'use client';
import { useCallback, useState } from 'react';
import { FACT_LABEL, fmtVal } from './data';
import { STEP_CAP, type AgentResult, type AgentStep } from './agent';
import { dropFor, useApp } from './store';

export interface Run {
  q: string;
  running: boolean;
  steps: AgentStep[];
  result?: AgentResult;
  error?: string;
  elapsedMs?: number;
}

/** Client side of the streamed agent run: shows steps as they arrive and updates the chart in place. */
export function useAgent(pid: string) {
  const app = useApp();
  const { s, trials, quotaLeft, log, addFacts, draft, consumeRun, track, versionStamp, searchedFor, markSearched, telem } = app;
  const [run, setRun] = useState<Run | null>(null);

  const ask = useCallback(async (question: string) => {
    if (!question.trim() || run?.running || quotaLeft <= 0) return;
    const t0 = performance.now();
    consumeRun();
    track('agent.ask', { patientId: pid });
    setRun({ q: question, running: true, steps: [] });
    log('agent.ask', `Ask box: "${question}"`, pid);
    const finish = (patch: Partial<Run>) => setRun((r) => (r ? { ...r, running: false, elapsedMs: Math.round(performance.now() - t0), ...patch } : r));
    try {
      const res = await fetch('/api/agent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId: pid, question, trials, overlay: s.overlay, overrides: s.overrides, mode: s.sim.agent, versions: versionStamp, skip: searchedFor(pid), today: s.queryDate, dropNlp: dropFor(s.sim),
          existing: s.referrals.map((r) => ({ patientId: r.patientId, trialId: r.trialId, kind: r.kind, status: r.status, fact: r.fact })),
        }),
      });
      if (!res.ok || !res.body) throw new Error(String(res.status));
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) {
          if (!part.startsWith('data: ')) continue;
          const ev = JSON.parse(part.slice(6));
          if (ev.type === 'step') {
            const step: AgentStep = ev.step;
            setRun((r) => (r ? { ...r, steps: [...r.steps, step] } : r));
            // Update rows in place as soon as a value is verified, not at the end of the run.
            if (step.fact) addFacts(pid, [step.fact], `Agent resolved ${FACT_LABEL[step.fact.key]} = ${fmtVal(step.fact.key, step.fact.value)} with a cited, span-verified value`);
            if (step.reject) log('agent.extraction.rejected', step.observation, pid);
          }
          if (ev.type === 'error') {
            finish({ error: ev.message });
            log('agent.error', ev.message, pid);
            telem({ kind: 'agent', ok: false, ms: Math.round(performance.now() - t0), patientId: pid, detail: ev.message });
            return;
          }
          if (ev.type === 'done') {
            const result: AgentResult = ev.result;
            finish({ result });
            log('agent.run', `Intent ${result.intent}; ${result.steps.length}/${STEP_CAP} tool calls; ~${result.tokens} tokens; ~$${result.costUsd.toFixed(2)}${result.capHit ? '; step cap reached' : ''}`, pid);
            if (result.resolved.length) addFacts(pid, result.resolved, `Agent resolved ${result.resolved.map((f) => FACT_LABEL[f.key]).join(', ')}`);
            result.drafts.forEach((d) => draft(pid, d.trialId, d.body, d.kind, d.fact));
            if (result.searchedAbsent.length) markSearched(pid, result.searchedAbsent);
            result.quarantined.forEach((q) => log('agent.injection.quarantined', `Instruction-like text in "${q.title}" was quarantined (${q.hits.join('; ')}). The agent treats documents as data.`, pid));
            telem({ kind: 'agent', ok: true, ms: Math.round(performance.now() - t0), steps: result.steps.length, tokens: result.tokens, cost: result.costUsd, capHit: result.capHit, patientId: pid });
          }
        }
      }
    } catch {
      finish({ error: 'The agent service is unavailable. Showing engine-only results; nothing was guessed.' });
      log('agent.error', 'Agent unavailable; engine-only fallback', pid);
      telem({ kind: 'agent', ok: false, ms: Math.round(performance.now() - t0), patientId: pid, detail: 'unavailable' });
    }
  }, [pid, run?.running, quotaLeft, trials, s.overlay, s.overrides, s.sim.agent, s.sim.regression, s.queryDate, s.referrals, s.searched, versionStamp]); // eslint-disable-line react-hooks/exhaustive-deps

  return { run, ask };
}
