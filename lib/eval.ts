/**
 * Offline eval harness (PRD section 9). Runs the real engine and the real agent over the golden set and applies the PRD's
 * ship thresholds. No change should ship unless every row passes, and the safety rows have zero tolerance.
 */
import { PATIENTS, TODAY, TRIALS } from './data';
import { runAgent } from './agent';
import { effectiveFacts, matchAll } from './engine';
import { CRIT_TRUTH, CRIT_TRUTH_AGENT, TRUTH_FIELDS, UNKNOWN_TRUTH, goldPairs, pairKey } from './golden';
import { verifyExtraction } from './verify';
import type { CStatus, Fact, FactKey, Patient, Trial, TrialMatch } from './types';

export type Variant = 'current' | 'baseline' | 'previous' | 'candidate';
export const VARIANT_INFO: Record<Variant, { label: string; note: string }> = {
  current: { label: 'Current rules (as deployed in this session)', note: 'Includes any rule edits, approvals or amendments made in this session.' },
  baseline: { label: 'Ruleset 1.4.0 (pristine baseline)', note: 'The rules exactly as shipped, before any edits.' },
  previous: { label: 'Ruleset 1.3.2 (the rollback target)', note: 'Older release. Lab time windows were twice as long, so stale labs still counted.' },
  candidate: { label: 'Ruleset 1.5.0-rc (a candidate release)', note: 'A tidy-up that dropped the CYP3A4 drug-interaction exclusion from HELIX-EGFR.' },
};

const liveBase = () => TRIALS.filter((t) => !t.hiddenUntilOpened);

export function variantTrials(v: Exclude<Variant, 'current'>): Trial[] {
  const base = liveBase();
  if (v === 'baseline') return base;
  if (v === 'previous') {
    return base.map((t) => ({ ...t, ruleSet: 'ruleset-1.3.2', criteria: t.criteria.map((c) => (c.rule.windowDays ? { ...c, rule: { ...c.rule, windowDays: c.rule.windowDays * 2 } } : c)) }));
  }
  return base.map((t) => ({ ...t, ruleSet: 'ruleset-1.5.0-rc', criteria: t.criteria.filter((c) => !(t.code === 'HELIX-EGFR' && c.rule.fact === 'strongCyp3a4')) }));
}

export interface Metric {
  id: string;
  name: string;
  level: string;
  threshold: string;
  display: string;
  pass: boolean;
  n: number;
  critical?: boolean;
}
export interface Failure { metric: string; subject: string; expected: string; got: string }
export interface Group { attribute: string; value: string; n: number; accuracy: number }
export interface EvalReport {
  ruleSet: string;
  metrics: Metric[];
  failures: Failure[];
  gate: 'pass' | 'fail';
  failed: string[];
  groups: Group[];
  pairs: number;
  labels: number;
  latency: { p50: number; p95: number; n: number };
}

/** Run the agent until it has nothing more it can do, the way a clinician pressing the button repeatedly would. */
export function agentComplete(p: Patient, trials: Trial[], today = TODAY): { overlay: Fact[]; resolved: Fact[] } {
  let overlay: Fact[] = [];
  const skip: FactKey[] = [];
  for (let i = 0; i < 6; i++) {
    const r = runAgent(p, trials, 'Find the missing values', [], { [p.id]: overlay }, {}, { skip, today });
    skip.push(...r.searchedAbsent);
    if (r.resolved.length === 0) break;
    overlay = [...overlay, ...r.resolved];
  }
  return { overlay, resolved: overlay };
}

const pct = (a: number, b: number) => (b === 0 ? 100 : Math.round((a / b) * 1000) / 10);

function resultFor(ms: TrialMatch[], code: string, fact: FactKey) {
  const m = ms.find((x) => x.trial.code === code);
  if (!m || m.state === 'filtered') return null;
  return m.results.find((r) => r.criterion.rule.fact === fact) ?? null;
}

function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

