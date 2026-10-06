import { TODAY } from './data';
import type { Role } from './types';

export type Action = 'override' | 'dismiss' | 'approveReferral' | 'ask' | 'worklist' | 'rules' | 'mode' | 'adjudicate' | 'handout' | 'sync' | 'integrity' | 'secondReview';

export const PERMS: Record<Action, Role[]> = {
  override: ['oncologist'],
  dismiss: ['oncologist'],
  approveReferral: ['oncologist'],
  ask: ['oncologist', 'coordinator', 'pi'],
  worklist: ['coordinator'],
  rules: ['informaticist'],
  mode: ['governance'],
  adjudicate: ['oncologist'],
  handout: ['oncologist'],
  sync: ['informaticist', 'pi', 'governance'],
  integrity: ['governance'],
  secondReview: ['coordinator', 'governance'],
};

/**
 * Decisions are made against today's chart. While the as-of date is simulated they are paused, so a referral, override,
 * adjudication or handout approval can never be recorded on the strength of a chart that is not the real one.
 */
export const DECISIONS: Action[] = ['override', 'dismiss', 'approveReferral', 'adjudicate', 'handout', 'worklist'];

export const PAUSED = ', and only while the date is not simulated';
export const PERM_HINT: Record<Action, string> = {
  override: `Only the treating oncologist can override criteria${PAUSED}`,
  dismiss: `Only the treating oncologist can dismiss a trial${PAUSED}`,
  approveReferral: `Only the treating oncologist can approve a referral${PAUSED}`,
  ask: 'Switch to oncologist, coordinator or PI to use the Ask box',
  worklist: `Only the coordinator works the queue${PAUSED}`,
  rules: 'Only the clinical informaticist approves rules',
  mode: 'Only the AI governance reviewer changes the rollout mode',
  adjudicate: `Only the treating oncologist adjudicates recommendations${PAUSED}`,
  handout: `Only the treating oncologist approves a patient handout${PAUSED}`,
  sync: 'Switch to informaticist, PI or governance to run the trial sync',
  integrity: 'Only the AI governance reviewer runs integrity checks',
  secondReview: 'Only the coordinator or governance reviewer does the second review',
};

export const isSimulated = (queryDate: string) => queryDate !== TODAY;

/** Role permission, minus the decisions that are paused while the date is simulated. */
export function canDo(role: Role, action: Action, queryDate: string): boolean {
  return PERMS[action].includes(role) && !(DECISIONS.includes(action) && isSimulated(queryDate));
}

/** Shadow mode (PRD section 9): the system runs and logs, but clinicians and coordinators do not see its results. */
export const hiddenByShadow = (mode: string, role: Role) => mode === 'shadow' && (role === 'oncologist' || role === 'coordinator');
