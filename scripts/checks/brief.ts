/* Visit brief and patient handout. */
import { PATIENTS, TRIALS, TODAY, VERSIONS } from '../../lib/data';
import { effectiveFacts, matchAll } from '../../lib/engine';
import { buildBrief, buildHandout, handoutText, readingGrade, FORBIDDEN_CLAIMS, HANDOUT_LANGUAGES } from '../../lib/brief';
import { plansFor, rankActions } from '../../lib/path';
import { check, section } from '../harness';
import type { Patient, TrialMatch } from '../../lib/types';

const live = TRIALS.filter((t) => !t.hiddenUntilOpened);
const P = (id: string) => PATIENTS.find((x) => x.id === id)!;
const stamp = `${VERSIONS.rules} · ${VERSIONS.prompt}`;
const briefOf = (p: Patient) => { const ms = matchAll(p, live, {}); return buildBrief(p, effectiveFacts(p), ms, rankActions(plansFor(ms, p)), TODAY, stamp); };
const cyr = /[Ѐ-ӿ]/;

section('10. Visit brief and patient handout', () => {
  const treating = PATIENTS.filter((p) => p.treating);
  for (const p of treating) {
    const b = briefOf(p);
    check(`${p.id}: the brief reads in under 2 minutes`, b.minutes < 2 && b.words > 10, `${b.words} words`);
    check(`${p.id}: the brief opens with the patient's name and age`, b.patientLine.includes(p.name) && b.patientLine.includes(String(p.age)));
    if (b.recommendation) {
      const m = matchAll(p, live, {}).find((x) => x.trial.id === b.recommendation!.trial.id)!;
      check(`${p.id}: only a likely or near-eligible trial is recommended`, m.state === 'eligible' || m.state === 'near');
      check(`${p.id}: the recommendation gives at least one supporting line`, b.recommendation.why.length > 0);
      check(`${p.id}: every supporting line carries a source label and a date`, b.recommendation.why.every((l) => /\(.+, \d{4}-\d{2}-\d{2}\)$/.test(l)), b.recommendation.why.join(' | '));
      check(`${p.id}: open items match the engine's open criteria`, b.recommendation.open.length === m.counts.unknown + m.counts.review + m.counts.pending);
      check(`${p.id}: a likely-eligible trial is preferred over a near-eligible one`, m.state === 'eligible' || !matchAll(p, live, {}).some((x) => x.state === 'eligible'));
    }
    check(`${p.id}: the brief states the as-of date and versions it was built under`, b.asOf === TODAY && b.stamp === stamp);
  }
  check('p4: no trial is recommended, and the closest blocked trial is named with its blockers', (() => { const b = briefOf(P('p4')); return b.recommendation === null && !!b.closest && /blocked by/.test(b.closest); })());
  check('p2: the brief warns that the eGFR is stale', briefOf(P('p2')).watchouts.some((w) => /eGFR is 41 days old/.test(w)), briefOf(P('p2')).watchouts.join(' | '));
  check('p3: the brief warns that EGFR sources disagree and shows both values', briefOf(P('p3')).watchouts.some((w) => /EGFR mutation: sources disagree/.test(w) && /Detected/.test(w) && /Not detected/.test(w)));
  check('p6: the brief warns the site is full', briefOf(P('p6')).watchouts.some((w) => /full at this site/.test(w)));
  check('p9: the brief warns about the satellite distance', briefOf(P('p9')).watchouts.some((w) => /45 miles/.test(w)));
  check('p11: the brief names the medication as the only blocker', briefOf(P('p11')).watchouts.some((w) => /CYP3A4/.test(w)));
  check('p7: the brief flags the low-confidence extraction', briefOf(P('p7')).watchouts.some((w) => /confidence/.test(w)));
  check('p2: the "if you do one thing" line is the ranked top action', /Search the chart for PD-L1/.test(briefOf(P('p2')).nextAction ?? ''));
  check('a likely-eligible patient has no next action to take', briefOf(P('p1')).nextAction === null);
  check('the brief never recommends a trial that is closed to this patient by disease', !treating.some((p) => { const b = briefOf(p); return b.recommendation && matchAll(p, live, {}).find((x) => x.trial.id === b.recommendation!.trial.id)!.state === 'filtered'; }));

  // Handouts
  const top = (p: Patient): TrialMatch | undefined => matchAll(p, live, {}).find((m) => m.state === 'eligible' || m.state === 'near');
  for (const p of treating) {
    const m = top(p);
    if (!m) { check(`${p.id}: no handout can be built for any trial of a patient with no match`, matchAll(p, live, {}).every((x) => buildHandout(p, x, 'English') === null) && matchAll(p, live, {}).length > 0); continue; }
    const h = buildHandout(p, m, 'English')!;
    const text = handoutText(h);
    check(`${p.id}: the English handout reads at grade 8 or lower`, readingGrade(text) <= 8, `grade ${readingGrade(text)}`);
    check(`${p.id}: the handout contains no promise or advice`, !FORBIDDEN_CLAIMS.test(text) && !/\beligible\b/i.test(text), text.match(FORBIDDEN_CLAIMS)?.[0]);
    check(`${p.id}: the handout says joining is voluntary and care will not change`, /Joining is your choice/.test(text) && /regular care will not change/.test(text));
    check(`${p.id}: the handout says it is not a promise`, /not a promise/.test(text));
    check(`${p.id}: the handout names the study and offers three questions`, text.includes(m.trial.code) && h.asks.length === 3);
    check(`${p.id}: the handout is addressed to the patient by first name`, text.includes(p.name.split(' ')[0]));
    check(`${p.id}: a near-eligible study says more checks are needed`, m.state !== 'near' || /more checks are still needed/.test(text));
    check(`${p.id}: the handout does not include clinical values or identifiers`, !text.includes(p.mrn) && !/\bMRN\b|PD-L1|ECOG|mL\/min|\d\s?%/i.test(text));
  }
  check('English is the source of truth: no interpreter is needed for it', buildHandout(P('p1'), top(P('p1'))!, 'English')!.needsInterpreter === false);
  const ru = buildHandout(P('p7'), top(P('p7'))!, 'Russian')!;
  check('the Russian handout is in Cyrillic, with the study code kept as is', cyr.test(handoutText(ru)) && handoutText(ru).includes('ASCENT-ADJ'));
  check('a non-English handout always needs an interpreter review', ru.needsInterpreter === true && ru.lang === 'Russian');
  check('the Russian handout uses the correct form of address for a female patient', /Уважаемая Elena/.test(handoutText(ru)));
  check('the Russian handout covers the same sections as the English one', ru.sections.length === buildHandout(P('p7'), top(P('p7'))!, 'English')!.sections.length && ru.asks.length === 3);
  check('the Russian handout makes no promise either', !/(?<!не )гарантир|обязательно вылечи/i.test(handoutText(ru)) && /не гарантирует/.test(handoutText(ru)));
  const fb = buildHandout(P('p1'), top(P('p1'))!, 'Vietnamese')!;
  check('an unsupported language falls back to English and demands an interpreter', fb.lang === 'English' && fb.fallback === true && fb.needsInterpreter === true);
  check('no handout for a patient with no matching trial', buildHandout(P('p4'), matchAll(P('p4'), live, {})[0], 'English') === null);
  check('no handout for a trial that is filtered out', buildHandout(P('p6'), matchAll(P('p6'), live, {}).find((m) => m.state === 'filtered')!, 'English') === null);
  // every trial that can be recommended has plain-language text in every supported language
  const codes = live.filter((t) => t.status === 'Recruiting').map((t) => t.code);
  for (const lang of HANDOUT_LANGUAGES) {
    for (const code of codes) {
      const fake = { ...matchAll(P('p1'), live, {})[0], state: 'eligible' as const, trial: live.find((t) => t.code === code)! };
      check(`plain-language text exists for ${code} in ${lang}`, buildHandout(P('p1'), fake, lang) !== null);
    }
  }
  // the readability scorer behaves
  check('reading grade: a short plain sentence scores low', readingGrade('The study is open. You can say no.') < 4);
  check('reading grade: dense jargon scores high', readingGrade('Pharmacokinetic characterization necessitates comprehensive immunohistochemical stratification of heterogeneous neoplastic populations.') > 14);
  check('the forbidden-claims filter catches the obvious promises', ['You are eligible for this study.', 'This will help you.', 'We guarantee a response.', 'It is the best option.'].every((s) => FORBIDDEN_CLAIMS.test(s)));
  check('the forbidden-claims filter leaves plain information alone', !FORBIDDEN_CLAIMS.test('Your doctor will talk with you at your visit.'));
});
