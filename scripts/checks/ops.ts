/* Ops telemetry, amendments and the PI funnel. */
import { PATIENTS, TRIALS, TODAY } from '../../lib/data';
import { AMENDMENTS, applyAmendment, describeAmendment } from '../../lib/amendments';
import { matchTrial } from '../../lib/engine';
import { CONVERSION, funnel } from '../../lib/funnel';
import { TARGETS, alertsFor, opsStats, unknownRates } from '../../lib/ops';
import { buildTrials } from '../../lib/trials';
import { validateRule } from '../../lib/rules';
import { check, section } from '../harness';
import type { AuditEntry, Referral, Telemetry } from '../../lib/types';

const live = TRIALS.filter((t) => !t.hiddenUntilOpened);
const P = (id: string) => PATIENTS.find((x) => x.id === id)!;
const tel = (kind: Telemetry['kind'], ok: boolean, extra: Partial<Telemetry> = {}): Telemetry => ({ ts: 'x', kind, ok, ...extra });
const base = { audit: [] as AuditEntry[], usage: [], overrides: {}, referrals: [] as Referral[], trials: live };

section('16. Ops telemetry', () => {
  const s = opsStats({ ...base, telemetry: [1, 2, 3, 4, 100].map((ms) => tel('engine', true, { ms })) });
  check('engine percentiles: p50 is the median and p95 catches the outlier', s.engine.p50 === 3 && s.engine.p95 === 100 && s.engine.n === 5);
  const a = opsStats({ ...base, telemetry: [tel('agent', true, { ms: 3000, cost: 0.2, capHit: false }), tel('agent', true, { ms: 5000, cost: 0.4, capHit: true }), tel('agent', false, { ms: 90000 })] });
  check('agent success rate counts failures and timeouts', a.agent.n === 3 && a.agent.ok === 2 && a.agent.errors === 1 && a.agent.successRate === 66.7);
  check('agent latency percentiles use successful runs only', a.agent.p50 === 3000 && a.agent.p95 === 5000);
  check('average cost divides by every run and total cost sums them', a.agent.avgCost === 0.2 && a.agent.totalCost === 0.6);
  check('cap hits are counted', a.agent.capHits === 1);
  check('projected monthly spend uses the PRD volumes: avg cost × 200 × 22 plus $800 fixed', opsStats({ ...base, telemetry: [tel('agent', true, { ms: 1, cost: 0.5 })] }).projectedMonthly === Math.round(0.5 * 200 * 22 + 800));
  check('with no runs the figures are zero, not NaN', (() => { const e = opsStats({ ...base, telemetry: [] }); return e.agent.avgCost === 0 && e.engine.p95 === 0 && e.agent.successRate === 100 && !Number.isNaN(e.projectedMonthly); })());
  const e = opsStats({ ...base, telemetry: [tel('ehr', false), tel('ehr', true)] });
  check('only failed EHR calls are failures', e.ehrFailures === 1);
  const au = (action: string): AuditEntry => ({ id: 1, ts: 'x', actor: 'a', role: 'r', action, detail: 'd', versions: 'v' });
  const g = opsStats({ ...base, telemetry: [], audit: [au('agent.extraction.rejected'), au('agent.extraction.rejected'), au('agent.injection.quarantined')] });
  check('rejected extractions and quarantined documents are counted from the audit log', g.rejectedExtractions === 2 && g.quarantined === 1);
  const o = opsStats({ ...base, telemetry: [], usage: [{ ts: 'x', role: 'oncologist', kind: 'trial.open', trialId: 't1' }], overrides: { a: { to: 'met', reason: 'wrong value', note: '', by: 'x', at: 'x', original: 'unknown' } } });
  check('override rate is overrides over criteria shown in opened checklists', o.override.overrides === 1 && o.override.reviewed === live[0].criteria.length && o.override.rate === Math.round((1 / live[0].criteria.length) * 1000) / 1000);

  // Unknown-rate spike: the regression drill
  const baseRates = unknownRates(live, {});
  const regRates = unknownRates(live, { dropNlp: ['pdl1'] });
  const rate = (rs: typeof baseRates, f: string) => rs.find((r) => r.fact === f);
  check('the Unknown rate for PD-L1 jumps when PD-L1 extraction breaks', (rate(regRates, 'pdl1')!.rate - rate(baseRates, 'pdl1')!.rate) >= TARGETS.unknownSpikePts);
  check('only the field that broke spikes', baseRates.filter((r) => r.fact !== 'pdl1').every((r) => Math.abs(r.rate - rate(regRates, r.fact)!.rate) < 0.001));
  check('rates are percentages of criteria that were evaluated', baseRates.every((r) => r.rate >= 0 && r.rate <= 100 && r.unknown <= r.total));
  check('a criterion awaiting rule approval is not counted at all', (() => { const lv = rate(baseRates, 'lvef')!; const helixPairs = PATIENTS.filter((p) => p.treating).filter((p) => matchTrial(p, live.find((x) => x.code === 'HELIX-EGFR')!, {}).state !== 'filtered').length; return lv.total === helixPairs; })());
  const quiet = alertsFor(opsStats({ ...base, telemetry: [] }), baseRates, baseRates);
  check('with healthy telemetry and no regression there are no critical or warning alerts', quiet.filter((x) => x.severity !== 'info').length === 0);
  const spike = alertsFor(opsStats({ ...base, telemetry: [] }), regRates, baseRates);
  check('the regression drill raises a critical alert naming the field', spike.some((x) => x.severity === 'critical' && x.id === 'unknown-pdl1'));
  check('that alert tells the on-call person what to do, in the PRD’s words', /Roll back/.test(spike.find((x) => x.id === 'unknown-pdl1')!.runbook));

  const alertIds = (tels: Telemetry[], extra: Partial<Parameters<typeof opsStats>[0]> = {}) => alertsFor(opsStats({ ...base, telemetry: tels, ...extra }), baseRates, baseRates).map((x) => x.id);
  check('engine P95 at the 10 s target raises a critical alert', alertIds([tel('engine', true, { ms: TARGETS.engineP95Ms })]).includes('engine-latency'));
  check('engine P95 just under target does not', !alertIds([tel('engine', true, { ms: TARGETS.engineP95Ms - 1 })]).includes('engine-latency'));
  check('agent P95 at 90 s raises a critical alert', alertIds([tel('agent', true, { ms: 90000, cost: 0.1 })]).includes('agent-latency'));
  check('an agent error rate over 5% (with at least 3 runs) raises a warning', alertIds([tel('agent', false), tel('agent', true, { ms: 1, cost: 0.1 }), tel('agent', true, { ms: 1, cost: 0.1 })]).includes('agent-errors'));
  check('a single failed run does not page anyone', !alertIds([tel('agent', false)]).includes('agent-errors'));
  check('cost per run over $0.50 raises a warning', alertIds([tel('agent', true, { ms: 1, cost: 0.51 })]).includes('cost-run'));
  check('cost exactly at $0.50 does not', !alertIds([tel('agent', true, { ms: 1, cost: 0.5 })]).includes('cost-run'));
  check('projected spend above $5,000 raises a critical alert', alertIds([tel('agent', true, { ms: 1, cost: 1 })]).includes('cost-month'));
  check('an EHR failure raises a warning', alertIds([tel('ehr', false)]).includes('ehr'));
  check('override rate over 10% needs at least 10 criteria reviewed to alert', !alertIds([], { usage: [{ ts: 'x', role: 'oncologist', kind: 'trial.open', trialId: 't1' }], overrides: { a: { to: 'met', reason: 'wrong value', note: '', by: 'x', at: 'x', original: 'unknown' } } }).includes('override'));
  check('alerts are ordered critical, then warning, then info', (() => { const l = alertsFor(opsStats({ ...base, telemetry: [tel('ehr', false), tel('engine', true, { ms: 20000 })], audit: [au('agent.extraction.rejected')] }), baseRates, baseRates); const order = { critical: 0, warning: 1, info: 2 }; return l.every((x, i) => i === 0 || order[l[i - 1].severity] <= order[x.severity]) && l.length >= 3; })());
});

