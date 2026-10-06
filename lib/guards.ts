/** Controls around the agent (PRD section 7). Each is deterministic: no model decides whether a guardrail holds. */

export const STEP_CAP = 8;
export const TOKEN_BUDGET = 40000;
export const COST_TARGET = 0.5;

export interface Guards { span: boolean; scope: boolean; injection: boolean; allowlist: boolean; cap: boolean; citation: boolean; ruleValidation: boolean }
export const ALL_ON: Guards = { span: true, scope: true, injection: true, allowlist: true, cap: true, citation: true, ruleValidation: true };

export const GUARD_INFO: Record<keyof Guards, { name: string; what: string; prd: string }> = {
  span: { name: 'Span check', what: 'Every extracted value must be found in, and supported by, the exact text it cites.', prd: '§7 Detection' },
  scope: { name: 'Patient scope', what: 'A document can only support a value for the patient it belongs to.', prd: '§6 Source of truth' },
  injection: { name: 'Injection scan', what: 'Instruction-like text inside a document is quarantined and ignored. Documents are data, never commands.', prd: '§7 Prevention' },
  allowlist: { name: 'Tool allowlist', what: 'Agent tools are read-only, except drafts that wait for a clinician to approve them.', prd: '§7 Prevention' },
  cap: { name: 'Step cap and budget', what: 'At most 8 tool calls and a token budget per run.', prd: '§7 Prevention, §8 Cost' },
  citation: { name: 'Citation rule', what: 'A criterion cannot be Met without a citation, even when a clinician overrides it.', prd: '§6 Citation' },
  ruleValidation: { name: 'Rule validation', what: 'A rule must be valid for its field before a reviewer can approve it.', prd: '§4 Criteria structuring' },
};

export const TOOLS: Record<string, { mode: 'read' | 'draft'; note: string }> = {
  query_fhir: { mode: 'read', note: 'Read a coded FHIR resource' },
  search_notes: { mode: 'read', note: 'Hybrid search, scoped to one patient' },
  ocr_document: { mode: 'read', note: 'Read a scanned document' },
  extract_value: { mode: 'read', note: 'Extract into a fixed schema, then check against the cited text' },
  scan_source: { mode: 'read', note: 'Deterministic scan of a source for instruction-like text' },
  get_match: { mode: 'read', note: 'Read the engine result' },
  rank_trials: { mode: 'read', note: 'Read the ranked list' },
  draft_referral: { mode: 'draft', note: 'Draft only. A clinician approves before anything leaves the system' },
  draft_task: { mode: 'draft', note: 'Draft only. A clinician approves before anything leaves the system' },
};

export function authorizeTool(name: string): { ok: boolean; reason: string } {
  // Own keys only: a plain object also answers to "toString", "constructor" and "__proto__", and deny-by-default must mean it.
  const t = Object.prototype.hasOwnProperty.call(TOOLS, name) ? TOOLS[name] : undefined;
  if (t) return { ok: true, reason: t.mode === 'draft' ? 'allowed as a draft that waits for approval' : 'allowed (read-only)' };
  return { ok: false, reason: 'agent tools are read-only except drafts that wait for approval, and external portals are outside that set' };
}

const INJECTION: [RegExp, string][] = [
  [/ignore\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier)[^.\n]{0,40}(instructions|rules|criteria|guidelines)/i, 'tells the reader to ignore its instructions'],
  [/disregard[^.\n]{0,40}(instructions|rules|criteria|guidelines)/i, 'tells the reader to disregard its rules'],
  [/note\s+to\s+(the\s+)?(ai|a\.i\.|assistant|language model|llm|model|agent|system)\b/i, 'addresses the AI system directly'],
  [/\byou\s+are\s+now\b/i, 'tries to reassign the reader\'s role'],
  [/\bmark\s+(this\s+patient\s+)?(as\s+)?eligible\b/i, 'tries to set eligibility'],
  [/\b(send|submit|create|issue)\b[^.\n]{0,30}\breferral\b[^.\n]{0,40}\b(immediately|now|without)\b/i, 'tries to trigger a referral'],
  [/<\|?\s*(system|im_start|assistant)\s*\|?>/i, 'contains a chat-control token'],
];

/** Instruction-like phrases found in a source document. Empty means the text looks like ordinary clinical writing. */
export function scanForInjection(text: string): string[] {
  return INJECTION.filter(([re]) => re.test(text)).map(([, label]) => label);
}

export const tokensOf = (steps: number) => (steps === 0 ? 400 : 900 + steps * 1800);
export const costOf = (steps: number) => (steps === 0 ? 0.01 : Math.round((0.03 + steps * 0.045) * 100) / 100);

/** One run's budget: the allowlist, the call cap and the token budget, applied to each requested call. */
export function makeBudget(opts: { cap?: boolean; allowlist?: boolean } = {}) {
  const { cap = true, allowlist = true } = opts;
  let calls = 0;
  const denied: { tool: string; reason: string }[] = [];
  return {
    request(tool: string): { ok: boolean; reason: string } {
      if (allowlist) {
        const a = authorizeTool(tool);
        if (!a.ok) { denied.push({ tool, reason: a.reason }); return { ok: false, reason: `Tool not permitted: ${a.reason}` }; }
      }
      if (cap && (calls >= STEP_CAP || tokensOf(calls + 1) > TOKEN_BUDGET)) { denied.push({ tool, reason: 'cap reached' }); return { ok: false, reason: `Stopped: the ${STEP_CAP}-call cap was reached` }; }
      calls += 1;
      return { ok: true, reason: 'executed' };
    },
    get calls() { return calls; },
    get denied() { return denied; },
    get tokens() { return tokensOf(calls); },
    get cost() { return costOf(calls); },
  };
}
