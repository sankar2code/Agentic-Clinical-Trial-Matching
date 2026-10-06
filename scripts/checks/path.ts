/* Path to eligibility and the what-if sandbox. */
import { PATIENTS, TRIALS, TODAY } from '../../lib/data';
import { classify, findKey } from '../../lib/agent';
import { matchAll } from '../../lib/engine';
import { plansFor, rankActions, whatIf, type TrialPlan } from '../../lib/path';
import { check, section } from '../harness';
import type { FactKey, Patient } from '../../lib/types';

const live = TRIALS.filter((t) => !t.hiddenUntilOpened);
const P = (id: string) => PATIENTS.find((x) => x.id === id)!;
const plans = (p: Patient) => plansFor(matchAll(p, live, {}), p);
const planOf = (p: Patient, code: string): TrialPlan => plans(p).find((x) => x.m.trial.code === code)!;
const keys = (pl: TrialPlan) => pl.steps.map((s) => s.key).sort();

section('9. Path to eligibility and the what-if sandbox', () => {
  // Robert Alvarez: PD-L1 is in the chart (agent), the eGFR is stale (new draw)
  const p2 = planOf(P('p2'), 'KEYSTONE-A');
  check('p2: KEYSTONE-A needs an agent search for PD-L1 and a repeat eGFR', JSON.stringify(keys(p2)) === JSON.stringify(['agent:pdl1', 'order:egfr']), JSON.stringify(keys(p2)));
  check('p2: the plan has no hard blockers', p2.reachable && p2.hardBlockers.length === 0);
  const r2 = rankActions(plans(P('p2')));
  check('p2: the quickest action ranks first (agent before a new lab)', r2[0]?.step.key === 'agent:pdl1');
  check('p2: neither step finishes the trial alone', r2.every((r) => r.completes.length === 0));

  // Linda Park: one medication blocks an otherwise perfect match
  const p11 = planOf(P('p11'), 'HELIX-EGFR');
  check('p11: HELIX-EGFR is reachable with a single medication step', p11.reachable && keys(p11).join() === 'medication:strongCyp3a4');
  const r11 = rankActions(plans(P('p11')));
  check('p11: the medication review completes HELIX-EGFR and ranks first', r11[0]?.step.key === 'medication:strongCyp3a4' && r11[0].completes.join() === 'HELIX-EGFR');
  check('p11: the other trials are unreachable because PD-L1 or a mutation rules them out', ['KEYSTONE-A', 'SOTERIA-G12C', 'PRISM-ALK'].every((c) => !planOf(P('p11'), c).reachable));
  check('p11: the medication step does not claim a clinical protocol', !/\b\d+ (days|weeks)\b/.test(p11.steps[0].detail) && /clinical decision/.test(p11.steps[0].detail));

  // James O'Neill: nothing a clinician could change
  check('p4: every trial is unreachable', plans(P('p4')).every((x) => !x.reachable));
  check('p4: so there is no action to rank', rankActions(plans(P('p4'))).length === 0);
  check('p4: hard blockers name what rules each trial out', plans(P('p4')).every((x) => x.hardBlockers.length > 0));

  // Priya Raman: a result outside the chart and a rule awaiting approval
  const p5 = planOf(P('p5'), 'SOTERIA-G12C');
  check('p5: SOTERIA-G12C needs the external KRAS report and a rule approval', keys(p5).some((k) => k === 'records:krasG12c') && keys(p5).some((k) => k.startsWith('informatics:')) && p5.steps.length === 2, JSON.stringify(keys(p5)));
  check('p5: the external report is not offered to the agent', !keys(p5).includes('agent:krasG12c'));

  // Dorothy Williams: conflicting sources need a human
  const p3 = planOf(P('p3'), 'HELIX-EGFR');
  check('p3: HELIX-EGFR needs a clinician to adjudicate the conflict, nothing else', keys(p3).join() === 'clinician:egfrMut');
  check('p3: that step names the conflict', /conflicting/i.test(p3.steps[0].label));

  // Elena Petrova: several values the agent can try for
  const p7 = planOf(P('p7'), 'ASCENT-ADJ');
  check('p7: the agent can try for ECOG, PD-L1, EGFR, ALK and treatment history', ['ecog', 'pdl1', 'egfrMut', 'alkFusion', 'priorLines'].every((k) => keys(p7).includes(`agent:${k}`)));

  // Every step is complete and every agent question really runs the agent for the right field
  const all = PATIENTS.filter((p) => p.treating).flatMap((p) => plans(p).flatMap((pl) => pl.steps.map((s) => ({ p, s }))));
  check('every step names an owner, a lead time and an explanation', all.every(({ s }) => s.label.length > 5 && s.owner.length > 2 && s.lead.length > 2 && s.detail.length > 10));
  check('there are agent steps to test (so the next two checks are not vacuous)', all.filter((x) => x.s.kind === 'agent').length >= 5);
  check('every agent step carries a question that routes to the resolve intent', all.filter((x) => x.s.kind === 'agent').every(({ s }) => !!s.question && classify(s.question) === 'resolve'));
  check('every agent question targets the field it is about', all.filter((x) => x.s.kind === 'agent').every(({ s }) => findKey(s.question!) === s.fact), all.filter((x) => x.s.kind === 'agent' && findKey(x.s.question!) !== x.s.fact).map((x) => `${x.s.fact}: "${x.s.question}" -> ${findKey(x.s.question!)}`).join('; '));
  check('step keys are unique within a plan', plans(P('p7')).every((pl) => new Set(pl.steps.map((s) => s.key)).size === pl.steps.length));
  check('a likely-eligible trial has no plan', !plans(P('p1')).some((pl) => pl.m.state === 'eligible'));

  // What-if: never mutates anything, replaces rather than conflicts, and never leaks
  const p = P('p2');
  const beforeP = JSON.stringify(p);
  const ctx = { overlay: {}, overrides: {} };
  const beforeCtx = JSON.stringify(ctx);
  const w = whatIf(p, live, ctx, [{ key: 'egfr', value: 68 }, { key: 'pdl1', value: 60 }], TODAY);
  const k = w.rows.find((r) => r.trial === 'KEYSTONE-A')!;
  check('what-if: a fresh eGFR and a PD-L1 of 60 would make KEYSTONE-A likely eligible', k.before === 'near' && k.after === 'eligible');
  check('what-if: the patient record is not modified', JSON.stringify(p) === beforeP);
  check('what-if: the context passed in is not modified', JSON.stringify(ctx) === beforeCtx);
  check('what-if: the real engine result afterwards is unchanged', matchAll(p, live, {}).find((m) => m.trial.code === 'KEYSTONE-A')!.state === 'near');
  const w3 = whatIf(P('p3'), live, {}, [{ key: 'egfrMut', value: false }], TODAY);
  check('what-if: replacing a conflicted value resolves the conflict instead of adding a third source', w3.rows.find((r) => r.trial === 'HELIX-EGFR')!.after === 'ineligible' && w3.rows.find((r) => r.trial === 'HELIX-EGFR')!.before === 'near');
  const w4 = whatIf(P('p3'), live, {}, [{ key: 'egfrMut', value: true }], TODAY);
  check('what-if: the other possible answer makes it likely eligible', w4.rows.find((r) => r.trial === 'HELIX-EGFR')!.after === 'eligible');
  check('what-if: an empty sandbox changes nothing', whatIf(P('p1'), live, {}, [], TODAY).changed.length === 0);
  check('what-if: setting a value to what it already is changes nothing', whatIf(P('p1'), live, {}, [{ key: 'pdl1', value: 80 }], TODAY).changed.length === 0);
  const w5 = whatIf(P('p11'), live, {}, [{ key: 'strongCyp3a4' as FactKey, value: false }], TODAY);
  check('what-if: stopping the interacting drug would make HELIX-EGFR likely eligible, matching the plan', w5.rows.find((r) => r.trial === 'HELIX-EGFR')!.after === 'eligible');
  check('what-if rows report open-item counts before and after', w.rows.every((r) => r.open.before >= 0 && r.open.after >= 0) && k.open.before > k.open.after);
  // Executing a plan in the sandbox reaches the state the plan promised
  const completes = rankActions(plans(P('p11')))[0].completes;
  check('following a one-step plan in the sandbox does reach likely eligible', completes.every((c) => w5.rows.find((r) => r.trial === c)?.after === 'eligible'));
});
