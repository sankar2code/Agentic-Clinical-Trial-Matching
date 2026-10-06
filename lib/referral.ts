import { STATE_LABEL } from './engine';
import type { TrialMatch } from './types';

/**
 * Can a referral written earlier be re-confirmed against this fresh match? Only if the patient is still a candidate and every
 * rule was actually evaluated. After a protocol amendment the changed rules wait for reviewer approval and are not evaluated, so
 * a match that skips them proves nothing about the new protocol: the referral stays flagged until they are approved.
 */
export function reconfirmation(m: TrialMatch, stamp: string): { holds: boolean; detail: string } {
  const open = m.counts.unknown + m.counts.review + m.counts.pending;
  const head = `Re-ran the match under ${stamp}: ${m.trial.code} is ${STATE_LABEL[m.state].toLowerCase()} (${m.counts.met} met, ${m.counts.notmet} not met, ${open} open).`;
  if (m.counts.pending > 0) return { holds: false, detail: `${head} ${m.counts.pending} rule${m.counts.pending > 1 ? 's still await' : ' still awaits'} reviewer approval and ${m.counts.pending > 1 ? 'are' : 'is'} not evaluated, so the referral cannot be re-confirmed yet.` };
  if (m.state !== 'eligible' && m.state !== 'near') return { holds: false, detail: `${head} The referral no longer holds, so it stays flagged for the treating clinician.` };
  return { holds: true, detail: `${head} The referral evidence still holds and was re-confirmed.` };
}
