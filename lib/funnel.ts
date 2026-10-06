/** PI view: how a trial's pipeline converts, and whether it will reach its target before accrual closes. */
import { daysBetween, isDismissed, matchTrial, type MatchContext } from './engine';
import type { Dismissal, Patient, Referral, Trial } from './types';

/** Fixtures standing in for the site's history. A real build reads these from the trial management system. */
export const CONVERSION = { eligibleToEnrolled: 0.35, nearToEnrolled: 0.15 };

export interface Stage { id: string; label: string; n: number; note?: string }
export interface Forecast {
  remaining: number;
  pace: number;
  monthsLeft: number;
  projected: number;
  shortfall: number;
  needPerMonth: number;
  pipelineYield: number;
  afterPipeline: number;
  status: 'on-track' | 'at-risk' | 'under-enrolling' | 'full' | 'paused';
  closesOn: string;
}

export function funnel(trial: Trial, patients: Patient[], ctx: MatchContext, referrals: Referral[], today: string, dismissals: Record<string, Dismissal> = {}): { stages: Stage[]; forecast: Forecast } {
  const ms = patients.filter((p) => p.treating).map((p) => ({ p, m: matchTrial(p, trial, { ...ctx, today }) }));
  const refs = referrals.filter((r) => r.trialId === trial.id && r.kind === 'referral' && r.status === 'approved');
  const passed = ms.filter((x) => x.m.state !== 'filtered');
  // A patient the treating clinician dismissed for this trial is not part of its pipeline.
  const dismissed = ms.filter((x) => (x.m.state === 'eligible' || x.m.state === 'near') && isDismissed(dismissals, x.p.id, trial.id)).length;
  const open = ms.filter((x) => !isDismissed(dismissals, x.p.id, trial.id));
  const likely = open.filter((x) => x.m.state === 'eligible');
  const near = open.filter((x) => x.m.state === 'near');
  const stages: Stage[] = [
    { id: 'seen', label: 'Patients in the pilot clinic', n: ms.length },
    { id: 'prefilter', label: 'Passed the pre-filter for this trial', n: passed.length, note: 'Disease, stage, status and site' },
    { id: 'pipeline', label: 'Likely or near-eligible', n: likely.length + near.length, note: dismissed ? `${dismissed} dismissed by the treating clinician` : undefined },
    { id: 'likely', label: 'Likely eligible', n: likely.length },
    { id: 'referred', label: 'Referral approved', n: refs.length },
    { id: 'screening', label: 'Screening started', n: refs.filter((r) => ['screening', 'consented'].includes(r.worklist)).length },
    { id: 'consented', label: 'Consented', n: refs.filter((r) => r.worklist === 'consented').length },
  ];
  const remaining = Math.max(0, trial.target - trial.enrolled);
  const pace = trial.pacePerMonth ?? 0;
  const closes = trial.closesOn ?? today;
  const monthsLeft = Math.max(0, Math.round((daysBetween(today, closes) / 30.4) * 10) / 10);
  const projected = Math.round(pace * monthsLeft * 10) / 10;
  const shortfall = Math.max(0, Math.round((remaining - projected) * 10) / 10);
  const pipelineYield = Math.round((likely.length * CONVERSION.eligibleToEnrolled + near.length * CONVERSION.nearToEnrolled) * 10) / 10;
  const afterPipeline = Math.max(0, Math.round((shortfall - pipelineYield) * 10) / 10);
  const status: Forecast['status'] = trial.status !== 'Recruiting' ? 'paused' : remaining === 0 ? 'full' : shortfall <= 0 ? 'on-track' : shortfall / Math.max(1, remaining) > 0.25 ? 'under-enrolling' : 'at-risk';
  return { stages, forecast: { remaining, pace, monthsLeft, projected, shortfall, needPerMonth: monthsLeft > 0 ? Math.round((remaining / monthsLeft) * 10) / 10 : remaining, pipelineYield, afterPipeline, status, closesOn: closes } };
}
