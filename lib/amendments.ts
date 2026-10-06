import type { Criterion, FactKey, Referral, Rule, Trial } from './types';

/** A protocol amendment as it would arrive from the nightly ClinicalTrials.gov sync. */
export interface AmendmentChange {
  kind: 'changed' | 'removed' | 'added';
  /** Which existing criterion this refers to (matched by the field it measures). Not used for 'added'. */
  fact?: FactKey;
  to?: { text: string; type: 'inclusion' | 'exclusion'; rule: Rule; parseConfidence: number; unknownStep?: string };
}

export interface Amendment {
  id: string;
  trialId: string;
  version: string;
  postedOn: string;
  source: string;
  summary: string;
  /** Plain-language effect, for the diff view. */
  effect: 'widens' | 'narrows' | 'mixed';
  changes: AmendmentChange[];
}

export const AMENDMENTS: Amendment[] = [
  {
    id: 'A1', trialId: 't1', version: 'Protocol v4.0', postedOn: '2026-10-05', source: 'ClinicalTrials.gov record update',
    summary: 'Sponsor broadens the population: PD-L1 threshold lowered and one prior line of therapy now allowed.', effect: 'widens',
    changes: [
      { kind: 'changed', fact: 'pdl1', to: { text: 'PD-L1 tumor proportion score of 10% or higher', type: 'inclusion', rule: { fact: 'pdl1', op: '>=', value: 10 }, parseConfidence: 0.93 } },
      { kind: 'changed', fact: 'priorLines', to: { text: 'No more than one prior line of systemic therapy for metastatic disease', type: 'inclusion', rule: { fact: 'priorLines', op: '<=', value: 1 }, parseConfidence: 0.9 } },
    ],
  },
  {
    id: 'A2', trialId: 't2', version: 'Protocol v2.1', postedOn: '2026-10-05', source: 'ClinicalTrials.gov record update',
    summary: 'Sponsor narrows the population: only patients with no prior systemic therapy.', effect: 'narrows',
    changes: [
      { kind: 'changed', fact: 'priorLines', to: { text: 'Treatment-naive for advanced disease (no prior systemic therapy)', type: 'inclusion', rule: { fact: 'priorLines', op: '<=', value: 0 }, parseConfidence: 0.91 } },
    ],
  },
];

export const amendmentById = (id: string) => AMENDMENTS.find((a) => a.id === id);

function matchFact(t: Trial, fact: FactKey): number {
  return t.criteria.findIndex((c) => c.rule.fact === fact && !c.amended);
}

/** The amended trial. Changed criteria get a new id and go back to review: the old approval does not carry over. */
export function applyAmendment(trial: Trial, a: Amendment): Trial {
  if (a.trialId !== trial.id) return trial;
  let criteria: Criterion[] = trial.criteria.slice();
  for (const ch of a.changes) {
    if (ch.kind === 'added' && ch.to) {
      criteria.push({ id: `a${a.id}.n${criteria.length}`, type: ch.to.type, text: ch.to.text, rule: ch.to.rule, review: 'pending', parseConfidence: ch.to.parseConfidence, unknownStep: ch.to.unknownStep ?? 'Locate the value in the chart' });
      continue;
    }
    if (!ch.fact) continue;
    const i = matchFact({ ...trial, criteria }, ch.fact);
    if (i < 0) continue;
    const old = criteria[i];
    if (ch.kind === 'removed') { criteria = criteria.filter((_, j) => j !== i); continue; }
    if (ch.kind === 'changed' && ch.to) {
      criteria[i] = {
        id: `${old.id}.${a.id}`, type: ch.to.type, text: ch.to.text, rule: ch.to.rule, review: 'pending', parseConfidence: ch.to.parseConfidence,
        unknownStep: ch.to.unknownStep ?? old.unknownStep, amended: { amendment: a.id, from: { text: old.text, type: old.type, rule: old.rule } },
      };
    }
  }
  return { ...trial, criteria, ruleSet: `${trial.ruleSet}+${a.id}`, amendments: [...(trial.amendments ?? []), a.id] };
}

export interface DiffRow { kind: 'changed' | 'removed' | 'added'; before?: { text: string; rule: Rule; type: string }; after?: { text: string; rule: Rule; type: string } }

/** Side-by-side view of what an amendment does to the trial as it stood before. */
export function describeAmendment(trial: Trial, a: Amendment): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const ch of a.changes) {
    const old = ch.fact ? trial.criteria.find((c) => c.rule.fact === ch.fact && !c.amended) : undefined;
    rows.push({
      kind: ch.kind,
      before: old ? { text: old.text, rule: old.rule, type: old.type } : undefined,
      after: ch.to ? { text: ch.to.text, rule: ch.to.rule, type: ch.to.type } : undefined,
    });
  }
  return rows;
}

/**
 * Amendments to this referral's trial that were applied after its evidence summary was written, and not since re-confirmed.
 * The summary is written when the draft is created, so a draft approved after an amendment is as stale as an approved one.
 */
export function amendedSince(r: Pick<Referral, 'trialId' | 'createdAt' | 'confirmedAt'>, applied: { id: string; appliedAt: string }[]): string[] {
  const from = r.confirmedAt ?? r.createdAt;
  return applied.filter((a) => AMENDMENTS.find((x) => x.id === a.id)?.trialId === r.trialId && a.appliedAt > from).map((a) => a.id);
}
