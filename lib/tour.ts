import type { Role } from './types';
import type { Sim, State } from './store';
import { TODAY } from './data';

/**
 * One thing to point at while a step is in progress. The guide shows the first cue that is not finished and whose element is on
 * the page, so a step moves from cue to cue as the person works (open the popover, then press +30 d, then Reset).
 */
export interface Cue {
  /** A data-tour name on the page. Several names separated by commas: the first one on the page wins. */
  at: string;
  /** What to do here, in one or two short sentences. */
  say: string | ((s: State) => string);
  /** Finished once the app state says so. */
  passed?: (s: State) => boolean;
  /** Or finished once this CSS selector matches something on the page (progress that lives only in the page, like an open popover). */
  passedIf?: string;
  /** A data-tour name the coach card must leave uncovered, when the controls needed next sit right around this one. */
  zone?: string;
}

/** What the guide may call to put the demo back the way the next step expects it. */
export interface TidyApi { undoTamper: () => void; setSim: (p: Partial<Sim>) => void; setQueryDate: (d: string) => void }

export interface TourStep {
  id: string;
  act: 'At the point of care' | 'Trust and safety' | 'Running the program' | 'Outcomes';
  title: string;
  role: Role;
  /** What to do, in one sentence. */
  doThis: string;
  /** What to notice, and why it matters. */
  look: string;
  prd: string;
  /** Where the step is shown on the tour page. */
  href: string;
  /** Where the guide takes the person when the step starts: the page with its first control on it. */
  start: string;
  /** The controls to point at, in order. */
  cues: Cue[];
  /** What to point at once the step is done, while the "Notice" text is read. */
  notice?: string;
  /** Run when the guide leaves the step, so the next one starts from a clean demo (for example, stop a drill). */
  tidy?: { when: (s: State) => boolean; label: string; run: (a: TidyApi) => void };
  /** Detected from real app state. A step without one is marked when the page records it. */
  done?: (s: State) => boolean;
}

const did = (s: State, action: string, includes?: string) => s.audit.some((e) => e.action === action && (!includes || e.detail.includes(includes)));
const opened = (s: State, patientId: string, trialId?: string) => s.usage.some((u) => u.patientId === patientId && (trialId ? u.trialId === trialId : u.kind === 'patient.open'));
const referralFor = (s: State, pid: string, tid: string) => s.referrals.filter((r) => r.patientId === pid && r.trialId === tid && r.kind === 'referral' && r.status !== 'rejected').slice(-1)[0];
/** A CSS selector that matches a data-tour name. */
export const tourSel = (names: string) => names.split(',').map((n) => `[data-tour="${n.trim()}"]`).join(', ');

