'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { FACT_LABEL, fmtVal } from '@/lib/data';
import type { MatchContext } from '@/lib/engine';
import { KIND_LABEL, plansFor, rankActions, whatIf, type Hypothetical, type PlanStep } from '@/lib/path';
import { FACT_SPEC, parseInput, validateRule } from '@/lib/rules';
import { Banner, Field, Sec, StateChip } from '@/components/ui';
import type { FactKey, MatchState, Patient, Trial, TrialMatch, Val } from '@/lib/types';

const KIND_CHIP: Record<string, string> = { agent: 'brand', order: 'unknown', clinician: 'review', records: 'unknown', medication: 'review', informatics: 'pending' };

export default function PathTab({ p, matches, trials, ctx, today, searched, canAsk, ask, busy }: {
  p: Patient; matches: TrialMatch[]; trials: Trial[]; ctx: MatchContext; today: string; searched: FactKey[]; canAsk: boolean; ask: (q: string) => void; busy: boolean;
}) {
  const plans = useMemo(() => plansFor(matches.filter((m) => m.state !== 'filtered'), p, searched), [matches, p, searched]);
  const ranked = useMemo(() => rankActions(plans), [plans]);
  const reachable = plans.filter((x) => x.reachable && x.steps.length > 0);
  const stuck = plans.filter((x) => !x.reachable);
  const done = matches.filter((m) => m.state === 'eligible');

  // What-if sandbox. Lives only in this component: it is never saved, logged as a result, or passed to the agent.
  const [hyp, setHyp] = useState<Hypothetical[]>([]);
  const fields = useMemo(() => Array.from(new Set(trials.filter((t) => matches.some((m) => m.trial.id === t.id && m.state !== 'filtered')).flatMap((t) => t.criteria.map((c) => c.rule.fact)))).filter((k) => !['diagnosis', 'histology'].includes(k)) as FactKey[], [trials, matches]);
  const [picked, setField] = useState<FactKey | undefined>(undefined);
  // The chosen field must still be on offer: the list changes with the date, the dismissals and the trials in play.
  const field: FactKey | undefined = picked && fields.includes(picked) ? picked : fields.includes('egfr') ? 'egfr' : fields[0];
  const [raw, setRaw] = useState('');
  const spec = field ? FACT_SPEC[field] : undefined;
  const value = field && spec ? (parseInput(field, '==', raw === '' && spec.type === 'boolean' ? 'true' : raw) as Val) : '';
  const problem = field && spec && (spec.type === 'enum' || spec.type === 'boolean' || spec.type === 'number')
    ? validateRule({ fact: field, op: '==', value }).filter((e) => !/Operator/.test(e))[0]
    : undefined;
  const result = useMemo(() => (hyp.length ? whatIf(p, trials.filter((t) => matches.some((m) => m.trial.id === t.id)), ctx, hyp, today) : null), [hyp, p, trials, matches, ctx, today]);

  const add = () => {
    if (!field || !spec || problem || (raw === '' && spec.type !== 'boolean')) return;
    setHyp((h) => [...h.filter((x) => x.key !== field), { key: field, value }]);
    setRaw('');
  };

  const step = (s: PlanStep, trialsFor: string[], completes: boolean) => (
    <div key={s.key} className="card tight">
      <div className="row between wrap">
        <div className="row wrap"><b>{s.label}</b><span className={`chip ${KIND_CHIP[s.kind]}`}>{KIND_LABEL[s.kind]}</span></div>
        {s.kind === 'agent' && s.question && <button className="btn sm pri" disabled={!canAsk || busy} onClick={() => ask(s.question!)}>Run the agent</button>}
        {s.kind === 'informatics' && <Link className="btn sm" href="/admin/criteria">Open Criteria review</Link>}
      </div>
      <p className="small muted" style={{ margin: '4px 0' }}>{s.detail}</p>
      <div className="small"><b>Who:</b> {s.owner} · <b>Typical lead time:</b> {s.lead} · <b>Moves:</b> {trialsFor.join(', ')}{completes ? ' (finishes it)' : ''}</div>
    </div>
  );

  return (
    <div>
      <Banner tone="info"><b>Engine-derived, nothing guessed.</b> Each step comes from a criterion that is Unknown, in conflict, awaiting a rule, or failed for a reason a clinician could change. Which tests or medication changes are appropriate remains a clinical decision.</Banner>

      <Sec title="Next best actions" count={ranked.length} note="Ranked by trials finished, then trials helped, then how quick it is" />
      {ranked.length === 0 ? (
        <div className="card muted">{done.length > 0 ? 'Nothing to do: this patient is already likely eligible for at least one trial.' : 'No action would unlock a trial. Every near or blocked trial is held by something that cannot be changed.'}</div>
      ) : <div className="col">{ranked.map((r, i) => (
        <div key={r.step.key} className="row" style={{ alignItems: 'flex-start' }}><span className="chip gray" style={{ marginTop: 10 }}>{i + 1}</span><div className="grow">{step(r.step, r.trials, r.completes.length > 0)}</div></div>
      ))}</div>}

      <Sec title="Plan for each trial" count={reachable.length} />
      <div className="col">
        {reachable.map((pl) => (
          <div key={pl.m.trial.id} className="card">
            <div className="row between wrap"><div className="row wrap"><b>{pl.m.trial.code}</b><StateChip s={pl.m.state} /></div><span className="small muted">{pl.steps.length} step{pl.steps.length > 1 ? 's' : ''} to likely eligible</span></div>
            <ol style={{ margin: '8px 0 0', paddingLeft: 20 }}>{pl.steps.map((s) => <li key={s.key} className="small" style={{ marginBottom: 4 }}>{s.label} <span className={`chip ${KIND_CHIP[s.kind]}`}>{KIND_LABEL[s.kind]}</span></li>)}</ol>
          </div>
        ))}
        {reachable.length === 0 && <div className="card muted">No trial has a reachable plan.</div>}
      </div>

      {stuck.length > 0 && (
        <details style={{ marginTop: 14 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Not reachable ({stuck.length})</summary>
          <div className="col" style={{ marginTop: 8 }}>{stuck.map((pl) => (
            <div key={pl.m.trial.id} className="card tight small"><b>{pl.m.trial.code}</b>: ruled out by {pl.hardBlockers.map((b) => b.text).join('; ')}. These describe the patient, not a missing step.</div>
          ))}</div>
        </details>
      )}

      <Sec title="What-if sandbox" note="Try a value to see what it would change" />
      {!field || !spec ? <div className="card muted">There is no live trial to try a value against.</div> : (
      <div className="card">
        <Banner tone="warn"><b>Hypothetical, not evidence.</b> Values entered here are never saved, never shown to the agent, and never become a result or an audit entry. They exist only on this page.</Banner>
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          <div style={{ width: 200 }}><Field label="Field">
            <select value={field} onChange={(e) => { setField(e.target.value as FactKey); setRaw(''); }}>{fields.map((k) => <option key={k} value={k}>{FACT_LABEL[k]}</option>)}</select>
          </Field></div>
          <div style={{ width: 170 }}><Field label={spec.type === 'number' ? `Value${'unit' in spec && spec.unit ? ` (${spec.unit})` : ''}` : 'Value'}>
            {spec.type === 'boolean' ? (
              <select value={raw || 'true'} onChange={(e) => setRaw(e.target.value)}><option value="true">{field === 'brainMets' ? 'Present' : field === 'strongCyp3a4' ? 'Yes' : 'Detected'}</option><option value="false">{field === 'brainMets' ? 'Absent' : field === 'strongCyp3a4' ? 'No' : 'Not detected'}</option></select>
            ) : spec.type === 'enum' ? (
              <select value={raw} onChange={(e) => setRaw(e.target.value)}><option value="">Choose…</option>{spec.allowed.map((a) => <option key={a}>{a}</option>)}</select>
            ) : (
              <input type="number" step="any" value={raw} onChange={(e) => setRaw(e.target.value)} />
            )}
          </Field></div>
          <button className="btn pri" disabled={!!problem || (raw === '' && spec.type !== 'boolean')} onClick={add}>Add what-if</button>
          <button className="btn" disabled={hyp.length === 0} onClick={() => setHyp([])}>Clear</button>
        </div>
        {problem && raw !== '' && <div className="err">{problem}</div>}
        {hyp.length > 0 && <div className="row wrap" style={{ marginTop: 8 }}>{hyp.map((h) => <span key={h.key} className="chip review">{FACT_LABEL[h.key]} = {fmtVal(h.key, h.value)} <button aria-label={`Remove ${FACT_LABEL[h.key]}`} style={{ border: 0, background: 'none', cursor: 'pointer', color: 'inherit' }} onClick={() => setHyp((x) => x.filter((y) => y.key !== h.key))}>✕</button></span>)}</div>}
        {result && (
          <table style={{ marginTop: 10 }}>
            <thead><tr><th>Trial</th><th>Now</th><th>If these were true</th><th>Open items</th></tr></thead>
            <tbody>{result.rows.map((r) => (
              <tr key={r.trial} style={{ background: r.before !== r.after ? 'var(--brand-soft)' : undefined }}>
                <td><b>{r.trial}</b></td><td><StateChip s={r.before as MatchState} /></td><td><StateChip s={r.after as MatchState} />{r.before !== r.after && <span className="small"> ← changes</span>}</td><td className="small">{r.open.before} → {r.open.after}</td>
              </tr>))}</tbody>
          </table>
        )}
        {result && result.changed.length === 0 && <p className="small muted" style={{ marginTop: 8 }}>These values would not change any trial.</p>}
      </div>
      )}
    </div>
  );
}
