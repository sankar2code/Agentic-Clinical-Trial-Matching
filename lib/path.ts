import { FACT_LABEL } from './data';
import { matchAll, type MatchContext } from './engine';
import type { CritResult, Fact, FactKey, MatchState, Patient, Trial, TrialMatch, Val } from './types';

export type StepKind = 'agent' | 'order' | 'clinician' | 'records' | 'medication' | 'informatics';

/** Lower means quicker and cheaper to do. Used only to break ties when ranking actions. */
export const STEP_EFFORT: Record<StepKind, number> = { agent: 1, order: 2, clinician: 3, records: 4, medication: 5, informatics: 6 };
export const KIND_LABEL: Record<StepKind, string> = {
  agent: 'Agent can try', order: 'Needs a new test or lab', clinician: 'Clinician decision', records: 'Outside records',
  medication: 'Medication decision', informatics: 'Rule approval',
};

export interface PlanStep {
  key: string;
  kind: StepKind;
  fact?: FactKey;
  label: string;
  owner: string;
  detail: string;
  lead: string;
  /** For agent steps: the question that runs it. */
  question?: string;
}

export interface TrialPlan {
  m: TrialMatch;
  steps: PlanStep[];
  hardBlockers: { fact: FactKey; text: string }[];
  /** False when something that cannot be changed (an ECOG, a prior line, a biomarker) rules the trial out. */
  reachable: boolean;
}

// The only failed criteria a clinician could plausibly change. Everything else that fails is a fact about the patient.
const MODIFIABLE: Partial<Record<FactKey, { label: string; owner: string; detail: string }>> = {
  strongCyp3a4: { label: 'Medication review: replace the interacting drug', owner: 'Prescriber and pharmacy', detail: 'A strong CYP3A4 inducer or inhibitor blocks this trial. Whether a non-interacting alternative exists, and any washout the protocol needs, is a clinical decision.' },
  steroidDose: { label: 'Review the corticosteroid dose', owner: 'Treating oncologist', detail: 'The dose is above the protocol limit. Whether it can be lowered is a clinical decision, and the protocol may need a stable lower dose first.' },
};

function stepFor(r: CritResult, p: Patient, searched: FactKey[]): PlanStep | 'hard' | null {
  const fact = r.criterion.rule.fact;
  const label = FACT_LABEL[fact];
  switch (r.status) {
    case 'met': return null;
    case 'pending':
      return { key: `informatics:${r.criterion.id}`, kind: 'informatics', label: `Approve the rule: ${r.criterion.text}`, owner: 'Clinical informaticist', detail: r.message, lead: 'review queue' };
    case 'review':
      return r.conflict
        ? { key: `clinician:${fact}`, kind: 'clinician', fact, label: `Adjudicate the conflicting ${label} results`, owner: 'Treating oncologist', detail: r.message, lead: 'at the visit' }
        : { key: `clinician:${fact}`, kind: 'clinician', fact, label: `Verify the extracted ${label} against its source`, owner: 'Treating oncologist or coordinator', detail: r.message, lead: 'at the visit' };
    case 'unknown':
      if (r.stale) return { key: `order:${fact}`, kind: 'order', fact, label: `Repeat ${label}`, owner: 'Ordering clinician', detail: r.message, lead: 'next draw' };
      if (p.externalOnly.includes(fact)) return { key: `records:${fact}`, kind: 'records', fact, label: `Obtain the external ${label} report`, owner: 'Health information management', detail: p.externalNote ?? 'The result exists outside the chart.', lead: 'days' };
      // Once the agent has searched and found nothing, searching again is not a next step: only a new test or record is.
      if (r.resolvable && !searched.includes(fact)) return { key: `agent:${fact}`, kind: 'agent', fact, label: `Search the chart for ${label}`, owner: 'Agent (read-only)', detail: 'The agent searches notes and reports. Every value it returns is checked against its cited text before it is used.', lead: 'about a minute', question: `Find the ${label}` };
      return { key: `order:${fact}`, kind: 'order', fact, label: `Obtain ${label}`, owner: 'Ordering clinician', detail: searched.includes(fact) ? `The agent searched the chart and found nothing. ${r.criterion.unknownStep}` : r.criterion.unknownStep, lead: 'next visit' };
    case 'notmet': {
      const mod = MODIFIABLE[fact];
      return mod ? { key: `medication:${fact}`, kind: 'medication', fact, label: mod.label, owner: mod.owner, detail: mod.detail, lead: 'depends on the drug' } : 'hard';
    }
  }
}

