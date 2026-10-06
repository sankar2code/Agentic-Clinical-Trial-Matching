'use client';
import Link from 'next/link';
import { useState } from 'react';
import { FACT_LABEL, PATIENTS } from '@/lib/data';
import { amendedSince } from '@/lib/amendments';
import { matchAll } from '@/lib/engine';
import { draftReferralText } from '@/lib/agent';
import { PERM_HINT, useApp } from '@/lib/store';
import { Banner, Sec, StateChip, StatusChip } from '@/components/ui';
import type { Referral } from '@/lib/types';

const STATUSES: Referral['worklist'][] = ['new', 'screening', 'consented', 'declined', 'screen-failed'];

export default function Worklist() {
  const { s, trials, mctx, can, setWorklist, draft, rerunReferral, fullStamp, versionStamp, shadowHidden: hiddenInShadow } = useApp();
  const [tab, setTab] = useState<'ref' | 'wait' | 'cand'>('ref');
  const [open, setOpen] = useState<string | null>(null);
  const approved = s.referrals.filter((r) => r.status === 'approved' && r.kind === 'referral');
  const records = s.referrals.filter((r) => r.status === 'approved' && r.kind === 'records-request');
  const waiting = s.referrals.filter((r) => r.status === 'draft');
  const cands = hiddenInShadow ? [] : PATIENTS.filter((p) => p.treating).flatMap((p) =>
    matchAll(p, trials, mctx()).filter((m) => (m.state === 'eligible' || m.state === 'near') && !s.dismissals[`${p.id}|${m.trial.id}`] && !s.referrals.some((r) => r.patientId === p.id && r.trialId === m.trial.id && r.kind === 'referral' && r.status !== 'rejected')).map((m) => ({ p, m })),
  ).sort((a, b) => b.m.rank - a.m.rank);
  const stale = approved.filter((r) => r.versions !== fullStamp);

  return (
    <div>
      <h1>Coordinator worklist</h1>
      <p className="muted">A prioritised queue with evidence attached, not raw charts. Patients are contacted only through their treating clinician.</p>
      {stale.length > 0 && <Banner tone="rev"><b>{stale.length} referral{stale.length > 1 ? 's were' : ' was'} produced under a different version</b> than the one now in force ({versionStamp}). Re-run each one to confirm the evidence still holds.</Banner>}
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'ref'} className={tab === 'ref' ? 'on' : ''} onClick={() => setTab('ref')}>Approved referrals ({approved.length})</button>
        <button role="tab" aria-selected={tab === 'wait'} className={tab === 'wait' ? 'on' : ''} onClick={() => setTab('wait')}>Awaiting clinician ({waiting.length})</button>
        <button role="tab" aria-selected={tab === 'cand'} className={tab === 'cand' ? 'on' : ''} onClick={() => setTab('cand')}>Pre-screen candidates{hiddenInShadow ? '' : ` (${cands.length})`}</button>
      </div>
      {!can('worklist') && <Banner tone="info">You are viewing as {s.role}. {PERM_HINT.worklist}.</Banner>}

      {tab === 'ref' && (approved.length === 0 ? (
        <div className="card muted">No approved referrals yet. A clinician must approve a drafted referral before it appears here. Try it from a patient’s trial checklist as the oncologist.</div>
      ) : (
        <div className="col">
          {approved.map((r) => {
            const p = PATIENTS.find((x) => x.id === r.patientId)!;
            const t = trials.find((x) => x.id === r.trialId);
            if (!t) return null;
            // In shadow mode the system's current result for this pair is not shown to the coordinator, so it is not even computed.
            const m = hiddenInShadow ? null : matchAll(p, [t], mctx())[0];
            const outdated = r.versions !== fullStamp;
            const amended = amendedSince(r, s.amendments);
            return (
              <div className="card" key={r.id}>
                <div className="row between wrap">
                  <div><b>{p.name}</b> → <b>{t.code}</b> {m && <StateChip s={m.state} />} {m?.siteFull && <span className="chip unknown">site full</span>}</div>
                  <select style={{ width: 160 }} value={r.worklist} disabled={!can('worklist')} onChange={(e) => setWorklist(r.id, e.target.value as Referral['worklist'])} aria-label={`Worklist status for ${p.name}`}>
                    {STATUSES.map((x) => <option key={x}>{x}</option>)}
                  </select>
                </div>
                <div className="row wrap" style={{ margin: '6px 0' }}>{m && <><StatusChip s="met" n={m.counts.met} />{m.counts.unknown > 0 && <StatusChip s="unknown" n={m.counts.unknown} />}{m.counts.review > 0 && <StatusChip s="review" n={m.counts.review} />}{m.counts.notmet > 0 && <StatusChip s="notmet" n={m.counts.notmet} />}</>}
                  <span className="muted small">Approved by {r.decidedBy}{r.edited ? ' (edited)' : ''}</span></div>
                {hiddenInShadow && <p className="small muted" style={{ margin: '0 0 6px' }}>Shadow mode: the system’s current result for this pair is hidden from coordinators.</p>}
                {m?.state === 'ineligible' && <Banner tone="warn">Evidence changed after approval: this patient is now <b>not eligible</b> ({m.blockers[0]}). Re-confirm with the treating clinician.</Banner>}
                {amended.length > 0 && (
                  <div className="banner warn"><div><b>Protocol amended after this referral was written</b> ({amended.join(', ')}). The criteria changed, so re-confirm eligibility under the new rules.{' '}
                    <button className="btn sm" disabled={!can('worklist')} title={can('worklist') ? '' : PERM_HINT.worklist} onClick={() => rerunReferral(r.id)}>Re-confirm</button></div></div>
                )}
                {outdated && (
                  <div className="banner rev"><div>Produced under <span className="mono">{r.versions}</span>; current is <span className="mono">{fullStamp}</span>.{' '}
                    <button className="btn sm" disabled={!can('worklist')} title={can('worklist') ? '' : PERM_HINT.worklist} onClick={() => rerunReferral(r.id)}>Re-run and confirm</button></div></div>
                )}
                <button className="btn sm" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide message' : 'Show message'}</button>{' '}
                <Link href={`/patient/${p.id}/trials/${t.id}`} className="small">Open evidence</Link>
                {open === r.id && <div className="doc" style={{ marginTop: 8 }}>{r.body}</div>}
              </div>
            );
          })}
        </div>
      ))}
      {tab === 'ref' && records.length > 0 && (
        <>
          <Sec title="Records requests sent" count={records.length} />
          <div className="card tight small">{records.map((r) => <div key={r.id}>{PATIENTS.find((x) => x.id === r.patientId)?.name}: external {r.fact ? FACT_LABEL[r.fact] : ''} report requested, approved by {r.decidedBy}</div>)}</div>
        </>
      )}

      {tab === 'wait' && (waiting.length === 0 ? <div className="card muted">Nothing is waiting. Drafts requested by you or the agent appear here until the treating clinician approves or rejects them.</div> : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table><thead><tr><th>Patient</th><th>Draft</th><th>Requested by</th><th>Status</th></tr></thead>
            <tbody>{waiting.map((r) => (
              <tr key={r.id}><td><b>{PATIENTS.find((x) => x.id === r.patientId)?.name}</b></td>
                <td>{r.kind === 'referral' ? `Referral to ${trials.find((t) => t.id === r.trialId)?.code}` : `Records request: ${r.fact ? FACT_LABEL[r.fact] : ''}`}</td>
                <td className="small">{r.requestedBy}</td><td><span className="chip unknown">waiting for the treating clinician</span></td></tr>))}</tbody></table>
        </div>
      ))}

      {tab === 'cand' && hiddenInShadow && <Banner tone="rev"><b>Shadow mode.</b> Pre-screen candidates come from the system’s results, which are hidden from coordinators while it is compared against manual screening.</Banner>}
      {tab === 'cand' && !hiddenInShadow && (
        <>
          <Sec title="Likely-eligible and near-eligible, ranked" note="Request a referral; the treating clinician must approve it" />
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Patient</th><th>Trial</th><th>State</th><th>Open items</th><th /></tr></thead>
              <tbody>
                {cands.map(({ p, m }) => (
                  <tr key={p.id + m.trial.id}>
                    <td><b>{p.name}</b><div className="small muted">{p.mrn}</div></td>
                    <td><b>{m.trial.code}</b>{m.siteFull && <div className="chip unknown">site full</div>}{m.trial.siteMiles > 0 && <div className="chip gray">{m.trial.siteMiles} mi</div>}</td>
                    <td><StateChip s={m.state} /></td>
                    <td className="small">{m.results.filter((r) => ['unknown', 'review', 'pending'].includes(r.status)).map((r) => r.criterion.text).slice(0, 2).join('; ') || 'None'}</td>
                    <td><button className="btn sm" disabled={!can('worklist')} title={can('worklist') ? '' : PERM_HINT.worklist} onClick={() => draft(p.id, m.trial.id, draftReferralText(p, m, versionStamp))}>Request referral</button></td>
                  </tr>
                ))}
                {cands.length === 0 && <tr><td colSpan={5} className="muted">No candidates.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
