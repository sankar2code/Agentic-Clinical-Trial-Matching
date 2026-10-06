'use client';
import { useMemo, useState } from 'react';
import { PATIENTS, TRIALS } from '@/lib/data';
import { describeRule, matchTrial } from '@/lib/engine';
import { ackSignature, ruleImpact, type Impact } from '@/lib/impact';
import { FACT_SPEC, opsFor, parseInput, showValue, validateRule } from '@/lib/rules';
import { PERM_HINT, useApp } from '@/lib/store';
import { Banner, Modal } from '@/components/ui';
import type { Criterion, Op, Rule, Trial } from '@/lib/types';

const STATE_WORD: Record<string, string> = { eligible: 'likely eligible', near: 'near-eligible', ineligible: 'not eligible', filtered: 'filtered out' };

function ImpactList({ impact }: { impact: Impact }) {
  return (
    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
      {impact.states.map((s) => <li key={s.patientId}>{s.patient}: {STATE_WORD[s.from]} → <b>{STATE_WORD[s.to]}</b></li>)}
      {impact.criteria.filter((x) => !impact.states.some((s) => s.patientId === x.patientId)).map((x) => <li key={x.patientId}>{x.patient}: criterion {x.from} → {x.to} (trial state unchanged)</li>)}
    </ul>
  );
}

