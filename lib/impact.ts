import { matchTrial, type MatchContext } from './engine';
import type { CStatus, MatchState, Patient, ReviewStatus, Rule, Trial } from './types';

export interface ImpactRow { patientId: string; patient: string; trial: string; from: MatchState; to: MatchState }
export interface CritChange { patientId: string; patient: string; from: CStatus; to: CStatus }
export interface Impact {
  patients: number;
  states: ImpactRow[];
  criteria: CritChange[];
  eligibleLost: ImpactRow[];
  eligibleGained: ImpactRow[];
  /** True when applying this would remove someone from likely eligible, which a reviewer must acknowledge. */
  risky: boolean;
}

/**
 * Dry run: who would change if this rule were saved with this review decision? Nothing is written. A reviewer sees the
 * blast radius across the whole cohort before approving, instead of finding out from the worklist afterwards.
 */
export function ruleImpact(a: { patients: Patient[]; trials: Trial[]; ctx: MatchContext; tid: string; cid: string; rule?: Rule; review: ReviewStatus }): Impact {
  const trial = a.trials.find((t) => t.id === a.tid);
  const empty: Impact = { patients: 0, states: [], criteria: [], eligibleLost: [], eligibleGained: [], risky: false };
  if (!trial) return empty;
  const after: Trial = { ...trial, criteria: trial.criteria.map((c) => (c.id === a.cid ? { ...c, review: a.review, rule: a.rule ?? c.rule } : c)) };
  const states: ImpactRow[] = [];
  const criteria: CritChange[] = [];
  let seen = 0;
  for (const p of a.patients.filter((x) => x.treating)) {
    const b = matchTrial(p, trial, a.ctx);
    const n = matchTrial(p, after, a.ctx);
    if (b.state === 'filtered' && n.state === 'filtered') continue;
    seen += 1;
    if (b.state !== n.state) states.push({ patientId: p.id, patient: p.name, trial: trial.code, from: b.state, to: n.state });
    const rb = b.results.find((r) => r.criterion.id === a.cid)?.status;
    const rn = n.results.find((r) => r.criterion.id === a.cid)?.status;
    if (rb && rn && rb !== rn) criteria.push({ patientId: p.id, patient: p.name, from: rb, to: rn });
  }
  const eligibleLost = states.filter((s) => s.from === 'eligible' && s.to !== 'eligible');
  const eligibleGained = states.filter((s) => s.to === 'eligible' && s.from !== 'eligible');
  return { patients: seen, states, criteria, eligibleLost, eligibleGained, risky: eligibleLost.length > 0 };
}

/**
 * What a reviewer acknowledges is a specific list of people who would stop being likely eligible. The signature names that
 * list, so an acknowledgement given for one edit never carries over to another edit that costs different patients.
 */
export const ackSignature = (i: Impact | null) => (i ? i.eligibleLost.map((x) => x.patientId).sort().join(',') : '');
