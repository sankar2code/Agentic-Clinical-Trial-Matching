import { FACT_LABEL, fmtVal } from './data';
import type { ActionRank } from './path';
import { sha256 } from './sha';
import type { Fact, FactKey, HandoutRecord, Patient, Trial, TrialMatch } from './types';

/* ------------------------------------------------ oncologist brief ------------------------------------------------ */

export interface Brief {
  patientLine: string;
  recommendation: { trial: Trial; state: TrialMatch['state']; why: string[]; open: string[] } | null;
  watchouts: string[];
  others: string[];
  closest: string | null;
  nextAction: string | null;
  words: number;
  /** At 200 words a minute. The PRD's job to be done is an answer in under two minutes. */
  minutes: number;
  asOf: string;
  stamp: string;
}

function latest(facts: Fact[], key: FactKey, asOf: string): Fact | undefined {
  return facts.filter((f) => f.key === key && f.date <= asOf).sort((a, b) => b.date.localeCompare(a.date))[0];
}

const WORTH_SHOWING: FactKey[] = ['pdl1', 'egfrMut', 'alkFusion', 'krasG12c', 'ecog', 'stage', 'priorLines', 'brainMets', 'strongCyp3a4', 'egfr', 'platelets', 'anc', 'lvef'];

function patientLine(p: Patient, facts: Fact[], asOf: string): string {
  const get = (k: FactKey) => latest(facts, k, asOf);
  const bits: string[] = [];
  const dx = get('diagnosis')?.value;
  const stage = get('stage')?.value;
  bits.push([dx, stage ? `stage ${stage}` : ''].filter(Boolean).join(', ') || 'diagnosis not coded');
  const pd = get('pdl1');
  if (pd) bits.push(`PD-L1 ${fmtVal('pdl1', pd.value)}`);
  if (get('egfrMut')?.value === true) bits.push('EGFR mutant');
  if (get('alkFusion')?.value === true) bits.push('ALK positive');
  if (get('krasG12c')?.value === true) bits.push('KRAS G12C');
  const e = get('ecog');
  if (e) bits.push(`ECOG ${e.value}`);
  return `${p.name}, ${p.age}${p.sex}. ${bits.join(' · ')}.`;
}

/** Built only from the engine's results and the chart. No model writes any sentence of it. */
export function buildBrief(p: Patient, facts: Fact[], matches: TrialMatch[], ranked: ActionRank[], asOf: string, stamp: string): Brief {
  const live = matches.filter((m) => m.state !== 'filtered');
  const candidates = live.filter((m) => m.state === 'eligible' || m.state === 'near');
  const best = candidates.find((m) => m.state === 'eligible') ?? candidates[0];

  // A criterion the clinician attested to is Met on their citation. The system evidence beside it may say the opposite,
  // so the brief quotes the attestation and never the evidence it overruled.
  const why = best ? best.results
    .filter((r) => r.status === 'met' && (r.attested ? r.override?.citation : r.evidence[0]) && WORTH_SHOWING.includes(r.criterion.rule.fact))
    .slice(0, 3)
    .map((r) => (r.attested
      ? `${r.criterion.text}: clinician-attested (${r.override!.citation})`
      : `${r.criterion.text}: ${fmtVal(r.evidence[0].key, r.evidence[0].value)} (${r.evidence[0].source.label}, ${r.evidence[0].date})`)) : [];
  const open = best ? best.results.filter((r) => ['unknown', 'review', 'pending'].includes(r.status)).map((r) => `${r.criterion.text}: ${r.nextStep ?? r.message}`) : [];

  const watch: string[] = [];
  for (const m of live) {
    for (const r of m.results) {
      if (m.state === 'ineligible' || r.override) continue; // an overridden row has already been settled by the clinician
      const w = `${FACT_LABEL[r.criterion.rule.fact]}`;
      if (r.conflict) watch.push(`${w}: sources disagree (${r.evidence.map((e) => `${fmtVal(e.key, e.value)} ${e.date}`).join(' vs ')}).`);
      else if (r.stale) watch.push(`${w} is ${r.message.match(/(\d+) days old/)?.[1] ?? 'too'} days old for the ${r.criterion.rule.windowDays}-day window.`);
      else if (r.lowConfidence && r.evidence[0]?.confidence !== undefined && r.evidence[0].confidence < 0.9) watch.push(`${w} was extracted at ${Math.round(r.evidence[0].confidence * 100)}% confidence.`);
    }
  }
  if (best?.siteFull) watch.push(`${best.trial.code} is full at this site; ask about the waitlist or a satellite site.`);
  if (best && best.trial.siteMiles > 0) watch.push(`${best.trial.code} is open only at a satellite site ${best.trial.siteMiles} miles away.`);
  for (const m of live.filter((x) => x.state === 'ineligible')) {
    if (m.blockers.length === 1 && /CYP3A4|corticosteroid/i.test(m.blockers[0])) watch.push(`${m.trial.code} is blocked only by: ${m.blockers[0]}.`);
  }
  const watchouts = Array.from(new Set(watch));

  const others = candidates.filter((m) => m !== best).slice(0, 2).map((m) => `${m.trial.code}: ${m.state === 'eligible' ? 'likely eligible' : `near-eligible, ${m.counts.unknown + m.counts.review + m.counts.pending} open`}`);
  const closest = !best && live.length
    ? (() => { const m = [...live].sort((a, b) => a.counts.notmet - b.counts.notmet || b.fit - a.fit)[0]; return `Closest is ${m.trial.code}, blocked by: ${m.blockers.join('; ')}.`; })()
    : null;
  const top = ranked[0];
  const nextAction = top ? `${top.step.label} (${top.step.owner}). It ${top.completes.length ? `completes ${top.completes.join(', ')}` : `moves ${top.trials.join(', ')} closer`}.` : null;

  const line = patientLine(p, facts, asOf);
  const text = [line, ...why, ...open, ...watchouts, ...others, closest ?? '', nextAction ?? ''].join(' ');
  const words = text.split(/\s+/).filter(Boolean).length;
  return {
    patientLine: line,
    recommendation: best ? { trial: best.trial, state: best.state, why, open } : null,
    watchouts, others, closest, nextAction, words, minutes: Math.max(0.5, Math.round((words / 200) * 10) / 10), asOf, stamp,
  };
}

