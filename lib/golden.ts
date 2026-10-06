/**
 * Golden set v0 (synthetic). Everything here was reasoned by hand from the chart text, not copied from engine output, so it
 * can disagree with the engine. The PRD's real golden set is 200 pairs labelled by two coordinators and adjudicated by an
 * oncologist; this is the same idea at demo scale (11 patients, 31 patient-trial pairs).
 */
import type { CStatus, FactKey, ManualDecision, MatchState, Val } from './types';

export const pairKey = (pid: string, tid: string) => `${pid}|${tid}`;

/** Adjudicated state for each pair that passes the pre-filter, judged on the chart as it stands (before the agent runs). */
export const GOLD_ENGINE: Record<string, Record<string, MatchState>> = {
  p1: { t1: 'eligible', t2: 'ineligible', t3: 'ineligible', t5: 'ineligible' },
  p2: { t1: 'near', t2: 'ineligible', t3: 'ineligible', t5: 'ineligible' },
  p3: { t1: 'ineligible', t2: 'near', t3: 'near', t5: 'ineligible' },
  p4: { t1: 'ineligible', t2: 'ineligible', t3: 'ineligible', t5: 'ineligible' },
  p5: { t1: 'ineligible', t2: 'ineligible', t3: 'near', t5: 'ineligible' },
  p6: { t4: 'eligible' },
  p7: { t6: 'near' },
  p9: { t1: 'ineligible', t2: 'ineligible', t3: 'ineligible', t5: 'eligible' },
  p10: { t7: 'near' },
  p11: { t1: 'ineligible', t2: 'ineligible', t3: 'ineligible', t5: 'ineligible' },
};

/** Where finding a value in the chart changes the adjudicated state. Everything else stays as above. */
export const GOLD_AGENT_DELTA: Record<string, MatchState> = { 'p10|t7': 'eligible' };

export function goldPairs() {
  const out: { pid: string; tid: string; engine: MatchState; agent: MatchState }[] = [];
  for (const [pid, trials] of Object.entries(GOLD_ENGINE)) {
    for (const [tid, engine] of Object.entries(trials)) out.push({ pid, tid, engine, agent: GOLD_AGENT_DELTA[pairKey(pid, tid)] ?? engine });
  }
  return out;
}

/** The true value of the key fields, read from the chart text. */
export const TRUTH_FIELDS: Record<string, Partial<Record<FactKey, Val>>> = {
  p1: { pdl1: 80, ecog: 1, egfr: 72, stage: 'IV' },
  p2: { pdl1: 60, ecog: 1, egfr: 65, stage: 'IV' },
  p3: { pdl1: 62, ecog: 1, egfr: 88, stage: 'IV' },
  p4: { pdl1: 55, ecog: 3, egfr: 70, stage: 'IV' },
  p5: { pdl1: 10, ecog: 1, egfr: 95, stage: 'IV' },
  p6: { ecog: 1, egfr: 80, stage: 'ES' },
  p7: { pdl1: 5, ecog: 0, egfr: 101, stage: 'IIA', egfrMut: false, alkFusion: false },
  p9: { pdl1: 20, ecog: 1, egfr: 99, stage: 'IV' },
  p10: { ecog: 1, egfr: 85, stage: 'III' },
  p11: { pdl1: 5, ecog: 1, egfr: 91, stage: 'IV' },
};

/** For every Unknown the engine can return: is the answer findable in the chart, or truly absent from it? */
export const UNKNOWN_TRUTH: Record<string, 'findable' | 'absent'> = {
  'p2|pdl1': 'findable', 'p2|egfr': 'absent', 'p2|anc': 'absent', 'p2|krasG12c': 'absent',
  'p3|krasG12c': 'absent',
  'p5|krasG12c': 'absent',
  'p7|ecog': 'findable', 'p7|pdl1': 'findable', 'p7|egfrMut': 'findable', 'p7|alkFusion': 'findable', 'p7|priorLines': 'absent',
  'p10|ecog': 'findable',
};

