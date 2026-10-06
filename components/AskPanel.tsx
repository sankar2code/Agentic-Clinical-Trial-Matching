'use client';
import Link from 'next/link';
import { useState } from 'react';
import { FACT_LABEL, fmtVal } from '@/lib/data';
import { AGENT_TIMEOUT_S, COST_TARGET, STEP_CAP, TOKEN_BUDGET } from '@/lib/agent';
import type { Run } from '@/lib/useAgent';
import { AGENT_QUOTA, PERM_HINT, useApp } from '@/lib/store';
import { Banner, Bar } from '@/components/ui';
import type { Fact } from '@/lib/types';

const PROMPTS = ['Any lung cancer trials for this patient?', 'Find the missing values', 'Why is KEYSTONE not eligible?', 'Draft a referral for the best trial', 'Find the PD-L1'];

export default function AskPanel({ pid, run, ask, onEvidence }: { pid: string; run: Run | null; ask: (q: string) => void; onEvidence: (f: Fact) => void }) {
  const { s, can, quotaLeft } = useApp();
  const [q, setQ] = useState('');
  const blocked = !can('ask') || !!run?.running || quotaLeft <= 0;
  const submit = (text: string) => { if (!blocked && text.trim()) { setQ(''); ask(text); } };
  return (
    <>
      <div className="card hl">
        <h2>Ask</h2>
        <p className="muted small">The agent gathers evidence and drafts. It never decides eligibility and never sends anything.</p>
        <form className="row" onSubmit={(e) => { e.preventDefault(); submit(q); }}>
          <input aria-label="Ask the agent" maxLength={400} value={q} placeholder="e.g. Any lung cancer trials for this patient?" onChange={(e) => setQ(e.target.value)} disabled={!can('ask') || quotaLeft <= 0} />
          <button className="btn pri" disabled={blocked || !q.trim()} title={can('ask') ? '' : PERM_HINT.ask}>Ask</button>
        </form>
        <div className="row wrap" style={{ marginTop: 8 }}>
          {PROMPTS.map((x) => <button key={x} className="btn sm" disabled={blocked} onClick={() => submit(x)}>{x}</button>)}
        </div>
        <div className="row between small muted" style={{ marginTop: 8 }}>
          <span>Agent runs left today: <b>{quotaLeft}</b> of {AGENT_QUOTA}</span>
          {s.sim.agent !== 'normal' && <span style={{ color: 'var(--unk)' }}>Scenario: agent “{s.sim.agent}”</span>}
        </div>
        {quotaLeft <= 0 && <Banner tone="warn">Daily agent limit reached for this user (PRD rate limiting). Engine results above still work.</Banner>}
      </div>

      {run && (
        <div className="card">
          <div className="row between"><b>“{run.q}”</b>{run.running && <span className="chip brand pulse">Running</span>}</div>
          <div className="steps" style={{ marginTop: 8 }} aria-live="polite">
            {run.steps.map((st) => (
              <div key={st.n} className={`step ${st.ok ? '' : 'bad'}`}>
                <div><b>{st.n}. {st.tool}</b> <span className="mono muted">{st.args}</span></div>
                <div className="muted">{st.observation}</div>
              </div>
            ))}
            {run.running && <div className="step pulse muted">Working… (read-only tools, cap {STEP_CAP})</div>}
          </div>
          {run.error && <Banner tone="warn">{run.error}</Banner>}
          {run.result && (
            <>
              <p style={{ marginTop: 10 }}>{run.result.answer}</p>
              {run.result.capHit && <Banner tone="warn">Tool-call cap ({STEP_CAP}) reached. The remaining items were not attempted. Run the agent again to continue.</Banner>}
              {run.result.resolved.map((f) => (
                <div key={f.key} className="row between small"><span>✓ {FACT_LABEL[f.key]} = <b>{fmtVal(f.key, f.value)}</b> {f.confidence !== undefined && f.confidence < 0.9 && <span className={`chip ${f.confidence < 0.7 ? 'review' : 'unknown'}`}>{f.confidence < 0.7 ? 'needs review' : 'medium confidence'}</span>}</span><button className="btn sm" onClick={() => onEvidence(f)}>Source</button></div>
              ))}
              {run.result.unresolved.map((u) => (
                <div key={u.key} className="small" style={{ marginTop: 4 }}><span className="chip unknown">Unknown</span> <b>{FACT_LABEL[u.key]}</b>: {u.reason} <i>Next: {u.nextStep}</i></div>
              ))}
              {run.result.drafts.map((d, i) => (
                <p key={i} className="small" style={{ marginTop: 8 }}>{d.kind === 'referral' ? 'Referral' : 'Records request'} drafted. <Link href={d.kind === 'referral' ? `/patient/${pid}/trials/${d.trialId}` : '/'}>{d.kind === 'referral' ? 'Review the draft' : 'Review it in the approvals queue'} →</Link> (waiting for clinician approval)</p>
              ))}
              <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '10px 0' }} />
              <div className="small muted">Tool calls {run.result.steps.length}/{STEP_CAP}</div><Bar v={run.result.steps.length / STEP_CAP} />
              <div className="small muted" style={{ marginTop: 4 }}>~{run.result.tokens.toLocaleString()} / {TOKEN_BUDGET.toLocaleString()} tokens · ~${run.result.costUsd.toFixed(2)} (target ≤ ${COST_TARGET.toFixed(2)}) · {((run.elapsedMs ?? 0) / 1000).toFixed(1)} s (target &lt; {AGENT_TIMEOUT_S} s)</div>
            </>
          )}
        </div>
      )}
    </>
  );
}
