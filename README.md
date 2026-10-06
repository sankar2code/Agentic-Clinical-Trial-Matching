# Agentic-Clinical-Trial-Matching
A deterministic, criterion-scored matching engine is the system of record for eligibility. An agentic layer on top gathers evidence, resolves unknowns, and moves the workflow forward, with a clinician approving every action that matters.

## Mockup application

Interactive mockup of the PRD (`Agentic_Clinical_Trial_Matching_AI_PRD.md`). Next.js App Router, TypeScript, no database. All patients, trials and results are synthetic.

**Live demo: https://trialmatch.sankar.work** (hosted on Vercel; a push to `main` redeploys it).

```bash
npm install
npm run dev        # http://localhost:3100
npm run validate   # about 4,200 checks across 20 groups
```

Start with the **Guided tour** (left nav, last item). It walks 21 steps through the product in the order a PRD reviewer would ask about them, and each step ticks itself when the app sees you do it.

### What is in it

**At the point of care**
- Ranked trials per patient with a per-criterion checklist, every Met linked to its source, and Unknown, conflict and stale states shown plainly.
- **Path to eligibility**: the ranked next-best action (agent search, repeat lab, outside records, medication review, rule approval) and a **what-if sandbox** whose values are never saved, logged or shown to the agent.
- **Evidence expiry clock**: how long each trial's evidence stays valid, expiry alerts on the schedule, and a **time-travel** control that evaluates every result as of another date.
- **Visit brief and patient handout**: a one-page brief readable in under two minutes, and a plain-language handout (English, Russian) that a clinician approves before it is shared. Both are built only from engine facts.
- Agent with live per-row status, an 8-call cap, a per-user quota, a negative-result cache per chart version, and approval-gated drafts for referrals and records requests.

**Trust and safety**
- **Guardrail lab**: runs the real agent, engine and validator against a hallucinated value, a wrong-patient document, a prompt injection and more. Switch a control off to see the attack it was stopping succeed.
- **Tamper-evident audit**: every entry is chained to the one before it with SHA-256. Editing an entry is caught at that entry; rewriting history is caught by an anchor. **Replay** re-judges a stored result under today's rules.
- **Rule impact preview**: before a reviewer approves a rule, a dry run shows who would change state, and losing a likely-eligible patient needs an acknowledgement.

**Running the program**
- **Eval harness**: the PRD's metrics and ship thresholds, computed on a hand-labelled golden set, with two zero-tolerance safety metrics. The rollback target and a candidate release both fail it.
- **Rollout modes**: shadow, human-in-the-loop and steady state. Shadow compares the system against coordinators' manual screening; promotion is gated by live exit criteria; steady state adds a deterministic weekly 5% double-review sample.
- **Ops dashboard**: latency, errors, cost per run and monthly projection, Unknown rate by criterion, override rate, with alerts and runbooks. A regression drill makes PD-L1 extraction fail so you can watch it trip.
- **Protocol amendments**: a nightly sync changes a trial's criteria; changed rules go back to review under new ids, referrals made under the old protocol are flagged, and the audit log can replay results against the new rules.

**Outcomes**
- **PI enrollment funnel** with a forecast against the closing date, **printable evidence packet** per patient and trial, and role-aware permissions throughout.

### How it is built

- `lib/engine.ts`: deterministic rules engine (Met / Not met / Unknown / Needs review, as-of dates, time windows, conflicts, pre-filter, ranking with a shown breakdown, audit snapshots and diffs). A Met needs a citation, including on a clinician override.
- `lib/rules.ts`: the shared rule validator, used by the reviewer UI, `/api/criteria` and the engine, so a malformed rule can never silently turn every patient into Not met.
- `lib/agent.ts`, `lib/guards.ts`, `lib/verify.ts`: the mock agent (read-only tools, step cap, injection scan, patient scope, span check) and its controls. `app/api/agent` streams it over server-sent events. The span check reads a value the way a person would: a PD-L1 score is a percentage (never the 22C3 assay clone), ECOG follows the word ECOG, a stage is a whole token (IIB is not found inside IIIB), and only the first reading stated counts.
- `lib/theme.ts` and `app/globals.css`: the light/dark theme. Every color is a CSS variable (graphite and teal), so one attribute on the page switches the whole app; a head script applies a saved choice before the first paint. The validation suite measures WCAG contrast for every text pairing in both themes and fails if a component hard-codes a color.
- `lib/perm.ts`: roles, permissions and the shadow-mode rule. Decisions (overrides, dismissals, approvals, adjudication, handouts, drafts) are paused while the as-of date is simulated, so nothing can be recorded against a chart that is not the real one.
- `lib/chain.ts`, `lib/sha.ts`, `lib/replay.ts`: the hash chain, anchors and replay.
- `lib/eval.ts`, `lib/golden.ts`, `lib/rollout.ts`, `lib/ops.ts`, `lib/funnel.ts`: the evaluation and operations logic. All are pure functions, so the validation suite tests them directly.
- `lib/store.tsx`: client state persisted to localStorage (key `ctm-mockup-v3`).
- `app/api/{match,agent,criteria}`: the three routes named in PRD section 14. There is no database, so the client sends its working state and the server trusts it. Patient access is still enforced server-side; a real build would own the rest server-side too.

### Validation

`npm run validate` runs about 4,200 checks. It uses its own independent oracles rather than reusing the code under test, runs the real API route handlers, and reports a crash in any group as a failure. The groups cover data integrity (every cited span exists and supports its value), engine invariants, a hand-reasoned golden set, agent behaviour including forged extractions, the rule validator, scenario coverage, and each feature module. The suite itself was mutation-tested: deliberate bugs in the engine, the guards, the chain, the validator and the eval gate are all caught.

An independent read-only review of the thirteen added features found 17 issues. Every one was reproduced and fixed, and each has a regression check (group 19) that fails against the old behaviour; the 36 mutations that put those defects back are all caught. The most serious was in the span check, which accepted a PD-L1 of 22 from the assay name "22C3" and the stage "I" from "Stage IV"; a sweep over every cited span in the chart now confirms that no wrong value in a field's whole domain is accepted.

### Using the demo

- **Demo role** (top right) switches between oncologist, coordinator, PI, informaticist and governance. You stay on the same screen, so you can compare permissions.
- **Scenario controls** (bottom right) force an agent timeout or outage, an EHR outage or rate limit, a rollback, a PD-L1 extraction failure, new lab, report or trial events, and exhaust the per-user agent quota.
- **Date chip** (top bar) is time travel. **Mode chip** shows the rollout mode.
- **Theme button** (top bar) switches between light and dark for the whole app. With no choice it follows your system setting; a choice is remembered on this device.
- Each patient on the EHR schedule demonstrates a different PRD scenario; the tags on each row name it.
