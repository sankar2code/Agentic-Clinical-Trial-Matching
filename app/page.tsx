'use client';
import Link from 'next/link';
import { FACT_LABEL, PATIENTS, TODAY, TRIALS } from '@/lib/data';
import { expiryAlerts } from '@/lib/expiry';
import { amendedSince } from '@/lib/amendments';
import { matchAll, undismissed } from '@/lib/engine';
import { PERM_HINT, ROLE_INFO, useApp } from '@/lib/store';
import { Banner, DraftEditor, Sec } from '@/components/ui';

export default function Home() {
  const { s, trials, mctx, can, decideReferral, editReferral, shadowHidden: hidden } = useApp();
  const pending = s.referrals.filter((r) => r.status === 'draft');
  const alerts = hidden ? [] : expiryAlerts(PATIENTS, trials, mctx(), s.queryDate, 7, s.dismissals);
  return (
    <div>
      <h1>EHR schedule</h1>
      <p className="muted">Simulated EHR landing page. The Trial Match panel launches in the patient chart via SMART on FHIR, so the clinician never leaves the EHR. Signed in as <b>{ROLE_INFO[s.role].name}</b> ({ROLE_INFO[s.role].title}).</p>
      <Banner tone="info">Each patient below demonstrates a different scenario from the PRD. Use <b>Scenario controls</b> (bottom right) to force agent failures, EHR outages, new labs, new trials and rollbacks. New here? Take the <Link href="/tour">guided tour</Link>: 21 steps, each one ticking itself as you do it.</Banner>

      {s.queryDate !== TODAY && <Banner tone="warn"><b>Simulated date {s.queryDate}.</b> Every result is evaluated as of this date, and decisions (overrides, approvals, adjudication, drafts) are paused until you reset it from the date chip in the top bar.</Banner>}
      {hidden && <Banner tone="rev"><b>Shadow mode.</b> The system is running and logging, but its results are hidden from clinicians and coordinators while it is compared against manual screening.</Banner>}

      {alerts.length > 0 && (
        <>
          <Sec title="Evidence expiring or expired" count={alerts.length} note="On trials the patient could still join" />
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Patient</th><th>Evidence</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>{alerts.slice(0, 8).map((a) => (
                <tr key={a.patientId + a.fact}>
                  <td><Link href={`/patient/${a.patientId}/trials`}><b>{a.patientName}</b></Link></td>
                  <td>{FACT_LABEL[a.fact]}<div className="small muted">{a.trials.join(', ')}</div></td>
                  <td><span className={`chip ${a.expired ? 'notmet' : a.daysLeft <= 3 ? 'notmet' : 'unknown'}`}>{a.expired ? `expired ${-a.daysLeft} d ago` : `${a.daysLeft} d left`}</span></td>
                  <td className="small">{a.action}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </>
      )}

      {pending.length > 0 && (
        <>
          <Sec title="Drafts awaiting approval" count={pending.length} note="Nothing leaves the system until a clinician approves" />
          <div className="col">
            {pending.map((r) => {
              const p = PATIENTS.find((x) => x.id === r.patientId)!;
              const t = TRIALS.find((x) => x.id === r.trialId)!;
              return (
                <div className="card" key={r.id}>
                  <div className="row between wrap">
                    <div><span className={`chip ${r.kind === 'referral' ? 'brand' : 'review'}`}>{r.kind === 'referral' ? 'Referral to coordinator' : `Records request: ${r.fact ? FACT_LABEL[r.fact] : ''}`}</span> <b>{p.name}</b> · {t.code}</div>
                    <Link href={`/patient/${p.id}/trials/${t.id}`} className="small">Open trial</Link>
                  </div>
                  <p className="muted small" style={{ margin: '4px 0 8px' }}>Requested by {r.requestedBy} · drafted under {r.versions}</p>
                  {r.kind === 'referral' && amendedSince(r, s.amendments).length > 0 && <Banner tone="warn"><b>The protocol was amended after this draft was written</b> ({amendedSince(r, s.amendments).join(', ')}). Its criteria counts describe the old rules. Reject it and draft it again before approving.</Banner>}
                  <DraftEditor label={`Draft for ${p.name}`} value={r.body} disabled={!can('approveReferral')} onCommit={(v) => editReferral(r.id, v)} />
                  <div className="row" style={{ marginTop: 8 }}>
                    <button className="btn pri" disabled={!can('approveReferral')} title={can('approveReferral') ? '' : PERM_HINT.approveReferral} onClick={() => decideReferral(r.id, 'approved')}>{r.kind === 'referral' ? 'Approve and send to coordinator' : 'Approve and send request'}</button>
                    <button className="btn dng" disabled={!can('approveReferral')} onClick={() => decideReferral(r.id, 'rejected')}>Reject</button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <Sec title="Today’s patients" count={PATIENTS.length} />
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Patient</th><th>Visit</th><th>Matches</th><th>Scenario shown</th><th /></tr></thead>
          <tbody>
            {PATIENTS.map((p) => {
              const m = p.treating && !hidden ? undismissed(matchAll(p, trials, mctx()), s.dismissals, p.id) : [];
              const e = m.filter((x) => x.state === 'eligible').length;
              const n = m.filter((x) => x.state === 'near').length;
              return (
                <tr key={p.id}>
                  <td><b>{p.name}</b><div className="muted small">{p.age}{p.sex} · MRN {p.mrn} · {p.language}</div><div className="small">{p.headline}</div></td>
                  <td className="small">{p.visit}</td>
                  <td><div className="col" style={{ gap: 4 }}>{hidden ? <span className="chip gray">hidden in shadow mode</span> : p.treating ? (<>{e > 0 && <span className="chip eligible">{e} likely eligible</span>}{n > 0 && <span className="chip near">{n} near-eligible</span>}{e + n === 0 && <span className="chip gray">no match</span>}</>) : <span className="chip gray">🔒 restricted</span>}</div></td>
                  <td className="small"><div>{p.tags.map((tg) => <span className="tag" key={tg}>{tg}</span>)}</div><span className="muted">{p.scenario}</span></td>
                  <td><Link className="btn pri sm" href={`/launch?patient=${p.id}`}>Open Trial Match</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small" style={{ marginTop: 10 }}>{trials.length} trials loaded. Personalisation is deliberately minimal: saved trial watchlists only, with no per-user model adaptation. A default disease filter will matter once more disease groups join the thoracic pilot.</p>
    </div>
  );
}
