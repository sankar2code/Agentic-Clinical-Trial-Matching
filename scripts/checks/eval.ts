/* Eval harness, golden set and rollout statistics. */
import { PATIENTS, TRIALS, ago, TODAY } from '../../lib/data';
import { matchAll } from '../../lib/engine';
import { agentComplete, runEval, variantTrials } from '../../lib/eval';
import { CRIT_TRUTH, CRIT_TRUTH_AGENT, GOLD_ENGINE, MANUAL_SEED, TRUTH_FIELDS, UNKNOWN_TRUTH, goldPairs, pairKey } from '../../lib/golden';
import { compareShadow, exitCriteria, isoWeek, kappa, sampleFor, shadowStats } from '../../lib/rollout';
import { check, section } from '../harness';
import type { MatchState } from '../../lib/types';

const live = TRIALS.filter((t) => !t.hiddenUntilOpened);
const idByCode = (c: string) => TRIALS.find((t) => t.code === c)!.id;

section('15. Eval harness, golden set and rollout statistics', () => {
  // The golden set itself
  const pairs = goldPairs();
  check('the golden set has 31 adjudicated pairs', pairs.length === 31);
  const engineLive = new Set<string>();
  for (const p of PATIENTS.filter((x) => x.treating)) for (const m of matchAll(p, live, {})) if (m.state !== 'filtered') engineLive.add(pairKey(p.id, m.trial.id));
  check('every live pair has a gold label and every gold label is a live pair', pairs.length === engineLive.size && pairs.every((g) => engineLive.has(pairKey(g.pid, g.tid))));
  check('the golden labels agree with the engine on the shipped rules, chart as it stands', pairs.every((g) => matchAll(PATIENTS.find((p) => p.id === g.pid)!, live, {}).find((m) => m.trial.id === g.tid)!.state === GOLD_ENGINE[g.pid][g.tid]));
  check('the manual screen covers exactly the same 31 pairs', Object.keys(MANUAL_SEED).length === 31 && pairs.every((g) => pairKey(g.pid, g.tid) in MANUAL_SEED));
  check('every criterion label points at a real patient, trial and field', Object.keys({ ...CRIT_TRUTH, ...CRIT_TRUTH_AGENT }).every((k) => { const [pid, code, fact] = k.split('|'); const t = TRIALS.find((x) => x.code === code); return !!PATIENTS.find((p) => p.id === pid) && !!t && t.criteria.some((c) => c.rule.fact === fact); }));
  check('every criterion label is a valid status', Object.values({ ...CRIT_TRUTH, ...CRIT_TRUTH_AGENT }).every((s) => ['met', 'notmet', 'unknown', 'review', 'pending'].includes(s)));
  check('every key-field truth is a number or a stage the app understands', Object.values(TRUTH_FIELDS).every((f) => Object.values(f).every((v) => ['number', 'string', 'boolean'].includes(typeof v))));
  check('every Unknown the engine can return, before or after the agent, has a label', (() => {
    const missing: string[] = [];
    for (const p of PATIENTS.filter((x) => x.treating)) {
      const { overlay } = agentComplete(p, live);
      for (const ms of [matchAll(p, live, {}), matchAll(p, live, { overlay: { [p.id]: overlay } })])
        for (const m of ms.filter((x) => x.state !== 'filtered')) for (const r of m.results.filter((x) => x.status === 'unknown')) if (!UNKNOWN_TRUTH[`${p.id}|${r.criterion.rule.fact}`]) missing.push(`${p.id}|${r.criterion.rule.fact}`);
    }
    return missing.length === 0;
  })());
  check('exactly one pair changes state once the agent has run, and it is the mesothelioma patient', pairs.filter((g) => g.agent !== g.engine).length === 1 && pairs.filter((g) => g.agent !== g.engine)[0].pid === 'p10');

  // agentComplete terminates and does the expected work
  const done = (id: string) => agentComplete(PATIENTS.find((p) => p.id === id)!, live).overlay.map((f) => f.key).sort().join();
  check('agentComplete resolves exactly what is findable for each patient', done('p2') === 'pdl1' && done('p7') === 'alkFusion,ecog,egfrMut,pdl1' && done('p10') === 'ecog' && done('p1') === '' && done('p5') === '');
  check('agentComplete never resolves something external', !agentComplete(PATIENTS.find((p) => p.id === 'p5')!, live).overlay.some((f) => f.key === 'krasG12c'));

  // The release gate
  const base = runEval(variantTrials('baseline'));
  check('the pristine ruleset passes every metric', base.gate === 'pass' && base.failed.length === 0, base.failed.join());
  check('the report is built on the whole golden set', base.pairs === 31 && base.labels === Object.keys(CRIT_TRUTH).length + Object.keys(CRIT_TRUTH_AGENT).length);
  check('every metric carries a threshold, a display value and a sample size', base.metrics.every((m) => m.threshold.length > 0 && m.display.length > 0 && m.n > 0));
  check('the report covers all ten PRD-driven metrics', base.metrics.length === 10 && ['criterion', 'unknown', 'citation', 'extraction', 'recall', 'agent', 'latency', 'equity', 'false-eligible', 'unsupported-met'].every((id) => base.metrics.some((m) => m.id === id)));
  check('the two safety metrics are marked critical and have zero tolerance', base.metrics.filter((m) => m.critical).map((m) => m.id).sort().join() === 'false-eligible,unsupported-met' && base.metrics.filter((m) => m.critical).every((m) => m.threshold === '0'));
  check('citation validity is computed over every Met in the golden set, not asserted', base.metrics.find((m) => m.id === 'citation')!.n > 300);
  check('the engine latency is measured, not made up', base.latency.n === 120 && base.latency.p95 >= 0 && base.latency.p95 < 1000);
  check('the baseline has no failures to report', base.failures.length === 0);

  const prev = runEval(variantTrials('previous'));
  check('the rollback target (1.3.2) fails the gate on a safety metric', prev.gate === 'fail' && prev.failed.includes('false-eligible') && prev.failed.includes('unsupported-met'));
  check('the failure is the stale eGFR counted as Met for Robert Alvarez', prev.failures.some((f) => f.metric === 'unsupported-met' && f.subject === 'p2|KEYSTONE-A|egfr') && prev.failures.some((f) => f.metric === 'false-eligible' && f.subject === `p2|${idByCode('KEYSTONE-A')}`));
  const cand = runEval(variantTrials('candidate'));
  check('the candidate (1.5.0-rc) fails the gate', cand.gate === 'fail' && cand.failed.includes('false-eligible'));
  check('the candidate failure is the carbamazepine patient shown as likely eligible', cand.failures.some((f) => f.metric === 'false-eligible' && f.subject === `p11|${idByCode('HELIX-EGFR')}` && f.got === 'eligible'));
  check('a failure always names what was expected and what was got', [...prev.failures, ...cand.failures].every((f) => f.subject.length > 3 && f.expected.length > 0 && f.got.length > 0));
  check('the ruleset under test is named in the report', base.ruleSet === 'ruleset-1.4.0' && prev.ruleSet === 'ruleset-1.3.2' && cand.ruleSet === 'ruleset-1.5.0-rc');
  check('the report is deterministic apart from the measured latency', (() => { const strip = (r: typeof prev) => JSON.stringify({ ...r, latency: 0, metrics: r.metrics.filter((m) => m.id !== 'latency') }); return strip(runEval(variantTrials('previous'))) === strip(prev); })());

  // A gate that can fail on each of its metrics: break one thing each time and expect exactly that metric to trip
  const broken = (mutate: (t: typeof live) => typeof live) => runEval(mutate(variantTrials('baseline')));
  const dropFact = (code: string, fact: string) => (ts: typeof live) => ts.map((t) => (t.code === code ? { ...t, criteria: t.criteria.filter((c) => c.rule.fact !== fact) } : t));
  const flip = (code: string, fact: string, rule: Partial<(typeof live)[0]['criteria'][0]['rule']>) => (ts: typeof live) => ts.map((t) => (t.code === code ? { ...t, criteria: t.criteria.map((c) => (c.rule.fact === fact ? { ...c, rule: { ...c.rule, ...rule } } : c)) } : t));
  check('breaking the ECOG rule lowers criterion accuracy', broken(flip('KEYSTONE-A', 'ecog', { value: 0 })).metrics.find((m) => m.id === 'criterion')!.display !== '100%');
  check('removing a trial from the ruleset is reported as missing criteria, not silently ignored', broken((ts) => ts.filter((t) => t.code !== 'KEYSTONE-A')).failures.some((f) => f.got === 'missing'));
  check('removing the brain-metastasis exclusion is caught', broken(dropFact('KEYSTONE-A', 'brainMets')).failures.some((f) => f.subject.includes('brainMets')));
  check('widening the PD-L1 threshold to 1 does not move any pair, so the pair gate still passes', broken(flip('KEYSTONE-A', 'pdl1', { value: 1 })).failed.indexOf('false-eligible') < 0);
  check('a rule set that lets everyone through fails the safety gate', runEval(variantTrials('baseline').map((t) => ({ ...t, criteria: t.criteria.filter((c) => c.type === 'inclusion' && ['age', 'diagnosis'].includes(c.rule.fact)) }))).failed.includes('false-eligible'));

  // Rollout statistics against an independent calculation
  check("kappa: identical raters give 1", kappa([true, false, true], [true, false, true]) === 1);
  check('kappa: the textbook example gives 0.5', kappa([true, true, false, false], [true, false, false, false]) === 0.5);
  check('kappa: raters that agree only as often as chance gives 0', Math.abs(kappa([true, true, false, false], [true, false, true, false])) < 1e-9);
  check('kappa: raters who always disagree give a negative value', kappa([true, false, true, false], [false, true, false, true]) < 0);
  const agent: Record<string, MatchState> = {};
  for (const p of PATIENTS.filter((x) => x.treating)) { const { overlay } = agentComplete(p, live); for (const m of matchAll(p, live, { overlay: { [p.id]: overlay } })) if (m.state !== 'filtered') agent[pairKey(p.id, m.trial.id)] = m.state; }
  const rows = compareShadow(agent);
  const st = shadowStats(rows);
  check('shadow: the system after the agent matches the adjudicated truth on every pair', st.system.accuracy === 100 && st.system.fp === 0 && st.system.fn === 0);
  check('shadow: manual screening makes 3 false positives and 1 miss', st.manual.fp === 3 && st.manual.fn === 1 && st.manual.tp === 3);
  check('shadow: the three false positives are the portal lab, the one-sided genomic result and the drug interaction', st.catches.map((r) => r.pair).sort().join() === 'p11|t2,p2|t1,p3|t2');
  check('shadow: the system finds the satellite-site patient the coordinator never screened', st.incrementalFinds.map((r) => r.pair).join() === 'p9|t5');
  const manualPos = rows.map((r) => r.manualPos), sysPos = rows.map((r) => r.systemPos);
  const n = rows.length, po = rows.filter((r) => r.manualPos === r.systemPos).length / n, pa = sysPos.filter(Boolean).length / n, pb = manualPos.filter(Boolean).length / n, pe = pa * pb + (1 - pa) * (1 - pb);
  check('shadow: kappa matches an independent calculation', Math.abs(st.kappa - Math.round(((po - pe) / (1 - pe)) * 1000) / 1000) < 0.0011, `${st.kappa} vs ${(po - pe) / (1 - pe)}`);
  check('shadow: agreement is the share of pairs where both raters say the same', st.agreement === Math.round((rows.filter((r) => r.agree).length / n) * 1000) / 10);
  const engineOnly: Record<string, MatchState> = {};
  for (const p of PATIENTS.filter((x) => x.treating)) for (const m of matchAll(p, live, {})) if (m.state !== 'filtered') engineOnly[pairKey(p.id, m.trial.id)] = m.state;
  check('shadow: without the agent the system misses the one finding that needs it', shadowStats(compareShadow(engineOnly)).system.fn === 1);
  check('every row says who was right', rows.every((r) => ['both', 'system', 'manual', 'neither'].includes(r.right)));

  // Exit criteria
  const gate = (g: boolean) => exitCriteria('shadow', { gatePass: g, failedGate: g ? [] : ['false-eligible'], stats: st, recommendations: 9, adjudicated: 0, agreeRate: 0, disagreements: 0 });
  check('shadow exit: everything passes on the shipped rules', gate(true).every((c) => c.ok));
  check('shadow exit: a failing eval gate blocks promotion and says which metric', !gate(false)[0].ok && /false-eligible/.test(gate(false)[0].detail));
  check('shadow exit: a false positive blocks promotion', !exitCriteria('shadow', { gatePass: true, failedGate: [], stats: { ...st, system: { ...st.system, fp: 1, accuracy: 96.8 } }, recommendations: 0, adjudicated: 0, agreeRate: 0, disagreements: 0 }).find((c) => c.id === 'fp')!.ok);
  const hitl = (adj: number, rate: number) => exitCriteria('hitl', { gatePass: true, failedGate: [], stats: st, recommendations: 9, adjudicated: adj, agreeRate: rate, disagreements: 0 });
  check('hitl exit: 9 of 9 adjudicated with high agreement passes', hitl(9, 100).every((c) => c.ok));
  check('hitl exit: 8 of 9 is below 90% coverage for 9 recommendations? (88.9%)', !hitl(8, 100).find((c) => c.id === 'cov')!.ok);
  check('hitl exit: high coverage with low agreement still blocks', !hitl(9, 70).find((c) => c.id === 'agree')!.ok);
  check('hitl exit: nothing adjudicated blocks', hitl(0, 0).every((c) => !c.ok));

  // The weekly sample
  const keys = pairs.map((g) => pairKey(g.pid, g.tid));
  const s1 = sampleFor(keys, 5, '2026-W41');
  check('the weekly 5% sample of 31 results is 2 pairs', s1.length === 2);
  check('the sample is deterministic for the same week', JSON.stringify(s1) === JSON.stringify(sampleFor(keys, 5, '2026-W41')));
  check('the sample is independent of input order', JSON.stringify(s1) === JSON.stringify(sampleFor([...keys].reverse(), 5, '2026-W41')));
  check('the sample only contains real pairs, with no duplicates', s1.every((k) => keys.includes(k)) && new Set(s1).size === s1.length);
  check('a different week gives a different sample at least some of the time', new Set(Array.from({ length: 20 }, (_, i) => sampleFor(keys, 5, `2026-W${i + 1}`).join())).size > 5);
  check('over 200 weeks every pair is sampled, and none is sampled wildly more than average', (() => { const c: Record<string, number> = {}; for (let w = 1; w <= 200; w++) for (const k of sampleFor(keys, 5, `W${w}`)) c[k] = (c[k] ?? 0) + 1; const avg = (200 * 2) / keys.length; return keys.every((k) => (c[k] ?? 0) > 0) && Math.max(...Object.values(c)) < avg * 2; })());
  check('a 100% rate samples everything and a tiny rate still samples one', sampleFor(keys, 100, 'w').length === 31 && sampleFor(keys, 0.1, 'w').length === 1);
  check('ISO weeks: 2026-01-01 is week 1, 2027-01-03 is week 53 of 2026, 2024-12-30 is week 1 of 2025', isoWeek('2026-01-01') === '2026-W01' && isoWeek('2027-01-03') === '2026-W53' && isoWeek('2024-12-30') === '2025-W01');
  check('ISO weeks: the app date falls in a sensible week', /^2026-W4\d$/.test(isoWeek(TODAY)));
  void ago;
});