/* ---------------------------------------------- patient handout ---------------------------------------------- */

export const HANDOUT_LANGUAGES = ['English', 'Russian'] as const;
export type HandoutLang = (typeof HANDOUT_LANGUAGES)[number];

const PLAIN: Record<string, Record<HandoutLang, string>> = {
  'KEYSTONE-A': { English: 'It tests a new medicine added to a standard cancer immunotherapy, for lung cancer that has spread.', Russian: 'Оно проверяет новое лекарство, добавленное к стандартной иммунотерапии, при раке лёгкого, который распространился.' },
  'HELIX-EGFR': { English: 'It tests two medicines used together for lung cancer that has a change in a gene called EGFR.', Russian: 'Оно проверяет два лекарства, применяемые вместе, при раке лёгкого с изменением гена EGFR.' },
  'SOTERIA-G12C': { English: 'It tests a medicine aimed at a gene change called KRAS, for lung cancer that came back after earlier treatment.', Russian: 'Оно проверяет лекарство, направленное на изменение гена KRAS, при раке лёгкого, который вернулся после прошлого лечения.' },
  'AURORA-ES': { English: 'It tests a new mix of medicines for small cell lung cancer that has spread.', Russian: 'Оно проверяет новое сочетание лекарств при мелкоклеточном раке лёгкого, который распространился.' },
  'PRISM-ALK': { English: 'It tests a newer medicine for lung cancer that has a change in a gene called ALK.', Russian: 'Оно проверяет более новое лекарство при раке лёгкого с изменением гена ALK.' },
  'ASCENT-ADJ': { English: 'It tests whether taking a medicine after surgery can lower the chance that lung cancer comes back.', Russian: 'Оно проверяет, может ли лекарство после операции снизить риск возвращения рака лёгкого.' },
  'PLEURA-1': { English: 'It tests two immune medicines used together for cancer of the lining of the lung.', Russian: 'Оно проверяет два иммунных препарата, применяемых вместе, при раке оболочки лёгкого.' },
  'NOVA-SHP2': { English: 'It tests a new medicine used together with an immune medicine, for lung cancer that has spread.', Russian: 'Оно проверяет новое лекарство вместе с иммунным препаратом при раке лёгкого, который распространился.' },
};

interface Copy {
  title: string; intro: (first: string, sex: 'F' | 'M') => string; study: (plain: string, code: string) => string; why: string; moreChecks: string;
  next: string; choice: string; asksTitle: string; asks: string[]; footer: string; headings: { study: string; why: string; next: string; choice: string };
}

