/* As-of dates and the evidence expiry clock. The oracle here does its own date arithmetic and its own window test. */
import { PATIENTS, TRIALS, TODAY, ago } from '../../lib/data';
import { evalCriterion, matchAll, matchTrial } from '../../lib/engine';
import { addDays, expiriesOf, expiryAlerts, readyUntil } from '../../lib/expiry';
import { check, section } from '../harness';
import type { Criterion, Fact, FactKey } from '../../lib/types';

const live = TRIALS.filter((t) => !t.hiddenUntilOpened);
const P = (id: string) => PATIENTS.find((x) => x.id === id)!;
const KEYSTONE = TRIALS.find((t) => t.code === 'KEYSTONE-A')!;
const plus = (days: number) => ago(-days); // TODAY + days

// Independent day count between two ISO dates
const dayNum = (iso: string) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000);
const crit = (fact: FactKey, op: Criterion['rule']['op'], value: Criterion['rule']['value'], windowDays?: number): Criterion => ({ id: 'cx', type: 'inclusion', text: 't', rule: { fact, op, value, windowDays }, review: 'approved', parseConfidence: 1, unknownStep: 'x' });
const mk = (key: FactKey, value: Fact['value'], date: string): Fact => ({ key, value, date, by: 'ehr', source: { kind: 'FHIR', resource: 'Observation', id: `t-${key}`, label: 'test' } });

