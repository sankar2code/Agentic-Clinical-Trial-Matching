/* Regressions from the independent review. Every check here failed against the build the reviewer read.
 * Each one pins a defect to a property that cannot regress silently: oracles are written out by hand, and where a fix
 * lives in a React page the rule was moved into lib/ so it can be tested without a browser. */
import { readFileSync } from 'node:fs';
import { PATIENTS, TRIALS, TODAY, ago } from '../../lib/data';
import { AMENDMENTS, amendedSince } from '../../lib/amendments';
import { runAgent } from '../../lib/agent';
import { buildBrief, buildHandout, handoutApproved, handoutHash, handoutText } from '../../lib/brief';
import { GENESIS, anchorHead, chainEntry, repairLog, tamperLog, verifyChain, type Anchor } from '../../lib/chain';
import { evalCriterion, isIsoDate, matchAll, matchTrial, snapshotOf, undismissed, visibleAt } from '../../lib/engine';
import { addDays, expiryAlerts } from '../../lib/expiry';
import { funnel } from '../../lib/funnel';
import { authorizeTool } from '../../lib/guards';
import { ackSignature, ruleImpact } from '../../lib/impact';
import { planFor, plansFor, rankActions } from '../../lib/path';
import { reconfirmation } from '../../lib/referral';
import { buildTrials } from '../../lib/trials';
import { replaySnapshot } from '../../lib/replay';
import { exitCriteria, recommendationsOf, reviewKey, shadowStats, compareShadow } from '../../lib/rollout';
import { DECISIONS, PERMS, canDo, hiddenByShadow, type Action } from '../../lib/perm';
import { LITERAL_KEYS, valueMatchesSpan, verifyExtraction } from '../../lib/verify';
import { POST as agentPOST } from '../../app/api/agent/route';
import { POST as matchPOST } from '../../app/api/match/route';
import { check, section } from '../harness';
import type { AuditEntry, Criterion, Dismissal, Fact, FactKey, HandoutRecord, Override, Role, Trial } from '../../lib/types';