const COPY: Record<HandoutLang, Copy> = {
  English: {
    title: 'A research study that may be an option for you',
    intro: (first) => `Dear ${first}, your care team found a research study that might fit your situation. This page explains it in plain words.`,
    study: (plain, code) => `${plain} The study is called ${code}.`,
    why: 'Your doctor looked at your test results and your medical record. Some of the study rules match what is in your record. The study team will check everything again before any decision is made.',
    moreChecks: ' A few more checks are still needed first.',
    next: 'Your doctor will talk with you at your visit. If you are interested, the research team will explain the visits, tests, and possible side effects. You can ask any questions you like.',
    choice: 'Joining is your choice. You can say no, and your regular care will not change. You can also leave a study at any time.',
    asksTitle: 'Questions you might ask',
    asks: ['What could the study medicine do for me, and what are the risks?', 'How many visits would I need, and where would they be?', 'What would happen to my regular treatment?'],
    footer: 'This page is not a promise that you can join. The study team makes that decision after more checks.',
    headings: { study: 'About the study', why: 'Why you were picked', next: 'What happens next', choice: 'Your choice' },
  },
  Russian: {
    title: 'Исследование, которое может вам подойти',
    intro: (first, sex) => `${sex === 'F' ? 'Уважаемая' : 'Уважаемый'} ${first}, ваша команда врачей нашла исследование, которое, возможно, вам подойдёт. Здесь оно объяснено простыми словами.`,
    study: (plain, code) => `${plain} Оно называется ${code}.`,
    why: 'Врач изучил ваши анализы и медицинскую карту. Некоторые условия исследования подходят к вашим данным. Команда исследования ещё раз всё проверит, прежде чем принимать решение.',
    moreChecks: ' Сначала нужно сделать ещё несколько проверок.',
    next: 'Врач поговорит с вами на приёме. Если вам интересно, команда исследования объяснит, сколько будет визитов, какие нужны обследования и какие возможны побочные эффекты. Вы можете задавать любые вопросы.',
    choice: 'Участие — ваше решение. Вы можете отказаться, и ваше обычное лечение не изменится. Вы также можете выйти из исследования в любое время.',
    asksTitle: 'Вопросы, которые можно задать',
    asks: ['Чем исследуемое лекарство может мне помочь и какие есть риски?', 'Сколько визитов потребуется и где они проходят?', 'Что будет с моим обычным лечением?'],
    footer: 'Эта страница не гарантирует, что вы сможете участвовать. Решение принимает команда исследования после дополнительных проверок.',
    headings: { study: 'Об исследовании', why: 'Почему предложили именно вам', next: 'Что будет дальше', choice: 'Ваш выбор' },
  },
};

export interface Handout {
  lang: HandoutLang;
  title: string;
  sections: { heading: string; text: string }[];
  asksTitle: string;
  asks: string[];
  footer: string;
  /** English text is the source of truth; any other language is machine-assisted and needs an interpreter. */
  needsInterpreter: boolean;
  /** True when the patient's own language has no template, so English is shown and an interpreter is needed. */
  fallback: boolean;
  trialCode: string;
}

export const isSupportedLang = (l: string): l is HandoutLang => (HANDOUT_LANGUAGES as readonly string[]).includes(l);

export function buildHandout(p: Patient, m: TrialMatch, requested: string): Handout | null {
  if (m.state !== 'eligible' && m.state !== 'near') return null;
  const supported = isSupportedLang(requested);
  const lang: HandoutLang = supported ? requested : 'English';
  const c = COPY[lang];
  const plain = PLAIN[m.trial.code]?.[lang];
  if (!plain) return null;
  const first = p.name.split(' ')[0];
  const why = c.why + (m.state === 'near' ? c.moreChecks : '');
  return {
    lang, title: c.title,
    sections: [
      { heading: '', text: c.intro(first, p.sex) },
      { heading: c.headings.study, text: c.study(plain, m.trial.code) },
      { heading: c.headings.why, text: why },
      { heading: c.headings.next, text: c.next },
      { heading: c.headings.choice, text: c.choice },
    ],
    asksTitle: c.asksTitle, asks: c.asks, footer: c.footer,
    needsInterpreter: lang !== 'English' || !supported, fallback: !supported && requested !== 'English', trialCode: m.trial.code,
  };
}

export const handoutText = (h: Handout) => [h.title, ...h.sections.map((s) => `${s.heading} ${s.text}`), h.asksTitle, ...h.asks, h.footer].join('\n');

/** Words that would turn plain information into a promise or advice. A handout must contain none of them. */
export const FORBIDDEN_CLAIMS = /\b(you are eligible|you qualify|you will be (able|accepted)|guarantee|cure|will help|best option|you must|you should join|safe and effective)\b/i;

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  const groups = w.replace(/e$/, '').match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Flesch-Kincaid grade level for English text. Patient materials should read at about grade 8 or lower. */
export function readingGrade(text: string): number {
  const sentences = Math.max(1, (text.match(/[.!?]+(\s|$)/g) ?? []).length);
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (words.length === 0) return 0;
  const syl = words.reduce((a, w) => a + syllables(w), 0);
  return Math.round((0.39 * (words.length / sentences) + 11.8 * (syl / words.length) - 15.59) * 10) / 10;
}

/** An approval covers the exact text that was approved. When the wording moves (a trial going from near to likely eligible), it stops counting. */
export const handoutHash = (text: string) => sha256(text);
export const handoutApproved = (rec: HandoutRecord | undefined, text: string) => rec?.status === 'approved' && rec.hash === handoutHash(text);
