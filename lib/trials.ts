import { AMENDMENTS, applyAmendment } from './amendments';
import type { ReviewStatus, Rule, Trial } from './types';

export type RuleReviews = Record<string, { review: ReviewStatus; rule?: Rule; by?: string; at?: string }>;
export interface AppliedAmendment { id: string; appliedAt: string }

/**
 * The trials as they stand right now: opened trials only, protocol amendments applied in order, then each reviewer's
 * decision on each rule. Pure, so the store, the previews and the validation suite all see the same thing.
 */
export function buildTrials(base: Trial[], rules: RuleReviews, opened: string[], applied: AppliedAmendment[] = []): Trial[] {
  return base.filter((t) => !t.hiddenUntilOpened || opened.includes(t.id)).map((t0) => {
    let t = t0;
    for (const ap of applied) {
      const a = AMENDMENTS.find((x) => x.id === ap.id);
      if (a) t = applyAmendment(t, a);
    }
    return {
      ...t,
      criteria: t.criteria.map((c) => {
        const r = rules[`${t.id}|${c.id}`];
        return r ? { ...c, review: r.review, rule: r.rule ?? c.rule } : c;
      }),
    };
  });
}