function Row({ t, c }: { t: Trial; c: Criterion }) {
  const { s, can, setReview, trials, mctx, shadowHidden } = useApp();
  // What a reviewer acknowledges is a specific list of people for a specific action. A different edit loses a different list, and
  // approving is not rejecting, so each action keeps its own acknowledgement.
  const [ackEdit, setAckEdit] = useState('');
  const [ackReject, setAckReject] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [showImpact, setShowImpact] = useState(false);
  const fact = c.rule.fact;
  const spec = FACT_SPEC[fact];
  const [op, setOp] = useState<Op>(c.rule.op);
  const [val, setVal] = useState(showValue(c.rule.value));
  const [win, setWin] = useState(c.rule.windowDays?.toString() ?? '');
  const [serverErrs, setServerErrs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const rule: Rule = { fact, op, value: parseInput(fact, op, val), windowDays: win.trim() === '' ? undefined : Number(win) };
  const errs = validateRule(rule);
  const edited = op !== c.rule.op || val !== showValue(c.rule.value) || win !== (c.rule.windowDays?.toString() ?? '');
  const dis = !can('rules');
  // A reviewer's correction to the parsed rule. The source text from the registry is not rewritten, so say so.
  const shipped = TRIALS.find((x) => x.id === t.id)?.criteria.find((k) => k.id === c.id);
  const correctedFrom = shipped && JSON.stringify(shipped.rule) !== JSON.stringify(c.rule) && !c.amended ? shipped.rule : null;
  // Dry run: what would change across the whole cohort if this rule were approved as it is shown here. Nothing is saved.
  // Patient-level results are hidden from clinicians and coordinators in shadow mode, and a preview is made of them.
  const needsPreview = !shadowHidden && errs.length === 0 && (edited || c.review !== 'approved');
  // The impact depends on the rule as edited and on the chart, the overrides, the as-of date and the drill, so all of them are dependencies.
  const impact = useMemo(() => (needsPreview ? ruleImpact({ patients: PATIENTS, trials, ctx: mctx(), tid: t.id, cid: c.id, rule: edited ? rule : undefined, review: 'approved' }) : null), [needsPreview, trials, op, val, win, s.overlay, s.overrides, s.queryDate, s.sim.regression]); // eslint-disable-line react-hooks/exhaustive-deps
  const sig = ackSignature(impact);
  const blocked = !!impact?.risky && ackEdit !== sig;
  // Rejecting an approved rule stops it being evaluated, which can demote people just as an edit can.
  const rejectImpact = useMemo(() => (c.review === 'approved' && !shadowHidden ? ruleImpact({ patients: PATIENTS, trials, ctx: mctx(), tid: t.id, cid: c.id, review: 'rejected' }) : null), [c.review, shadowHidden, trials, s.overlay, s.overrides, s.queryDate, s.sim.regression]); // eslint-disable-line react-hooks/exhaustive-deps
  const rejectSig = ackSignature(rejectImpact);
  const rejectBlocked = !!rejectImpact?.risky && ackReject !== rejectSig;
  const closeReject = () => { setRejecting(false); setAckReject(''); };
  const reject = () => { closeReject(); setReview(t.id, c.id, 'rejected', undefined, `Rejected ${c.id}: ${c.text}`); };

  async function approve() {
    setBusy(true);
    setServerErrs([]);
    try {
      const res = await fetch('/api/criteria', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trialId: t.id, criterionId: c.id, rule }) });
      const data = await res.json();
      if (!data.ok) { setServerErrs(data.errors ?? ['Rule rejected by the server']); return; }
      setReview(t.id, c.id, 'approved', edited ? rule : undefined, `Approved ${c.id}${edited ? ` with edit: ${describeRule(rule)} (was ${describeRule(c.rule)})` : ''}`);
    } catch {
      setServerErrs(['Could not reach the validation service. Nothing was approved.']);
    } finally {
      setBusy(false);
    }
  }

  const control = spec.type === 'boolean' ? (
    <select style={{ width: 110 }} value={val} onChange={(e) => setVal(e.target.value)} disabled={dis} aria-label="value"><option value="true">true</option><option value="false">false</option></select>
  ) : spec.type === 'enum' && op !== 'in' ? (
    <select style={{ width: 150 }} value={val} onChange={(e) => setVal(e.target.value)} disabled={dis} aria-label="value">{[...(spec.allowed.includes(val) ? [] : [val]), ...spec.allowed].map((x) => <option key={x}>{x}</option>)}</select>
  ) : spec.type === 'enum' ? (
    <input style={{ width: 200 }} value={val} onChange={(e) => setVal(e.target.value)} disabled={dis} aria-label="value (comma separated)" placeholder={spec.allowed.slice(0, 3).join(', ')} />
  ) : (
    <input style={{ width: 110 }} type="number" step="any" value={val} onChange={(e) => setVal(e.target.value)} disabled={dis} aria-label="value" />
  );

  return (
    <tr>
      <td style={{ width: '28%' }}>{c.text}<div className="small muted">{c.type} · parse confidence {Math.round(c.parseConfidence * 100)}%</div></td>
      <td>
        <div className="row wrap"><span className="mono" style={{ minWidth: 80 }}>{fact}</span>
          <select style={{ width: 70 }} value={op} onChange={(e) => { const next = e.target.value as Op; setOp(next); if (spec.type === 'enum' && next !== 'in' && val.includes(',')) setVal(val.split(',')[0].trim()); }} disabled={dis} aria-label="operator">{opsFor(fact).map((o) => <option key={o}>{o}</option>)}</select>
          {control}
          {spec.type === 'number' && <input style={{ width: 90 }} type="number" min={1} max={365} placeholder="window d" value={win} onChange={(e) => setWin(e.target.value)} disabled={dis} aria-label="time window in days" />}
        </div>
        <div className="small muted mono">{errs.length ? 'invalid' : describeRule(rule)}</div>
        {correctedFrom && <div className="small" style={{ color: 'var(--rev)' }}>Rule corrected by a reviewer. The source text above is unchanged; it was parsed as {describeRule(correctedFrom)}.</div>}
        {c.amended && <div className="small" style={{ color: 'var(--rev)' }}>Amended by {c.amended.amendment}. Was: “{c.amended.from.text}” ({describeRule(c.amended.from.rule)})</div>}
        {[...errs, ...serverErrs].map((e) => <div className="err" key={e} role="alert">{e}</div>)}
        {impact && (
          <div className="small" style={{ marginTop: 6, padding: '6px 8px', borderRadius: 8, background: impact.risky ? 'var(--not-bg)' : 'var(--brand-soft)' }}>
            <b>Impact if approved:</b> {impact.states.length === 0 && impact.criteria.length === 0 ? `no patient changes (${impact.patients} checked).` : `${impact.criteria.length} criterion result(s) change; ${impact.states.length} patient(s) change trial state${impact.eligibleGained.length ? `, ${impact.eligibleGained.length} newly likely eligible` : ''}${impact.eligibleLost.length ? `, ${impact.eligibleLost.length} lose likely eligible` : ''}.`}
            {(impact.states.length > 0 || impact.criteria.length > 0) && <button className="btn sm" style={{ marginLeft: 8 }} aria-expanded={showImpact} onClick={() => setShowImpact(!showImpact)}>{showImpact ? 'Hide' : 'Details'}</button>}
            {showImpact && <ImpactList impact={impact} />}
            {impact.risky && <label className="row" style={{ margin: '6px 0 0', fontWeight: 400, color: 'var(--ink)' }}><input type="checkbox" style={{ width: 'auto' }} checked={ackEdit === sig} onChange={(e) => setAckEdit(e.target.checked ? sig : '')} /> I reviewed this: {impact.eligibleLost.map((x) => x.patient).join(', ')} would no longer be likely eligible.</label>}
          </div>
        )}
      </td>
      <td><span className={`chip ${c.review === 'approved' ? 'met' : c.review === 'rejected' ? 'notmet' : 'pending'}`}>{c.review}</span>{c.parseConfidence < 0.8 && <div className="chip unknown">low parse confidence</div>}</td>
      <td><div className="row wrap">
        <button className="btn sm pri" disabled={dis || errs.length > 0 || busy || blocked} title={dis ? PERM_HINT.rules : errs[0] ?? (blocked ? 'Acknowledge the impact first' : '')} onClick={approve}>{busy ? 'Checking…' : edited ? 'Save and approve' : 'Approve'}</button>
        <button className="btn sm dng" disabled={dis} onClick={() => (c.review === 'approved' ? setRejecting(true) : reject())}>Reject</button></div>
        {rejecting && (
          <Modal title={`Reject ${c.id}?`} onClose={closeReject}>
            <p className="muted">{c.text}. This rule is approved and live. A rejected rule is not evaluated, so every trial that depends on it falls to near-eligible until it is approved again.</p>
            {rejectImpact && (
              <div className="small" style={{ padding: '6px 8px', borderRadius: 8, background: rejectImpact.risky ? 'var(--not-bg)' : 'var(--brand-soft)' }}>
                <b>Impact if rejected:</b> {rejectImpact.states.length === 0 ? `no patient changes trial state (${rejectImpact.patients} checked).` : `${rejectImpact.states.length} patient(s) change trial state${rejectImpact.eligibleLost.length ? `, ${rejectImpact.eligibleLost.length} lose likely eligible` : ''}.`}
                {rejectImpact.states.length > 0 && <ImpactList impact={rejectImpact} />}
                {rejectImpact.risky && <label className="row" style={{ margin: '6px 0 0', fontWeight: 400, color: 'var(--ink)' }}><input type="checkbox" style={{ width: 'auto' }} checked={ackReject === rejectSig} onChange={(e) => setAckReject(e.target.checked ? rejectSig : '')} /> I reviewed this: {rejectImpact.eligibleLost.map((x) => x.patient).join(', ')} would no longer be likely eligible.</label>}
              </div>
            )}
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn dng" disabled={rejectBlocked} title={rejectBlocked ? 'Acknowledge the impact first' : ''} onClick={reject}>Reject the rule</button>
              <button className="btn" onClick={closeReject}>Cancel</button>
            </div>
          </Modal>
        )}</td>
    </tr>
  );
}

