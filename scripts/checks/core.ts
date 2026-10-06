/* Validation suite for the Trial Match mockup. Run with: npm run validate
 *
 * Checks data integrity, rules-engine invariants, per-patient scenario expectations (a small golden set
 * reasoned by hand from the chart text, not copied from engine output), agent behaviour, rule validation and
 * scenario coverage against the PRD.
 *
 * It uses its own independent oracles on purpose: if it reused the code under test it could not catch its bugs.
 */
import { PATIENTS, TRIALS, TODAY, FACT_LABEL, ago } from '../../lib/data';
import { matchAll, matchTrial, evalCriterion, signatureOf, snapshotOf, diffMatches, MIN_CITATION } from '../../lib/engine';
import { runAgent, classify, findKey, draftReferralText, STEP_CAP, TOKEN_BUDGET, COST_TARGET } from '../../lib/agent';
import { FACT_SPEC, opsFor, validateRule } from '../../lib/rules';
import { verifyExtraction } from '../../lib/verify';
import { csvCell } from '../../lib/csv';
import { check, section } from '../harness';
import type { Criterion, Fact, FactKey, Override, Patient, Rule, Trial, TrialMatch } from '../../lib/types';

const trialsLive = TRIALS.filter((t) => !t.hiddenUntilOpened);
const P = (id: string) => PATIENTS.find((x) => x.id === id)!;
const byCode = (p: Patient, code: string, ctx = {}) => matchTrial(p, TRIALS.find((t) => t.code === code)!, ctx);
const NUMERIC: FactKey[] = ['age', 'ecog', 'egfr', 'pdl1', 'priorLines', 'steroidDose', 'anc', 'platelets', 'lvef', 'bilirubin'];
const BOOLEAN: FactKey[] = ['egfrMut', 'alkFusion', 'krasG12c', 'brainMets', 'strongCyp3a4'];
// Keys whose value is stated literally in the cited text (counts of lines and dose equivalents are inferred, so excluded).
const LITERAL: FactKey[] = ['ecog', 'pdl1', 'stage', 'histology', 'egfrMut', 'alkFusion', 'krasG12c', 'brainMets'];
const STAGE_WORDS: Record<string, RegExp> = { ES: /extensive/i, IV: /\bIV\b|metastatic/i };

/** Independent oracle: does the cited span literally support the value? */
function spanSupports(f: Pick<Fact, 'value'> & { source: { span?: string } }, value = f.value): boolean {
  const span = f.source.span ?? '';
  if (typeof value === 'number') {
    const nums = (span.match(/(?<![A-Za-z])\d+(\.\d+)?/g) ?? []).map(Number);
    return nums.includes(value);
  }
  if (typeof value === 'boolean') {
    const neg = /\b(no|not|negative|wild[- ]?type|absent|without|none)\b/i.test(span) || /нет|отриц/i.test(span);
    return value === !neg;
  }
  const v = String(value);
  return (STAGE_WORDS[v]?.test(span) ?? false) || span.toLowerCase().includes(v.toLowerCase());
}
const KIND_DOC_TYPES: Record<string, (type: string, scanned?: boolean) => boolean> = {
  Note: (t) => t === 'Oncology note' || t === 'Surgical consult',
  'Pathology PDF': (t) => t === 'Pathology',
  'Genomic PDF': (t) => t === 'Genomic',
  Imaging: (t) => t === 'Imaging',
  'Scanned report': (_t, s) => !!s,
};

function allFacts(p: Patient) { return [...p.facts, ...p.hidden]; }
const mk = (key: FactKey, value: Fact['value'], daysAgo: number, confidence?: number): Fact => ({ key, value, date: ago(daysAgo), confidence, by: 'ehr', source: { kind: 'FHIR', resource: 'Observation', id: `t-${key}`, label: 'test' } });
const crit = (fact: FactKey, op: Criterion['rule']['op'], value: Criterion['rule']['value'], windowDays?: number): Criterion => ({ id: 'cx', type: 'inclusion', text: 't', rule: { fact, op, value, windowDays }, review: 'approved', parseConfidence: 1, unknownStep: 'x' });

/* ------------------------------------------------------------------------------------------------ */
section('1. Data integrity', () => {
  const uniq = (xs: string[]) => new Set(xs).size === xs.length;
  check('patient ids unique', uniq(PATIENTS.map((p) => p.id)));
  check('MRNs unique', uniq(PATIENTS.map((p) => p.mrn)));
  check('trial ids unique', uniq(TRIALS.map((t) => t.id)));
  check('NCT ids unique', uniq(TRIALS.map((t) => t.nct)));
  check('criterion ids unique across trials', uniq(TRIALS.flatMap((t) => t.criteria.map((c) => c.id))));

  for (const p of PATIENTS) {
    check(`${p.id}: has scenario text and tags`, p.scenario.length > 10 && p.tags.length > 0);
    check(`${p.id}: doc ids unique`, uniq(p.docs.map((d) => d.id)));
    for (const d of p.docs) check(`${p.id}/${d.id}: doc date not in the future`, d.date <= TODAY);
    for (const k of p.externalOnly) check(`${p.id}: external-only ${k} must not also exist in the chart`, !allFacts(p).some((f) => f.key === k));
    for (const f of allFacts(p)) {
      const tag = `${p.id}/${f.key}@${f.date}`;
      check(`${tag}: key has a label`, f.key in FACT_LABEL);
      check(`${tag}: key has a rule spec`, f.key in FACT_SPEC);
      check(`${tag}: not dated in the future`, f.date <= TODAY);
      if (NUMERIC.includes(f.key)) check(`${tag}: numeric key holds a number`, typeof f.value === 'number');
      if (BOOLEAN.includes(f.key)) check(`${tag}: boolean key holds a boolean`, typeof f.value === 'boolean');
      if (f.confidence !== undefined) check(`${tag}: confidence within 0..1`, f.confidence >= 0 && f.confidence <= 1);
      if (f.source.kind !== 'FHIR') {
        const doc = p.docs.find((d) => d.id === f.source.docId);
        check(`${tag}: ${f.source.kind} source must point at a document`, !!doc, `docId=${f.source.docId ?? 'none'}`);
        if (doc && f.source.span) {
          check(`${tag}: cited span exists in the document`, doc.text.includes(f.source.span), `"${f.source.span}"`);
          check(`${tag}: source kind "${f.source.kind}" matches document type "${doc.type}"`, KIND_DOC_TYPES[f.source.kind](doc.type, doc.scanned));
        }
        check(`${tag}: NLP source states a confidence`, f.confidence !== undefined);
      }
      if (f.source.span && LITERAL.includes(f.key)) {
        check(`${tag}: span supports the value`, spanSupports(f), `value=${String(f.value)} span="${f.source.span}"`);
        if (f.firstAttempt !== undefined) check(`${tag}: the simulated first attempt really is wrong`, !spanSupports(f, f.firstAttempt), `first attempt ${String(f.firstAttempt)} is actually supported by the span`);
      }
    }
  }
  for (const t of TRIALS) {
    check(`${t.code}: enrolled ≤ target`, t.enrolled <= t.target);
    check(`${t.code}: has stages`, t.stages.length > 0);
    for (const c of t.criteria) {
      const tag = `${t.code}/${c.id}`;
      check(`${tag}: rule passes the shared validator`, validateRule(c.rule).length === 0, validateRule(c.rule).join('; '));
      check(`${tag}: next step text present`, c.unknownStep.trim().length > 0);
      check(`${tag}: parse confidence within 0..1`, c.parseConfidence >= 0 && c.parseConfidence <= 1);
    }
  }
});

