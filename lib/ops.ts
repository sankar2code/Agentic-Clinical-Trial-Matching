/** Operational telemetry (PRD section 10): what is measured, where it is measured from, and when it should page someone. */
import { PATIENTS, TODAY } from './data';
import { COST_TARGET } from './guards';
import { matchAll, type MatchContext } from './engine';
import type { AuditEntry, FactKey, Override, Referral, Telemetry, Trial, UsageEvent } from './types';

export const TARGETS = { engineP95Ms: 10_000, agentP95Ms: 90_000, costPerRun: COST_TARGET, monthlyBudget: 5000, errorRate: 0.05, overrideRate: 0.1, unknownSpikePts: 10 };

const percentile = (xs: number[], p: number) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export interface OpsStats {
  engine: { n: number; p50: number; p95: number };
  agent: { n: number; ok: number; errors: number; successRate: number; p50: number; p95: number; avgCost: number; totalCost: number; capHits: number };
  ehrFailures: number;
  projectedMonthly: number;
  rejectedExtractions: number;
  quarantined: number;
  override: { overrides: number; reviewed: number; rate: number };
  approvals: { approved: number; edited: number; rejected: number; total: number };
}

export function opsStats(a: { telemetry: Telemetry[]; audit: AuditEntry[]; usage: UsageEvent[]; overrides: Record<string, Override>; referrals: Referral[]; trials: Trial[] }): OpsStats {
  const eng = a.telemetry.filter((t) => t.kind === 'engine').map((t) => t.ms ?? 0);
  const ag = a.telemetry.filter((t) => t.kind === 'agent');
  const agMs = ag.filter((t) => t.ok).map((t) => t.ms ?? 0);
  const totalCost = ag.reduce((s, t) => s + (t.cost ?? 0), 0);
  const avgCost = ag.length ? totalCost / ag.length : 0;
  const reviewed = a.usage.filter((u) => u.kind === 'trial.open').reduce((s, u) => s + (a.trials.find((t) => t.id === u.trialId)?.criteria.length ?? 0), 0);
  const overrides = Object.keys(a.overrides).length;
  // 200 point-of-care runs a day over 22 clinic days, plus the nightly re-screen and criteria parsing from the PRD's budget.
  const projectedMonthly = Math.round(avgCost * 200 * 22 + 750 + 50);
  return {
    engine: { n: eng.length, p50: round(percentile(eng, 50)), p95: round(percentile(eng, 95)) },
    agent: { n: ag.length, ok: ag.filter((t) => t.ok).length, errors: ag.filter((t) => !t.ok).length, successRate: ag.length ? round((ag.filter((t) => t.ok).length / ag.length) * 100, 1) : 100, p50: Math.round(percentile(agMs, 50)), p95: Math.round(percentile(agMs, 95)), avgCost: round(avgCost), totalCost: round(totalCost), capHits: ag.filter((t) => t.capHit).length },
    ehrFailures: a.telemetry.filter((t) => t.kind === 'ehr' && !t.ok).length,
    projectedMonthly,
    rejectedExtractions: a.audit.filter((e) => e.action === 'agent.extraction.rejected').length,
    quarantined: a.audit.filter((e) => e.action === 'agent.injection.quarantined').length,
    override: { overrides, reviewed, rate: reviewed ? round(overrides / reviewed, 3) : 0 },
    approvals: { approved: a.referrals.filter((r) => r.status === 'approved').length, edited: a.referrals.filter((r) => r.edited).length, rejected: a.referrals.filter((r) => r.status === 'rejected').length, total: a.referrals.length },
  };
}

export interface UnknownRate { fact: FactKey; unknown: number; total: number; rate: number }

/** Share of criteria on each field that come back Unknown, across every live pair. A jump means extraction broke. */
export function unknownRates(trials: Trial[], ctx: MatchContext): UnknownRate[] {
  const acc = new Map<FactKey, { unknown: number; total: number }>();
  for (const p of PATIENTS.filter((x) => x.treating)) {
    for (const m of matchAll(p, trials, { ...ctx, today: ctx.today ?? TODAY })) {
      if (m.state === 'filtered') continue;
      for (const r of m.results) {
        if (r.status === 'pending') continue;
        const e = acc.get(r.criterion.rule.fact) ?? { unknown: 0, total: 0 };
        e.total += 1;
        if (r.status === 'unknown') e.unknown += 1;
        acc.set(r.criterion.rule.fact, e);
      }
    }
  }
  return [...acc.entries()].map(([fact, v]) => ({ fact, ...v, rate: v.total ? round((v.unknown / v.total) * 100, 1) : 0 })).sort((a, b) => b.rate - a.rate);
}

