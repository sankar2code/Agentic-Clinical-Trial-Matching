import type { Role } from './types';
import type { State } from './store';

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
  href: string;
  /** Detected from real app state. A step without one is marked when the page records it. */
  done?: (s: State) => boolean;
}

const did = (s: State, action: string, includes?: string) => s.audit.some((e) => e.action === action && (!includes || e.detail.includes(includes)));
const opened = (s: State, patientId: string, trialId?: string) => s.usage.some((u) => u.patientId === patientId && (trialId ? u.trialId === trialId : u.kind === 'patient.open'));

export const TOUR: TourStep[] = [
  { id: 'launch', act: 'At the point of care', title: 'Launch from the EHR', role: 'oncologist', doThis: 'Open any patient from the schedule with “Open Trial Match”.', look: 'The SMART on FHIR handshake, then the ranked list. The clinician never leaves the chart.', prd: '§13 Design, §14 SMART launch', href: '/', done: (s) => did(s, 'smart.launch') },
  { id: 'clean', act: 'At the point of care', title: 'A clean match, fully cited', role: 'oncologist', doThis: 'Open Margaret Chen and her KEYSTONE-A checklist.', look: 'Every Met links to its source. Use “Why this rank?” to see the score built from fit, site and enrollment.', prd: '§4 Ranked recommendations, §6 Citation', href: '/patient/p1/trials/t1', done: (s) => opened(s, 'p1', 't1') },
  { id: 'evidence', act: 'At the point of care', title: 'Open the source behind a value', role: 'oncologist', doThis: 'Click any blue source link on the checklist.', look: 'The cited span is highlighted in the document, and the value was checked against it.', prd: '§6 Citation and traceability', href: '/patient/p1/trials/t1', done: (s) => s.usage.some((u) => u.kind === 'evidence.open') },
  { id: 'agent', act: 'At the point of care', title: 'Let the agent resolve an Unknown', role: 'oncologist', doThis: 'Open Robert Alvarez and press “Find the missing values”.', look: 'Rows update in place with live status. PD-L1 comes from a scanned PDF at medium confidence; the stale eGFR stays Unknown because only a new draw fixes it.', prd: '§4 Agentic unknown resolution, §13 Loading', href: '/patient/p2/trials', done: (s) => (s.overlay.p2 ?? []).some((f) => f.key === 'pdl1' && f.by === 'agent') },
  { id: 'path', act: 'At the point of care', title: 'Read the path to eligibility', role: 'oncologist', doThis: 'Open Linda Park, then the “Path to eligibility” tab.', look: 'One medication blocks an otherwise perfect match. The tab ranks the next-best action and lets you try a what-if that is never saved.', prd: '§1 Conflicting medications, §13 Unknown next step', href: '/patient/p11/trials' },
  { id: 'time', act: 'At the point of care', title: 'Travel in time', role: 'oncologist', doThis: 'Click the date chip in the top bar and move forward 30 days, then press Reset.', look: 'Lab windows age, trials fall from likely eligible to near-eligible, and every result is evaluated as of the chosen date. Decisions are paused while the date is simulated, so nothing is ever approved against a chart that is not the real one.', prd: '§6 Freshness', href: '/', done: (s) => did(s, 'sim.change', 'Time travel') },
  { id: 'conflict', act: 'At the point of care', title: 'See two sources disagree', role: 'oncologist', doThis: 'Open Dorothy Williams and her HELIX-EGFR checklist.', look: 'Tissue says mutation detected, plasma says not. The system flags both and picks neither.', prd: '§7 Detection', href: '/patient/p3/trials/t2', done: (s) => opened(s, 'p3', 't2') },
  { id: 'override', act: 'At the point of care', title: 'Override with a citation', role: 'oncologist', doThis: 'Override a criterion to Met and try saving without a citation.', look: 'A Met cannot exist without a source, even from a clinician. The reason code routes the fix.', prd: '§6 Citation, §12 Feedback loop', href: '/patient/p2/trials/t1', done: (s) => Object.values(s.overrides).some((o) => !!o.citation) },
  { id: 'referral', act: 'At the point of care', title: 'Draft, edit and approve a referral', role: 'oncologist', doThis: 'Draft a referral for Margaret Chen, edit it, then approve it.', look: 'Nothing leaves the system until a clinician approves. The edit is one audit entry, not one per keystroke.', prd: '§4 Handoff drafting, §7 Approval gate', href: '/patient/p1/trials/t1', done: (s) => s.referrals.some((r) => r.status === 'approved' && r.kind === 'referral') },
  { id: 'brief', act: 'At the point of care', title: 'Brief and handout', role: 'oncologist', doThis: 'Open a patient’s “Visit brief”, then approve the patient handout.', look: 'A brief you can read in under two minutes, and a plain-language handout in the patient’s language. Both come only from engine facts.', prd: '§2 Persona job to be done', href: '/patient/p7/brief', done: (s) => Object.values(s.handouts).some((h) => h.status === 'approved') },

  { id: 'lab', act: 'Trust and safety', title: 'Break a guardrail on purpose', role: 'governance', doThis: 'In the Guardrail lab, turn off one control and run all scenarios.', look: 'The scenario that control protected fails, and says what harm would follow. Turn off the injection scan and nothing fails, because the allowlist still holds.', prd: '§7 Hallucination guardrails', href: '/guardrails' },
  { id: 'impact', act: 'Trust and safety', title: 'See a rule’s blast radius first', role: 'informaticist', doThis: 'In Criteria review, edit a threshold and read the impact before approving.', look: 'Who would change state, shown before anything is saved. Losing a likely-eligible patient needs an explicit acknowledgement.', prd: '§4 Criteria structuring with review', href: '/admin/criteria', done: (s) => did(s, 'rule.approved') },
  { id: 'chain', act: 'Trust and safety', title: 'Verify, then tamper with, the audit log', role: 'governance', doThis: 'On the Audit page, verify the chain, anchor it, then simulate tampering.', look: 'Editing one entry is caught at that entry. Rewriting the whole history is caught only by the anchor.', prd: '§4 Audit log, §10 Production readiness', href: '/audit', done: (s) => s.tamper !== null || s.anchors.length > 0 },
  { id: 'replay', act: 'Trust and safety', title: 'Replay a past result', role: 'governance', doThis: 'On a stored match result in the audit log, press “Replay under today’s rules”.', look: 'The chart as it was, judged by the rules as they are now. Rule edits and amendments show up as flipped rows.', prd: '§10 Rollback plan', href: '/audit' },

  { id: 'eval', act: 'Running the program', title: 'Run the release gate', role: 'governance', doThis: 'In the Eval harness, run the gate on the rollback target and the candidate.', look: 'Both fail, on safety metrics with zero tolerance. A rollback is only safe if the target passes the same gate.', prd: '§9 Eval strategy', href: '/eval' },
  { id: 'rollout', act: 'Running the program', title: 'Move through the rollout modes', role: 'governance', doThis: 'On Rollout modes, read the shadow comparison, then promote to human-in-the-loop.', look: 'The system catches a drug interaction and finds a patient the coordinators never screened. Promotion is gated by evidence, not a button.', prd: '§9 Online evals', href: '/rollout', done: (s) => did(s, 'rollout.mode') },
  { id: 'monitor', act: 'Running the program', title: 'Fire a monitoring event', role: 'informaticist', doThis: 'On Monitoring, send “New lab result” and read the re-screen.', look: 'The diff is computed, down to the criterion that went from Unknown to Met.', prd: '§4 Continuous monitoring', href: '/monitoring', done: (s) => s.events.length > 0 },
  { id: 'amend', act: 'Running the program', title: 'Absorb a protocol amendment', role: 'informaticist', doThis: 'On Monitoring, run the nightly sync, then review the amendment diff.', look: 'Changed rules go back to review and are not evaluated until approved. Referrals made under the old protocol are flagged.', prd: '§4 Trial ingestion', href: '/monitoring', done: (s) => s.amendments.length > 0 },
  { id: 'ops', act: 'Running the program', title: 'Trip an alert', role: 'governance', doThis: 'In Scenario controls, switch on the PD-L1 extraction drill, then open the Ops dashboard.', look: 'The Unknown rate for one field spikes and a critical alert fires with a runbook. This is the regression signal the PRD names.', prd: '§10 Monitoring', href: '/ops', done: (s) => did(s, 'sim.change', 'regression') },

  { id: 'funnel', act: 'Outcomes', title: 'Read the enrollment funnel', role: 'pi', doThis: 'On the cohort page, open a trial and read the funnel and the forecast.', look: 'Where patients drop out, whether the trial will reach target before it closes, and what the current pipeline is worth.', prd: '§2 PI persona, §3 North Star', href: '/trials' },
  { id: 'packet', act: 'Outcomes', title: 'Print an evidence packet', role: 'coordinator', doThis: 'Open a trial checklist and choose “Evidence packet”, then print.', look: 'Criteria, citations, source excerpts, versions and approvals on one page for the trial team or IRB.', prd: '§6 Traceability, §10 Governance', href: '/patient/p1/trials/t1/packet' },
];

export function tourProgress(s: State) {
  const done = TOUR.filter((t) => (t.done ? t.done(s) : false) || s.tour[t.id]).length;
  return { done, total: TOUR.length };
}

export const stepDone = (s: State, t: TourStep) => (t.done ? t.done(s) : false) || !!s.tour[t.id];

