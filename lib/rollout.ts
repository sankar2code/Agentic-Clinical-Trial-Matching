/** Rollout modes (PRD section 9): shadow first, then human-in-the-loop, then steady state with a weekly double-review sample. */
import { isDismissed, matchAll, type MatchContext } from './engine';
import { sha256 } from './sha';
import { MANUAL_SEED, SYSTEM_TO_BINARY, goldPairs, pairKey } from './golden';
import type { Adjudication, Dismissal, DoubleReview, ManualDecision, MatchState, Mode, Patient, Trial } from './types';

export const MODE_INFO: Record<Mode, { label: string; summary: string; rule: string }> = {
  shadow: { label: 'Shadow', summary: 'The system runs and logs results, but clinicians do not see them. Coordinators screen as usual and the two are compared.', rule: 'Results are hidden from clinicians and coordinators.' },
  hitl: { label: 'Human-in-the-loop', summary: 'Clinicians see results and adjudicate every recommendation as agree or disagree.', rule: 'Every recommendation shows adjudication controls.' },
  steady: { label: 'Steady state', summary: 'Clinicians use results normally. A deterministic 5% sample of results is double-reviewed each week.', rule: 'Sampled results show a double-review flag.' },
};

export const SAMPLE_RATE = 5;

/** Cohen's kappa for two binary raters: agreement beyond what chance alone would give. */
export function kappa(a: boolean[], b: boolean[]): number {
  const n = a.length;
  if (n === 0 || n !== b.length) return 0;
  const po = a.filter((x, i) => x === b[i]).length / n;
  const pa = a.filter(Boolean).length / n;
  const pb = b.filter(Boolean).length / n;
  const pe = pa * pb + (1 - pa) * (1 - pb);
  return pe === 1 ? 1 : Math.round(((po - pe) / (1 - pe)) * 1000) / 1000;
}

export interface Row {
  pair: string;
  pid: string;
  tid: string;
  manual: ManualDecision;
  system: MatchState;
  truth: MatchState;
  manualPos: boolean;
  systemPos: boolean;
  truthPos: boolean;
  agree: boolean;
  right: 'both' | 'system' | 'manual' | 'neither';
}

/** Compare the system with the coordinators' own screening, using the adjudicated truth after the agent. */
export function compareShadow(system: Record<string, MatchState>, manual: Record<string, ManualDecision> = MANUAL_SEED): Row[] {
  return goldPairs().map((g) => {
    const pair = pairKey(g.pid, g.tid);
    const m = manual[pair] ?? 'not screened';
    const s = system[pair] ?? 'filtered';
    const truthPos = SYSTEM_TO_BINARY(g.agent);
    const manualPos = m === 'eligible';
    const systemPos = SYSTEM_TO_BINARY(s);
    const mOk = manualPos === truthPos;
    const sOk = systemPos === truthPos;
    return { pair, pid: g.pid, tid: g.tid, manual: m, system: s, truth: g.agent, manualPos, systemPos, truthPos, agree: manualPos === systemPos, right: mOk && sOk ? 'both' : sOk ? 'system' : mOk ? 'manual' : 'neither' };
  });
}

export interface ShadowStats {
  n: number;
  agreement: number;
  kappa: number;
  system: { tp: number; fp: number; fn: number; tn: number; precision: number; recall: number; accuracy: number };
  manual: { tp: number; fp: number; fn: number; tn: number; precision: number; recall: number; accuracy: number };
  incrementalFinds: Row[];
  catches: Row[];
  missed: Row[];
}

const ratio = (a: number, b: number) => (b === 0 ? 100 : Math.round((a / b) * 1000) / 10);
function conf(rows: Row[], pos: (r: Row) => boolean) {
  const tp = rows.filter((r) => pos(r) && r.truthPos).length;
  const fp = rows.filter((r) => pos(r) && !r.truthPos).length;
  const fn = rows.filter((r) => !pos(r) && r.truthPos).length;
  const tn = rows.filter((r) => !pos(r) && !r.truthPos).length;
  return { tp, fp, fn, tn, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn), accuracy: ratio(tp + tn, rows.length) };
}

export function shadowStats(rows: Row[]): ShadowStats {
  return {
    n: rows.length,
    agreement: ratio(rows.filter((r) => r.agree).length, rows.length),
    kappa: kappa(rows.map((r) => r.systemPos), rows.map((r) => r.manualPos)),
    system: conf(rows, (r) => r.systemPos),
    manual: conf(rows, (r) => r.manualPos),
    incrementalFinds: rows.filter((r) => r.systemPos && r.truthPos && !r.manualPos),
    catches: rows.filter((r) => r.manualPos && !r.truthPos && !r.systemPos),
    missed: rows.filter((r) => !r.systemPos && r.truthPos),
  };
}

