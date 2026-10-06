import { FACT_LABEL, PATIENTS, TODAY, fmtVal } from './data';
import { matchAll } from './engine';
import { COST_TARGET, STEP_CAP, TOKEN_BUDGET, authorizeTool, costOf, scanForInjection, tokensOf } from './guards';
import { verifyExtraction } from './verify';
import type { Doc, DraftKind, Fact, FactKey, InlineDoc, Override, Patient, Trial, TrialMatch } from './types';

export { COST_TARGET, STEP_CAP, TOKEN_BUDGET };
export const AGENT_TIMEOUT_S = 90;

export interface AgentStep {
  n: number;
  tool: string;
  args: string;
  observation: string;
  ok: boolean;
  key?: FactKey; // which missing value this step is working on, so the UI can update rows in place
  fact?: Fact; // present when this step produced a verified value
  reject?: boolean; // true when the deterministic check refused a value (as opposed to the extractor failing)
}

export interface Unresolved { key: FactKey; reason: string; nextStep: string }

export interface DraftOut { kind: DraftKind; trialId: string; body: string; fact?: FactKey }

export interface ExistingDraft { patientId: string; trialId: string; kind: DraftKind; status: 'draft' | 'approved' | 'rejected'; fact?: FactKey }

export type Intent = 'resolve' | 'draft' | 'explain' | 'summary';

export interface AgentOptions {
  existing?: ExistingDraft[];
  versions?: string;
  /** Values already searched for, with no result, in this chart version (PRD section 8: cache per data version). */
  skip?: FactKey[];
  /** As-of date for the match the agent reasons over. */
  today?: string;
  dropNlp?: FactKey[];
  /**
   * Guardrail lab only: switch a control off to show what it prevents. The API route never forwards this, so a request
   * from outside cannot weaken the agent.
   */
  unsafe?: { skipVerification?: boolean; skipScope?: boolean; skipInjectionScan?: boolean };
}

export interface AgentResult {
  intent: Intent;
  steps: AgentStep[];
  answer: string;
  resolved: Fact[];
  unresolved: Unresolved[];
  drafts: DraftOut[];
  /** Values searched for this run that turned out to be truly absent, so the caller can remember not to search again. */
  searchedAbsent: FactKey[];
  /** Documents that contained instruction-like text. They were quarantined: the agent treats documents as data only. */
  quarantined: { docId: string; title: string; hits: string[] }[];
  /** Values skipped because an earlier run already searched this chart version. No tool calls were spent. */
  cached: FactKey[];
  capHit: boolean;
  tokens: number;
  costUsd: number;
}

/* ------------------------------------------- intent and field routing ------------------------------------------- */

export function classify(q: string): Intent {
  if (/\b(draft|referral|hand[- ]?off)\b|\bcoordinator\b/i.test(q)) return 'draft';
  if (/\bwhy\b|\bexplain\b|not eligible|ineligible|not a fit|\bblocked\b|\bexcluded?\b/i.test(q)) return 'explain';
  if (/\b(resolve|unknown|missing|find|look|search|locate|check|recent|stale|labs?)\b|pd-?l1|\bkras\b|\becog\b|\balk\b|mutation|\be?gfr\b|\bscreen\b/i.test(q)) return 'resolve';
  return 'summary';
}

/** Which patient field a question is about, if any. */
export function findKey(q: string): FactKey | undefined {
  if (/pd-?l1|\btps\b|tumou?r proportion/i.test(q)) return 'pdl1';
  if (/\bkras\b|g12c/i.test(q)) return 'krasG12c';
  if (/\becog\b|performance status/i.test(q)) return 'ecog';
  if (/\balk\b|rearrangement/i.test(q)) return 'alkFusion';
  if (/brain|\bcns\b/i.test(q)) return 'brainMets';
  if (/steroid|dexamethasone|prednisone/i.test(q)) return 'steroidDose';
  if (/cyp3a4|interaction|anticonvuls|carbamazepine/i.test(q)) return 'strongCyp3a4';
  if (/\bneutrophil|\banc\b/i.test(q)) return 'anc';
  if (/platelet/i.test(q)) return 'platelets';
  if (/lvef|ejection|echo/i.test(q)) return 'lvef';
  if (/egfr/i.test(q) && /mutation|mutant|exon|l858r/i.test(q)) return 'egfrMut';
  if (/\bgfr\b|kidney|renal|creatinine|\blabs?\b/i.test(q) || /\beGFR\b/.test(q)) return 'egfr';
  if (/\begfr\b/i.test(q)) return 'egfrMut';
  if (/prior (line|therapy|treatment)|treatment history|lines of therapy/i.test(q)) return 'priorLines';
  if (/\bstage\b/i.test(q)) return 'stage';
  return undefined;
}