export function planFor(m: TrialMatch, p: Patient, searched: FactKey[] = []): TrialPlan {
  const steps: PlanStep[] = [];
  const hardBlockers: TrialPlan['hardBlockers'] = [];
  for (const r of m.results) {
    const s = stepFor(r, p, searched);
    if (s === 'hard') hardBlockers.push({ fact: r.criterion.rule.fact, text: r.criterion.text });
    else if (s && !steps.some((x) => x.key === s.key)) steps.push(s);
  }
  return { m, steps, hardBlockers, reachable: hardBlockers.length === 0 };
}

/** Plans for every live trial the patient is not already likely eligible for. `searched` lists values the agent already looked for and did not find. */
export function plansFor(matches: TrialMatch[], p: Patient, searched: FactKey[] = []): TrialPlan[] {
  return matches.filter((m) => m.state === 'near' || m.state === 'ineligible').map((m) => planFor(m, p, searched));
}

export interface ActionRank { step: PlanStep; trials: string[]; completes: string[] }

/** Which single action moves the most trials: first those it finishes on its own, then those it helps. */
export function rankActions(plans: TrialPlan[]): ActionRank[] {
  const map = new Map<string, ActionRank>();
  for (const pl of plans) {
    if (!pl.reachable || pl.steps.length === 0) continue;
    for (const s of pl.steps) {
      const e = map.get(s.key) ?? { step: s, trials: [], completes: [] };
      e.trials.push(pl.m.trial.code);
      if (pl.steps.length === 1) e.completes.push(pl.m.trial.code);
      map.set(s.key, e);
    }
  }
  return [...map.values()].sort((a, b) => b.completes.length - a.completes.length || b.trials.length - a.trials.length || STEP_EFFORT[a.step.kind] - STEP_EFFORT[b.step.kind] || a.step.label.localeCompare(b.step.label));
}

/* ------------------------------------ what-if sandbox ------------------------------------ */

export interface Hypothetical { key: FactKey; value: Val }

export interface WhatIfRow { trial: string; before: MatchState; after: MatchState; open: { before: number; after: number } }

/**
 * Run the engine on a copy of the chart in which these fields hold hypothetical values. Nothing is saved, nothing is
 * logged as a result, and the hypothetical values never become evidence: they live and die inside this call.
 */
export function whatIf(p: Patient, trials: Trial[], ctx: MatchContext, hyp: Hypothetical[], today: string): { rows: WhatIfRow[]; changed: WhatIfRow[] } {
  const keys = new Set(hyp.map((h) => h.key));
  const before = matchAll(p, trials, ctx);
  const copy: Patient = { ...p, facts: p.facts.filter((f) => !keys.has(f.key)) };
  const fake: Fact[] = hyp.map((h, i) => ({ key: h.key, value: h.value, date: today, by: 'ehr', source: { kind: 'FHIR', resource: 'Hypothetical', id: `what-if-${i}`, label: 'What-if value (not evidence)' } }));
  const overlay = { ...(ctx.overlay ?? {}), [p.id]: [...(ctx.overlay?.[p.id] ?? []).filter((f) => !keys.has(f.key)), ...fake] };
  const after = matchAll(copy, trials, { ...ctx, overlay, today });
  const open = (m: TrialMatch) => m.counts.unknown + m.counts.review + m.counts.pending;
  const rows = before.filter((b) => b.state !== 'filtered').map((b) => {
    const a = after.find((x) => x.trial.id === b.trial.id)!;
    return { trial: b.trial.code, before: b.state, after: a.state, open: { before: open(b), after: open(a) } };
  });
  return { rows, changed: rows.filter((r) => r.before !== r.after || r.open.before !== r.open.after) };
}