section('8. As-of date (time travel) and the evidence expiry clock', () => {
  // As-of semantics: a value dated after the query date does not exist yet
  check('a value dated after the query date is ignored', evalCriterion(crit('ecog', '<=', 1, 28), [mk('ecog', 1, plus(3))], TODAY).status === 'unknown');
  check('the same value counts once the query date reaches it', evalCriterion(crit('ecog', '<=', 1, 28), [mk('ecog', 1, plus(3))], plus(3)).status === 'met');
  check('a value dated exactly on the query date counts', evalCriterion(crit('ecog', '<=', 1, 28), [mk('ecog', 1, TODAY)], TODAY).status === 'met');
  check('traveling back hides facts that did not exist yet, so the chart shrinks', (() => {
    const p1 = P('p1');
    const at = matchTrial(p1, KEYSTONE, { today: ago(7) }); // ECOG was recorded 6 days ago
    return at.results.find((r) => r.criterion.rule.fact === 'ecog')?.status === 'unknown';
  })());

  // p1's eGFR was drawn 9 days ago (28-day window) and her ECOG 6 days ago (28-day window)
  const p1 = P('p1');
  const stateAt = (n: number) => matchTrial(p1, KEYSTONE, { today: plus(n) }).state;
  check('p1 stays likely eligible up to the last valid day of the eGFR window', stateAt(19) === 'eligible');
  check('p1 drops out the day after the eGFR window closes', stateAt(20) === 'near');
  const stale = matchTrial(p1, KEYSTONE, { today: plus(20) }).results.find((r) => r.criterion.rule.fact === 'egfr')!;
  check('the expired lab is Unknown (stale), not Not met', stale.status === 'unknown' && stale.stale === true);

  // readyUntil, against an independent calculation
  const m = matchTrial(p1, KEYSTONE, {});
  const ru = readyUntil(m, TODAY)!;
  const expect = (() => {
    const lab = p1.facts.filter((f) => f.key === 'egfr')[0];
    const ecog = p1.facts.filter((f) => f.key === 'ecog')[0];
    const a = dayNum(lab.date) + 28, b = dayNum(ecog.date) + 28;
    return { until: Math.min(a, b), fact: a <= b ? 'egfr' : 'ecog' };
  })();
  check('readyUntil is the earliest time-windowed evidence to expire', dayNum(ru.expiresOn) === expect.until && ru.fact === expect.fact, `${ru.expiresOn} ${ru.fact}`);
  check('readyUntil days left matches the date difference', ru.daysLeft === dayNum(ru.expiresOn) - dayNum(TODAY));
  check('days left is zero on the last valid day', readyUntil(matchTrial(p1, KEYSTONE, { today: ru.expiresOn }), ru.expiresOn)?.daysLeft === 0);
  check('readyUntil is null for a trial the patient cannot join', readyUntil(matchTrial(P('p4'), KEYSTONE, {}), TODAY) === null);
  check('readyUntil is null when nothing in the match is time-limited', (() => { const t = { ...KEYSTONE, criteria: KEYSTONE.criteria.filter((c) => c.rule.windowDays === undefined) }; return readyUntil(matchTrial(p1, t, {}), TODAY) === null; })());

  // Expiries list: only windowed criteria, never overridden ones, expired ones flagged
  const ex = expiriesOf(matchTrial(P('p2'), KEYSTONE, {}), TODAY);
  check('a stale lab shows as already expired with negative days left', ex.some((e) => e.fact === 'egfr' && e.expired && e.daysLeft === 28 - 41), JSON.stringify(ex.map((e) => [e.fact, e.daysLeft])));
  check('every expiry has a window and an expiry date after its measurement', ex.every((e) => e.windowDays > 0 && e.expiresOn > e.measuredOn));
  check('addDays is exact across a month and a year boundary', addDays('2026-12-30', 5) === '2027-01-04' && addDays('2026-02-27', 2) === '2026-03-01' && addDays('2028-02-28', 1) === '2028-02-29');

  // Alerts, against a brute-force oracle that does not use expiriesOf
  const oracle = (today: string, within: number) => {
    const out = new Set<string>();
    for (const p of PATIENTS.filter((x) => x.treating)) {
      for (const t of live) {
        const mm = matchAll(p, [t], { today })[0];
        if (mm.state !== 'eligible' && mm.state !== 'near') continue;
        for (const c of t.criteria) {
          if (c.rule.windowDays === undefined || c.review !== 'approved') continue;
          const f = p.facts.filter((x) => x.key === c.rule.fact && x.date <= today).sort((a, b) => b.date.localeCompare(a.date))[0];
          if (!f) continue;
          const left = dayNum(f.date) + c.rule.windowDays - dayNum(today);
          if (left <= within) out.add(`${p.id}|${c.rule.fact}`);
        }
      }
    }
    return out;
  };
  for (const n of [0, 5, 14, 30]) {
    const today = plus(n);
    const got = new Set(expiryAlerts(PATIENTS, live, {}, today, 7).map((a) => `${a.patientId}|${a.fact}`));
    const want = oracle(today, 7);
    check(`alerts at +${n} days match the brute-force oracle`, got.size === want.size && [...want].every((k) => got.has(k)), `got ${[...got].sort().join(',')} want ${[...want].sort().join(',')}`);
  }
  const a0 = expiryAlerts(PATIENTS, live, {}, TODAY, 7);
  check('the stale eGFR for Robert Alvarez is an expired alert today, with a repeat-lab action', a0.some((a) => a.patientId === 'p2' && a.fact === 'egfr' && a.expired && /Repeat/.test(a.action)));
  check('alerts are sorted most urgent first', a0.every((a, i) => i === 0 || a0[i - 1].daysLeft <= a.daysLeft));
  check('an alert names the trials it protects', a0.every((a) => a.trials.length > 0));
  check('no patient is alerted twice for the same field', new Set(a0.map((a) => `${a.patientId}|${a.fact}`)).size === a0.length);
  const a30 = expiryAlerts(PATIENTS, live, {}, plus(30), 7);
  check('a month later far more evidence has expired', a30.filter((a) => a.expired).length > a0.filter((a) => a.expired).length);
  check('alerts for an ineligible-only patient never appear', !a0.some((a) => a.patientId === 'p4'));
  check('the window boundary: 28 days old is still valid, 29 is not', (() => {
    const ok = evalCriterion(crit('egfr', '>=', 60, 28), [mk('egfr', 80, ago(28))], TODAY).status;
    const bad = evalCriterion(crit('egfr', '>=', 60, 28), [mk('egfr', 80, ago(29))], TODAY).status;
    return ok === 'met' && bad === 'unknown';
  })());
});
