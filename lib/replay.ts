import { evidencePointer, matchAll } from './engine';
import { TODAY } from './data';
import type { AuditEntry, CStatus, Fact, Override, Patient, Trial } from './types';

export interface ReplayRow { trial: string; criterionId: string; text: string; then: CStatus; now: CStatus | 'removed'; note?: string }
export interface Replay {
  asOf: string;
  rows: ReplayRow[];
  changed: ReplayRow[];
  added: { trial: string; criterionId: string; text: string; now: CStatus }[];
  thenVersions: string;
  skippedOverrides: number;
}

const WORD: Record<string, string> = { met: 'Met', notmet: 'Not met', unknown: 'Unknown', review: 'Needs review', pending: 'Rule pending', removed: 'removed' };
export const statusWord = (s: string) => WORD[s] ?? s;

/**
 * Re-run a stored result under today's rules. The chart is rebuilt from what the entry cited: the patient's base record
 * plus any later-added value whose evidence pointer appears in the stored snapshot. Rows the clinician overrode are left out.
 */
export function replaySnapshot(entry: AuditEntry, patient: Patient, trials: Trial[], overlay: Record<string, Fact[]>, overrides: Record<string, Override>): Replay | null {
  if (!entry.snapshot) return null;
  const asOf = entry.asOf ?? TODAY;
  const cited = new Set(entry.snapshot.rows.flatMap((r) => r.e));
  const then = (overlay[patient.id] ?? []).filter((f) => cited.has(evidencePointer(f)));
  // The regression drill that was switched on when the entry was written is switched on here too, so a flipped row is a rule change, not the drill.
  const now = matchAll(patient, trials, { overlay: { [patient.id]: then }, today: asOf, dropNlp: entry.drill });
  const byKey = new Map<string, { status: CStatus; text: string; trialId: string }>();
  for (const m of now) for (const r of m.results) byKey.set(`${m.trial.code}|${r.criterion.id}`, { status: r.status, text: r.criterion.text, trialId: m.trial.id });

  const rows: ReplayRow[] = [];
  let skipped = 0;
  for (const s of entry.snapshot.rows) {
    const cur = byKey.get(`${s.t}|${s.c}`);
    const code = s.t;
    const trialId = trials.find((t) => t.code === code)?.id ?? '';
    if (overrides[`${patient.id}|${trialId}|${s.c}`]) { skipped += 1; continue; }
    if (!cur) rows.push({ trial: code, criterionId: s.c, text: s.c, then: s.s, now: 'removed', note: 'This criterion no longer exists in the current rule set (replaced or removed by an amendment).' });
    else rows.push({ trial: code, criterionId: s.c, text: cur.text, then: s.s, now: cur.status });
  }
  const seen = new Set(entry.snapshot.rows.map((r) => `${r.t}|${r.c}`));
  const liveCodes = new Set(entry.snapshot.trials.map((t) => t.code));
  const added = [...byKey.entries()].filter(([k]) => !seen.has(k) && liveCodes.has(k.split('|')[0])).map(([k, v]) => ({ trial: k.split('|')[0], criterionId: k.split('|')[1], text: v.text, now: v.status }));
  return { asOf, rows, changed: rows.filter((r) => r.then !== r.now), added, thenVersions: entry.versions, skippedOverrides: skipped };
}