export default function Criteria() {
  const { trials, mctx, shadowHidden } = useApp();
  const [tid, setTid] = useState('t3');
  const t = trials.find((x) => x.id === tid) ?? trials[0];
  const pend = (x: Trial) => x.criteria.filter((c) => c.review !== 'approved').length;
  const matching = shadowHidden ? 0 : PATIENTS.filter((p) => p.treating && ['eligible', 'near'].includes(matchTrial(p, t, mctx()).state)).length;
  return (
    <div>
      <h1>Criteria structuring and review</h1>
      <p className="muted">The model drafts each free-text criterion as a computable rule. A reviewer approves before it goes live. Every rule is validated against its field type before it can be approved, so a typo cannot silently mark every patient Not met.</p>
      <div className="tabs" style={{ flexWrap: 'wrap' }}>
        {trials.map((x) => <button key={x.id} className={x.id === t.id ? 'on' : ''} onClick={() => setTid(x.id)}>{x.code}{pend(x) > 0 ? ` (${pend(x)})` : ''}</button>)}
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <b>{t.code}</b> <span className="muted">{t.title}</span>
        <div className="small muted">{pend(t)} not approved · {shadowHidden ? 'patient-level results hidden in shadow mode' : `${matching} patients currently likely or near-eligible`} · {t.ruleSet}</div>
      </div>
      {pend(t) > 0 && <Banner tone="rev">Rules that are not approved are not evaluated. Approving them re-screens the cohort and updates the worklist.</Banner>}
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table><thead><tr><th>Free-text criterion</th><th>Computable rule (editable)</th><th>Status</th><th /></tr></thead>
          <tbody>{t.criteria.map((c) => <Row key={`${t.id}-${c.id}-${c.review}`} t={t} c={c} />)}</tbody></table>
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>Edits are logged with before and after values. Open question from the PRD: who signs off, the coordinator, the PI, or clinical informatics? This mockup assumes informatics.</p>
    </div>
  );
}