export interface Alert { id: string; severity: 'critical' | 'warning' | 'info'; title: string; detail: string; runbook: string }

export function alertsFor(s: OpsStats, now: UnknownRate[], baseline: UnknownRate[]): Alert[] {
  const out: Alert[] = [];
  if (s.engine.n && s.engine.p95 >= TARGETS.engineP95Ms) out.push({ id: 'engine-latency', severity: 'critical', title: 'Engine latency over target', detail: `P95 ${s.engine.p95} ms against a ${TARGETS.engineP95Ms / 1000} s target.`, runbook: 'Check FHIR rate limits and the cache hit rate. Fall back to cached patient data.' });
  if (s.agent.n && s.agent.p95 >= TARGETS.agentP95Ms) out.push({ id: 'agent-latency', severity: 'critical', title: 'Agent latency over target', detail: `P95 ${Math.round(s.agent.p95 / 1000)} s against a ${TARGETS.agentP95Ms / 1000} s target.`, runbook: 'Switch the agent feature flag off. The panel falls back to engine-only results.' });
  if (s.agent.n >= 3 && s.agent.errors / s.agent.n > TARGETS.errorRate) out.push({ id: 'agent-errors', severity: 'warning', title: 'Agent error rate above 5%', detail: `${s.agent.errors} of ${s.agent.n} runs failed or timed out.`, runbook: 'Check the model endpoint and the BAA tenant status. Engine-only results remain available.' });
  if (s.agent.n && s.agent.avgCost > TARGETS.costPerRun) out.push({ id: 'cost-run', severity: 'warning', title: 'Cost per run over target', detail: `Average $${s.agent.avgCost.toFixed(2)} against a $${TARGETS.costPerRun.toFixed(2)} target.`, runbook: 'Tighten the pre-filter, raise cache coverage, and review the step cap.' });
  if (s.agent.n && s.projectedMonthly > TARGETS.monthlyBudget) out.push({ id: 'cost-month', severity: 'critical', title: 'Projected spend over the monthly ceiling', detail: `About $${s.projectedMonthly.toLocaleString()} a month against $${TARGETS.monthlyBudget.toLocaleString()}.`, runbook: 'Cap queries per user, move extraction to the smaller model, and extend cache lifetimes.' });
  if (s.ehrFailures > 0) out.push({ id: 'ehr', severity: 'warning', title: 'EHR calls failed', detail: `${s.ehrFailures} FHIR failure(s) this session.`, runbook: 'Confirm the FHIR endpoint and app registration. The panel shows no partial results while it is down.' });
  for (const n of now) {
    const b = baseline.find((x) => x.fact === n.fact);
    if (b && n.total >= 3 && n.rate - b.rate >= TARGETS.unknownSpikePts) out.push({ id: `unknown-${n.fact}`, severity: 'critical', title: `Unknown rate spike: ${n.fact}`, detail: `${n.rate}% Unknown now against ${b.rate}% at baseline (${n.unknown} of ${n.total} criteria). A spike usually means extraction regressed.`, runbook: 'Roll back the prompt and rule set (feature flag), then re-run affected results and flag them to coordinators.' });
  }
  if (s.override.reviewed >= 10 && s.override.rate > TARGETS.overrideRate) out.push({ id: 'override', severity: 'warning', title: 'Override rate above 10%', detail: `${s.override.overrides} overrides over ${s.override.reviewed} criteria reviewed.`, runbook: 'Review override reason codes. Extraction errors go to the ML backlog and rule errors to informatics.' });
  if (s.rejectedExtractions > 0) out.push({ id: 'span-rejections', severity: 'info', title: 'Extractions rejected by the span check', detail: `${s.rejectedExtractions} value(s) were stopped before they reached the chart.`, runbook: 'The guardrail worked. Sample the rejected values into the ML backlog.' });
  if (s.quarantined > 0) out.push({ id: 'injection', severity: 'info', title: 'Instruction-like text quarantined', detail: `${s.quarantined} document(s) contained text addressed to the AI.`, runbook: 'Review the source documents with InfoSec. The text was treated as data and ignored.' });
  return out.sort((a, b) => ({ critical: 0, warning: 1, info: 2 })[a.severity] - ({ critical: 0, warning: 1, info: 2 })[b.severity]);
}