section('17. Protocol amendments', () => {
  check('every amendment targets a real trial and matches real criteria', AMENDMENTS.every((a) => { const t = TRIALS.find((x) => x.id === a.trialId); return !!t && a.changes.every((c) => c.kind === 'added' || t.criteria.some((k) => k.rule.fact === c.fact)); }));
  check('amendment ids are unique and each has a posted date, version and summary', new Set(AMENDMENTS.map((a) => a.id)).size === AMENDMENTS.length && AMENDMENTS.every((a) => a.postedOn && a.version && a.summary.length > 20));
  check('every replacement rule passes the shared validator', AMENDMENTS.every((a) => a.changes.every((c) => !c.to || validateRule(c.to.rule).length === 0)));
  const k = TRIALS.find((t) => t.code === 'KEYSTONE-A')!;
  const a1 = AMENDMENTS.find((a) => a.id === 'A1')!;
  const k2 = applyAmendment(k, a1);
  check('an amendment changes only the criteria it names', k2.criteria.length === k.criteria.length && k2.criteria.filter((c) => c.amended).length === 2);
  check('changed criteria get a new id, so the old approval does not carry over', k2.criteria.filter((c) => c.amended).every((c) => c.id.endsWith('.A1') && !k.criteria.some((o) => o.id === c.id)));
  check('changed criteria go back to review', k2.criteria.filter((c) => c.amended).every((c) => c.review === 'pending'));
  check('the old wording is kept for the diff', k2.criteria.filter((c) => c.amended).every((c) => !!c.amended!.from.text && !!c.amended!.from.rule));
  check('untouched criteria keep their id and review status', k2.criteria.filter((c) => !c.amended).every((c) => k.criteria.some((o) => o.id === c.id && o.review === c.review)));
  check('the trial records the amendment and its rule set version', k2.amendments!.join() === 'A1' && k2.ruleSet === 'ruleset-1.4.0+A1');
  check('an amendment for another trial leaves the trial alone', applyAmendment(TRIALS.find((t) => t.code === 'HELIX-EGFR')!, a1) === TRIALS.find((t) => t.code === 'HELIX-EGFR'));
  check('applying amendments never edits the shared trial definitions', JSON.stringify(k) === JSON.stringify(TRIALS.find((t) => t.code === 'KEYSTONE-A')));
  const diff = describeAmendment(k, a1);
  check('the diff shows before and after for each change', diff.length === 2 && diff.every((d) => d.before && d.after && d.before.text !== d.after.text));
  check('the diff names the old and new threshold', diff.some((d) => d.before!.rule.value === 50 && d.after!.rule.value === 10));

  // Effects on patients, with the new rules pending and then approved
  const applied = [{ id: 'A1', appliedAt: 'now' }];
  const pending = buildTrials(TRIALS, {}, [], applied).find((t) => t.code === 'KEYSTONE-A')!;
  const ids = pending.criteria.filter((c) => c.amended).map((c) => c.id);
  const approve = Object.fromEntries(ids.map((id) => [`t1|${id}`, { review: 'approved' as const }]));
  const live2 = buildTrials(TRIALS, approve, [], applied).find((t) => t.code === 'KEYSTONE-A')!;
  const st = (t: typeof k, id: string) => matchTrial(P(id), t, {}).state;
  check('before approval, an amendment that widens the trial leaves Priya Raman near-eligible, not eligible', st(k, 'p5') === 'ineligible' && st(pending, 'p5') === 'near');
  check('after approval Priya Raman (PD-L1 10%, one prior line) becomes likely eligible', st(live2, 'p5') === 'eligible');
  check('after approval Dorothy Williams moves to near-eligible, held by her conflicting EGFR sources', st(k, 'p3') === 'ineligible' && st(live2, 'p3') === 'near');
  check('James O’Neill stays out: ECOG 3, brain metastases and steroids still rule him out', st(live2, 'p4') === 'ineligible');
  check('Margaret Chen is unaffected: she was eligible and still is', st(live2, 'p1') === 'eligible' && st(pending, 'p1') === 'near');
  const helix = TRIALS.find((t) => t.code === 'HELIX-EGFR')!;
  const a2 = AMENDMENTS.find((a) => a.id === 'A2')!;
  const h2 = buildTrials(TRIALS, Object.fromEntries(applyAmendment(helix, a2).criteria.filter((c) => c.amended).map((c) => [`t2|${c.id}`, { review: 'approved' as const }])), [], [{ id: 'A2', appliedAt: 'now' }]).find((t) => t.code === 'HELIX-EGFR')!;
  check('an amendment that narrows the trial removes Dorothy Williams (one prior line) once approved', st(helix, 'p3') === 'near' && st(h2, 'p3') === 'ineligible');
  check('buildTrials applies each amendment once, in order, and ignores unknown ids', buildTrials(TRIALS, {}, [], [{ id: 'A1', appliedAt: 'x' }, { id: 'A1', appliedAt: 'y' }, { id: 'ZZ', appliedAt: 'z' }]).find((t) => t.code === 'KEYSTONE-A')!.criteria.filter((c) => c.amended).length === 2);
});