const live = TRIALS.filter((t) => !t.hiddenUntilOpened);
const P = (id: string) => PATIENTS.find((x) => x.id === id)!;
const KEYSTONE = TRIALS.find((t) => t.code === 'KEYSTONE-A')!;
const plus = (n: number) => ago(-n); // TODAY + n days
const dayNum = (iso: string) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000);
const crit = (fact: FactKey, op: Criterion['rule']['op'], value: Criterion['rule']['value'], windowDays?: number): Criterion => ({ id: 'cx', type: 'inclusion', text: 't', rule: { fact, op, value, windowDays }, review: 'approved', parseConfidence: 1, unknownStep: 'x' });
const mk = (key: FactKey, value: Fact['value'], date: string): Fact => ({ key, value, date, by: 'ehr', source: { kind: 'FHIR', resource: 'Observation', id: `t-${key}`, label: 'test' } });
const req = (url: string, body: unknown) => new Request(`http://localhost${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function readEvents(res: Response) {
  return (await res.text()).split('\n\n').filter((x) => x.startsWith('data: ')).map((x) => JSON.parse(x.slice(6)));
}

section('19. Regressions from the independent review', async () => {
  /* ---- 1. The span check must reject a wrong value, not just a missing one ---- */
  const STAGES = ['I', 'IA', 'IB', 'II', 'IIA', 'IIB', 'III', 'IIIA', 'IIIB', 'IIIC', 'IV', 'IVA', 'IVB', 'ES', 'LS'];
  const domain = (key: FactKey, truth: Fact['value']): Fact['value'][] =>
    key === 'pdl1' ? Array.from({ length: 101 }, (_, i) => i) : key === 'ecog' ? [0, 1, 2, 3, 4, 5] : key === 'stage' ? STAGES : typeof truth === 'boolean' ? [true, false] : [];
  let cited = 0;
  const wrong: string[] = [];
  const missed: string[] = [];
  for (const p of PATIENTS) {
    for (const f of [...p.facts, ...p.hidden]) {
      const doc = p.docs.find((d) => d.id === f.source.docId) ?? f.source.inlineDoc;
      if (!f.source.span || !doc || !LITERAL_KEYS.includes(f.key)) continue;
      cited += 1;
      if (!verifyExtraction(f.key, f.value, f.source.span, doc).ok) missed.push(`${p.id} ${f.key}=${String(f.value)}`);
      for (const v of domain(f.key, f.value)) if (v !== f.value && verifyExtraction(f.key, v, f.source.span, doc).ok) wrong.push(`${p.id} ${f.key}=${String(v)} from "${f.source.span}"`);
    }
  }
  check('the sweep covers every cited literal value in the chart', cited >= 30, `${cited}`);
  check('every true value still passes its own cited span', missed.length === 0, missed.join('; '));
  check('across every real span, no wrong value in the field’s whole domain is accepted', wrong.length === 0, `${wrong.length}: ${wrong.slice(0, 4).join('; ')}`);
  const v = (key: FactKey, value: Fact['value'], span: string) => valueMatchesSpan(key, value, span);
  check('the assay clone 22C3 is not a PD-L1 score', !v('pdl1', 22, 'PD-L1 22C3 IHC: TPS 60 %') && v('pdl1', 60, 'PD-L1 22C3 IHC: TPS 60 %'));
  check('the clone 28-8 is not a score, but the score beside it is', !v('pdl1', 28, 'PD-L1 28-8 TPS 5%') && !v('pdl1', 8, 'PD-L1 28-8 TPS 5%') && v('pdl1', 5, 'PD-L1 28-8 TPS 5%'));
  check('a range or a bound is not a reading', !v('pdl1', 60, 'TPS 60-70%') && !v('pdl1', 70, 'TPS 60-70%') && !v('pdl1', 1, 'PD-L1 TPS <1%') && !v('ecog', 0, 'ECOG 0-1') && !v('ecog', 1, 'ECOG 0-1'));
  check('digits in a date are not a reading', !v('pdl1', 15, 'Collected 2026-08-15, TPS 60%') && !v('ecog', 10, 'ECOG 1 on 2026-10-02') && v('ecog', 1, 'ECOG 1 on 2026-10-02'));
  check('a decimal score reads as itself', v('pdl1', 0.5, 'TPS 0.5%') && !v('pdl1', 5, 'TPS 0.5%'));
  check('only the first reading stated is the value: a Ki-67 or a CPS in the same span is not the PD-L1', !v('pdl1', 40, 'PD-L1 TPS 60%; Ki-67 40%') && v('pdl1', 60, 'PD-L1 TPS 60%; Ki-67 40%') && !v('pdl1', 70, 'PD-L1 22C3 TPS 60 %, CPS 70') && v('pdl1', 60, 'PD-L1 22C3 TPS 60 %, CPS 70'));
  check('likewise for ECOG: a weight or an earlier score in the same span is not the performance status', !v('ecog', 70, 'ECOG 1, weight 70 kg') && !v('ecog', 2, 'ECOG 1 (was 2 in March)') && v('ecog', 1, 'ECOG 1 (was 2 in March)') && v('ecog', 1, 'ECOG performance status: 1'));
  check('a number with no cue word is not an ECOG reading', !v('ecog', 1, 'seen on 1 occasion') && !v('ecog', 1, 'stage IV, 1 prior line'));
  check('IIB is not found inside IIIB, and III is not IIIB', !v('stage', 'IIB', 'Stage IIIB adenocarcinoma') && !v('stage', 'III', 'Stage IIIB adenocarcinoma') && v('stage', 'IIIB', 'Stage IIIB adenocarcinoma'));
  check('I is not found inside IV, and IV is not found inside "extensive"', !v('stage', 'I', 'Stage IV adenocarcinoma') && !v('stage', 'IV', 'Extensive-stage small cell lung cancer') && v('stage', 'ES', 'Extensive-stage small cell lung cancer'));
  check('stage IV needs the whole token, but "metastatic" says it too, and "non-metastatic" does not', !v('stage', 'IV', 'Stage IVB') && v('stage', 'IVB', 'Stage IVB') && v('stage', 'IV', 'Metastatic adenocarcinoma') && !v('stage', 'IV', 'Non-metastatic disease'));
  check('a Cyrillic stage note reads as its Roman numeral', v('stage', 'IIA', 'стадия IIA') && !v('stage', 'II', 'стадия IIA') && !v('stage', 'I', 'стадия IIA'));
  check('a bare I is a stage only straight after the word stage', !v('stage', 'I', 'I reviewed the scan') && v('stage', 'I', 'Stage I adenocarcinoma'));
  check('"small cell" is not found inside "non-small cell"', !v('histology', 'small cell', 'Non-small cell lung cancer') && v('histology', 'small cell', 'Small cell lung cancer'));
  check('a hallucinated PD-L1 of 22 is refused end to end, and so is the same value inside the agent', (() => {
    const p2 = P('p2');
    const doc = p2.docs.find((d) => d.id === 'p2-path')!;
    const forged = { ...p2, hidden: [{ ...p2.hidden[0], value: 22 }] };
    const r = runAgent(forged, live, 'Find the PD-L1', [], {}, {});
    return !verifyExtraction('pdl1', 22, p2.hidden[0].source.span, doc).ok && r.resolved.length === 0 && r.steps.some((s) => s.reject === true);
  })());

  /* ---- 2. Age is not an observation that appears on a date ---- */
  const ASOF = [-14, -7, -1, 0, 30, 90].map(plus);
  let ageChecked = 0;
  const ageBad: string[] = [];
  for (const p of PATIENTS.filter((x) => x.treating)) {
    for (const t of TRIALS) {
      for (const c of t.criteria.filter((x) => x.rule.fact === 'age')) {
        for (const d of ASOF) {
          ageChecked += 1;
          const want = c.rule.op === '>=' ? p.age >= Number(c.rule.value) : c.rule.op === '<=' ? p.age <= Number(c.rule.value) : null;
          const got = evalCriterion(c, p.facts, d).status;
          if (want === null || got !== (want ? 'met' : 'notmet')) ageBad.push(`${p.id}/${t.code}@${d}: ${got}`);
        }
      }
    }
  }
  check('the age criteria are evaluated for every patient, trial and as-of date', ageChecked > 100, `${ageChecked}`);
  check('age gives the same answer at every as-of date, from two weeks back to three months ahead', ageBad.length === 0, ageBad.slice(0, 3).join('; '));
  check('p1 is likely eligible one day back and five days back, where only dated observations that existed then count', matchTrial(P('p1'), KEYSTONE, { today: plus(-1) }).state === 'eligible' && matchTrial(P('p1'), KEYSTONE, { today: plus(-5) }).state === 'eligible');
  check('a dated observation still disappears when it did not exist yet', matchTrial(P('p1'), KEYSTONE, { today: plus(-7) }).results.find((r) => r.criterion.rule.fact === 'ecog')?.status === 'unknown');
  check('visibleAt keeps age and hides a later observation', visibleAt(mk('age', 60, TODAY), plus(-30)) && !visibleAt(mk('ecog', 1, TODAY), plus(-30)) && visibleAt(mk('ecog', 1, TODAY), TODAY));

  /* ---- 3. The agent cannot read a report that did not exist yet ---- */
  const p2 = P('p2');
  const reportDate = p2.hidden.find((h) => h.key === 'pdl1')!.date;
  const day = (n: number) => addDays(reportDate, n);
  const before = runAgent(p2, live, 'Find the PD-L1', [], {}, {}, { today: day(-1) });
  check('the day before the report is dated, the agent finds nothing and resolves nothing', before.resolved.length === 0 && before.unresolved.some((u) => u.key === 'pdl1'));
  check('and it says the value was not there as of that date', before.unresolved.some((u) => /as of/.test(u.reason)) && before.steps.some((s) => /dated on or before/.test(s.observation)));
  check('a value that was only absent as of an earlier date is not remembered as absent from the chart', !before.searchedAbsent.includes('pdl1'));
  const onDay = runAgent(p2, live, 'Find the PD-L1', [], {}, {}, { today: day(0) });
  check('on the day the report is dated, it counts (the date is inclusive)', onDay.resolved.length === 1 && onDay.resolved[0].value === 60);
  check('and today it is found as before', runAgent(p2, live, 'Find the PD-L1', [], {}, {}).resolved.length === 1);
  let leaked = 0;
  let runs = 0;
  for (const p of PATIENTS.filter((x) => x.treating)) {
    for (const n of [-60, -45, -30, -20, -10, -3, 0]) {
      for (const q of ['Find the missing values', 'Find the PD-L1', 'What is the ECOG?']) {
        const asOf = plus(n);
        const r = runAgent(p, live, q, [], {}, {}, { today: asOf });
        runs += 1;
        leaked += r.resolved.filter((f) => f.date > asOf).length;
      }
    }
  }
  check('across every patient, date and question, the agent never resolves a value dated after the as-of date', runs > 100 && leaked === 0, `${leaked} of ${runs} runs`);
  check('nothing resolved at an early date is dated after it, even through the route', (() => {
    const r = runAgent(p2, live, 'Find the missing values', [], {}, {}, { today: day(-20) });
    return r.resolved.every((f) => f.date <= day(-20));
  })());

  /* ---- Decisions and drafts are paused while the date is simulated ---- */
  const sim = plus(-7);
  let drafted = 0;
  for (const p of PATIENTS.filter((x) => x.treating)) {
    for (const q of ['Draft a referral for the best trial', 'Find the missing values', 'Find the KRAS status', 'Find the PD-L1']) drafted += runAgent(p, live, q, [], {}, {}, { today: sim }).drafts.length;
  }
  check('while the date is simulated the agent drafts nothing, for any patient or question', drafted === 0, `${drafted}`);
  const simDraft = runAgent(P('p1'), live, 'Draft a referral for the best trial', [], {}, {}, { today: sim });
  check('and it says why, and spends no tool call', /paused/.test(simDraft.answer) && simDraft.steps.length === 0);
  check('on the real date the same question drafts a referral', runAgent(P('p1'), live, 'Draft a referral for the best trial', [], {}, {}).drafts.length === 1);
  const simKras = runAgent(P('p5'), live, 'Find the KRAS status', [], {}, {}, { today: sim });
  check('a records request is not drafted at a simulated date either', simKras.drafts.length === 0 && simKras.steps.some((s) => /Not drafted/.test(s.observation)));
  check('and is drafted on the real date', runAgent(P('p5'), live, 'Find the KRAS status', [], {}, {}).drafts.length === 1);
  const roles: Role[] = ['oncologist', 'coordinator', 'pi', 'informaticist', 'governance'];
  const everyAction = Object.keys(PERMS) as Action[];
  check('every decision is allowed to its role on the real date and refused on a simulated one', DECISIONS.every((a) => PERMS[a].every((r) => canDo(r, a, TODAY) && !canDo(r, a, sim))));
  check('actions that are not decisions are unaffected by the simulated date', everyAction.filter((a) => !DECISIONS.includes(a)).every((a) => PERMS[a].every((r) => canDo(r, a, TODAY) && canDo(r, a, sim))));
  check('a role that lacks a permission still lacks it on the real date', everyAction.every((a) => roles.filter((r) => !PERMS[a].includes(r)).every((r) => !canDo(r, a, TODAY))));
  check('the decisions that are paused are exactly the ones that write a clinical or operational record', JSON.stringify([...DECISIONS].sort()) === JSON.stringify(['adjudicate', 'approveReferral', 'dismiss', 'handout', 'override', 'worklist']));
  // The store is React-bound, so the guard on each writer is pinned by reading it: a writer that forgets it fails here.
  const store = readFileSync(new URL('../../lib/store.tsx', import.meta.url), 'utf8');
  for (const w of ['override', 'clearOverride', 'dismiss', 'restore', 'draft', 'editReferral', 'decideReferral', 'setWorklist', 'rerunReferral', 'adjudicate', 'setHandout']) {
    const at = store.indexOf(`\n    ${w}: `);
    const next = store.slice(at + 1).search(/\n    [a-zA-Z]+: /);
    const body = store.slice(at, next === -1 ? undefined : at + 1 + next);
    check(`the store's "${w}" does nothing while the date is simulated`, at > 0 && /paused\(st\)/.test(body));
  }

  /* ---- 6. Deny by default means deny by default ---- */
  const protoNames = [...Object.getOwnPropertyNames(Object.prototype), '__proto__'];
  check('the allowlist denies every name an object inherits', protoNames.length > 8 && protoNames.every((n) => !authorizeTool(n).ok), protoNames.filter((n) => authorizeTool(n).ok).join(','));
  check('and still allows the tools it lists', ['query_fhir', 'search_notes', 'draft_referral'].every((t) => authorizeTool(t).ok));

  /* ---- 7. A date that is not a date must not switch a safety window off ---- */
  const REAL = ['2026-10-06', '2028-02-29', '2000-02-29', '2026-12-31', '0001-01-01'];
  const FAKE = ['2026-99-99', '2026-02-30', '2026-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '2026-1-1', 'abc', '', '2026-10-06T00:00', ' 2026-10-06', 20261006, null, undefined, {}];
  check('real calendar dates are accepted, including leap days', REAL.every((d) => isIsoDate(d)));
  check('dates with the right shape but no such day are refused, along with every non-date', FAKE.every((d) => !isIsoDate(d)));
  const lab41 = [mk('egfr', 80, ago(41))];
  check('a 41-day-old lab is Unknown at the real date', evalCriterion(crit('egfr', '>=', 60, 28), lab41, TODAY).status === 'unknown');
  check('and an uncomputable date can never turn it into Met', FAKE.filter((d): d is string => typeof d === 'string').every((d) => evalCriterion(crit('egfr', '>=', 60, 28), lab41, d).status !== 'met'));
  const probe = { patientId: 'p2', question: 'Find the missing values' };
  const baseline = (await readEvents(await agentPOST(req('/api/agent', probe)))).pop().result;
  for (const bad of ['2026-99-99', '2026-02-30', 'not-a-date']) {
    const got = (await readEvents(await agentPOST(req('/api/agent', { ...probe, today: bad })))).pop().result;
    check(`the agent route ignores an impossible date (${bad}) and answers as of today`, JSON.stringify(got) === JSON.stringify(baseline));
  }
  const ms = await (await matchPOST(req('/api/match', { patientId: 'p2', today: '2026-99-99' }))).json();
  const m0 = await (await matchPOST(req('/api/match', { patientId: 'p2' }))).json();
  check('the match route ignores an impossible date too', JSON.stringify(ms.matches.map((m: { state: string }) => m.state)) === JSON.stringify(m0.matches.map((m: { state: string }) => m.state)));
  const early = await (await matchPOST(req('/api/match', { patientId: 'p1', today: plus(-7) }))).json();
  check('and honours a real as-of date', early.matches.find((m: { trial: { code: string } }) => m.trial.code === 'KEYSTONE-A').state === 'near');

  /* ---- 8. The alert for a lab must not depend on which trial is listed first ---- */
  const winVariant = (w: number, id: string): Trial => ({ ...KEYSTONE, id, code: `K${w}`, criteria: KEYSTONE.criteria.map((c) => (c.rule.fact === 'egfr' ? { ...c, rule: { ...c.rule, windowDays: w } } : c)) });
  const A = winVariant(45, 'ta');
  const B = winVariant(28, 'tb');
  const C = winVariant(60, 'tc');
  const perms = <T,>(xs: T[]): T[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((r) => [x, ...r])));
  const egfrLab = P('p2').facts.filter((f) => f.key === 'egfr').sort((a, b) => b.date.localeCompare(a.date))[0];
  const expectLeft = (w: number) => dayNum(egfrLab.date) + w - dayNum(TODAY);
  for (const set of [[A, B], [A, B, C], [B, C]]) {
    const outs = perms(set).map((order) => JSON.stringify(expiryAlerts([P('p2')], order, {}, TODAY, 7).filter((a) => a.fact === 'egfr')));
    check(`the eGFR alert is identical for every ordering of ${set.map((t) => t.code).join(', ')}`, new Set(outs).size === 1, outs.join(' | '));
  }
  const ab = expiryAlerts([P('p2')], [A, B], {}, TODAY, 7).find((a) => a.fact === 'egfr')!;
  check('the most urgent window wins: the 28-day window has expired even though the 45-day one has not', ab.expired && ab.daysLeft === expectLeft(28) && expectLeft(45) >= 0, `${ab.daysLeft} ${expectLeft(28)}`);
  check('and the alert names every trial it affects, in a fixed order', JSON.stringify(ab.trials) === JSON.stringify(['K28', 'K45']));
  check('real trials: reversing the list changes nothing', JSON.stringify(expiryAlerts(PATIENTS, live, {}, TODAY, 7)) === JSON.stringify(expiryAlerts(PATIENTS, [...live].reverse(), {}, TODAY, 7)));
  check('real trials, a month on: reversing the list changes nothing', JSON.stringify(expiryAlerts(PATIENTS, live, {}, plus(30), 7)) === JSON.stringify(expiryAlerts(PATIENTS, [...live].reverse(), {}, plus(30), 7)));
  const dismissedAll: Record<string, Dismissal> = Object.fromEntries(live.map((t) => [`p2|${t.id}`, { reason: 'x', note: '', by: 'x', at: 'x' }]));
  check('a trial the clinician dismissed raises no alert', !expiryAlerts(PATIENTS, live, {}, TODAY, 7, dismissedAll).some((a) => a.patientId === 'p2') && expiryAlerts(PATIENTS, live, {}, TODAY, 7).some((a) => a.patientId === 'p2'));
  const dismissedOne = { 'p2|ta': { reason: 'x', note: '', by: 'x', at: 'x' } };
  check('dismissing one of two trials keeps the other one’s alert, and only its code', JSON.stringify(expiryAlerts([P('p2')], [A, B], {}, TODAY, 7, dismissedOne).find((a) => a.fact === 'egfr')?.trials) === JSON.stringify(['K28']));

  /* ---- 4. The brief quotes the clinician's citation, not the evidence it overruled ---- */
  const p4 = P('p4');
  const p4m = matchTrial(p4, KEYSTONE, {});
  const attest: Record<string, Override> = {};
  for (const r of p4m.results.filter((x) => x.status !== 'met')) attest[`p4|${KEYSTONE.id}|${r.criterion.id}`] = { to: 'met', reason: 'clinical judgement', note: 'n', citation: `Outside record 2026-09-30 supports ${r.criterion.rule.fact}`, by: 'x', at: 'x', original: r.status };
  const att = matchAll(p4, live, { overrides: attest });
  check('overriding every open criterion makes p4 likely eligible for KEYSTONE-A (the review’s scenario)', att.find((m) => m.trial.id === KEYSTONE.id)!.state === 'eligible');
  const brief = buildBrief(p4, p4.facts, att, [], TODAY, 'v');
  const ecogLine = brief.recommendation?.why.find((w) => /ECOG/.test(w)) ?? '';
  check('the brief says the ECOG criterion is clinician-attested and quotes the citation', /clinician-attested/.test(ecogLine) && /Outside record 2026-09-30 supports ecog/.test(ecogLine), ecogLine);
  check('and never quotes the contradicting system value (ECOG 3) as the reason it fits', !(brief.recommendation?.why ?? []).some((w) => /Oncology clinic note/.test(w) && /ECOG/.test(w)));
  const p3 = P('p3');
  const helix = TRIALS.find((t) => t.code === 'HELIX-EGFR')!;
  const conflicted = matchAll(p3, live, {});
  const conflictRow = conflicted.find((m) => m.trial.id === helix.id)!.results.find((r) => r.conflict)!;
  const settled = matchAll(p3, live, { overrides: { [`p3|${helix.id}|${conflictRow.criterion.id}`]: { to: 'met', reason: 'wrong source', note: 'n', citation: 'Tissue report is the reference', by: 'x', at: 'x', original: 'review' } } });
  const hasDisagree = (ms: typeof conflicted) => buildBrief(p3, p3.facts, ms, [], TODAY, 'v').watchouts.some((w) => /sources disagree/.test(w));
  check('a conflict is a watch-out until the clinician settles it', hasDisagree(conflicted));
  check('and stops being one once the clinician has overridden that row', !hasDisagree(settled));

  /* ---- 9. A replay must apply the drill that was on when the result was stored ---- */
  const p1 = P('p1');
  const drilled = matchAll(p1, live, { dropNlp: ['pdl1'] });
  const drillEntry: AuditEntry = { id: 1, ts: 'x', actor: 'a', role: 'r', action: 'match.run', patientId: 'p1', detail: 'd', versions: 'v', snapshot: snapshotOf(drilled), asOf: TODAY, drill: ['pdl1'] };
  check('the stored drilled result has PD-L1 Unknown', drilled.find((m) => m.trial.id === KEYSTONE.id)!.results.find((r) => r.criterion.rule.fact === 'pdl1')!.status === 'unknown');
  check('replaying it with its drill reproduces the result: nothing changes', replaySnapshot(drillEntry, p1, live, {}, {})!.changed.length === 0);
  const noFlag = replaySnapshot({ ...drillEntry, drill: undefined }, p1, live, {}, {})!;
  check('without the drill flag it would have shown a spurious flip, which is the defect', noFlag.changed.some((c) => c.criterionId.length > 0 && c.then === 'unknown' && c.now === 'met'));

  /* ---- 5. Undoing a simulated tamper must leave a log that verifies ---- */
  const logOf = (n: number): AuditEntry[] => { const out: AuditEntry[] = []; let prev = GENESIS; for (let i = 1; i <= n; i++) { const e = chainEntry(prev, { id: i, ts: `t${i}`, actor: 'a', role: 'r', action: 'x', detail: `entry ${i}`, versions: 'v' }); out.push(e); prev = e.hash!; } return out; };
  const head = (log: AuditEntry[], ts = 'n'): Anchor => ({ count: log.length, head: log[log.length - 1].hash!, ts });
  const clean = logOf(8);
  for (const kind of ['edit', 'rewrite'] as const) {
    const anchors = [head(clean)];
    const t = tamperLog(clean, 3, kind, 'rewritten')!;
    check(`${kind}: the tampered log is detected, by the entry for an edit and by the anchor for a rewrite`, kind === 'edit' ? verifyChain(t.audit, anchors).broken?.id === 3 : verifyChain(t.audit, anchors).ok === false && verifyChain(t.audit, anchors).broken === undefined);
    const back = repairLog(t.audit, anchors, t.tamper);
    check(`${kind}: undoing it restores the exact original log`, JSON.stringify(back.audit) === JSON.stringify(clean));
    check(`${kind}: and the log verifies against the anchor taken before the tampering`, verifyChain(back.audit, back.anchors).ok && back.anchors.length === 1);
  }
  // The review's scenario: tamper, anchor, undo. The anchor must not be possible, and if one slipped in it must not survive.
  const tt = tamperLog(clean, 2, 'rewrite', 'x')!;
  check('an anchor cannot be taken while the log is tampered with', anchorHead(tt.audit, [], true, 'n') === null && anchorHead(tt.audit, [], false, 'n') !== null);
  const smuggled = [head(tt.audit)];
  const fixed = repairLog(tt.audit, smuggled, tt.tamper);
  check('even an anchor that slipped in during the tampering is dropped on undo, so no false failure remains', fixed.anchors.length === 0 && verifyChain(fixed.audit, fixed.anchors).ok);
  const grown = [...tt.audit, chainEntry(tt.audit[tt.audit.length - 1].hash!, { id: 9, ts: 't9', actor: 'a', role: 'r', action: 'x', detail: 'written during tampering', versions: 'v' })];
  const grownFixed = repairLog(grown, [], tt.tamper);
  check('entries written during the tampering are chained back onto the honest log', grownFixed.audit.length === 9 && verifyChain(grownFixed.audit).ok && grownFixed.audit[8].detail === 'written during tampering');
  const mixed = repairLog(tt.audit, [head(clean), head(tt.audit)], tt.tamper);
  check('an anchor survives an undo only if it agrees with the restored log, whatever order they were taken in', mixed.anchors.length === 1 && mixed.anchors[0].head === clean[clean.length - 1].hash && verifyChain(mixed.audit, mixed.anchors).ok);
  check('an anchor for an entry that no longer exists is dropped too', repairLog(grown, [{ count: 9, head: grown[8].hash!, ts: 'n' }], tt.tamper).anchors.length === 0);
  check('tampering with an entry that does not exist is refused', tamperLog(clean, 99, 'edit', 'x') === null);

  /* ---- 15. A referral drafted before an amendment is as stale as one approved before it ---- */
  const a1 = AMENDMENTS.find((a) => a.id === 'A1')!;
  const refFor = (trialId: string, createdAt: string, confirmedAt?: string) => ({ trialId, createdAt, confirmedAt });
  const applied = [{ id: 'A1', appliedAt: '2026-10-06T12:00:00.000Z' }];
  check('a draft written before the amendment is flagged even if it is approved after it', amendedSince(refFor(a1.trialId, '2026-10-06T10:00:00.000Z'), applied).join() === 'A1');
  check('a referral written after the amendment is not flagged', amendedSince(refFor(a1.trialId, '2026-10-06T13:00:00.000Z'), applied).length === 0);
  check('re-confirming after the amendment clears the flag', amendedSince(refFor(a1.trialId, '2026-10-06T10:00:00.000Z', '2026-10-06T14:00:00.000Z'), applied).length === 0);
  check('re-confirming before the amendment does not', amendedSince(refFor(a1.trialId, '2026-10-06T09:00:00.000Z', '2026-10-06T10:00:00.000Z'), applied).join() === 'A1');
  check('an amendment to another trial does not flag it', amendedSince(refFor('t5', '2026-10-06T10:00:00.000Z'), applied).length === 0);
  check('an amendment that has not been applied does not flag it', amendedSince(refFor(a1.trialId, '2026-10-06T10:00:00.000Z'), []).length === 0);
  const refSrc = readFileSync(new URL('../../lib/store.tsx', import.meta.url), 'utf8');
  const rerun = refSrc.slice(refSrc.indexOf('rerunReferral: (id)'), refSrc.indexOf('setReview: (tid, cid'));
  check('the re-run really re-runs the match, stores its results, and re-confirms only a referral that still holds', /matchTrial\(/.test(rerun) && /snapshotOf\(\[m\]\)/.test(rerun) && /holds \?/.test(rerun) && /confirmedAt/.test(rerun) && !/decidedAt/.test(rerun));
  const rc = (pid: string, trials: Trial[], code = 'KEYSTONE-A') => reconfirmation(matchTrial(P(pid), trials.find((t) => t.code === code)!, {}), 'v');
  check('a referral for a patient who is still likely eligible is re-confirmed, and the message gives the real counts', (() => { const r = rc('p1', live); return r.holds && /KEYSTONE-A is likely eligible \(\d+ met, 0 not met, 0 open\)/.test(r.detail); })());
  check('a referral for a patient who is now ineligible is not re-confirmed, and says so', (() => { const r = rc('p4', live); return !r.holds && /no longer holds/.test(r.detail); })());
  check('a near-eligible patient with every rule evaluated can still be re-confirmed', (() => { const r = rc('p2', live); return r.holds && /near-eligible/.test(r.detail); })());
  const amendedTrials = buildTrials(TRIALS, {}, [], [{ id: 'A1', appliedAt: 'now' }]);
  check('after an amendment the changed rules are not evaluated, so the referral cannot be re-confirmed yet', (() => { const r = rc('p1', amendedTrials); return !r.holds && /await reviewer approval/.test(r.detail) && /not evaluated/.test(r.detail); })());
  const approvedAll = buildTrials(TRIALS, Object.fromEntries(amendedTrials.find((t) => t.code === 'KEYSTONE-A')!.criteria.map((c) => [`t1|${c.id}`, { review: 'approved' as const }])), [], [{ id: 'A1', appliedAt: 'now' }]);
  check('once the amended rules are approved, the same referral can be re-confirmed under the new protocol', (() => { const r = rc('p1', approvedAll); return r.holds && /re-confirmed/.test(r.detail); })());
  check('the store uses it and records the re-run with its stored results', /reconfirmation\(/.test(rerun) && /snapshotOf\(\[m\]\)/.test(rerun) && /confirmedAt/.test(rerun) && !/decidedAt/.test(rerun));

  /* ---- 17. The path planner must not send the agent back to a place it already searched ---- */
  const p2m = matchTrial(P('p2'), KEYSTONE, {});
  const stepOf = (searched: FactKey[]) => planFor(p2m, P('p2'), searched).steps.find((s) => s.fact === 'pdl1');
  check('before a search, the next step for a missing PD-L1 is to ask the agent', stepOf([])?.kind === 'agent');
  check('after the agent searched and found nothing, the step is a new test, with the reason', stepOf(['pdl1'])?.kind === 'order' && /searched the chart and found nothing/.test(stepOf(['pdl1'])!.detail));
  check('a search for one field does not change the step for another', planFor(p2m, P('p2'), ['pdl1']).steps.filter((s) => s.fact !== 'pdl1').every((s) => planFor(p2m, P('p2'), []).steps.some((x) => x.key === s.key)));
  check('the ranked next action drops the agent step once it has been tried', !rankActions(plansFor([p2m], P('p2'), ['pdl1'])).some((r) => r.step.key === 'agent:pdl1') && rankActions(plansFor([p2m], P('p2'), [])).some((r) => r.step.key === 'agent:pdl1'));

  /* ---- 12. An approval covers the text that was approved ---- */
  const eligible = matchTrial(P('p1'), KEYSTONE, {});
  const near = { ...eligible, state: 'near' as const };
  const hEl = handoutText(buildHandout(P('p1'), eligible, 'English')!);
  const hNear = handoutText(buildHandout(P('p1'), near, 'English')!);
  check('the handout wording differs between likely and near-eligible, which is why the approval must track it', hEl !== hNear && handoutHash(hEl) !== handoutHash(hNear));
  const rec: HandoutRecord = { status: 'approved', interpreterReviewed: false, by: 'x', at: 'x', hash: handoutHash(hNear) };
  check('an approval holds for the text that was approved', handoutApproved(rec, hNear));
  check('and stops holding when the state moves and the wording changes', !handoutApproved(rec, hEl));
  check('a draft, an approval with no hash, or no record is never approved', !handoutApproved({ ...rec, status: 'draft' }, hNear) && !handoutApproved({ ...rec, hash: undefined }, hNear) && !handoutApproved(undefined, hNear));

  /* ---- 13. Shadow mode hides the system's results from every page that shows them ---- */
  const everyRole: Role[] = ['oncologist', 'coordinator', 'pi', 'informaticist', 'governance'];
  check('in shadow mode the oncologist and the coordinator are hidden from results, and nobody else', everyRole.every((r) => hiddenByShadow('shadow', r) === (r === 'oncologist' || r === 'coordinator')));
  check('outside shadow mode nobody is hidden', ['hitl', 'steady'].every((m) => everyRole.every((r) => !hiddenByShadow(m, r))));
  const PAGES = ['app/page.tsx', 'app/patient/[id]/trials/page.tsx', 'app/patient/[id]/trials/[tid]/page.tsx', 'app/patient/[id]/trials/[tid]/packet/page.tsx', 'app/patient/[id]/brief/page.tsx', 'app/worklist/page.tsx', 'app/trials/page.tsx', 'app/monitoring/page.tsx', 'app/admin/criteria/page.tsx'];
  for (const f of PAGES) check(`${f} applies the shadow gate`, /shadowHidden/.test(readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')));

  /* ---- 14. A dismissed trial is not recommended, counted, planned or adjudicated ---- */
  const dis = (pid: string, tid: string): Record<string, Dismissal> => ({ [`${pid}|${tid}`]: { reason: 'Patient preference', note: '', by: 'x', at: 'x' } });
  const all = recommendationsOf(PATIENTS, live, {}, {});
  const one = all[0];
  const without = recommendationsOf(PATIENTS, live, {}, dis(one.pid, one.tid));
  check('a dismissed pair leaves the recommendations and nothing else does', without.length === all.length - 1 && !without.some((r) => r.pid === one.pid && r.tid === one.tid));
  check('undismissed() drops exactly the dismissed trial for that patient', (() => { const ms = matchAll(P(one.pid), live, {}); const kept = undismissed(ms, dis(one.pid, one.tid), one.pid); return kept.length === ms.length - 1 && undismissed(ms, dis(one.pid, one.tid), 'p9').length === ms.length; })());
  const stats = shadowStats(compareShadow({}));
  const hitl = (rs: number, adj: number) => exitCriteria('hitl', { gatePass: true, failedGate: [], stats, recommendations: rs, adjudicated: adj, agreeRate: 100, disagreements: 0 }).find((c) => c.id === 'cov')!.ok;
  check('the adjudication-coverage criterion is reachable once the dismissed pair is excluded', hitl(without.length, without.length) && !hitl(all.length, without.length));
  check('the week’s sample review is keyed by week and pair, so a later week starts clean', reviewKey('2026-W41', 'p1|t1') !== reviewKey('2026-W42', 'p1|t1') && reviewKey('2026-W41', 'p1|t1') === '2026-W41|p1|t1');
  const f0 = funnel(KEYSTONE, PATIENTS, {}, [], TODAY);
  const likelyPair = PATIENTS.filter((p) => p.treating).find((p) => matchTrial(p, KEYSTONE, {}).state === 'eligible')!;
  const f1 = funnel(KEYSTONE, PATIENTS, {}, [], TODAY, dis(likelyPair.id, KEYSTONE.id));
  const n = (f: typeof f0, id: string) => f.stages.find((s) => s.id === id)!.n;
  check('a dismissed patient leaves the funnel’s pipeline but not its pre-filter count', n(f1, 'likely') === n(f0, 'likely') - 1 && n(f1, 'pipeline') === n(f0, 'pipeline') - 1 && n(f1, 'prefilter') === n(f0, 'prefilter'));
  check('and the funnel says how many were dismissed', /1 dismissed/.test(f1.stages.find((s) => s.id === 'pipeline')!.note ?? '') && f0.stages.find((s) => s.id === 'pipeline')!.note === undefined);
  check('the forecast yield falls with the pipeline', f1.forecast.pipelineYield < f0.forecast.pipelineYield);

  /* ---- 11. An acknowledgement belongs to the impact it was given for ---- */
  const pdl1 = KEYSTONE.criteria.find((c) => c.rule.fact === 'pdl1')!;
  const impactAt = (value: number) => ruleImpact({ patients: PATIENTS, trials: live, ctx: {}, tid: KEYSTONE.id, cid: pdl1.id, rule: { fact: 'pdl1', op: '>=', value }, review: 'approved' });
  const mild = impactAt(70);
  const harsh = impactAt(90);
  check('raising the threshold to 70 and to 90 costs different people', JSON.stringify(mild.eligibleLost.map((x) => x.patientId)) !== JSON.stringify(harsh.eligibleLost.map((x) => x.patientId)) || mild.eligibleLost.length !== harsh.eligibleLost.length);
  check('their acknowledgement signatures differ, so one cannot approve the other', ackSignature(mild) !== ackSignature(harsh) && ackSignature(mild) === ackSignature(impactAt(70)));
  check('an impact that loses nobody has an empty signature and is not risky', (() => { const i = impactAt(50); return ackSignature(i) === '' && !i.risky; })());
  const rejected = ruleImpact({ patients: PATIENTS, trials: live, ctx: {}, tid: KEYSTONE.id, cid: pdl1.id, review: 'rejected' });
  check('rejecting an approved rule is risky when it demotes someone who is likely eligible', rejected.risky && rejected.eligibleLost.some((x) => x.patientId === 'p1') && ackSignature(rejected).includes('p1'));
  check('and the demotion is to near-eligible, because the rule is simply not evaluated', rejected.states.filter((s) => s.from === 'eligible').every((s) => s.to === 'near'));
  // Nothing was lost on an unrelated trial
  check('the impact of a rejection never touches another trial', rejected.states.every((s) => s.trial === 'KEYSTONE-A'));
});