export function runEval(trials: Trial[]): EvalReport {
  const patients = PATIENTS.filter((p) => p.treating);
  const failures: Failure[] = [];
  const engine = new Map<string, TrialMatch[]>();
  const agent = new Map<string, { ms: TrialMatch[]; overlay: Fact[] }>();
  for (const p of patients) {
    engine.set(p.id, matchAll(p, trials, {}));
    const { overlay } = agentComplete(p, trials);
    agent.set(p.id, { overlay, ms: matchAll(p, trials, { overlay: { [p.id]: overlay } }) });
  }

  // 1. Criterion accuracy (Met / Not met), on the chart as it stands and after the agent has run
  let cOk = 0, cN = 0;
  const check = (key: string, truth: CStatus, ms: TrialMatch[], stage: string) => {
    const [pid, code, fact] = key.split('|');
    void pid;
    const r = resultFor(ms, code, fact as FactKey);
    const got = r ? r.status : 'missing';
    if (truth === 'met' || truth === 'notmet') {
      cN += 1;
      if (got === truth) cOk += 1; else failures.push({ metric: 'criterion', subject: `${key} (${stage})`, expected: truth, got });
    }
    return got;
  };
  let unsupported = 0;
  for (const [key, truth] of Object.entries(CRIT_TRUTH)) {
    const pid = key.split('|')[0];
    const got = check(key, truth, engine.get(pid)!, 'chart as it stands');
    if ((truth === 'unknown' || truth === 'review' || truth === 'pending') && got === 'met') {
      unsupported += 1;
      failures.push({ metric: 'unsupported-met', subject: key, expected: truth, got: 'met' });
    }
  }
  for (const [key, truth] of Object.entries(CRIT_TRUTH_AGENT)) check(key, truth, agent.get(key.split('|')[0])!.ms, 'after the agent');

  // 2. Appropriate Unknown, after the agent
  const seen = new Set<string>();
  let uOk = 0, uN = 0;
  for (const p of patients) {
    for (const m of agent.get(p.id)!.ms.filter((x) => x.state !== 'filtered')) {
      for (const r of m.results.filter((x) => x.status === 'unknown')) {
        const k = `${p.id}|${r.criterion.rule.fact}`;
        if (seen.has(k)) continue;
        seen.add(k);
        uN += 1;
        if (UNKNOWN_TRUTH[k] === 'absent') uOk += 1;
        else failures.push({ metric: 'unknown', subject: k, expected: 'absent from the chart (Unknown is appropriate)', got: UNKNOWN_TRUTH[k] === 'findable' ? 'findable but still Unknown' : 'no label' });
      }
    }
  }

  // 3. Citation validity: every Met has a source that opens and supports it
  let vOk = 0, vN = 0;
  for (const [stage, get] of [['chart', (p: Patient) => engine.get(p.id)!], ['agent', (p: Patient) => agent.get(p.id)!.ms]] as const) {
    for (const p of patients) {
      for (const m of get(p).filter((x) => x.state !== 'filtered')) {
        for (const r of m.results.filter((x) => x.status === 'met')) {
          vN += 1;
          const e = r.evidence[0];
          let ok = !!e && !!e.source.id;
          if (ok && e.source.kind !== 'FHIR') {
            const doc = p.docs.find((d) => d.id === e.source.docId) ?? e.source.inlineDoc;
            ok = verifyExtraction(e.key, e.value, e.source.span, doc).ok;
          }
          if (ok) vOk += 1; else failures.push({ metric: 'citation', subject: `${p.id}|${m.trial.code}|${r.criterion.rule.fact} (${stage})`, expected: 'a source that opens and supports the value', got: 'no valid citation' });
        }
      }
    }
  }

  // 4. Key-field extraction, after the agent
  const fields: FactKey[] = ['pdl1', 'ecog', 'egfr', 'stage'];
  const perField: Record<string, { ok: number; got: number; truth: number }> = {};
  for (const f of fields) perField[f] = { ok: 0, got: 0, truth: 0 };
  for (const p of patients) {
    const facts = effectiveFacts(p, { [p.id]: agent.get(p.id)!.overlay });
    for (const f of fields) {
      const truth = TRUTH_FIELDS[p.id]?.[f];
      if (truth === undefined) continue;
      perField[f].truth += 1;
      const have = facts.filter((x) => x.key === f && x.date <= TODAY).sort((a, b) => b.date.localeCompare(a.date))[0];
      if (have) {
        perField[f].got += 1;
        if (have.value === truth) perField[f].ok += 1;
        else failures.push({ metric: 'extraction', subject: `${p.id}|${f}`, expected: String(truth), got: String(have.value) });
      } else failures.push({ metric: 'extraction', subject: `${p.id}|${f}`, expected: String(truth), got: 'not extracted' });
    }
  }
  const worst = fields.map((f) => ({ f, acc: pct(perField[f].ok, perField[f].truth) })).sort((a, b) => a.acc - b.acc)[0];

  // 5. Recall@5 of eligible trials (adjudicated truth after the agent)
  let rHit = 0, rN = 0;
  for (const p of patients) {
    const truthEligible = goldPairs().filter((g) => g.pid === p.id && g.agent === 'eligible').map((g) => g.tid);
    if (truthEligible.length === 0) continue;
    const top5 = agent.get(p.id)!.ms.filter((m) => m.state !== 'filtered').slice(0, 5).map((m) => m.trial.id);
    for (const tid of truthEligible) {
      rN += 1;
      if (top5.includes(tid) && agent.get(p.id)!.ms.find((m) => m.trial.id === tid)?.state === 'eligible') rHit += 1;
      else failures.push({ metric: 'recall', subject: `${p.id}|${tid}`, expected: 'likely eligible, in the top 5', got: agent.get(p.id)!.ms.find((m) => m.trial.id === tid)?.state ?? 'missing' });
    }
  }

  // 6. Agent task success: findable Unknowns resolved with the correct value
  let aOk = 0, aN = 0;
  for (const [k, kind] of Object.entries(UNKNOWN_TRUTH)) {
    if (kind !== 'findable') continue;
    const [pid, fact] = k.split('|') as [string, FactKey];
    aN += 1;
    const got = agent.get(pid)!.overlay.find((f) => f.key === fact);
    if (got && got.value === TRUTH_FIELDS[pid]?.[fact]) aOk += 1; else failures.push({ metric: 'agent', subject: k, expected: String(TRUTH_FIELDS[pid]?.[fact]), got: got ? String(got.value) : 'not resolved' });
  }

  // 7. Latency of the engine on this machine, over every patient, repeated
  const times: number[] = [];
  for (let rep = 0; rep < 12; rep++) for (const p of patients) { const t0 = performance.now(); matchAll(p, trials, {}); times.push(performance.now() - t0); }
  const latency = { p50: Math.round(percentile(times, 50) * 100) / 100, p95: Math.round(percentile(times, 95) * 100) / 100, n: times.length };

  // 8. Safety: a pair reported likely eligible that the adjudicators say is not
  let falseElig = 0;
  const pairAcc = { ok: 0, n: 0 };
  const byPatient: Record<string, { ok: number; n: number }> = {};
  for (const g of goldPairs()) {
    const ms = agent.get(g.pid)!.ms;
    const m = ms.find((x) => x.trial.id === g.tid);
    const got = m ? m.state : 'missing';
    const key = pairKey(g.pid, g.tid);
    pairAcc.n += 1;
    (byPatient[g.pid] ??= { ok: 0, n: 0 }).n += 1;
    if (got === g.agent) { pairAcc.ok += 1; byPatient[g.pid].ok += 1; }
    else failures.push({ metric: 'pair', subject: key, expected: g.agent, got });
    if (got === 'eligible' && g.agent !== 'eligible') {
      falseElig += 1;
      failures.push({ metric: 'false-eligible', subject: key, expected: g.agent, got: 'eligible' });
    }
  }

  // 9. Equity: pair accuracy by subgroup. Small groups, so treat as an illustration of the method.
  const groups: Group[] = [];
  const attrs: [string, (p: Patient) => string][] = [
    ['Language', (p) => (p.language === 'English' ? 'English' : 'Non-English')], ['Sex', (p) => p.sex], ['Age', (p) => (p.age >= 65 ? '65 and over' : 'Under 65')], ['Race/ethnicity', (p) => p.race],
  ];
  let gap = 0;
  for (const [attr, f] of attrs) {
    const acc: Record<string, { ok: number; n: number }> = {};
    for (const p of patients) { const b = byPatient[p.id]; if (!b) continue; const k = f(p); (acc[k] ??= { ok: 0, n: 0 }); acc[k].ok += b.ok; acc[k].n += b.n; }
    const vals = Object.entries(acc).map(([value, a]) => ({ attribute: attr, value, n: a.n, accuracy: pct(a.ok, a.n) }));
    groups.push(...vals);
    if (vals.length > 1) gap = Math.max(gap, Math.max(...vals.map((v) => v.accuracy)) - Math.min(...vals.map((v) => v.accuracy)));
  }

  const ruleSet = trials[0]?.ruleSet ?? 'unknown';
  const metrics: Metric[] = [
    { id: 'criterion', name: 'Criterion accuracy (Met / Not met)', level: 'Criterion', threshold: '≥ 95%', display: `${pct(cOk, cN)}%`, pass: pct(cOk, cN) >= 95, n: cN },
    { id: 'unknown', name: 'Appropriate Unknown (after the agent)', level: 'Criterion', threshold: '≥ 90%', display: `${pct(uOk, uN)}%`, pass: pct(uOk, uN) >= 90, n: uN },
    { id: 'citation', name: 'Citation validity', level: 'Criterion', threshold: '100%', display: `${pct(vOk, vN)}%`, pass: vOk === vN, n: vN },
    { id: 'extraction', name: 'Key-field extraction (PD-L1, ECOG, eGFR, stage), worst field', level: 'Field', threshold: '≥ 95% each', display: `${worst.acc}% (${worst.f})`, pass: worst.acc >= 95, n: fields.reduce((a, f) => a + perField[f].truth, 0) },
    { id: 'recall', name: 'Recall@5 of eligible trials', level: 'Trial', threshold: '≥ 90%', display: `${pct(rHit, rN)}%`, pass: pct(rHit, rN) >= 90, n: rN },
    { id: 'agent', name: 'Agent task success', level: 'Agent', threshold: '≥ 85%', display: `${pct(aOk, aN)}%`, pass: pct(aOk, aN) >= 85, n: aN },
    { id: 'latency', name: 'Engine latency P95', level: 'System', threshold: '< 10 s', display: `${latency.p95} ms`, pass: latency.p95 < 10000, n: latency.n },
    { id: 'equity', name: 'Subgroup accuracy gap', level: 'Equity', threshold: '≤ 5 points', display: `${Math.round(gap * 10) / 10} pts`, pass: gap <= 5, n: groups.reduce((a, g) => a + g.n, 0) },
    { id: 'false-eligible', name: 'Likely eligible when adjudicated otherwise', level: 'Safety', threshold: '0', display: String(falseElig), pass: falseElig === 0, n: pairAcc.n, critical: true },
    { id: 'unsupported-met', name: 'Unknown or Needs review reported as Met', level: 'Safety', threshold: '0', display: String(unsupported), pass: unsupported === 0, n: Object.values(CRIT_TRUTH).filter((x) => x === 'unknown' || x === 'review' || x === 'pending').length, critical: true },
  ];
  const failed = metrics.filter((m) => !m.pass).map((m) => m.id);
  return { ruleSet, metrics, failures, gate: failed.length === 0 ? 'pass' : 'fail', failed, groups, pairs: pairAcc.n, labels: Object.keys(CRIT_TRUTH).length + Object.keys(CRIT_TRUTH_AGENT).length, latency };
}
