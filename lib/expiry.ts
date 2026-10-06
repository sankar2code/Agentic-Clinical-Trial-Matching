import { FACT_LABEL } from './data';
import { daysBetween, isDismissed, matchTrial, type MatchContext } from './engine';
import type { Dismissal, FactKey, Patient, Trial, TrialMatch, Val } from './types';

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface Expiry {
  fact: FactKey;
  windowDays: number;
  value: Val;
  measuredOn: string;
  expiresOn: string;
  /** Days of validity left as of the query date. Zero means it is still valid today. Negative means already expired. */
  daysLeft: number;
  expired: boolean;
  criterion: string;
}

/** For each time-windowed criterion that currently counts, when its evidence stops counting. */
export function expiriesOf(m: TrialMatch, today: string): Expiry[] {
  const out: Expiry[] = [];
  for (const r of m.results) {
    const w = r.criterion.rule.windowDays;
    if (w === undefined || r.override) continue;
    const e = r.evidence[0];
    if (!e) continue;
    if (r.status === 'met') {
      const expiresOn = addDays(e.date, w);
      out.push({ fact: e.key, windowDays: w, value: e.value, measuredOn: e.date, expiresOn, daysLeft: daysBetween(today, expiresOn), expired: false, criterion: r.criterion.text });
    } else if (r.stale) {
      const expiresOn = addDays(e.date, w);
      out.push({ fact: e.key, windowDays: w, value: e.value, measuredOn: e.date, expiresOn, daysLeft: daysBetween(today, expiresOn), expired: true, criterion: r.criterion.text });
    }
  }
  return out;
}

export interface ReadyUntil { expiresOn: string; daysLeft: number; fact: FactKey; expired: Expiry[] }

/** How long this trial's current evidence stays usable. Null when nothing time-limited is involved. */
export function readyUntil(m: TrialMatch, today: string): ReadyUntil | null {
  if (m.state === 'ineligible' || m.state === 'filtered') return null;
  const all = expiriesOf(m, today);
  const live = all.filter((e) => !e.expired).sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
  const expired = all.filter((e) => e.expired);
  if (live.length === 0 && expired.length === 0) return null;
  return { expiresOn: live[0]?.expiresOn ?? '', daysLeft: live[0]?.daysLeft ?? -1, fact: live[0]?.fact ?? expired[0].fact, expired };
}

export interface ExpiryAlert {
  patientId: string;
  patientName: string;
  fact: FactKey;
  expiresOn: string;
  daysLeft: number;
  expired: boolean;
  trials: string[];
  action: string;
}

/**
 * Alerts for evidence that is about to expire, or already has, on trials the patient could still join. A trial the
 * treating clinician dismissed is not one the patient could join. When two trials give one result different windows, the
 * most urgent wins, whichever trial happens to be listed first.
 */
export function expiryAlerts(patients: Patient[], trials: Trial[], ctx: MatchContext, today: string, withinDays = 7, dismissals: Record<string, Dismissal> = {}): ExpiryAlert[] {
  const out: ExpiryAlert[] = [];
  for (const p of patients.filter((x) => x.treating)) {
    const found = new Map<FactKey, { e: Expiry; codes: string[] }>();
    for (const t of trials) {
      if (isDismissed(dismissals, p.id, t.id)) continue;
      const m = matchTrial(p, t, { ...ctx, today });
      if (m.state !== 'eligible' && m.state !== 'near') continue;
      for (const e of expiriesOf(m, today)) {
        if (!e.expired && e.daysLeft > withinDays) continue;
        const have = found.get(e.fact);
        if (!have) { found.set(e.fact, { e, codes: [t.code] }); continue; }
        if (!have.codes.includes(t.code)) have.codes.push(t.code);
        if (e.daysLeft < have.e.daysLeft) have.e = e;
      }
    }
    for (const { e, codes } of found.values()) {
      out.push({
        patientId: p.id, patientName: p.name, fact: e.fact, expiresOn: e.expiresOn, daysLeft: e.daysLeft, expired: e.expired, trials: codes.sort(),
        action: e.expired
          ? `Repeat ${FACT_LABEL[e.fact]}: the last result is ${-e.daysLeft} day${-e.daysLeft === 1 ? '' : 's'} past its ${e.windowDays}-day window`
          : `Repeat ${FACT_LABEL[e.fact]} on or before ${e.expiresOn} to stay screening-ready`,
      });
    }
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft || a.patientName.localeCompare(b.patientName) || a.fact.localeCompare(b.fact));
}