/** Deterministic weekly sample: the same pairs every time for the same week, with no randomness to argue about. */
export function sampleFor(pairs: string[], ratePct: number, week: string): string[] {
  const scored = pairs.map((p) => ({ p, s: parseInt(sha256(`${week}|${p}`).slice(0, 8), 16) })).sort((a, b) => a.s - b.s || a.p.localeCompare(b.p));
  return scored.slice(0, Math.min(pairs.length, Math.max(1, Math.ceil((pairs.length * ratePct) / 100)))).map((x) => x.p);
}

export function isoWeek(date: string): string {
  const d = new Date(date + 'T12:00:00Z');
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - first.getTime()) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export interface ExitCriterion { id: string; label: string; ok: boolean; detail: string }

/** What has to be true before the next mode. Computed live, so promotion is evidence, not a button. */
export function exitCriteria(mode: Mode, a: {
  gatePass: boolean; failedGate: string[]; stats: ShadowStats;
  recommendations: number; adjudicated: number; agreeRate: number; disagreements: number;
}): ExitCriterion[] {
  if (mode === 'shadow') {
    return [
      { id: 'gate', label: 'Offline eval gate passes on the current rules', ok: a.gatePass, detail: a.gatePass ? 'Every metric is at or above its threshold.' : `Failing: ${a.failedGate.join(', ')}.` },
      { id: 'acc', label: 'System accuracy against adjudicated truth ≥ 95%', ok: a.stats.system.accuracy >= 95, detail: `${a.stats.system.accuracy}% over ${a.stats.n} pairs.` },
      { id: 'fp', label: 'No pair reported likely eligible that adjudicators reject', ok: a.stats.system.fp === 0, detail: `${a.stats.system.fp} false positive(s).` },
      { id: 'rec', label: 'System finds at least as many eligible patients as manual screening', ok: a.stats.system.recall >= a.stats.manual.recall, detail: `System recall ${a.stats.system.recall}% vs manual ${a.stats.manual.recall}%.` },
      { id: 'vol', label: 'At least 30 pairs compared', ok: a.stats.n >= 30, detail: `${a.stats.n} pairs.` },
    ];
  }
  if (mode === 'hitl') {
    return [
      { id: 'cov', label: 'At least 90% of recommendations adjudicated', ok: a.recommendations > 0 && a.adjudicated / a.recommendations >= 0.9, detail: `${a.adjudicated} of ${a.recommendations} adjudicated.` },
      { id: 'agree', label: 'Clinicians agree with at least 90% of what they adjudicated', ok: a.adjudicated > 0 && a.agreeRate >= 90, detail: a.adjudicated ? `${a.agreeRate}% agreement, ${a.disagreements} disagreement(s).` : 'Nothing adjudicated yet.' },
    ];
  }
  return [{ id: 'sample', label: 'Weekly double-review sample completed', ok: false, detail: 'Tracked on the queue below.' }];
}

export const reviewState = (r?: DoubleReview) => ({ complete: !!r?.coordinator && !!r?.governance, agree: !!r?.coordinator && r.coordinator === r.governance });

export const agreeRate = (adj: Record<string, Adjudication>) => {
  const v = Object.values(adj);
  return v.length ? Math.round((v.filter((x) => x.verdict === 'agree').length / v.length) * 1000) / 10 : 0;
};


/** A double review belongs to one week's sample. The same pair sampled again in a later week needs its own review. */
export const reviewKey = (week: string, pair: string) => `${week}|${pair}`;

export interface Recommendation { pid: string; tid: string; name: string; code: string; state: MatchState }

/**
 * What the clinicians are asked to adjudicate: every likely or near-eligible trial the treating clinician has not
 * dismissed. A dismissed trial has no card to adjudicate, so counting it would make the exit criterion unreachable.
 */
export function recommendationsOf(patients: Patient[], trials: Trial[], ctx: MatchContext, dismissals: Record<string, Dismissal>): Recommendation[] {
  const out: Recommendation[] = [];
  for (const p of patients.filter((x) => x.treating)) {
    for (const m of matchAll(p, trials, ctx)) {
      if ((m.state === 'eligible' || m.state === 'near') && !isDismissed(dismissals, p.id, m.trial.id)) out.push({ pid: p.id, tid: m.trial.id, name: p.name, code: m.trial.code, state: m.state });
    }
  }
  return out;
}