/** Hand-labelled criterion results on the chart as it stands. Key: patient | trial code | field the criterion measures. */
export const CRIT_TRUTH: Record<string, CStatus> = {
  'p1|KEYSTONE-A|pdl1': 'met', 'p1|KEYSTONE-A|ecog': 'met', 'p1|KEYSTONE-A|egfr': 'met', 'p1|KEYSTONE-A|egfrMut': 'met', 'p1|KEYSTONE-A|brainMets': 'met', 'p1|KEYSTONE-A|priorLines': 'met', 'p1|KEYSTONE-A|steroidDose': 'met',
  'p2|KEYSTONE-A|pdl1': 'unknown', 'p2|KEYSTONE-A|egfr': 'unknown', 'p2|KEYSTONE-A|ecog': 'met', 'p2|KEYSTONE-A|egfrMut': 'met', 'p2|KEYSTONE-A|brainMets': 'met', 'p2|KEYSTONE-A|priorLines': 'met',
  'p3|KEYSTONE-A|egfrMut': 'review', 'p3|KEYSTONE-A|priorLines': 'notmet', 'p3|KEYSTONE-A|pdl1': 'met', 'p3|KEYSTONE-A|ecog': 'met',
  'p4|KEYSTONE-A|ecog': 'notmet', 'p4|KEYSTONE-A|brainMets': 'notmet', 'p4|KEYSTONE-A|steroidDose': 'notmet', 'p4|KEYSTONE-A|priorLines': 'notmet', 'p4|KEYSTONE-A|pdl1': 'met',
  'p5|KEYSTONE-A|pdl1': 'notmet', 'p5|KEYSTONE-A|priorLines': 'notmet',
  'p9|KEYSTONE-A|alkFusion': 'notmet', 'p9|KEYSTONE-A|pdl1': 'notmet', 'p9|KEYSTONE-A|priorLines': 'notmet',
  'p11|KEYSTONE-A|egfrMut': 'notmet', 'p11|KEYSTONE-A|pdl1': 'notmet',
  'p3|HELIX-EGFR|egfrMut': 'review',
  'p11|HELIX-EGFR|strongCyp3a4': 'notmet', 'p11|HELIX-EGFR|egfrMut': 'met', 'p11|HELIX-EGFR|ecog': 'met', 'p11|HELIX-EGFR|lvef': 'met', 'p11|HELIX-EGFR|anc': 'met',
  'p5|SOTERIA-G12C|krasG12c': 'unknown', 'p5|SOTERIA-G12C|lvef': 'pending', 'p5|SOTERIA-G12C|priorLines': 'met', 'p5|SOTERIA-G12C|anc': 'met', 'p5|SOTERIA-G12C|ecog': 'met',
  'p9|PRISM-ALK|alkFusion': 'met', 'p9|PRISM-ALK|ecog': 'met', 'p9|PRISM-ALK|priorLines': 'met',
  'p6|AURORA-ES|platelets': 'met', 'p6|AURORA-ES|anc': 'met', 'p6|AURORA-ES|ecog': 'met', 'p6|AURORA-ES|stage': 'met',
  'p7|ASCENT-ADJ|stage': 'met', 'p7|ASCENT-ADJ|ecog': 'unknown', 'p7|ASCENT-ADJ|pdl1': 'unknown', 'p7|ASCENT-ADJ|priorLines': 'unknown', 'p7|ASCENT-ADJ|egfr': 'met',
  'p10|PLEURA-1|ecog': 'unknown', 'p10|PLEURA-1|platelets': 'met', 'p10|PLEURA-1|stage': 'met',
};

/** The same, after the agent has resolved what it can. Only the labels that change. */
export const CRIT_TRUTH_AGENT: Record<string, CStatus> = {
  'p2|KEYSTONE-A|pdl1': 'met',
  'p7|ASCENT-ADJ|ecog': 'review', 'p7|ASCENT-ADJ|pdl1': 'met',
  'p10|PLEURA-1|ecog': 'met',
};

/**
 * What coordinators decided when screening by hand. They are good, but human: one missed a drug interaction, one trusted a
 * single genomic result, one did not check a satellite site, and one worked from an outside report that was not in the chart.
 */
export const MANUAL_SEED: Record<string, ManualDecision> = {
  'p1|t1': 'eligible', 'p1|t2': 'not eligible', 'p1|t3': 'not eligible', 'p1|t5': 'not eligible',
  'p2|t1': 'eligible', 'p2|t2': 'not eligible', 'p2|t3': 'not eligible', 'p2|t5': 'not eligible',
  'p3|t1': 'not eligible', 'p3|t2': 'eligible', 'p3|t3': 'not screened', 'p3|t5': 'not eligible',
  'p4|t1': 'not eligible', 'p4|t2': 'not eligible', 'p4|t3': 'not eligible', 'p4|t5': 'not eligible',
  'p5|t1': 'not eligible', 'p5|t2': 'not eligible', 'p5|t3': 'not eligible', 'p5|t5': 'not eligible',
  'p6|t4': 'eligible',
  'p7|t6': 'not screened',
  'p9|t1': 'not eligible', 'p9|t2': 'not eligible', 'p9|t3': 'not eligible', 'p9|t5': 'not screened',
  'p10|t7': 'eligible',
  'p11|t1': 'not eligible', 'p11|t2': 'eligible', 'p11|t3': 'not eligible', 'p11|t5': 'not eligible',
};

export const MANUAL_WHY: Record<string, string> = {
  'p2|t1': 'The coordinator counted a lab from the hospital portal that is not in the chart, so the eGFR window was assumed met.',
  'p3|t2': 'The coordinator used the tissue panel and did not see the plasma result that disagrees.',
  'p11|t2': 'The coordinator did not notice carbamazepine, a strong CYP3A4 inducer, on the medication list.',
  'p9|t5': 'The only open site is a satellite 45 miles away, and it was not checked.',
  'p7|t6': 'Notes are partly in Russian and little is coded, so the chart was skipped.',
  'p5|t3': 'The KRAS result is in an outside portal, so the coordinator recorded the patient as not eligible.',
};

export const SYSTEM_TO_BINARY = (s: MatchState): boolean => s === 'eligible';
