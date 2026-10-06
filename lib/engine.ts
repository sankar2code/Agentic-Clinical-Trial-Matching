import { TODAY, fmtVal } from './data';
import { validateRule } from './rules';
import type { CritResult, CStatus, Criterion, Dismissal, Fact, FactKey, MatchState, Override, Patient, Rule, Snapshot, Trial, TrialMatch, Val } from './types';

// Facts that do not change over time: two different values from different sources are a conflict.
const STATIC: FactKey[] = ['pdl1', 'egfrMut', 'alkFusion', 'krasG12c', 'brainMets', 'histology', 'diagnosis'];
// Treated as unresolvable by search of the chart alone (a new draw or scan is needed).
const NEEDS_NEW_DATA: FactKey[] = ['egfr', 'anc', 'platelets', 'lvef'];

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
}

/** A real calendar date in ISO form. "2026-99-99" and "2026-02-30" have the right shape and are not dates. */
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Demographics are not observations that appear on a date: a patient's age is known at every as-of date.
const TIMELESS: FactKey[] = ['age'];

/** As-of semantics: a value dated after the query date does not exist yet (this is what makes time travel and replay honest). */
export const visibleAt = (f: Fact, today: string) => TIMELESS.includes(f.key) || f.date <= today;

function compare(op: Rule['op'], actual: Val, expected: Rule['value']): boolean {
  switch (op) {
    case '>=': return Number(actual) >= Number(expected);
    case '<=': return Number(actual) <= Number(expected);
    case '>': return Number(actual) > Number(expected);
    case '<': return Number(actual) < Number(expected);
    case '==': return actual === expected;
    case '!=': return actual !== expected;
    case 'in': return Array.isArray(expected) && expected.includes(String(actual));
  }
}

export const overrideKey = (p: string, t: string, c: string) => `${p}|${t}|${c}`;

export const MIN_CITATION = 8;

export function evalCriterion(c: Criterion, facts: Fact[], today: string, override?: Override): CritResult {
  const base = { criterion: c } as const;
  const mine = facts.filter((f) => f.key === c.rule.fact && visibleAt(f, today)).sort((a, b) => b.date.localeCompare(a.date));
  const resolvable = !NEEDS_NEW_DATA.includes(c.rule.fact);

  let res: CritResult;
  const problems = c.review === 'approved' ? validateRule(c.rule) : [];
  if (c.review !== 'approved') {
    res = { ...base, status: 'pending', evidence: [], message: c.review === 'rejected' ? 'Rule rejected by reviewer; not evaluated.' : 'Rule awaiting reviewer approval; not evaluated.' };
  } else if (problems.length > 0) {
    // Defence in depth: a malformed rule must never silently turn into Not met for every patient.
    res = { ...base, status: 'pending', evidence: [], message: `Rule failed validation and was not evaluated: ${problems[0]}` };
  } else if (mine.length === 0) {
    res = { ...base, status: 'unknown', evidence: [], message: 'No value found in the chart.', nextStep: c.unknownStep, resolvable };
  } else {
    const distinct = new Set(mine.map((f) => String(f.value)));
    if (STATIC.includes(c.rule.fact) && distinct.size > 1) {
      res = { ...base, status: 'review', evidence: mine, conflict: true, message: `Conflicting sources: ${mine.map((f) => `${fmtVal(f.key, f.value)} (${f.date})`).join(' vs ')}.`, nextStep: 'Clinician to adjudicate which source is correct' };
    } else {
      const latest = mine[0];
      const age = daysBetween(latest.date, today);
      // Written as a negated "within", so an age that cannot be computed counts as outside the window instead of inside it.
      if (c.rule.windowDays !== undefined && !(age <= c.rule.windowDays)) {
        res = { ...base, status: 'unknown', evidence: [latest], stale: true, message: `Latest value is ${age} days old; the criterion requires within ${c.rule.windowDays} days.`, nextStep: c.unknownStep, resolvable: false };
      } else if (latest.confidence !== undefined && latest.confidence < 0.7) {
        res = { ...base, status: 'review', evidence: [latest], lowConfidence: true, message: `Extraction confidence ${Math.round(latest.confidence * 100)}%, below the 70% floor. Verify against the source.`, nextStep: 'Verify extracted value against the source document' };
      } else {
        const ok = compare(c.rule.op, latest.value, c.rule.value);
        res = { ...base, status: ok ? 'met' : 'notmet', evidence: [latest], message: ok ? 'Criterion satisfied.' : 'Criterion not satisfied.' };
        if (latest.confidence !== undefined && latest.confidence < 0.9) res.lowConfidence = true;
      }
    }
  }
  if (override && res.status !== 'pending') {
    // PRD section 6: a criterion cannot be Met without a citation. An override to Met must carry the clinician's own.
    if (override.to === 'met' && (override.citation ?? '').trim().length < MIN_CITATION) {
      res = { ...res, message: `${res.message} An override to Met was ignored because it has no citation.` };
    } else {
      res = {
        ...res, status: override.to, override, attested: override.to === 'met',
        message: `Clinician override (${override.reason}): ${override.note || 'no note'}`,
        nextStep: undefined,
      };
    }
  }
  return res;
}