function findTrial(q: string, trials: Trial[]): Trial | undefined {
  const lower = q.toLowerCase();
  return trials.find((t) => lower.includes(t.code.toLowerCase()) || lower.includes(t.code.split('-')[0].toLowerCase()));
}

/* ----------------------------------------------- draft text ----------------------------------------------- */

export function draftReferralText(p: Patient, m: TrialMatch, versions?: string): string {
  const met = m.results.filter((r) => r.status === 'met').length;
  const open = m.results.filter((r) => r.status === 'unknown' || r.status === 'review' || r.status === 'pending');
  const site = m.trial.siteStatus !== 'Open'
    ? `Site: ${m.trial.siteStatus.toLowerCase()} here (${m.trial.enrolled}/${m.trial.target}). Please check the waitlist or an open satellite site before contacting the patient.`
    : m.trial.siteMiles > 0
      ? `Site: satellite site ${m.trial.siteMiles} miles away. Please confirm the patient can travel.`
      : `Site: open at this campus (${m.trial.enrolled}/${m.trial.target} enrolled).`;
  return [
    `To: Clinical Research Coordinator, Thoracic Oncology`,
    `Re: ${p.name} (MRN ${p.mrn}), possible candidate for ${m.trial.code} (${m.trial.nct})`,
    ``,
    `Pre-screening summary (engine ${m.trial.ruleSet}): ${met} of ${m.results.length} criteria met with citations, ${m.counts.notmet} not met, ${open.length} open.`,
    site,
    ``,
    open.length
      ? `Open items to confirm before consent:\n${open.map((r) => `- ${r.criterion.text}: ${r.nextStep ?? r.message}`).join('\n')}`
      : `No open items. All evaluated criteria are met with citations.`,
    ``,
    `Please contact the patient only through me. Formal eligibility is confirmed by the trial team per protocol.`,
    versions ? `\nGenerated with ${versions}.` : '',
  ].join('\n').trimEnd();
}

export function draftRecordsRequest(p: Patient, key: FactKey, trial: Trial): string {
  return [
    `To: Health Information Management, outside records`,
    `Re: ${p.name} (MRN ${p.mrn}), request for an external ${FACT_LABEL[key]} report`,
    ``,
    `The chart shows this result exists outside our systems. ${p.externalNote ?? ''}`.trim(),
    `Purpose: pre-screening for ${trial.code} (${trial.nct}). The result is needed to evaluate "${trial.criteria.find((c) => c.rule.fact === key)?.text ?? FACT_LABEL[key]}".`,
    ``,
    `Please scan the report into the chart and route any questions to the treating oncologist. No contact with the patient is needed for this request.`,
  ].join('\n');
}

/* --------------------------------------------------- the agent --------------------------------------------------- */

