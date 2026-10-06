/* Rule impact preview: the dry run a reviewer sees before approving. */
import { PATIENTS, TRIALS, TODAY } from '../../lib/data';
import { matchTrial } from '../../lib/engine';
import { ruleImpact } from '../../lib/impact';
import { check, section } from '../harness';
import type { ReviewStatus, Rule, Trial } from '../../lib/types';

const live = TRIALS.filter((t) => !t.hiddenUntilOpened);
const t1 = live.find((t) => t.code === 'KEYSTONE-A')!;
const pd = t1.criteria.find((c) => c.rule.fact === 'pdl1')!;
const t3 = live.find((t) => t.code === 'SOTERIA-G12C')!;
const lvef = t3.criteria.find((c) => c.rule.fact === 'lvef')!;
const impact = (t: Trial, cid: string, rule: Rule | undefined, review: ReviewStatus) => ruleImpact({ patients: PATIENTS, trials: live, ctx: {}, tid: t.id, cid, rule, review });

// Independent oracle: rebuild the trial and compare states patient by patient
function oracle(t: Trial, cid: string, rule: Rule | undefined, review: ReviewStatus) {
  const after: Trial = { ...t, criteria: t.criteria.map((c) => (c.id === cid ? { ...c, review, rule: rule ?? c.rule } : c)) };
  const out: string[] = [];
  for (const p of PATIENTS.filter((x) => x.treating)) {
    const a = matchTrial(p, t, { today: TODAY }).state, b = matchTrial(p, after, { today: TODAY }).state;
    if (a !== b) out.push(`${p.id}:${a}>${b}`);
  }
  return out.sort();
}

section('14. Rule impact preview', () => {
  const raise = impact(t1, pd.id, { fact: 'pdl1', op: '>=', value: 90 }, 'approved');
  check('raising the PD-L1 threshold to 90 removes Margaret Chen from likely eligible', raise.eligibleLost.length === 1 && raise.eligibleLost[0].patientId === 'p1' && raise.risky);
  check('the criterion changes are exactly the patients with PD-L1 between 50 and 89', raise.criteria.map((c) => c.patientId).sort().join() === 'p1,p3,p4', raise.criteria.map((c) => c.patientId).join());
  check('each changed criterion goes from Met to Not met', raise.criteria.every((c) => c.from === 'met' && c.to === 'notmet'));
  check('the preview matches an independent recomputation', JSON.stringify(raise.states.map((s) => `${s.patientId}:${s.from}>${s.to}`).sort()) === JSON.stringify(oracle(t1, pd.id, { fact: 'pdl1', op: '>=', value: 90 }, 'approved')));

  const lower = impact(t1, pd.id, { fact: 'pdl1', op: '>=', value: 5 }, 'approved');
  check('lowering the threshold to 5 changes criteria for the patients it newly admits', lower.criteria.map((c) => c.patientId).sort().join() === 'p11,p5,p9');
  check('but moves nobody between states, because other criteria still rule them out', lower.states.length === 0 && !lower.risky);

  const noop = impact(t1, pd.id, undefined, 'approved');
  check('re-approving the rule as it already is changes nothing', noop.states.length === 0 && noop.criteria.length === 0 && !noop.risky);

  const approve = impact(t3, lvef.id, undefined, 'approved');
  check('approving the pending LVEF rule changes criteria for patients it is evaluated against', approve.criteria.length >= 2 && approve.criteria.every((c) => c.from === 'pending'));
  check('approving it moves nobody between states, since KRAS is still Unknown', approve.states.length === 0 && approve.eligibleGained.length === 0);
  const reject = impact(t3, lvef.id, undefined, 'rejected');
  check('rejecting a pending rule leaves everything exactly as it is', reject.states.length === 0 && reject.criteria.length === 0);

  check('only patients the trial applies to are counted', raise.patients === PATIENTS.filter((p) => p.treating && matchTrial(p, t1, { today: TODAY }).state !== 'filtered').length);
  check('patients filtered out of the trial never appear in the preview', !raise.states.concat().some((s) => ['p6', 'p7', 'p10'].includes(s.patientId)) && !raise.criteria.some((c) => ['p6', 'p7', 'p10'].includes(c.patientId)));
  const noTrial = ruleImpact({ patients: PATIENTS, trials: live, ctx: {}, tid: 'nope', cid: 'x', review: 'approved' });
  check('an unknown trial gives an empty, safe preview', noTrial.states.length === 0 && noTrial.patients === 0);

  // The preview is a dry run: nothing is modified
  const before = JSON.stringify(live);
  impact(t1, pd.id, { fact: 'pdl1', op: '>=', value: 90 }, 'approved');
  check('the preview never mutates the trials it reads', JSON.stringify(live) === before);

  // A rule that would make someone eligible who was not
  const loosen = impact(t1, t1.criteria.find((c) => c.rule.fact === 'priorLines')!.id, { fact: 'priorLines', op: '<=', value: 1 }, 'approved');
  check('allowing one prior line brings Dorothy Williams from not eligible to near-eligible', loosen.states.some((s) => s.patientId === 'p3' && s.from === 'ineligible' && s.to === 'near'));
  check('and Priya Raman, whose PD-L1 is still below 50, stays out', !loosen.states.some((s) => s.patientId === 'p5'));
  check('every preview row carries the patient name for the reviewer', [raise, lower, approve, loosen].every((i) => i.states.every((s) => s.patient.length > 3) && i.criteria.every((c) => c.patient.length > 3)));
  // Fuzz: a range of thresholds, always equal to the oracle
  let agree = true;
  for (const v of [0, 1, 5, 10, 20, 50, 55, 60, 62, 80, 81, 100]) {
    const got = impact(t1, pd.id, { fact: 'pdl1', op: '>=', value: v }, 'approved').states.map((s) => `${s.patientId}:${s.from}>${s.to}`).sort();
    if (JSON.stringify(got) !== JSON.stringify(oracle(t1, pd.id, { fact: 'pdl1', op: '>=', value: v }, 'approved'))) agree = false;
  }
  check('twelve different thresholds all match the independent oracle', agree);
});