export function describeRule(r: Rule): string {
  const v = Array.isArray(r.value) ? `[${r.value.join(', ')}]` : String(r.value);
  return `${r.fact} ${r.op} ${v}${r.windowDays ? ` within ${r.windowDays}d` : ''}`;
}

function latestOf(facts: Fact[], key: FactKey, today: string): Val | undefined {
  return facts.filter((f) => f.key === key && visibleAt(f, today)).sort((a, b) => b.date.localeCompare(a.date))[0]?.value;
}

export interface MatchContext {
  overlay?: Record<string, Fact[]>;
  overrides?: Record<string, Override>;
  /** The as-of (query) date. Defaults to the app's fixed date. */
  today?: string;
  /** Regression drill: ignore values extracted from documents for these fields, as if extraction had broken. */
  dropNlp?: FactKey[];
}

export function effectiveFacts(p: Patient, overlay?: Record<string, Fact[]>, dropNlp?: FactKey[]): Fact[] {
  const all = [...p.facts, ...(overlay?.[p.id] ?? [])];
  return dropNlp?.length ? all.filter((f) => !(dropNlp.includes(f.key) && f.source.kind !== 'FHIR')) : all;
}

export function matchTrial(p: Patient, t: Trial, ctx: MatchContext = {}): TrialMatch {
  const today = ctx.today ?? TODAY;
  const facts = effectiveFacts(p, ctx.overlay, ctx.dropNlp);
  const siteFull = t.siteStatus !== 'Open';

  // Deterministic pre-filter. No LLM call is made for filtered trials.
  const dx = latestOf(facts, 'diagnosis', today);
  const stage = latestOf(facts, 'stage', today);
  let filterReason: string | undefined;
  if (t.status !== 'Recruiting') filterReason = `Trial status: ${t.status}`;
  else if (dx !== undefined && dx !== t.disease) filterReason = `Disease mismatch (${String(dx)} vs ${t.disease})`;
  else if (stage !== undefined && !t.stages.includes(String(stage))) filterReason = `Stage ${String(stage)} outside trial stages (${t.stages.join(', ')})`;
  else if (t.siteStatus === 'Closed to accrual') filterReason = 'Site closed to accrual';

  const results = t.criteria.map((c) => evalCriterion(c, facts, today, ctx.overrides?.[overrideKey(p.id, t.id, c.id)]));
  const counts: Record<CStatus, number> = { met: 0, notmet: 0, unknown: 0, review: 0, pending: 0 };
  results.forEach((r) => (counts[r.status] += 1));
  const evaluated = results.length - counts.pending;
  const fit = evaluated === 0 ? 0 : counts.met / evaluated;

  let state: MatchState;
  if (filterReason) state = 'filtered';
  else if (counts.notmet > 0) state = 'ineligible';
  else if (counts.unknown + counts.review + counts.pending > 0) state = 'near';
  else state = 'eligible';

  // Rank = clinical fit, site proximity and enrollment status (PRD section 4). Each part is shown to the clinician.
  const rankParts = {
    state: state === 'eligible' ? 300 : state === 'near' ? 200 : 0,
    fit: Math.round(fit * 100),
    site: siteFull ? -150 : 20,
    distance: -Math.round(t.siteMiles / 10),
    enrollment: Math.round((1 - t.enrolled / t.target) * 20),
  };
  const rank = rankParts.state + rankParts.fit + rankParts.site + rankParts.distance + rankParts.enrollment;

  const unknownKeys = Array.from(new Set(results.filter((r) => r.status === 'unknown' && r.resolvable).map((r) => r.criterion.rule.fact)));
  const blockers = results.filter((r) => r.status === 'notmet').map((r) => r.criterion.text);
  return { trial: t, state, results, counts, fit, rank, rankParts, filterReason, siteFull, unknownKeys, blockers };
}