export function runAgent(
  p: Patient,
  trials: Trial[],
  question: string,
  extra: Fact[],
  overlay: Record<string, Fact[]>,
  overrides: Record<string, Override>,
  opts: AgentOptions = {},
): AgentResult {
  const { existing = [], versions, skip = [], today, dropNlp, unsafe = {} } = opts;
  // A report dated after the as-of date does not exist yet, so the agent cannot find it. Decisions and drafts are paused
  // while the date is simulated, so nothing written against a date that is not today can reach a queue.
  const asOf = today ?? TODAY;
  const simulated = asOf !== TODAY;
  const quarantined: AgentResult['quarantined'] = [];
  const searchedAbsent: FactKey[] = [];
  const cached: FactKey[] = [];
  const intent = classify(question);
  const ctx = { overlay: { ...overlay, [p.id]: [...(overlay[p.id] ?? []), ...extra] }, overrides, today, dropNlp };
  const matches = matchAll(p, trials, ctx);
  const live = matches.filter((m) => m.state !== 'filtered');
  const steps: AgentStep[] = [];
  const resolved: Fact[] = [];
  const unresolved: Unresolved[] = [];
  const drafts: DraftOut[] = [];
  let capHit = false;
  const push = (tool: string, args: string, observation: string, ok = true, key?: FactKey, fact?: Fact, reject = false) => {
    // Defence in depth: whatever the planning code above decides, a run can never exceed the cap or succeed with a tool outside the allowlist.
    if (steps.length >= STEP_CAP) throw new Error(`agent step cap (${STEP_CAP}) breached`);
    if (ok && !authorizeTool(tool).ok) throw new Error(`tool ${tool} is not on the allowlist`);
    steps.push({ n: steps.length + 1, tool, args, observation, ok, key, fact, reject: reject || undefined });
  };
  // Retrieval is scoped to this patient. A document id that belongs to someone else is flagged, never silently used.
  const lookup = (f: Fact): { doc?: Doc | InlineDoc; foreign: boolean } => {
    const own = p.docs.find((d) => d.id === f.source.docId);
    if (own) return { doc: own, foreign: false };
    if (f.source.inlineDoc) return { doc: f.source.inlineDoc, foreign: false };
    const other = PATIENTS.find((x) => x.id !== p.id && x.docs.some((d) => d.id === f.source.docId));
    return other ? { doc: other.docs.find((d) => d.id === f.source.docId), foreign: true } : { foreign: false };
  };

  let answer = '';

  if (intent === 'resolve') {
    const named = findKey(question);
    const counts = new Map<FactKey, number>();
    live.filter((m) => m.state !== 'ineligible').forEach((m) => m.unknownKeys.forEach((k) => counts.set(k, (counts.get(k) ?? 0) + 1)));
    let targets = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    if (named) targets = targets.includes(named) ? [named] : [];

    // Stale labs are not searchable: surface them as unresolved (no tool call spent). A new draw is the only fix.
    live.filter((m) => m.state !== 'ineligible').forEach((m) => m.results.filter((r) => r.stale && (!named || r.criterion.rule.fact === named)).forEach((r) => {
      if (!unresolved.find((u) => u.key === r.criterion.rule.fact)) {
        unresolved.push({ key: r.criterion.rule.fact, reason: `Latest ${FACT_LABEL[r.criterion.rule.fact]} is outside the ${r.criterion.rule.windowDays}-day window; no chart search can fix that.`, nextStep: r.nextStep ?? 'Repeat lab' });
      }
    }));

    if (targets.length === 0 && unresolved.length === 0) {
      answer = named
        ? `No open Unknown for ${FACT_LABEL[named]} on trials that still matter for this patient.`
        : 'No resolvable Unknowns. Every open item is already resolved, or needs a new lab, a clinician decision, or a rule approval.';
    }
    for (const key of targets) {
      if (skip.includes(key)) {
        cached.push(key);
        unresolved.push({ key, reason: 'Already searched in this chart version and nothing was found (cached, no tool calls spent).', nextStep: live.flatMap((m) => m.results).find((r) => r.criterion.rule.fact === key)?.criterion.unknownStep ?? 'Order the test or ask the clinician' });
        continue;
      }
      const dated = p.hidden.find((h) => h.key === key);
      const hidden = dated && dated.date <= asOf ? dated : undefined;
      const notYet = !!dated && !hidden;
      const external = p.externalOnly.includes(key);
      const found = hidden ? lookup(hidden) : undefined;
      const scanned = hidden ? !!(found?.doc as Doc | undefined)?.scanned : false;
      const retry = hidden?.firstAttempt !== undefined;
      const hits = found?.doc && !found.foreign && !unsafe.skipInjectionScan ? scanForInjection(found.doc.text) : [];
      const need = hidden ? 3 + (scanned ? 1 : 0) + (retry ? 1 : 0) + (hits.length ? 1 : 0) : external ? 4 : 2;
      if (steps.length + need > STEP_CAP) {
        capHit = true;
        unresolved.push({ key, reason: `Not attempted: the ${STEP_CAP}-tool-call cap was reached.`, nextStep: 'Run the agent again, or resolve manually' });
        continue;
      }
      const label = FACT_LABEL[key];
      push('query_fhir', `Observation?code=${key}&patient=${p.id}`, `No discrete ${label} result in FHIR.`, false, key);
      if (hidden) {
        const d = found?.doc;
        const foreign = !!found?.foreign && !unsafe.skipScope;
        push('search_notes', `hybrid("${label}") scope=patient:${p.id}`, `Top hit: ${d?.title ?? 'document'} (${d?.date}).`, true, key);
        if (scanned) push('ocr_document', hidden.source.docId ?? 'doc', 'OCR completed. Layout noisy; text may contain errors.', true, key);
        if (hits.length) {
          quarantined.push({ docId: hidden.source.docId ?? 'doc', title: d?.title ?? 'document', hits });
          push('scan_source', hidden.source.docId ?? 'doc', `Instruction-like text found (${hits.join('; ')}). Quarantined: documents are data, so the instruction is ignored. The value is still verified as usual.`, true, key);
        }
        let accepted = true;
        if (dropNlp?.includes(key)) {
          // Regression drill: the extraction pipeline for this field is down, so the agent says so instead of pretending.
          push('extract_value', `schema={${key}} doc=${hidden.source.docId}`, `The extractor returned no usable value for ${label} (extraction is failing for this field). Nothing was saved.`, false, key);
          unresolved.push({ key, reason: `Extraction is failing for ${label}, so a value could not be read from the document.`, nextStep: 'Escalate to the ML on-call; the Ops dashboard shows the Unknown-rate spike' });
          continue;
        }
        if (retry) {
          const bad = verifyExtraction(key, hidden.firstAttempt!, hidden.source.span, d, { foreign });
          push('extract_value', `schema={${key}} doc=${hidden.source.docId}`, `Proposed ${label} = ${fmtVal(key, hidden.firstAttempt!)}. Deterministic check FAILED (${bad.summary}). Value rejected, nothing was saved.`, false, key, undefined, true);
        }
        const good = verifyExtraction(key, hidden.value, hidden.source.span, d, { foreign });
        accepted = unsafe.skipVerification ? true : good.ok;
        const conf = hidden.confidence ?? 0.9;
        const verifier = conf < 0.9 ? ` Confidence ${Math.round(conf * 100)}%: secondary verifier model reviewed it.${conf < 0.7 ? ' Below the 70% floor, so the engine will mark it Needs review.' : ''}` : '';
        push('extract_value', retry ? `retry with verifier model, doc=${hidden.source.docId}` : `schema={${key}} doc=${hidden.source.docId}`,
          accepted ? `Extracted ${label} = ${fmtVal(key, hidden.value)}. ${unsafe.skipVerification ? 'Check skipped (lab counterfactual).' : `Deterministic check passed (${good.summary}).`}${verifier}` : `Rejected: ${good.summary}.`, accepted, key, accepted ? hidden : undefined, !accepted);
        if (accepted) resolved.push(hidden);
        else unresolved.push({ key, reason: 'Extracted value failed the deterministic check and was rejected.', nextStep: 'Manual chart review' });
      } else if (external) {
        push('search_notes', `hybrid("${label}") scope=patient:${p.id}`, 'A note says the result is in an external portal; no value in the chart.', true, key);
        const portal = authorizeTool('check_external_source');
        push('check_external_source', 'external lab portal', `Tool not permitted: ${portal.reason}.`, portal.ok, key);
        const trial = live.find((m) => m.unknownKeys.includes(key))?.trial ?? trials[0];
        const dup = existing.some((e) => e.patientId === p.id && e.kind === 'records-request' && e.fact === key && e.status !== 'rejected');
        if (simulated) {
          push('draft_task', `request external report for ${label}`, `Not drafted: drafts are paused while the date is simulated (as of ${asOf}).`, false, key);
        } else if (dup) {
          push('draft_task', `request external report for ${label}`, 'A request for this report is already drafted or approved. No duplicate created.', true, key);
        } else {
          push('draft_task', `request external report for ${label}`, 'Drafted a records request. It is in the approvals queue and nothing is sent until a clinician approves.', true, key);
          drafts.push({ kind: 'records-request', trialId: trial.id, fact: key, body: draftRecordsRequest(p, key, trial) });
        }
        unresolved.push({ key, reason: p.externalNote ?? 'Result exists outside the chart.', nextStep: 'Approve the drafted records request, or obtain the external report' });
      } else {
        push('search_notes', `hybrid("${label}") scope=patient:${p.id}`, notYet ? `No supporting text found in documents dated on or before ${asOf}.` : 'No supporting text found in notes or reports.', false, key);
        // A value that is only absent as of an earlier date must not be remembered as absent from the chart today.
        if (!notYet) searchedAbsent.push(key);
        unresolved.push({ key, reason: notYet ? `There was no ${label} in the chart as of ${asOf}.` : 'Evidence is truly absent from the chart.', nextStep: live.flatMap((m) => m.results).find((r) => r.criterion.rule.fact === key)?.criterion.unknownStep ?? 'Order the test or ask the clinician' });
      }
    }
    if (!answer) {
      const parts: string[] = [];
      if (resolved.length) parts.push(`Resolved ${resolved.length}: ${resolved.map((f) => `${FACT_LABEL[f.key]} = ${fmtVal(f.key, f.value)}`).join('; ')}. Each value is cited and span-verified, and the engine re-ran.`);
      if (unresolved.length) parts.push(`Still Unknown ${unresolved.length}: ${unresolved.map((u) => FACT_LABEL[u.key]).join(', ')}. Next steps are shown below.`);
      if (cached.length) parts.push(`${cached.map((k) => FACT_LABEL[k]).join(', ')} not searched again: the chart has not changed since the last search.`);
      answer = parts.join(' ');
    }
  } else if (intent === 'draft') {
    const open = (m: TrialMatch) => !existing.some((e) => e.patientId === p.id && e.trialId === m.trial.id && e.kind === 'referral' && e.status !== 'rejected');
    const candidates = live.filter((m) => m.state === 'eligible' || m.state === 'near');
    const best = simulated ? undefined : candidates.find((m) => m.state === 'eligible' && !m.siteFull && open(m)) ?? candidates.find((m) => m.state === 'eligible' && open(m)) ?? candidates.find((m) => open(m));
    if (simulated) {
      answer = `Drafts are paused while the date is simulated (as of ${asOf}). Reset the date to today to draft a referral.`;
    } else if (!best) {
      const already = candidates.length > 0;
      answer = already ? 'A referral for every eligible or near-eligible trial is already drafted or approved. Nothing new to draft.' : 'There is no eligible or near-eligible trial to refer for right now.';
    } else {
      push('get_match', `${p.id}/${best.trial.id}`, `Engine result: ${best.counts.met} met, ${best.counts.notmet} not met, ${best.counts.unknown + best.counts.review + best.counts.pending} open.`);
      push('draft_referral', best.trial.code, 'Drafted from engine criteria only. Nothing is sent until you approve.');
      drafts.push({ kind: 'referral', trialId: best.trial.id, body: draftReferralText(p, best, versions) });
      answer = `Drafted a referral for ${best.trial.code}. Review and edit it, then approve to place it in the coordinator worklist.`;
    }
  } else if (intent === 'explain') {
    const named = findTrial(question, trials);
    const key = findKey(question);
    if (named) {
      const m = matches.find((x) => x.trial.id === named.id)!;
      push('get_match', `${p.id}/${m.trial.id}`, `State: ${m.state}.`);
      if (m.filterReason) answer = `${m.trial.code} was filtered out before evaluation: ${m.filterReason}.`;
      else if (m.blockers.length) answer = `${m.trial.code} is not a fit because: ${m.blockers.join('; ')}.`;
      else if (m.state === 'near') answer = `${m.trial.code} has no failed criteria, but ${m.counts.unknown + m.counts.review + m.counts.pending} are open: ${m.results.filter((r) => ['unknown', 'review', 'pending'].includes(r.status)).map((r) => r.criterion.text).join('; ')}.`;
      else answer = `${m.trial.code}: all evaluated criteria are met with citations.`;
    } else if (key) {
      push('get_match', `${p.id}/*`, `Looked up every criterion that uses ${FACT_LABEL[key]}.`);
      const rows = live.flatMap((m) => m.results.filter((r) => r.criterion.rule.fact === key).map((r) => `${m.trial.code}: ${r.criterion.text} is ${r.status === 'notmet' ? 'Not met' : r.status === 'met' ? 'Met' : r.status === 'review' ? 'Needs review' : r.status === 'pending' ? 'not evaluated' : 'Unknown'}. ${r.message}`));
      answer = rows.length ? rows.slice(0, 4).join(' ') : `${FACT_LABEL[key]} is not used by any live trial for this patient.`;
    } else {
      const m = live.find((x) => x.state === 'ineligible') ?? live[0];
      if (m) {
        push('get_match', `${p.id}/${m.trial.id}`, `State: ${m.state}.`);
        answer = m.blockers.length ? `${m.trial.code} is not a fit because: ${m.blockers.join('; ')}.` : `${m.trial.code} has no failed criteria.`;
      } else answer = 'No trial passed the pre-filter for this patient.';
    }
  } else {
    push('rank_trials', `patient=${p.id}`, `${live.length} trials passed the deterministic pre-filter; ${matches.length - live.length} filtered.`);
    const top = live.filter((m) => m.state !== 'ineligible').slice(0, 3);
    answer = top.length
      ? `Top matches: ${top.map((m) => `${m.trial.code} (${m.state === 'eligible' ? 'likely eligible' : 'near-eligible'}${m.siteFull ? ', site full' : m.trial.siteMiles ? `, ${m.trial.siteMiles} mi` : ''})`).join('; ')}.`
      : 'No eligible or near-eligible trials at this time. The blocking criteria are listed on each trial.';
  }

  const tokens = tokensOf(steps.length);
  const costUsd = costOf(steps.length);
  return { intent, steps, answer, resolved, unresolved, drafts, searchedAbsent, quarantined, cached, capHit, tokens, costUsd };
}