/* ------------------------------------------------------------------------------------------------ */
section('2. Rules-engine invariants', () => {
  check('threshold: eGFR 60 meets >= 60', evalCriterion(crit('egfr', '>=', 60, 28), [mk('egfr', 60, 1)], TODAY).status === 'met');
  check('threshold: eGFR 59 fails >= 60', evalCriterion(crit('egfr', '>=', 60, 28), [mk('egfr', 59, 1)], TODAY).status === 'notmet');
  check('threshold: ECOG 1 meets <= 1', evalCriterion(crit('ecog', '<=', 1, 28), [mk('ecog', 1, 1)], TODAY).status === 'met');
  check('threshold: ECOG 2 fails <= 1', evalCriterion(crit('ecog', '<=', 1, 28), [mk('ecog', 2, 1)], TODAY).status === 'notmet');
  check('threshold: PD-L1 49 fails >= 50', evalCriterion(crit('pdl1', '>=', 50), [mk('pdl1', 49, 5)], TODAY).status === 'notmet');
  check('window: exactly 28 days old is inside a 28-day window', evalCriterion(crit('egfr', '>=', 60, 28), [mk('egfr', 70, 28)], TODAY).status === 'met');
  const w29 = evalCriterion(crit('egfr', '>=', 60, 28), [mk('egfr', 70, 29)], TODAY);
  check('window: 29 days old is stale and Unknown, not Not met', w29.status === 'unknown' && w29.stale === true);
  check('window: the PRD example, a 40-day-old creatinine fails a 28-day criterion', evalCriterion(crit('egfr', '>=', 60, 28), [mk('egfr', 90, 40)], TODAY).status === 'unknown');
  check('window: newest value wins over an older one', evalCriterion(crit('ecog', '<=', 1, 28), [mk('ecog', 3, 20), mk('ecog', 1, 2)], TODAY).status === 'met');
  check('no data is Unknown with a next step', (() => { const r = evalCriterion(crit('pdl1', '>=', 50), [], TODAY); return r.status === 'unknown' && !!r.nextStep; })());
  check('conflicting static values are Needs review, never resolved silently', evalCriterion(crit('egfrMut', '==', false), [mk('egfrMut', true, 60), mk('egfrMut', false, 5)], TODAY).status === 'review');
  check('identical duplicate values are not a conflict', evalCriterion(crit('egfrMut', '==', false), [mk('egfrMut', false, 60), mk('egfrMut', false, 5)], TODAY).status === 'met');
  check('confidence below 70% needs review', evalCriterion(crit('ecog', '<=', 1, 28), [mk('ecog', 0, 2, 0.6)], TODAY).status === 'review');
  check('confidence 70-89% is accepted but flagged', (() => { const r = evalCriterion(crit('ecog', '<=', 1, 28), [mk('ecog', 0, 2, 0.8)], TODAY); return r.status === 'met' && r.lowConfidence === true; })());
  check('unapproved rule is not evaluated', evalCriterion({ ...crit('ecog', '<=', 1), review: 'pending' }, [mk('ecog', 1, 1)], TODAY).status === 'pending');
  check('rejected rule is not evaluated', evalCriterion({ ...crit('ecog', '<=', 1), review: 'rejected' }, [mk('ecog', 1, 1)], TODAY).status === 'pending');
  check('operator "in" matches list membership', evalCriterion(crit('stage', 'in', ['IV', 'IVA']), [mk('stage', 'IV', 1)], TODAY).status === 'met');

  // A malformed rule must never silently turn into Not met for every patient (found by the reviewer-form test).
  const bad = evalCriterion(crit('pdl1', '>=', 'abc' as unknown as number), [mk('pdl1', 80, 1)], TODAY);
  check('a malformed approved rule is not evaluated instead of silently failing', bad.status === 'pending' && /validation/i.test(bad.message), `got ${bad.status}: ${bad.message}`);

  // PRD section 6: "A criterion cannot be Met without a citation." An override to Met must carry one.
  const ov = (extra: Partial<Override> = {}): Override => ({ to: 'met', reason: 'clinical judgement', note: 'seen in outside records', by: 'x', at: 'x', original: 'unknown', ...extra });
  const noCite = evalCriterion(crit('pdl1', '>=', 50), [], TODAY, ov());
  check('an override to Met with no citation is ignored', noCite.status === 'unknown' && noCite.override === undefined, `got ${noCite.status}`);
  check('a one-word citation is too short to count', evalCriterion(crit('pdl1', '>=', 50), [], TODAY, ov({ citation: 'yes' })).status === 'unknown');
  const cited = evalCriterion(crit('pdl1', '>=', 50), [], TODAY, ov({ citation: 'x'.repeat(MIN_CITATION) }));
  check('an override to Met with a citation is applied and marked attested', cited.status === 'met' && cited.attested === true);
  check('an override to Not met needs no citation', evalCriterion(crit('pdl1', '>=', 50), [mk('pdl1', 80, 1)], TODAY, ov({ to: 'notmet', original: 'met' })).status === 'notmet');
  check('an override cannot revive a rule that is not evaluable', evalCriterion({ ...crit('pdl1', '>=', 50), review: 'pending' }, [], TODAY, ov({ citation: 'a real citation here' })).status === 'pending');

  for (const p of PATIENTS.filter((x) => x.treating)) {
    const variants: [string, Record<string, Fact[]>][] = [['base', {}], ['agent-resolved', { [p.id]: p.hidden }]];
    for (const [vn, overlay] of variants) {
      const ms = matchAll(p, trialsLive, { overlay });
      const again = matchAll(p, trialsLive, { overlay });
      check(`${p.id}/${vn}: deterministic`, JSON.stringify(ms) === JSON.stringify(again));
      const doubled = matchAll(p, trialsLive, { overlay: { [p.id]: [...(overlay[p.id] ?? []), ...(overlay[p.id] ?? [])] } });
      check(`${p.id}/${vn}: duplicate facts do not change results`, JSON.stringify(ms.map((m) => [m.trial.id, m.state, m.counts])) === JSON.stringify(doubled.map((m) => [m.trial.id, m.state, m.counts])));
      for (const m of ms) {
        const tag = `${p.id}/${vn}/${m.trial.code}`;
        check(`${tag}: one result per criterion`, m.results.length === m.trial.criteria.length);
        for (const r of m.results) {
          if (r.status === 'met') check(`${tag}/${r.criterion.id}: Met has a citation`, (r.evidence.length > 0 && r.evidence.every((e) => !!e.source.id)) || !!r.override?.citation);
          if (r.status === 'notmet') check(`${tag}/${r.criterion.id}: Not met has evidence`, r.evidence.length > 0);
          if (r.status === 'pending') check(`${tag}/${r.criterion.id}: pending only when rule unapproved`, r.criterion.review !== 'approved');
          if (r.status === 'unknown' && !r.stale) check(`${tag}/${r.criterion.id}: Unknown names a next step`, !!r.nextStep);
        }
        const c = m.counts;
        if (m.state === 'eligible') check(`${tag}: eligible means nothing open or failed`, c.notmet + c.unknown + c.review + c.pending === 0);
        if (m.state === 'ineligible') check(`${tag}: ineligible means at least one Not met`, c.notmet > 0);
        if (m.state === 'near') check(`${tag}: near means no Not met but something open`, c.notmet === 0 && c.unknown + c.review + c.pending > 0);
        check(`${tag}: fit within 0..1`, m.fit >= 0 && m.fit <= 1);
        const sum = m.rankParts.state + m.rankParts.fit + m.rankParts.site + m.rankParts.distance + m.rankParts.enrollment;
        check(`${tag}: rank equals the sum of its shown parts`, sum === m.rank);
        if (m.state !== 'filtered') check(`${tag}: a trial that is not Recruiting is never ranked live`, m.trial.status === 'Recruiting' && m.trial.siteStatus !== 'Closed to accrual');
      }
      const live = ms.filter((m) => m.state !== 'filtered');
      const order = { eligible: 3, near: 2, ineligible: 1, filtered: 0 } as const;
      for (let i = 1; i < live.length; i++) check(`${p.id}/${vn}: live trials ranked eligible > near > ineligible`, order[live[i - 1].state] >= order[live[i].state]);
    }
  }

  // Audit support: stored results carry their evidence, and signatures notice changes
  const p2 = P('p2');
  const before = matchAll(p2, trialsLive);
  const snap = snapshotOf(before);
  const liveRows = before.filter((m) => m.state !== 'filtered').reduce((a, m) => a + m.results.length, 0);
  check('snapshot stores one row per live criterion', snap.rows.length === liveRows);
  check('snapshot Met rows carry evidence pointers', snap.rows.filter((r) => r.s === 'met').every((r) => r.e.length > 0 && /\//.test(r.e[0]) && /@\d{4}-\d{2}-\d{2}$/.test(r.e[0])));
  check('snapshot excludes filtered trials', !snap.trials.some((t) => t.state === 'filtered'));
  check('signature is stable for identical results', signatureOf(snap) === signatureOf(snapshotOf(matchAll(p2, trialsLive))));
  const freshLab: Fact = { key: 'egfr', value: 68, date: TODAY, by: 'ehr', source: { kind: 'FHIR', resource: 'Observation', id: 'new', label: 'new eGFR' } };
  const afterLab = matchAll(p2, trialsLive, { overlay: { p2: [freshLab] } });
  check('signature changes when evidence changes', signatureOf(snap) !== signatureOf(snapshotOf(afterLab)));
  const d = diffMatches(before, afterLab);
  check('diff reports the eGFR criterion going Unknown to Met, not just "no change"', d.criteria.some((c) => c.trial === 'KEYSTONE-A' && /GFR/.test(c.text) && c.from === 'unknown' && c.to === 'met'), JSON.stringify(d.criteria));
  check('diff is empty when nothing changed', diffMatches(before, matchAll(p2, trialsLive)).criteria.length === 0);
});

/* ------------------------------------------------------------------------------------------------ */
section('3. Scenario expectations (hand-reasoned golden set)', () => {
  type S = 'eligible' | 'near' | 'ineligible' | 'filtered';
  const LUNG_FILTERED: Record<string, S> = { 'AURORA-ES': 'filtered', 'ASCENT-ADJ': 'filtered', 'PLEURA-1': 'filtered', 'HERALD-8': 'filtered' };
  const GOLD: Record<string, Record<string, S>> = {
    // Stage IV NSCLC, PD-L1 80, ECOG 1, eGFR fresh, no driver mutation, treatment naive
    p1: { 'KEYSTONE-A': 'eligible', 'HELIX-EGFR': 'ineligible', 'SOTERIA-G12C': 'ineligible', 'PRISM-ALK': 'ineligible', ...LUNG_FILTERED },
    // PD-L1 only in a scanned PDF, eGFR and ANC 41 days old
    p2: { 'KEYSTONE-A': 'near', 'HELIX-EGFR': 'ineligible', 'SOTERIA-G12C': 'ineligible', 'PRISM-ALK': 'ineligible', ...LUNG_FILTERED },
    // Tissue says EGFR mutant, plasma says not; one prior line
    p3: { 'KEYSTONE-A': 'ineligible', 'HELIX-EGFR': 'near', 'SOTERIA-G12C': 'near', 'PRISM-ALK': 'ineligible', ...LUNG_FILTERED },
    // ECOG 3, brain mets, dexamethasone 16 mg
    p4: { 'KEYSTONE-A': 'ineligible', 'HELIX-EGFR': 'ineligible', 'SOTERIA-G12C': 'ineligible', 'PRISM-ALK': 'ineligible', ...LUNG_FILTERED },
    // KRAS result only in an external portal, one prior line; LVEF rule awaiting review
    p5: { 'KEYSTONE-A': 'ineligible', 'HELIX-EGFR': 'ineligible', 'SOTERIA-G12C': 'near', 'PRISM-ALK': 'ineligible', ...LUNG_FILTERED },
    // Extensive-stage SCLC, labs fine; the only matching trial is full at this site
    p6: { 'AURORA-ES': 'eligible', 'KEYSTONE-A': 'filtered', 'HELIX-EGFR': 'filtered', 'SOTERIA-G12C': 'filtered', 'PRISM-ALK': 'filtered', 'ASCENT-ADJ': 'filtered', 'PLEURA-1': 'filtered', 'HERALD-8': 'filtered' },
    // Stage IIA, almost nothing coded
    p7: { 'ASCENT-ADJ': 'near', 'KEYSTONE-A': 'filtered', 'HELIX-EGFR': 'filtered', 'SOTERIA-G12C': 'filtered', 'PRISM-ALK': 'filtered', 'AURORA-ES': 'filtered', 'PLEURA-1': 'filtered', 'HERALD-8': 'filtered' },
    // ALK-positive after one platinum line: the only open match is the satellite site
    p9: { 'PRISM-ALK': 'eligible', 'KEYSTONE-A': 'ineligible', 'HELIX-EGFR': 'ineligible', 'SOTERIA-G12C': 'ineligible', ...LUNG_FILTERED },
    // Mesothelioma, ECOG only in the note: every lung trial is the wrong disease
    p10: { 'PLEURA-1': 'near', 'KEYSTONE-A': 'filtered', 'HELIX-EGFR': 'filtered', 'SOTERIA-G12C': 'filtered', 'PRISM-ALK': 'filtered', 'AURORA-ES': 'filtered', 'ASCENT-ADJ': 'filtered', 'HERALD-8': 'filtered' },
    // EGFR-mutant, everything fits except carbamazepine
    p11: { 'KEYSTONE-A': 'ineligible', 'HELIX-EGFR': 'ineligible', 'SOTERIA-G12C': 'ineligible', 'PRISM-ALK': 'ineligible', ...LUNG_FILTERED },
  };
  for (const [pid, exp] of Object.entries(GOLD)) {
    const p = P(pid);
    const got = Object.fromEntries(matchAll(p, trialsLive).map((m) => [m.trial.code, m.state]));
    for (const [code, want] of Object.entries(exp)) check(`${p.name}: ${code} is ${want}`, got[code] === want, `got ${got[code]}`);
  }
  check('every treating patient is covered by the golden set', PATIENTS.filter((p) => p.treating).every((p) => p.id in GOLD));

  // Criterion-level expectations
  const p2k = byCode(P('p2'), 'KEYSTONE-A');
  check('p2: PD-L1 Unknown and resolvable by the agent', p2k.results.find((r) => r.criterion.rule.fact === 'pdl1')?.status === 'unknown' && p2k.unknownKeys.includes('pdl1'));
  check('p2: eGFR is stale, not resolvable by chart search', (() => { const r = p2k.results.find((x) => x.criterion.rule.fact === 'egfr')!; return r.status === 'unknown' && r.stale === true && !p2k.unknownKeys.includes('egfr'); })());
  const p2after = byCode(P('p2'), 'KEYSTONE-A', { overlay: { p2: P('p2').hidden } });
  check('p2: after the agent resolves PD-L1, only the stale eGFR remains open', p2after.counts.unknown === 1 && p2after.state === 'near');
  const freshLab: Fact = { key: 'egfr', value: 68, date: TODAY, by: 'ehr', source: { kind: 'FHIR', resource: 'Observation', id: 'new', label: 'new eGFR' } };
  check('p2: agent plus a fresh eGFR makes KEYSTONE-A likely eligible', byCode(P('p2'), 'KEYSTONE-A', { overlay: { p2: [...P('p2').hidden, freshLab] } }).state === 'eligible');
  const p3h = byCode(P('p3'), 'HELIX-EGFR').results.find((r) => r.criterion.rule.fact === 'egfrMut')!;
  check('p3: conflicting EGFR sources flagged, both values shown', p3h.status === 'review' && p3h.conflict === true && p3h.evidence.length === 2);
  const p4 = matchAll(P('p4'), trialsLive).filter((m) => m.state !== 'filtered');
  check('p4: every trial blocked, with named blockers', p4.every((m) => m.state === 'ineligible' && m.blockers.length > 0));
  check('p4: ECOG 3, brain metastases and steroids all block KEYSTONE-A', (() => { const m = byCode(P('p4'), 'KEYSTONE-A'); const b = m.results.filter((r) => r.status === 'notmet').map((r) => r.criterion.rule.fact); return b.includes('ecog') && b.includes('brainMets') && b.includes('steroidDose'); })());
  check('p5: KRAS Unknown is not resolvable from the chart alone', byCode(P('p5'), 'SOTERIA-G12C').results.find((r) => r.criterion.rule.fact === 'krasG12c')?.status === 'unknown');
  check('p5: pending LVEF rule is not evaluated and blocks eligibility', byCode(P('p5'), 'SOTERIA-G12C').counts.pending === 1);
  const kras: Fact = { key: 'krasG12c', value: true, date: ago(2), source: { kind: 'Genomic PDF', resource: 'DiagnosticReport', id: 'g', label: 'Guardant' } };
  check('p5: KRAS arriving still leaves the trial near-eligible while a rule is unapproved', byCode(P('p5'), 'SOTERIA-G12C', { overlay: { p5: [kras] } }).state === 'near');
  const t3 = TRIALS.find((t) => t.code === 'SOTERIA-G12C')!;
  const approved: Trial = { ...t3, criteria: t3.criteria.map((c) => ({ ...c, review: 'approved' as const })) };
  check('p5: KRAS arriving plus the rule approved makes the trial likely eligible', matchTrial(P('p5'), approved, { overlay: { p5: [kras] } }).state === 'eligible');
  check('p6: eligible trial that is full at this site is flagged and still ranked', (() => { const m = byCode(P('p6'), 'AURORA-ES'); return m.state === 'eligible' && m.siteFull; })());
  check('p6: a full site is penalised in the rank', byCode(P('p6'), 'AURORA-ES').rankParts.site < 0);
  check('p7: stage extracted from a Russian note is accepted but flagged for verification', (() => { const r = byCode(P('p7'), 'ASCENT-ADJ').results.find((x) => x.criterion.rule.fact === 'stage')!; return r.status === 'met' && r.lowConfidence === true; })());
  check('p7: after the agent, ECOG at 66% confidence is Needs review, not Met', (() => { const r = byCode(P('p7'), 'ASCENT-ADJ', { overlay: { p7: P('p7').hidden } }).results.find((x) => x.criterion.rule.fact === 'ecog')!; return r.status === 'review' && r.lowConfidence === true; })());
  check('p8: no treating relationship means no facts are exposed', P('p8').treating === false && P('p8').facts.length === 0);
  const sat = byCode(P('p9'), 'PRISM-ALK');
  check('p9: satellite site eligible but penalised for distance', sat.state === 'eligible' && sat.rankParts.distance < 0);
  check('p9: same patient would rank higher at an equivalent on-campus trial (distance only costs points)', sat.rankParts.distance === -Math.round(sat.trial.siteMiles / 10));
  check('p10: a mesothelioma patient is filtered out of every lung trial for disease', matchAll(P('p10'), trialsLive).filter((m) => m.trial.disease !== 'Mesothelioma').every((m) => m.state === 'filtered' && /Disease mismatch|Trial status/.test(m.filterReason ?? '')));
  const p10 = byCode(P('p10'), 'PLEURA-1', { overlay: { p10: P('p10').hidden } });
  check('p10: once ECOG is verified the mesothelioma trial is likely eligible', p10.state === 'eligible');
  const p11 = byCode(P('p11'), 'HELIX-EGFR');
  check('p11: a single conflicting medication is the only blocker', p11.state === 'ineligible' && p11.blockers.length === 1 && /CYP3A4/.test(p11.blockers[0]));
  check('p11: the blocker cites the medication list', p11.results.find((r) => r.status === 'notmet')!.evidence[0].source.resource === 'MedicationRequest');

  // Overrides and ranking
  const k = TRIALS.find((t) => t.code === 'KEYSTONE-A')!;
  const c4 = k.criteria.find((c) => c.rule.fact === 'pdl1')!;
  const okOv: Override = { to: 'met', reason: 'clinical judgement', note: 'confirmed by phone', citation: 'Outside lab call 2026-10-05, TPS 60%', by: 'x', at: 'x', original: 'unknown' };
  const withOv = matchTrial(P('p2'), k, { overrides: { [`p2|${k.id}|${c4.id}`]: okOv } });
  check('override changes the criterion and is marked as overridden', withOv.results.find((r) => r.criterion.id === c4.id)?.override !== undefined);
  const noCite = matchTrial(P('p2'), k, { overrides: { [`p2|${k.id}|${c4.id}`]: { ...okOv, citation: undefined } } });
  check('an uncited override to Met does not move the trial toward eligible', noCite.results.find((r) => r.criterion.id === c4.id)?.status === 'unknown');
  check('ranking: likely eligible outranks near-eligible', byCode(P('p1'), 'KEYSTONE-A').rank > byCode(P('p2'), 'KEYSTONE-A').rank);
});

/* ------------------------------------------------------------------------------------------------ */
section('4. Agent behaviour', () => {
  const CLASSIFY: [string, string][] = [
    ['Any lung cancer trials for this patient?', 'summary'],
    ['What trials are available?', 'summary'],
    ['Find the missing values', 'resolve'],
    ['Find the PD-L1', 'resolve'],
    ['Why is KEYSTONE not eligible?', 'explain'],
    ['Why is PRISM-ALK not eligible?', 'explain'],
    ['Why is HELIX-EGFR not a fit?', 'explain'],
    ['Explain why SOTERIA-G12C is blocked', 'explain'],
    ['Why is the PD-L1 unknown?', 'explain'],
    ['Draft a referral for the best trial', 'draft'],
    ['Draft a handoff to the coordinator', 'draft'],
    ['What is missing for KEYSTONE-A?', 'resolve'],
    ['Resolve unknowns', 'resolve'],
    ['Is the eGFR recent enough?', 'resolve'],
    ['Check her labs', 'resolve'],
  ];
  for (const [q, want] of CLASSIFY) check(`intent: "${q}" → ${want}`, classify(q) === want, `got ${classify(q)}`);
  const KEYS: [string, FactKey | undefined][] = [
    ['Find the PD-L1', 'pdl1'], ['Find the KRAS result', 'krasG12c'], ['What is her ECOG?', 'ecog'], ['Is the eGFR recent enough?', 'egfr'],
    ['Does he have an EGFR mutation?', 'egfrMut'], ['Any ALK fusion?', 'alkFusion'], ['What trials are available?', undefined], ['Any interaction with carbamazepine?', 'strongCyp3a4'],
  ];
  for (const [q, want] of KEYS) check(`field: "${q}" → ${want ?? 'none'}`, findKey(q) === want, `got ${findKey(q)}`);

  const PROMPTS = ['Any lung cancer trials for this patient?', 'Find the missing values', 'Why is KEYSTONE not eligible?', 'Draft a referral for the best trial', 'Find the PD-L1'];
  for (const p of PATIENTS.filter((x) => x.treating)) {
    for (const q of PROMPTS) {
      const r = runAgent(p, trialsLive, q, [], {}, {});
      const tag = `${p.id} "${q}"`;
      check(`${tag}: stays within the ${STEP_CAP}-call cap`, r.steps.length <= STEP_CAP);
      check(`${tag}: steps numbered in order`, r.steps.every((s, i) => s.n === i + 1));
      check(`${tag}: tokens within budget`, r.tokens <= TOKEN_BUDGET);
      check(`${tag}: cost within the $${COST_TARGET.toFixed(2)} per-run target`, r.costUsd <= COST_TARGET);
      check(`${tag}: gives an answer`, r.answer.trim().length > 0);
      for (const f of r.resolved) {
        check(`${tag}: resolved ${f.key} comes from the patient's own hidden evidence`, p.hidden.includes(f));
        check(`${tag}: resolved ${f.key} is span-verified by an independent check`, !!f.source.span && spanSupports(f));
        check(`${tag}: resolved ${f.key} is not an external-only result`, !p.externalOnly.includes(f.key));
      }
      for (const st of r.steps) if (st.fact) check(`${tag}: a step that carries a value reports success`, st.ok === true);
      for (const u of r.unresolved) check(`${tag}: unresolved ${u.key} states a reason and next step`, u.reason.length > 0 && u.nextStep.length > 0);
      for (const dr of r.drafts) {
        if (dr.kind === 'referral') {
          const m = matchAll(p, trialsLive).find((x) => x.trial.id === dr.trialId)!;
          check(`${tag}: draft cites the trial and MRN`, dr.body.includes(m.trial.code) && dr.body.includes(p.mrn));
          check(`${tag}: draft counts match the engine`, dr.body.includes(`${m.counts.met} of ${m.results.length} criteria met`) && dr.body.includes(`${m.counts.notmet} not met`));
          check(`${tag}: never drafts for an ineligible trial`, m.state === 'eligible' || m.state === 'near');
        } else {
          check(`${tag}: a records request names the patient MRN and the field`, dr.body.includes(p.mrn) && !!dr.fact && dr.body.includes(FACT_LABEL[dr.fact]));
        }
      }
    }
  }

  // Re-running does not duplicate work
  const p2 = P('p2');
  const first = runAgent(p2, trialsLive, 'Find the missing values', [], {}, {});
  const second = runAgent(p2, trialsLive, 'Find the missing values', [], { p2: first.resolved }, {});
  check('re-running resolve does not re-resolve the same value', second.resolved.length === 0);
  check('re-running resolve spends no tool calls on settled keys', second.steps.length === 0);
  check('p2: stale eGFR is reported as needing a new draw, not searched', first.unresolved.some((u) => u.key === 'egfr' && /window/.test(u.reason)) && !first.steps.some((s) => s.key === 'egfr'));
  check('p2: the scanned report goes through OCR before extraction', first.steps.some((s) => s.tool === 'ocr_document') && first.steps.findIndex((s) => s.tool === 'ocr_document') < first.steps.findIndex((s) => s.tool === 'extract_value'));

  // PRD section 7: when evidence is external or absent the agent says Unknown, it does not guess
  const p5r = runAgent(P('p5'), trialsLive, 'Find the KRAS result', [], {}, {});
  check('p5: agent does not invent a KRAS value', p5r.resolved.length === 0 && p5r.unresolved.some((u) => u.key === 'krasG12c'));
  check('p5: agent notices the external portal and drafts a records request that is really returned', p5r.steps.some((s) => s.tool === 'draft_task') && p5r.drafts.length === 1 && p5r.drafts[0].kind === 'records-request' && p5r.drafts[0].fact === 'krasG12c');
  const p5dup = runAgent(P('p5'), trialsLive, 'Find the KRAS result', [], {}, {}, { existing: [{ patientId: 'p5', trialId: p5r.drafts[0].trialId, kind: 'records-request', status: 'draft', fact: 'krasG12c' }] });
  check('p5: an existing records request is not drafted twice', p5dup.drafts.length === 0 && p5dup.steps.some((s) => /already drafted/.test(s.observation)));
  check('p5: the external tool call is refused, not silently skipped', p5r.steps.some((s) => s.tool === 'check_external_source' && s.ok === false));

  // Step cap, low confidence and truly absent evidence (patient 7)
  const p7a = runAgent(P('p7'), trialsLive, 'Find the missing values', [], {}, {});
  check('p7 run 1: the 8-call cap is honoured and the remainder is reported, not dropped', p7a.capHit && p7a.steps.length <= STEP_CAP && p7a.unresolved.some((u) => /cap/.test(u.reason)));
  const p7b = runAgent(P('p7'), trialsLive, 'Find the missing values', [], { p7: p7a.resolved }, {});
  check('p7 run 2: continues where run 1 stopped and finishes within the cap', !p7b.capHit && p7b.steps.length <= STEP_CAP && p7b.resolved.length > 0);
  const absent = p7b.unresolved.find((u) => u.key === 'priorLines');
  check('p7: a value that is truly absent stays Unknown with a next step', !!absent && /absent/i.test(absent.reason) && absent.nextStep.length > 0);
  check('p7: the low-confidence ECOG is surfaced with the verifier note', p7a.steps.some((s) => s.tool === 'extract_value' && /verifier/i.test(s.observation) && /Needs review/.test(s.observation)));
  const p7final = byCode(P('p7'), 'ASCENT-ADJ', { overlay: { p7: [...p7a.resolved, ...p7b.resolved] } });
  check('p7: after both runs the trial is still near-eligible (ECOG needs review, treatment history unknown)', p7final.state === 'near' && p7final.counts.review === 1 && p7final.counts.unknown === 1);

  // Cost control (PRD section 8): a value already searched for in this chart version is not searched again
  check('p7: the run reports which values were truly absent so they can be cached', p7a.searchedAbsent.includes('priorLines'));
  const p7c = runAgent(P('p7'), trialsLive, 'Find the missing values', [], { p7: [...p7a.resolved, ...p7b.resolved] }, {}, { skip: ['priorLines'] });
  check('p7 with cache: the cached value spends no tool calls', p7c.steps.length === 0 && p7c.cached.includes('priorLines'));
  check('p7 with cache: the answer says why it was not searched again', /not searched again/.test(p7c.answer));
  check('p7 with cache: the value stays Unknown with its next step', p7c.unresolved.some((u) => u.key === 'priorLines' && /cached/.test(u.reason) && u.nextStep.length > 0));
  const p7d = runAgent(P('p7'), trialsLive, 'Find the missing values', [], { p7: [...p7a.resolved, ...p7b.resolved] }, {}, { skip: [] });
  check('p7 without cache (new documents arrived): the value is searched again', p7d.steps.some((s) => s.key === 'priorLines'));

  // Guardrail: a wrong extraction is rejected by the deterministic check, then retried
  const p10 = runAgent(P('p10'), trialsLive, 'Find the missing values', [], {}, {});
  const rejectedStep = p10.steps.findIndex((s) => s.tool === 'extract_value' && s.ok === false);
  const acceptedStep = p10.steps.findIndex((s) => s.tool === 'extract_value' && s.ok === true && !!s.fact);
  check('p10: the wrong first extraction is rejected, then the retry is accepted', rejectedStep >= 0 && acceptedStep > rejectedStep && p10.resolved.length === 1 && p10.resolved[0].value === 1);
  check('p10: a rejected extraction saves nothing', p10.steps[rejectedStep].fact === undefined);
  const hid = P('p10').hidden[0];
  const doc = P('p10').docs.find((d) => d.id === hid.source.docId);
  check('verifier: rejects the value the extractor first proposed', !verifyExtraction('ecog', hid.firstAttempt!, hid.source.span, doc).ok);
  check('verifier: accepts the true value', verifyExtraction('ecog', hid.value, hid.source.span, doc).ok);
  check('verifier: rejects a span that is not in the document', !verifyExtraction('ecog', 1, 'ECOG 9', doc).ok);
  check('verifier: rejects when there is no document at all', !verifyExtraction('ecog', 1, 'ECOG 1', undefined).ok);

  // The agent's own gate: a forged or sloppy extraction must be rejected, whatever the extractor claims
  const base2 = P('p2').hidden[0];
  const forged: [string, Partial<Fact>][] = [
    ['value contradicts its own span (61 vs "TPS 60 %")', { value: 61 }],
    ['span is not in the document', { source: { ...base2.source, span: 'TPS 99 %' } }],
    ['cited document does not exist', { source: { ...base2.source, docId: 'p2-missing' } }],
    ['no span cited at all', { source: { ...base2.source, span: undefined } }],
  ];
  for (const [name, patch] of forged) {
    const fp: Patient = { ...P('p2'), hidden: [{ ...base2, ...patch } as Fact] };
    const r = runAgent(fp, trialsLive, 'Find the PD-L1', [], {}, {});
    check(`guardrail: rejects a forged extraction (${name})`, r.resolved.length === 0 && r.unresolved.some((u) => u.key === 'pdl1' && /deterministic/i.test(u.reason)) && r.steps.every((s) => !s.fact), `resolved=${r.resolved.length}`);
    check(`guardrail: the rejected step is marked failed (${name})`, r.steps.some((s) => s.tool === 'extract_value' && s.ok === false));
  }

  // Draft behaviour
  const p1 = P('p1');
  const best = matchAll(p1, trialsLive).find((m) => m.state === 'eligible')!;
  const d1 = runAgent(p1, trialsLive, 'Draft a referral for the best trial', [], {}, {});
  check('draft: picks the eligible trial', d1.drafts[0]?.trialId === best.trial.id);
  const d2 = runAgent(p1, trialsLive, 'Draft a referral for the best trial', [], {}, {}, { existing: [{ patientId: 'p1', trialId: best.trial.id, kind: 'referral', status: 'approved' }] });
  check('draft: does not draft a duplicate when one is already approved', d2.drafts.length === 0 && /already/.test(d2.answer));
  const dr6 = draftReferralText(P('p6'), matchAll(P('p6'), trialsLive).find((m) => m.trial.code === 'AURORA-ES')!);
  check('draft for a full site mentions the site status', /full|waitlist|satellite/i.test(dr6), 'draft text omits that the site is full');
  const dr9 = draftReferralText(P('p9'), matchAll(P('p9'), trialsLive).find((m) => m.trial.code === 'PRISM-ALK')!);
  check('draft for a satellite site mentions the distance', /45 miles/.test(dr9));
  check('draft states that contact goes through the treating clinician', /only through me/.test(dr9));
  const ex = runAgent(P('p11'), trialsLive, 'Why is HELIX-EGFR not eligible?', [], {}, {});
  check('explain: names the exact blocker', /CYP3A4/.test(ex.answer), ex.answer);
  const ex2 = runAgent(P('p4'), trialsLive, 'Why is the ECOG a problem?', [], {}, {});
  check('explain by field: lists the criteria that use it', /ECOG/.test(ex2.answer) && /Not met/.test(ex2.answer), ex2.answer);
});

/* ------------------------------------------------------------------------------------------------ */
section('5. Rule validation (the reviewer gate)', () => {
  const ok = (r: Rule) => validateRule(r).length === 0;
  const R = (fact: FactKey, op: Rule['op'], value: Rule['value'], windowDays?: number): Rule => ({ fact, op, value, windowDays });
  check('valid: pdl1 >= 50', ok(R('pdl1', '>=', 50)));
  check('valid: ecog <= 1 within 28 days', ok(R('ecog', '<=', 1, 28)));
  check('valid: stage in [IV, IVA]', ok(R('stage', 'in', ['IV', 'IVA'])));
  check('valid: egfrMut == false', ok(R('egfrMut', '==', false)));
  check('valid: diagnosis == NSCLC', ok(R('diagnosis', '==', 'NSCLC')));
  const BAD: [string, Rule][] = [
    ['non-numeric threshold', R('pdl1', '>=', 'abc' as unknown as number)],
    ['NaN threshold', R('pdl1', '>=', NaN)],
    ['threshold out of range (PD-L1 150%)', R('pdl1', '>=', 150)],
    ['negative ECOG', R('ecog', '<=', -1)],
    ['numeric operator on a boolean field', R('egfrMut', '>=', true)],
    ['boolean field compared with a number', R('alkFusion', '==', 1 as unknown as boolean)],
    ['boolean field compared with a string', R('brainMets', '==', 'true' as unknown as boolean)],
    ['unknown enum value', R('stage', '==', 'Stage Four')],
    ['unknown value inside a list', R('stage', 'in', ['IV', 'XX'])],
    ['empty list', R('stage', 'in', [])],
    ['list on a numeric field', R('ecog', 'in', ['1'])],
    ['window of zero days', R('egfr', '>=', 60, 0)],
    ['fractional window', R('egfr', '>=', 60, 2.5)],
    ['window over a year', R('egfr', '>=', 60, 400)],
    ['window on a boolean field', R('egfrMut', '==', false, 14)],
    ['unknown field', { fact: 'nonsense' as FactKey, op: '>=', value: 1 }],
    ['text on a numeric field', R('anc', '>=', '1500' as unknown as number)],
  ];
  for (const [name, r] of BAD) check(`rejected: ${name}`, !ok(r), `validateRule returned no errors for ${JSON.stringify(r)}`);
  for (const fact of Object.keys(FACT_SPEC) as FactKey[]) check(`every field offers at least one operator: ${fact}`, opsFor(fact).length > 0);
  const lab = evalCriterion(crit('egfr', '>=', 60, 28), [mk('egfr', 80, 1)], TODAY);
  check('sanity: a valid rule still evaluates', lab.status === 'met');
});

/* ------------------------------------------------------------------------------------------------ */
section('6. Scenario coverage (every scenario the PRD describes is exercised by at least one patient)', () => {
  const withAgent = (p: Patient): TrialMatch[] => matchAll(p, trialsLive, { overlay: { [p.id]: p.hidden } });
  const base = PATIENTS.filter((p) => p.treating).map((p) => ({ p, ms: matchAll(p, trialsLive) }));
  const has = (pred: (m: TrialMatch, p: Patient) => boolean) => base.some(({ p, ms }) => ms.some((m) => pred(m, p)));
  const hasR = (pred: (r: TrialMatch['results'][number]) => boolean) => has((m) => m.results.some(pred));
  const cases: [string, boolean][] = [
    ['likely eligible', has((m) => m.state === 'eligible')],
    ['near-eligible', has((m) => m.state === 'near')],
    ['not eligible with named blockers', has((m) => m.state === 'ineligible' && m.blockers.length > 0)],
    ['pre-filter: disease mismatch', has((m) => /Disease mismatch/.test(m.filterReason ?? ''))],
    ['pre-filter: stage outside trial', has((m) => /Stage/.test(m.filterReason ?? ''))],
    ['pre-filter: trial suspended', has((m) => /Suspended/.test(m.filterReason ?? ''))],
    ['stale lab Unknown', hasR((r) => r.stale === true)],
    ['conflicting sources', hasR((r) => r.conflict === true)],
    ['low-confidence flag (70-89%)', hasR((r) => r.lowConfidence === true && r.status === 'met')],
    ['rule pending review', hasR((r) => r.status === 'pending')],
    ['eligible but site full', has((m) => m.state === 'eligible' && m.siteFull)],
    ['eligible at a satellite site', has((m) => m.state === 'eligible' && m.trial.siteMiles > 0)],
    ['medication conflict blocks a match', hasR((r) => r.status === 'notmet' && r.criterion.rule.fact === 'strongCyp3a4')],
    ['steroid dose exclusion', hasR((r) => r.status === 'notmet' && r.criterion.rule.fact === 'steroidDose')],
    ['brain metastases exclusion', hasR((r) => r.status === 'notmet' && r.criterion.rule.fact === 'brainMets')],
    ['performance-status failure', hasR((r) => r.status === 'notmet' && r.criterion.rule.fact === 'ecog')],
    ['prior-therapy failure', hasR((r) => r.status === 'notmet' && r.criterion.rule.fact === 'priorLines')],
    ['biomarker threshold failure (PD-L1)', hasR((r) => r.status === 'notmet' && r.criterion.rule.fact === 'pdl1')],
    ['driver-mutation exclusion', hasR((r) => r.status === 'notmet' && ['egfrMut', 'alkFusion'].includes(r.criterion.rule.fact))],
    ['a patient with no treating relationship', PATIENTS.some((p) => !p.treating)],
    ['non-English source document', PATIENTS.some((p) => p.docs.some((d) => d.language && d.language !== 'en'))],
    ['scanned (OCR) document', PATIENTS.some((p) => p.docs.some((d) => d.scanned))],
    ['result that exists only in an external portal', PATIENTS.some((p) => p.externalOnly.length > 0)],
    ['a non-lung disease group', PATIENTS.some((p) => allFacts(p).some((f) => f.key === 'diagnosis' && f.value === 'Mesothelioma'))],
    ['a small-cell patient', PATIENTS.some((p) => allFacts(p).some((f) => f.key === 'diagnosis' && f.value === 'SCLC'))],
    ['an early-stage resectable patient', PATIENTS.some((p) => allFacts(p).some((f) => f.key === 'stage' && f.value === 'IIA'))],
  ];
  // Needs-review from low confidence appears only after the agent resolves a value
  cases.push(['low-confidence extraction below the 70% floor (after the agent)', base.some(({ p }) => withAgent(p).some((m) => m.results.some((r) => r.status === 'review' && r.lowConfidence === true && !r.conflict)))]);
  cases.push(['agent resolves a value that makes a trial eligible', base.some(({ p, ms }) => withAgent(p).some((m) => m.state === 'eligible' && ms.find((x) => x.trial.id === m.trial.id)!.state !== 'eligible'))]);
  const caps = PATIENTS.filter((p) => p.treating).map((p) => runAgent(p, trialsLive, 'Find the missing values', [], {}, {}));
  cases.push(['agent hits the 8-call cap', caps.some((r) => r.capHit)]);
  cases.push(['agent cannot find a value because it is external', caps.some((r) => r.unresolved.some((u) => /portal|outside/i.test(u.reason)))]);
  cases.push(['agent cannot find a value because it is truly absent', PATIENTS.some((p) => { const r1 = runAgent(p, trialsLive, 'Find the missing values', [], {}, {}); const r2 = runAgent(p, trialsLive, 'Find the missing values', [], { [p.id]: r1.resolved }, {}); return r2.unresolved.some((u) => /absent/i.test(u.reason)); })]);
  cases.push(['agent extraction rejected by the deterministic check', caps.some((r) => r.steps.some((s) => s.tool === 'extract_value' && !s.ok && /FAILED/.test(s.observation)))]);
  cases.push(['agent needs a new lab and says so', caps.some((r) => r.unresolved.some((u) => /window/.test(u.reason)))]);
  for (const [name, ok] of cases) check(`covered: ${name}`, ok);
});

/* ------------------------------------------------------------------------------------------------ */
section('7. Hardening and PRD numbers', () => {
  check('csv: a leading = is neutralised so it cannot run as a formula', csvCell('=HYPERLINK("http://x")') === `"'=HYPERLINK(""http://x"")"`);
  check('csv: leading + - @ are neutralised', ['+1', '-1', '@sum'].every((v) => csvCell(v).startsWith(`"'`)));
  check('csv: quotes are escaped', csvCell('say "hi"') === '"say ""hi"""');
  check('csv: ordinary text is untouched', csvCell('Dr. Rao') === '"Dr. Rao"');
  check('point-of-care: 200 queries x 22 days x $0.50 = $2,200', 200 * 22 * 0.5 === 2200);
  check('nightly re-screen: 5,000 x 10% x $0.05 x 30 nights = $750', 5000 * 0.1 * 0.05 * 30 === 750);
  check('criteria parsing: 20 trials x $2 stays under $50', 20 * 2 < 50);
  check('planned spend stays under the $5,000 ceiling', 2200 + 750 + 50 <= 5000);
  check('agent cap matches the PRD (8 calls)', STEP_CAP === 8);
});