export function matchAll(p: Patient, trials: Trial[], ctx: MatchContext = {}): TrialMatch[] {
  return trials.map((t) => matchTrial(p, t, ctx)).sort((a, b) => b.rank - a.rank);
}

export function isDismissed(dismissals: Record<string, Dismissal>, pid: string, tid: string) {
  return Boolean(dismissals[`${pid}|${tid}`]);
}

/** Matches the treating clinician has not dismissed. Everything that recommends, counts or plans uses this, not the raw list. */
export function undismissed(matches: TrialMatch[], dismissals: Record<string, Dismissal>, pid: string): TrialMatch[] {
  return matches.filter((m) => !isDismissed(dismissals, pid, m.trial.id));
}

export const STATE_LABEL: Record<MatchState, string> = {
  eligible: 'Likely eligible', near: 'Near-eligible', ineligible: 'Not eligible', filtered: 'Filtered out',
};

/* ---------- Audit support: results with their evidence pointers, and what changed between two runs ---------- */

export const evidencePointer = (f: Fact) => `${f.source.resource}/${f.source.id}@${f.date}`;

/** Compact record of every live result and the evidence behind it (PRD: audit stores every result and its evidence). */
export function snapshotOf(matches: TrialMatch[]): Snapshot {
  const live = matches.filter((m) => m.state !== 'filtered');
  return {
    trials: live.map((m) => ({ code: m.trial.code, state: m.state, met: m.counts.met, notmet: m.counts.notmet, unknown: m.counts.unknown, review: m.counts.review, pending: m.counts.pending })),
    rows: live.flatMap((m) => m.results.map((r) => ({ t: m.trial.code, c: r.criterion.id, s: r.status, e: r.evidence.map(evidencePointer) }))),
  };
}

export function signatureOf(s: Snapshot): string {
  const str = JSON.stringify(s);
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

export interface Change { trial: string; text: string; from: string; to: string }
export interface StateChange { trial: string; from: string; to: string }

/** Criterion-level and trial-level differences between two sets of matches for one patient. */
export function diffMatches(before: TrialMatch[], after: TrialMatch[]): { states: StateChange[]; criteria: Change[] } {
  const states: StateChange[] = [];
  const criteria: Change[] = [];
  for (const a of after) {
    const b = before.find((x) => x.trial.id === a.trial.id);
    if (!b) { if (a.state !== 'filtered') states.push({ trial: a.trial.code, from: 'not loaded', to: a.state }); continue; }
    if (b.state !== a.state) states.push({ trial: a.trial.code, from: b.state, to: a.state });
    if (a.state === 'filtered') continue;
    for (const r of a.results) {
      const old = b.results.find((x) => x.criterion.id === r.criterion.id);
      if (old && old.status !== r.status) criteria.push({ trial: a.trial.code, text: r.criterion.text, from: old.status, to: r.status });
    }
  }
  return { states, criteria };
}
