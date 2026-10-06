'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { FACT_LABEL, TODAY, fmtVal } from '@/lib/data';
import { MIN_CITATION, describeRule, matchTrial } from '@/lib/engine';
import { draftReferralText } from '@/lib/agent';
import { PERM_HINT, useApp } from '@/lib/store';
import { Banner, Bar, DraftEditor, EvidenceModal, Field, Modal, RankBreakdown, StateChip, StatusChip } from '@/components/ui';
import type { CritResult, Fact, Override } from '@/lib/types';

const REASONS: Override['reason'][] = ['wrong value', 'wrong source', 'outdated evidence', 'wrong rule', 'clinical judgement'];

export default function TrialDetail() {
  const { id, tid } = useParams<{ id: string; tid: string }>();
  const { s, trials, patient, mctx, can, override, clearOverride, draft, editReferral, decideReferral, dismiss, restore, track, versionStamp, paused, shadowHidden } = useApp();
  const p = patient(id);
  const t = trials.find((x) => x.id === tid);
  const [evi, setEvi] = useState<Fact | null>(null);
  const [ov, setOv] = useState<CritResult | null>(null);
  const [showRule, setShowRule] = useState(false);
  // The as-of date and the regression drill change the result, so they are dependencies like the chart and the overrides.
  const m = useMemo(() => (p && t ? matchTrial(p, t, mctx()) : null), [p, t, s.overlay, s.overrides, s.queryDate, s.sim.regression]); // eslint-disable-line react-hooks/exhaustive-deps

  // Usage analytics (PRD section 12): which checklists are opened and how long clinicians spend in review.
  useEffect(() => {
    if (!p?.treating) return;
    track('trial.open', { patientId: id, trialId: tid });
    const t0 = Date.now();
    return () => { const ms = Date.now() - t0; if (ms > 1500) track('dwell', { patientId: id, trialId: tid, ms }); };
  }, [id, tid]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!p || !t || !m) return <Banner tone="bad">Patient or trial not found.</Banner>;
  if (!p.treating) return <Banner tone="bad"><b>Access restricted.</b> No treating relationship with this patient.</Banner>;
  if (shadowHidden) return <Banner tone="rev"><b>Shadow mode.</b> The system’s results are hidden from clinicians and coordinators while it is compared against manual screening.</Banner>;

  const ref = s.referrals.filter((r) => r.patientId === id && r.trialId === tid && r.kind === 'referral' && r.status !== 'rejected').slice(-1)[0];
  const lastRejected = !ref && s.referrals.some((r) => r.patientId === id && r.trialId === tid && r.kind === 'referral' && r.status === 'rejected');
  const dismissed = s.dismissals[`${id}|${tid}`];
  const groups: ['inclusion' | 'exclusion', string][] = [['inclusion', 'Inclusion criteria'], ['exclusion', 'Exclusion criteria (met = the patient is not excluded)']];
  const unevaluable = m.counts.pending;

  return (
    <div>
      <p className="small"><Link href={`/patient/${id}/trials`}>← {p.name}</Link></p>
      <div className="row between wrap">
        <div><h1>{t.code} <StateChip s={m.state} /></h1><p className="muted">{t.title}</p></div>
        <div className="col" style={{ alignItems: 'flex-end', gap: 2 }}><Link className="btn sm" href={`/patient/${id}/trials/${tid}/packet`}>Evidence packet</Link><span className="chip gray">{t.nct} · {t.phase} · {t.sponsor}</span><span className="small muted">{t.enrolled}/{t.target} enrolled · {t.ruleSet}</span></div>
      </div>
      {s.queryDate !== TODAY && <Banner tone="warn"><b>Simulated date {s.queryDate}.</b> This checklist is evaluated as of that date. Overrides, referrals and dismissals are paused until you reset the date from the top bar.</Banner>}
      {m.filterReason && <Banner tone="info"><b>Filtered out before evaluation:</b> {m.filterReason}. Criteria below are shown for transparency only.</Banner>}
      {m.siteFull && <Banner tone="warn"><b>Site {t.siteStatus.toLowerCase()}.</b> Ranked lower. Discuss a satellite site or the waitlist with the coordinator.</Banner>}
      {t.siteMiles > 0 && <Banner tone="info"><b>Satellite site, {t.siteMiles} miles away.</b> Ranked slightly lower for distance.</Banner>}
      {dismissed && <Banner tone="info">Dismissed by {dismissed.by}: {dismissed.reason}. {dismissed.note} <button className="btn sm" disabled={!can('dismiss')} onClick={() => restore(id, tid)}>Restore</button></Banner>}
      {unevaluable > 0 && <Banner tone="rev"><b>{unevaluable} rule{unevaluable > 1 ? 's are' : ' is'} not evaluable</b> (awaiting reviewer approval, rejected, or failed validation). {unevaluable > 1 ? 'They are' : 'It is'} skipped, so this trial cannot be called eligible until {unevaluable > 1 ? 'they are' : 'it is'} approved.</Banner>}

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row wrap"><StatusChip s="met" n={m.counts.met} /><StatusChip s="notmet" n={m.counts.notmet} /><StatusChip s="unknown" n={m.counts.unknown} /><StatusChip s="review" n={m.counts.review} />{unevaluable > 0 && <StatusChip s="pending" n={unevaluable} />}
          <span className="grow" /><span className="small muted">{Math.round(m.fit * 100)}% met</span></div>
        <div style={{ marginTop: 8 }}><Bar v={m.fit} tone={m.state === 'eligible' ? 'good' : m.state === 'ineligible' ? 'bad' : 'warn'} /></div>
        <div style={{ marginTop: 8 }}><RankBreakdown m={m} /></div>
      </div>

      {groups.map(([type, title]) => (
        <div key={type} style={{ marginBottom: 16 }}>
          <h2>{title}</h2>
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table>
              <thead><tr><th style={{ width: 120 }}>Result</th><th>Criterion</th><th>Evidence</th><th style={{ width: 90 }} /></tr></thead>
              <tbody>
                {m.results.filter((r) => r.criterion.type === type).map((r) => (
                  <tr key={r.criterion.id}>
                    <td><StatusChip s={r.status} />{r.override && <div className="small muted">overridden</div>}</td>
                    <td><div>{r.criterion.text}</div>
                      <div className="small muted">{r.message}</div>
                      {r.nextStep && ['unknown', 'review'].includes(r.status) && <div className="small" style={{ color: 'var(--unk)' }}>Next step: {r.nextStep}</div>}
                      <div className="row wrap" style={{ marginTop: 4 }}>
                        {r.stale && <span className="chip unknown">stale</span>}{r.conflict && <span className="chip review">conflicting sources</span>}
                        {r.lowConfidence && !r.conflict && <span className="chip unknown">verify extraction</span>}
                        {r.attested && <span className="chip review">clinician-attested</span>}
                        {r.evidence.some((e) => e.by === 'agent') && <span className="chip brand">agent-resolved</span>}
                        {r.criterion.review !== 'approved' && <span className="chip pending">{r.criterion.review}</span>}
                        {r.criterion.amended && <span className="chip review" title={`Was: ${r.criterion.amended.from.text}`}>amended {r.criterion.amended.amendment}</span>}
                      </div>
                    </td>
                    <td className="small">
                      {r.override?.citation && <div style={{ marginBottom: 4 }}><b>Clinician citation:</b> {r.override.citation}</div>}
                      {r.evidence.length === 0 && !r.override?.citation ? <span className="muted">No citation (cannot be Met)</span> : r.evidence.map((e, i) => (
                        <div key={i} style={{ marginBottom: 4 }}>
                          <b>{fmtVal(e.key, e.value)}</b> <span className="muted">· {e.date}{e.confidence !== undefined ? ` · ${Math.round(e.confidence * 100)}%` : ''}</span><br />
                          <a href="#" onClick={(ev) => { ev.preventDefault(); track('evidence.open', { patientId: id, trialId: tid, key: e.key }); setEvi(e); }}>{e.source.label}</a>
                        </div>
                      ))}
                    </td>
                    <td>
                      {r.override ? (
                        <button className="btn sm" disabled={!can('override')} onClick={() => clearOverride(id, tid, r.criterion.id)}>Undo</button>
                      ) : (
                        <button className="btn sm" disabled={!can('override') || r.status === 'pending'} title={can('override') ? '' : PERM_HINT.override} onClick={() => setOv(r)}>Override</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div className="row between" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>Rule provenance</h2>
        <button className="btn sm" aria-expanded={showRule} onClick={() => setShowRule(!showRule)}>{showRule ? 'Hide' : 'Show'}</button>
      </div>
      {showRule && (
        <div className="card tight mono" style={{ marginBottom: 16 }}>
          {t.criteria.map((c) => <div key={c.id}>{c.id}: {describeRule(c.rule)} · {c.review} · parse confidence {Math.round(c.parseConfidence * 100)}%</div>)}
        </div>
      )}

      <h2>Referral to coordinator</h2>
      <div className="card">
        {!ref ? (
          <>
            <p className="muted">{lastRejected ? 'The last draft was rejected; nothing was sent. ' : ''}The agent drafts from the engine’s evaluated criteria only. You edit and approve before anything reaches the coordinator.</p>
            <button className="btn pri" disabled={!!m.filterReason || m.state === 'ineligible' || paused} title={paused ? 'Drafts are paused while the date is simulated. Reset it to draft a referral.' : m.state === 'ineligible' ? 'A not-eligible trial cannot be referred' : ''} onClick={() => draft(id, tid, draftReferralText(p, m, versionStamp))}>Draft referral</button>
          </>
        ) : (
          <>
            <div className="row between"><b>{ref.status === 'draft' ? 'Draft: waiting for your approval' : 'Approved and released'}</b><span className={`chip ${ref.status === 'draft' ? 'unknown' : 'met'}`}>{ref.status}</span></div>
            <div style={{ marginTop: 8 }}><DraftEditor label="Referral body" value={ref.body} disabled={ref.status !== 'draft' || !can('approveReferral')} onCommit={(v) => editReferral(ref.id, v)} /></div>
            {ref.status === 'draft' && (
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn pri" disabled={!can('approveReferral')} title={can('approveReferral') ? '' : PERM_HINT.approveReferral} onClick={() => decideReferral(ref.id, 'approved')}>Approve and send</button>
                <button className="btn dng" disabled={!can('approveReferral')} onClick={() => decideReferral(ref.id, 'rejected')}>Reject</button>
                {ref.edited && <span className="muted small">edited by clinician</span>}
              </div>
            )}
            {ref.status === 'approved' && <p className="small muted" style={{ marginTop: 8 }}>Approved by {ref.decidedBy}. Coordinator status: {ref.worklist}. Patient contact happens only through the treating clinician.</p>}
          </>
        )}
      </div>

      <div className="row" style={{ marginTop: 14 }}>
        {!dismissed && <button className="btn" disabled={!can('dismiss')} title={can('dismiss') ? '' : PERM_HINT.dismiss} onClick={() => { const r = prompt('Reason for dismissing this trial?', 'Clinically inappropriate'); if (r) dismiss(id, tid, r, ''); }}>Dismiss trial</button>}
      </div>

      {evi && <EvidenceModal fact={evi} patient={p} onClose={() => setEvi(null)} />}
      {ov && <OverrideModal r={ov} onClose={() => setOv(null)} onSave={(to, reason, note, citation) => { override(id, tid, ov.criterion.id, { to, reason, note, citation, original: ov.status }, `${FACT_LABEL[ov.criterion.rule.fact]} (${ov.criterion.text})`); setOv(null); }} />}
    </div>
  );
}

function OverrideModal({ r, onClose, onSave }: { r: CritResult; onClose: () => void; onSave: (to: 'met' | 'notmet', reason: Override['reason'], note: string, citation?: string) => void }) {
  const [to, setTo] = useState<'met' | 'notmet'>(r.status === 'met' ? 'notmet' : 'met');
  const [reason, setReason] = useState<Override['reason']>(REASONS[0]);
  const [note, setNote] = useState('');
  const [citation, setCitation] = useState('');
  const needCite = to === 'met';
  const citeOk = !needCite || citation.trim().length >= MIN_CITATION;
  return (
    <Modal title="Override criterion" onClose={onClose}>
      <p className="muted">{r.criterion.text}. Currently <b>{r.status}</b>. Your reason code routes the fix: extraction errors to ML, rule errors to the informaticist, and confirmed cases into the golden set.</p>
      <div className="col">
        <Field label="Set to"><select value={to} onChange={(e) => setTo(e.target.value as 'met')}><option value="met">Met</option><option value="notmet">Not met</option></select></Field>
        {needCite && (
          <Field label="Citation (required for Met)" hint="A criterion cannot be Met without a source. Name the document, date and where the value appears.">
            <input value={citation} onChange={(e) => setCitation(e.target.value)} placeholder="e.g. Outside pathology report 2026-08-01, page 2, PD-L1 TPS 60%" aria-invalid={!citeOk} />
            {!citeOk && <div className="err">Enter at least {MIN_CITATION} characters naming the source.</div>}
          </Field>
        )}
        <Field label="Reason code (required)"><select value={reason} onChange={(e) => setReason(e.target.value as Override['reason'])}>{REASONS.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Note"><textarea style={{ minHeight: 70 }} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <button className="btn pri" disabled={!citeOk} onClick={() => onSave(to, reason, note, needCite ? citation.trim() : undefined)}>Save override and log</button>
      </div>
    </Modal>
  );
}