section('18. PI enrollment funnel and forecast', () => {
  const k = TRIALS.find((t) => t.code === 'KEYSTONE-A')!;
  const f = funnel(k, PATIENTS, {}, [], TODAY);
  const n = (id: string) => f.stages.find((s) => s.id === id)!.n;
  check('the funnel starts with every patient the PI can see', n('seen') === PATIENTS.filter((p) => p.treating).length);
  check('the pre-filter stage counts patients not filtered out for this trial', n('prefilter') === PATIENTS.filter((p) => p.treating && matchTrial(p, k, {}).state !== 'filtered').length && n('prefilter') === 7);
  check('likely eligible is Margaret Chen alone, and the pipeline adds Robert Alvarez', n('likely') === 1 && n('pipeline') === 2);
  check('the early stages never grow as the funnel narrows', n('seen') >= n('prefilter') && n('prefilter') >= n('pipeline') && n('pipeline') >= n('likely'));
  check('with no referrals the later stages are empty', n('referred') === 0 && n('screening') === 0 && n('consented') === 0);
  const ref = (worklist: Referral['worklist'], status: Referral['status'] = 'approved'): Referral => ({ id: 'r', kind: 'referral', patientId: 'p1', trialId: 't1', body: '', status, createdAt: 'x', worklist, versions: 'v', requestedBy: 'x' });
  const f2 = funnel(k, PATIENTS, {}, [ref('screening'), ref('consented'), ref('new'), ref('declined', 'draft'), ref('consented', 'rejected')], TODAY);
  const n2 = (id: string) => f2.stages.find((s) => s.id === id)!.n;
  check('only approved referrals count as referred', n2('referred') === 3);
  check('screening counts both screening and consented', n2('screening') === 2 && n2('consented') === 1);
  check('a referral for another trial is not counted', funnel(k, PATIENTS, {}, [{ ...ref('consented'), trialId: 't2' }], TODAY).stages.find((s) => s.id === 'referred')!.n === 0);

  // Forecast arithmetic, recomputed independently
  const days = Math.round((Date.parse('2027-06-30') - Date.parse(TODAY)) / 86400000);
  const monthsLeft = Math.round((days / 30.4) * 10) / 10;
  const projected = Math.round(24 * monthsLeft * 10) / 10;
  const shortfall = Math.round((458 - projected) * 10) / 10;
  check('months left is the days to the closing date over 30.4', f.forecast.monthsLeft === monthsLeft, `${f.forecast.monthsLeft} vs ${monthsLeft}`);
  check('projected enrollment is pace × months left, and the shortfall is what remains', f.forecast.projected === projected && f.forecast.shortfall === shortfall && f.forecast.remaining === 458);
  check('KEYSTONE-A is under-enrolling: it will miss its target by more than a quarter of what remains', f.forecast.status === 'under-enrolling');
  check('the pipeline yield uses the historical conversion rates', f.forecast.pipelineYield === Math.round((1 * CONVERSION.eligibleToEnrolled + 1 * CONVERSION.nearToEnrolled) * 10) / 10);
  check('the gap after the pipeline is the shortfall less the yield', f.forecast.afterPipeline === Math.round((f.forecast.shortfall - f.forecast.pipelineYield) * 10) / 10);
  check('the monthly need is what remains over the months left', f.forecast.needPerMonth === Math.round((458 / monthsLeft) * 10) / 10);
  check('a trial at its target is reported as full', funnel(TRIALS.find((t) => t.code === 'AURORA-ES')!, PATIENTS, {}, [], TODAY).forecast.status === 'full');
  check('a suspended trial is paused, not on course to miss its target', funnel(TRIALS.find((t) => t.code === 'HERALD-8')!, PATIENTS, {}, [], TODAY).forecast.status === 'paused');
  check('a fast enough site is on track', funnel({ ...k, pacePerMonth: 200 }, PATIENTS, {}, [], TODAY).forecast.status === 'on-track');
  check('a site just short of target is at risk rather than under-enrolling', funnel({ ...k, pacePerMonth: 45 }, PATIENTS, {}, [], TODAY).forecast.status === 'at-risk');
  check('after the closing date nothing more can be enrolled', funnel(k, PATIENTS, {}, [], '2028-01-01').forecast.monthsLeft === 0 && funnel(k, PATIENTS, {}, [], '2028-01-01').forecast.projected === 0);
  check('every live trial has a pace and a closing date fixture', TRIALS.every((t) => t.pacePerMonth !== undefined && !!t.closesOn));
});
