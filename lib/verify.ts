import type { Doc, FactKey, InlineDoc, Val } from './types';

// Keys whose value is stated literally in the cited text. Counts of therapy lines and dose equivalents are inferred
// from the text, so for those we can only check that the cited span exists.
export const LITERAL_KEYS: FactKey[] = ['ecog', 'pdl1', 'stage', 'histology', 'egfrMut', 'alkFusion', 'krasG12c', 'brainMets'];

const NEGATION = /\b(no|not|negative|wild[- ]?type|absent|without|none)\b|нет|отриц/i;

// A number stands alone when it is not part of a code (22C3, 28-8), a date (2026-08-15), a range (60-70) or a bound (<1).
const NUMBER = String.raw`(?<![A-Za-z0-9.\-<>≤≥])(\d+(?:\.\d+)?)(?![A-Za-z0-9]|-\d|\.\d)`;

// Where the reading sits, for the fields whose number is named by the words around it.
const READING: Partial<Record<FactKey, RegExp[]>> = {
  // A PD-L1 score is a percentage, so the assay clone in "22C3" or "28-8" can never be mistaken for it.
  pdl1: [new RegExp(`${NUMBER}\\s*%`, 'g'), new RegExp(String.raw`\b(?:TPS|CPS)\b\s*[:=]?\s*${NUMBER}`, 'gi')],
  // ECOG is the digit written after the words that name it.
  ecog: [new RegExp(String.raw`\b(?:ECOG|performance status)\b[^0-9\n]{0,30}?${NUMBER}`, 'gi')],
};

function readings(key: FactKey, span: string): number[] {
  const patterns = READING[key];
  if (!patterns) return Array.from(span.matchAll(new RegExp(NUMBER, 'g')), (m) => Number(m[1]));
  const found = patterns.flatMap((re) => Array.from(span.matchAll(re), (m) => ({ at: (m.index ?? 0) + m[0].indexOf(m[1]), n: Number(m[1]) })));
  // The cited reading is the first one stated. A second number in the same span (a Ki-67, a CPS, a weight) is not the value.
  return found.sort((a, b) => a.at - b.at).slice(0, 1).map((f) => f.n);
}

// Stages are matched as whole tokens, so IIB is never found inside IIIB and IV is never found inside "extensive".
// A bare "I" counts only straight after the word stage, because it is also a pronoun.
const STAGE_CUE = /(?:stage|стадия|стадии)\s*$/i;
function stageTokens(span: string): string[] {
  return Array.from(span.matchAll(/(?<![A-Za-z0-9])(IV|III|II|I)([ABC])?(?![A-Za-z0-9])/g))
    .filter((m) => m[0] !== 'I' || STAGE_CUE.test(span.slice(0, m.index)))
    .map((m) => m[0]);
}
const STAGE_WORDS: Record<string, RegExp> = { ES: /\bextensive\b/i, LS: /\blimited\b/i, IV: /(?<!non[- ])\bmetastatic\b/i };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface Check { name: string; ok: boolean; detail: string }
export interface Verification { ok: boolean; checks: Check[]; summary: string }

/** Does the cited text literally support this value? Deterministic, no model involved. */
export function valueMatchesSpan(key: FactKey, value: Val, span: string): boolean {
  if (typeof value === 'number') return readings(key, span).includes(value);
  if (typeof value === 'boolean') return value === !NEGATION.test(span);
  const v = String(value);
  if (key === 'stage') return (STAGE_WORDS[v]?.test(span) ?? false) || stageTokens(span).includes(v);
  // "small cell" is not found inside "non-small cell": the prefix flips its meaning.
  return new RegExp(`(?<![A-Za-z0-9])(?<!non[- ])${escape(v)}(?![A-Za-z0-9])`, 'i').test(span);
}

/** PRD section 7: every extracted value is checked against its cited text span; a value not found in the source is rejected. */
export function verifyExtraction(key: FactKey, value: Val, span: string | undefined, doc: Doc | InlineDoc | undefined, scope: { foreign?: boolean } = {}): Verification {
  const checks: Check[] = [];
  if (scope.foreign) checks.push({ name: 'document belongs to this patient', ok: false, detail: 'the cited document belongs to a different patient (scope violation)' });
  const present = !!doc && !!span && doc.text.includes(span);
  checks.push({ name: 'cited span exists in the source', ok: present, detail: span ? `"${span}"` : 'no span cited' });
  if (present && LITERAL_KEYS.includes(key)) {
    const ok = valueMatchesSpan(key, value, span!);
    checks.push({ name: 'value matches the cited text', ok, detail: ok ? `${String(value)} is stated in the span` : `the span reads "${span}", which does not support ${String(value)}` });
  } else if (present) {
    checks.push({ name: 'value matches the cited text', ok: true, detail: 'inferred value: span presence only' });
  }
  const failed = checks.find((c) => !c.ok);
  return { ok: !failed, checks, summary: failed ? `${failed.name}: ${failed.detail}` : 'span found and value consistent with it' };
}