export const TOUR: TourStep[] = [
  {
    id: 'launch', act: 'At the point of care', title: 'Launch from the EHR', role: 'oncologist', doThis: 'Open any patient from the schedule with “Open Trial Match”.', look: 'The SMART on FHIR handshake, then the ranked list. The clinician never leaves the chart.', prd: '§13 Design, §14 SMART launch', href: '/', start: '/',
    cues: [{ at: 'open-trial-match', say: 'Press “Open Trial Match” for Margaret Chen. Watch the SMART on FHIR handshake, then the ranked list.' }],
    done: (s) => did(s, 'smart.launch'),
  },
  {
    id: 'clean', act: 'At the point of care', title: 'A clean match, fully cited', role: 'oncologist', doThis: 'Open Margaret Chen and her KEYSTONE-A checklist.', look: 'Every Met links to its source. The rank score under the counts is built from fit, site and enrollment, so ordering is never a black box.', prd: '§4 Ranked recommendations, §6 Citation', href: '/patient/p1/trials/t1', start: '/patient/p1/trials',
    cues: [{ at: 'open-checklist-t1', say: 'KEYSTONE-A is likely eligible. Press “Open checklist” to see every criterion and its evidence.' }],
    notice: 'checklist-summary', done: (s) => opened(s, 'p1', 't1'),
  },
  {
    id: 'evidence', act: 'At the point of care', title: 'Open the source behind a value', role: 'oncologist', doThis: 'Click any blue source link on the checklist.', look: 'The cited span is highlighted in the document, and the value was checked against it.', prd: '§6 Citation and traceability', href: '/patient/p1/trials/t1', start: '/patient/p1/trials/t1',
    cues: [{ at: 'evidence-link', say: 'Click this source link to open the document behind the value.' }],
    notice: 'evidence-doc', done: (s) => s.usage.some((u) => u.kind === 'evidence.open'),
  },
  {
    id: 'agent', act: 'At the point of care', title: 'Let the agent resolve an Unknown', role: 'oncologist', doThis: 'Open Robert Alvarez and press “Find the missing values”.', look: 'Rows update in place with live status. PD-L1 comes from a scanned PDF at medium confidence; the stale eGFR stays Unknown because only a new draw fixes it.', prd: '§4 Agentic unknown resolution, §13 Loading', href: '/patient/p2/trials', start: '/patient/p2/trials',
    cues: [
      { at: 'ask-find-missing', say: 'Robert has Unknowns. Press “Find the missing values” and let the agent search his chart.', passedIf: tourSel('agent-run') },
      { at: 'agent-run', say: 'The agent is working: each tool call appears here, and the trial rows update in place.' },
    ],
    notice: 'agent-run', done: (s) => (s.overlay.p2 ?? []).some((f) => f.key === 'pdl1' && f.by === 'agent'),
  },
  {
    id: 'path', act: 'At the point of care', title: 'Read the path to eligibility', role: 'oncologist', doThis: 'Open Linda Park, then the “Path to eligibility” tab.', look: 'One medication blocks an otherwise perfect match. The tab ranks the next-best action and lets you try a what-if that is never saved.', prd: '§1 Conflicting medications, §13 Unknown next step', href: '/patient/p11/trials', start: '/patient/p11/trials',
    cues: [{ at: 'tab-path', say: 'Open the “Path to eligibility” tab.', passed: (s) => !!s.tour.path }],
    notice: 'path-panel',
  },
  {
    id: 'time', act: 'At the point of care', title: 'Travel in time', role: 'oncologist', doThis: 'Click the date chip in the top bar and move forward 30 days, then press Reset.', look: 'Lab windows age, trials fall from likely eligible to near-eligible, and every result is evaluated as of the chosen date. Decisions are paused while the date is simulated, so nothing is ever approved against a chart that is not the real one.', prd: '§6 Freshness', href: '/', start: '/',
    cues: [
      { at: 'time-chip', say: (s) => (s.queryDate === TODAY ? 'Click the date chip to open time travel.' : 'Open the date chip again and press Reset.'), passedIf: tourSel('time-pop') },
      { at: 'time-plus30', say: 'Press “+30 d”. Watch the Matches column on the schedule change.', passed: (s) => s.queryDate !== TODAY },
      { at: 'time-reset', say: 'See the warning banner and the changed matches. Now press Reset to come back to today.' },
    ],
    notice: 'time-chip', tidy: { when: (s) => s.queryDate !== TODAY, label: 'Moving on resets the date to today.', run: (a) => a.setQueryDate(TODAY) },
    done: (s) => did(s, 'sim.change', 'Time travel: results') && s.queryDate === TODAY,
  },
  {
    id: 'conflict', act: 'At the point of care', title: 'See two sources disagree', role: 'oncologist', doThis: 'Open Dorothy Williams and her HELIX-EGFR checklist.', look: 'Tissue says mutation detected, plasma says not. The system flags both and picks neither.', prd: '§7 Detection', href: '/patient/p3/trials/t2', start: '/patient/p3/trials',
    cues: [{ at: 'open-checklist-t2', say: 'The purple banner says two sources disagree. Press “Open checklist” on HELIX-EGFR.' }],
    notice: 'conflict-chip', done: (s) => opened(s, 'p3', 't2'),
  },
  {
    id: 'override', act: 'At the point of care', title: 'Override with a citation', role: 'oncologist', doThis: 'Override a criterion to Met and try saving without a citation.', look: 'A Met cannot exist without a source, even from a clinician. The reason code routes the fix.', prd: '§6 Citation, §12 Feedback loop', href: '/patient/p2/trials/t1', start: '/patient/p2/trials/t1',
    cues: [
      { at: 'override-unknown, override-notmet', say: 'Press “Override” on this Unknown criterion.', passedIf: tourSel('override-citation') },
      { at: 'override-citation', say: 'Leave the citation empty: Save stays disabled, because a Met needs a source. Then name one here (for example “Outside lab 2026-10-01, eGFR 66”) and save.' },
    ],
    notice: 'override-done', done: (s) => Object.values(s.overrides).some((o) => !!o.citation),
  },
  {
    id: 'referral', act: 'At the point of care', title: 'Draft, edit and approve a referral', role: 'oncologist', doThis: 'Draft a referral for Margaret Chen, edit it, then approve it.', look: 'Nothing leaves the system until a clinician approves. The edit is one audit entry, not one per keystroke.', prd: '§4 Handoff drafting, §7 Approval gate', href: '/patient/p1/trials/t1', start: '/patient/p1/trials/t1',
    cues: [
      { at: 'referral-draft', say: 'Press “Draft referral”. The agent writes it from the engine’s evaluated criteria only.', passed: (s) => !!referralFor(s, 'p1', 't1') },
      { at: 'referral-body', zone: 'referral-card', say: 'Change a word in the draft, then click outside the box. The edit is saved as one audit entry.', passed: (s) => { const r = referralFor(s, 'p1', 't1'); return !!r && (!!r.edited || r.status !== 'draft'); } },
      { at: 'referral-approve', say: 'Press “Approve and send”. Only now does it reach the coordinator.' },
    ],
    notice: 'referral-card', done: (s) => s.referrals.some((r) => r.status === 'approved' && r.kind === 'referral'),
  },
  {
    id: 'brief', act: 'At the point of care', title: 'Brief and handout', role: 'oncologist', doThis: 'Open a patient’s “Visit brief”, then approve the patient handout.', look: 'A brief you can read in under two minutes, and a plain-language handout in the patient’s language. Both come only from engine facts.', prd: '§2 Persona job to be done', href: '/patient/p7/brief', start: '/patient/p7/brief',
    cues: [
      { at: 'tab-handout', say: 'This is the two-minute brief. Now open the “Patient handout” tab.', passedIf: tourSel('handout-approve') },
      { at: 'handout-interpreter', say: 'The handout is in Russian, the patient’s language. Confirm an interpreter reviewed it.', passedIf: `${tourSel('handout-interpreter')} input:checked` },
      { at: 'handout-approve', say: 'Press “Approve for sharing”. The approval covers this exact text.' },
    ],
    notice: 'handout-status', done: (s) => Object.values(s.handouts).some((h) => h.status === 'approved'),
  },

  {
    id: 'lab', act: 'Trust and safety', title: 'Break a guardrail on purpose', role: 'governance', doThis: 'In the Guardrail lab, turn off one control and run all scenarios.', look: 'The scenario that control protected fails, and says what harm would follow. Turn off the injection scan and nothing fails, because the allowlist still holds.', prd: '§7 Hallucination guardrails', href: '/guardrails', start: '/guardrails',
    cues: [
      { at: 'guard-control', say: 'Switch off one control. The first one is fine.', passedIf: `${tourSel('guard-control')} input:not(:checked)` },
      { at: 'guard-run-all', say: 'Now run every scenario against the weakened controls.' },
    ],
    notice: 'guard-results',
  },
  {
    id: 'impact', act: 'Trust and safety', title: 'See a rule’s blast radius first', role: 'informaticist', doThis: 'In Criteria review, edit a threshold and read the impact before approving.', look: 'Who would change state, shown before anything is saved. Losing a likely-eligible patient needs an explicit acknowledgement.', prd: '§4 Criteria structuring with review', href: '/admin/criteria', start: '/admin/criteria',
    cues: [
      { at: 'rule-value', zone: 'rule-row', say: 'This LVEF rule is waiting for review. Change 50 to 55 and watch the impact line below update.', passedIf: `${tourSel('rule-approve')}[data-edited="yes"]` },
      { at: 'rule-impact', zone: 'rule-row', say: 'This is who would change state if you approved. Tick the acknowledgement if it asks, then press “Save and approve”.' },
    ],
    notice: 'rule-reviewed', done: (s) => did(s, 'rule.approved'),
  },
  {
    id: 'chain', act: 'Trust and safety', title: 'Verify, then tamper with, the audit log', role: 'governance', doThis: 'On the Audit page, verify the chain, anchor it, then simulate tampering.', look: 'Editing one entry is caught at that entry. Rewriting the whole history is caught only by the anchor.', prd: '§4 Audit log, §10 Production readiness', href: '/audit', start: '/audit',
    cues: [
      { at: 'audit-verify', say: 'Every entry is chained with SHA-256. Press “Verify and record”.', passed: (s) => did(s, 'audit.verify') },
      { at: 'audit-anchor', say: 'Press “Anchor the head” to copy the head hash to write-once storage.', passed: (s) => s.anchors.length > 0 },
      { at: 'audit-attacker', say: 'Now play the attacker. Open “Attacker simulation”.', passedIf: `${tourSel('audit-attacker')}[open]` },
      { at: 'audit-tamper-edit', say: 'Press “Edit one entry” and watch the integrity seal.' },
    ],
    notice: 'audit-integrity', tidy: { when: (s) => !!s.tamper, label: 'Moving on undoes the tampering.', run: (a) => a.undoTamper() },
    done: (s) => s.tamper !== null,
  },
  {
    id: 'replay', act: 'Trust and safety', title: 'Replay a past result', role: 'governance', doThis: 'On a stored match result in the audit log, press “Replay under today’s rules”.', look: 'The chart as it was, judged by the rules as they are now. Rule edits and amendments show up as flipped rows.', prd: '§10 Rollback plan', href: '/audit', start: '/audit',
    cues: [{ at: 'audit-replay', say: 'This entry stored its results. Press “Replay under today’s rules”.' }],
    notice: 'audit-replay-result',
  },

  {
    id: 'eval', act: 'Running the program', title: 'Run the release gate', role: 'governance', doThis: 'In the Eval harness, run the gate on the rollback target and the candidate.', look: 'Both fail, on safety metrics with zero tolerance. A rollback is only safe if the target passes the same gate.', prd: '§9 Eval strategy', href: '/eval', start: '/eval',
    cues: [{ at: 'eval-compare', say: 'Press “Compare all four” to run the gate on every ruleset, including the rollback target and the candidate.' }],
    notice: 'eval-results',
  },
  {
    id: 'rollout', act: 'Running the program', title: 'Read the shadow comparison', role: 'governance', doThis: 'On Rollout modes, read the shadow comparison, then do one second review on the weekly sample.', look: 'The system catches a drug interaction and finds a patient the coordinators never screened. Promotion between modes is gated by that evidence, not a button.', prd: '§9 Online evals', href: '/rollout', start: '/rollout',
    cues: [
      { at: 'rollout-tab-shadow', say: 'Open the “Shadow comparison” tab.', passedIf: tourSel('shadow-panel, review-sample') },
      { at: 'rollout-tab-review', zone: 'shadow-read', say: 'Read the two blue banners: the system found a patient manual screening missed, and caught wrong flags. Then open “Adjudication and sampling”.', passedIf: tourSel('review-sample') },
      { at: 'review-agree-gov', say: 'Each sampled result needs two independent reviews. Give yours: press “Agree”.' },
    ],
    notice: 'review-sample', done: (s) => did(s, 'rollout.mode'),
  },
  {
    id: 'ops', act: 'Running the program', title: 'Trip an alert', role: 'governance', doThis: 'On the Ops dashboard, start the PD-L1 extraction drill.', look: 'The Unknown rate for one field spikes and a critical alert fires with a runbook. This is the regression signal the PRD names.', prd: '§10 Monitoring', href: '/ops', start: '/ops',
    cues: [{ at: 'ops-drill', say: 'Press “Start the drill”. PD-L1 extraction silently stops working, as a bad prompt release might.', passed: (s) => s.sim.regression }],
    notice: 'ops-alerts', tidy: { when: (s) => s.sim.regression, label: 'Moving on stops the drill.', run: (a) => a.setSim({ regression: false }) },
    done: (s) => did(s, 'sim.change', 'regression'),
  },
  {
    id: 'monitor', act: 'Running the program', title: 'Fire a monitoring event', role: 'informaticist', doThis: 'On Monitoring, send “New lab result” and read the re-screen.', look: 'The diff is computed, down to the criterion that went from Unknown to Met.', prd: '§4 Continuous monitoring', href: '/monitoring', start: '/monitoring',
    cues: [{ at: 'mon-lab', say: 'A new eGFR result arrives for Robert Alvarez. Press “Send event”.' }],
    notice: 'mon-feed', done: (s) => s.events.some((e) => e.kind === 'lab' || e.kind === 'report' || e.kind === 'trial'),
  },
  {
    id: 'amend', act: 'Running the program', title: 'Absorb a protocol amendment', role: 'informaticist', doThis: 'On Monitoring, run the nightly sync, then review the amendment diff.', look: 'Changed rules go back to review and are not evaluated until approved. Referrals made under the old protocol are flagged.', prd: '§4 Trial ingestion', href: '/monitoring', start: '/monitoring',
    cues: [{ at: 'mon-sync', say: 'Press the sync button to pull the next update from ClinicalTrials.gov.' }],
    notice: 'mon-amendment', done: (s) => s.amendments.length > 0,
  },

  {
    id: 'funnel', act: 'Outcomes', title: 'Read the enrollment funnel', role: 'pi', doThis: 'On the cohort page, open a trial and read the funnel and the forecast.', look: 'Where patients drop out, whether the trial will reach target before it closes, and what the current pipeline is worth.', prd: '§2 PI persona, §3 North Star', href: '/trials', start: '/trials',
    cues: [{ at: 'funnel', say: 'Read the funnel for KEYSTONE-A. Pick another trial on the left to compare.' }],
    notice: 'funnel',
  },
  {
    id: 'packet', act: 'Outcomes', title: 'Print an evidence packet', role: 'coordinator', doThis: 'Open a trial checklist and choose “Evidence packet”, then print.', look: 'Criteria, citations, source excerpts, versions and approvals on one page for the trial team or IRB.', prd: '§6 Traceability, §10 Governance', href: '/patient/p1/trials/t1/packet', start: '/patient/p1/trials/t1',
    cues: [
      { at: 'packet-link', say: 'Press “Evidence packet”.', passedIf: tourSel('packet-print') },
      { at: 'packet-print', say: 'Everything on one page. Press “Print or save as PDF”.' },
    ],
  },
];

export function tourProgress(s: State) {
  const done = TOUR.filter((t) => (t.done ? t.done(s) : false) || s.tour[t.id]).length;
  return { done, total: TOUR.length };
}

export const stepDone = (s: State, t: TourStep) => (t.done ? t.done(s) : false) || !!s.tour[t.id];

/** The next unfinished step after this one, wrapping to any unfinished step before it. Null when the tour is complete. */
export function nextStep(s: State, after?: TourStep): TourStep | null {
  const i = after ? TOUR.indexOf(after) : -1;
  return TOUR.slice(i + 1).find((t) => !stepDone(s, t)) ?? TOUR.slice(0, Math.max(0, i)).find((t) => !stepDone(s, t)) ?? null;
}

/** The page part of a route, so "/patient/p1/trials" matches the current path with or without a query string. */
export const samePage = (path: string, route: string) => path.replace(/\/$/, '') === route.split('?')[0].replace(/\/$/, '');
