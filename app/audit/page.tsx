'use client';
import Link from 'next/link';
import { Fragment, useMemo, useState } from 'react';
import { FACT_LABEL, PATIENTS, TRIALS } from '@/lib/data';
import { verifyChain } from '@/lib/chain';
import { csvCell } from '@/lib/csv';
import { replaySnapshot, statusWord } from '@/lib/replay';
import { PERM_HINT, useApp } from '@/lib/store';
import { Banner, Field, Modal } from '@/components/ui';
import type { AuditEntry } from '@/lib/types';

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Audit() {
  const { s, trials, can, log, anchorNow, tamperAudit, undoTamper, markTour, fullStamp } = useApp();
  const [f, setF] = useState('');
  const [pid, setPid] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [replayOf, setReplayOf] = useState<AuditEntry | null>(null);
  const [target, setTarget] = useState(3);
  const [text, setText] = useState('Nothing of note happened here.');

  const v = useMemo(() => verifyChain(s.audit, s.anchors), [s.audit, s.anchors]);
  const rows = useMemo(() => s.audit.filter((e) => (!pid || e.patientId === pid) && (!f || (e.action + e.detail + e.actor).toLowerCase().includes(f.toLowerCase()))).slice().reverse(), [s.audit, f, pid]);
  const csv = ['id,ts,actor,role,action,patient,trial,detail,versions,evidence_rows,hash', ...s.audit.map((e) => [e.id, e.ts, e.actor, e.role, e.action, e.patientId ?? '', e.trialId ?? '', e.detail, e.versions, e.snapshot?.rows.length ?? 0, e.hash ?? ''].map(csvCell).join(','))].join('\n');
  const name = (e: AuditEntry) => `${PATIENTS.find((p) => p.id === e.patientId)?.name ?? ''}${e.trialId ? ` · ${TRIALS.find((t) => t.id === e.trialId)?.code}` : ''}`;
  const brokenId = v.broken?.id;
  const replay = replayOf ? replaySnapshot(replayOf, PATIENTS.find((p) => p.id === replayOf.patientId)!, trials, s.overlay, s.overrides) : null;

  return (
    <div>
      <h1>Audit log</h1>
      <p className="muted">Append-only record of every result, its evidence pointers, the versions that produced it, and every human action. Each entry carries a SHA-256 hash that covers the entry before it, so editing any earlier entry is detectable.</p>

      <div className="card" style={{ marginBottom: 14, borderColor: v.ok ? undefined : 'var(--not)' }}>
        <div className="row between wrap">
          <div className="row wrap"><h2 style={{ margin: 0 }}>Integrity</h2><span className={`seal ${v.ok ? 'ok' : 'bad'}`}>{v.ok ? `Chain intact · ${v.checked} entries verified` : 'INTEGRITY FAILURE'}</span></div>
          <div className="row wrap">
            <button className="btn pri sm" disabled={!can('integrity')} title={can('integrity') ? '' : PERM_HINT.integrity} onClick={() => { log('audit.verify', v.ok ? `Verified the chain: ${v.checked} entries intact.` : `Verification FAILED at entry ${v.broken?.id ?? 'anchor'}.`); markTour('chain'); }}>Verify and record</button>
            <button className="btn sm" disabled={!can('integrity') || s.audit.length === 0 || !!s.tamper} onClick={anchorNow} title={!can('integrity') ? PERM_HINT.integrity : s.tamper ? 'Undo the tampering first: an anchor of a tampered log would certify the tampering' : 'Write the current head hash to write-once storage'}>Anchor the head</button>
          </div>
        </div>
        <p className="mono-box muted" style={{ margin: '8px 0 4px' }}>Head: {v.head}</p>
        <p className="small muted" style={{ margin: 0 }}>{s.anchors.length ? `Anchored at entries ${s.anchors.map((a) => a.count).join(', ')}.` : 'No anchor yet. An anchor is the head hash copied to storage the logger cannot rewrite.'} In production the anchor lives outside this system; here it is kept in the same browser, so it demonstrates the mechanism rather than real protection.</p>
        {!v.ok && v.broken && <Banner tone="bad"><b>Entry {v.broken.id}: {v.broken.reason}.</b> {v.broken.detail} {v.unverifiable} later entr{v.unverifiable === 1 ? 'y is' : 'ies are'} unverifiable, because their own hashes rest on this one.</Banner>}
        {v.anchorFailures.map((a) => <Banner key={a.count} tone="bad"><b>Anchor check failed.</b> {a.detail}</Banner>)}

        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Attacker simulation (demo only)</summary>
          <p className="muted small">Pretend to be someone with write access to the stored log. Edit a single entry, or rewrite history and recompute every hash so the chain still looks valid. Then watch what the integrity check says.</p>
          {s.tamper ? (
            <div className="row wrap"><span className="chip notmet">Tampered: entry {s.tamper.id} ({s.tamper.kind === 'edit' ? 'edited in place' : 'history rewritten'})</span><button className="btn sm" onClick={undoTamper}>Undo tampering</button></div>
          ) : (
            <div className="row wrap" style={{ alignItems: 'flex-end' }}>
              <div style={{ width: 120 }}><Field label="Entry number"><input type="number" min={1} max={s.audit.length} value={target} onChange={(e) => setTarget(Number(e.target.value))} /></Field></div>
              <div style={{ width: 320 }}><Field label="Rewrite its detail as"><input value={text} onChange={(e) => setText(e.target.value)} /></Field></div>
              <button className="btn dng sm" disabled={!can('integrity') || target < 1 || target > s.audit.length} onClick={() => tamperAudit(target, 'edit', text)}>Edit one entry</button>
              <button className="btn dng sm" disabled={!can('integrity') || target < 1 || target > s.audit.length} onClick={() => tamperAudit(target, 'rewrite', text)}>Rewrite history and re-hash</button>
            </div>
          )}
          {!can('integrity') && <p className="small muted">{PERM_HINT.integrity}.</p>}
          <p className="small muted" style={{ marginBottom: 0 }}>Try: anchor, then “Rewrite history” on an early entry. The chain still verifies internally, but the anchor exposes it. Then try “Edit one entry” and see the exact entry flagged.</p>
        </details>
      </div>

      <div className="row wrap" style={{ marginBottom: 10 }}>
        <input style={{ maxWidth: 260 }} placeholder="Filter by action, detail, actor" value={f} onChange={(e) => setF(e.target.value)} aria-label="Filter" />
        <select style={{ maxWidth: 200 }} value={pid} onChange={(e) => setPid(e.target.value)} aria-label="Patient"><option value="">All patients</option>{PATIENTS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <span className="grow" />
        <span className="muted small">{rows.length} of {s.audit.length} entries</span>
        <button className="btn sm" disabled={!s.audit.length} onClick={() => download('audit-log.csv', csv, 'text/csv')}>Export CSV</button>
        <button className="btn sm" disabled={!s.audit.length} onClick={() => download('audit-log.json', JSON.stringify(s.audit, null, 2), 'application/json')}>Export JSON</button>
      </div>
      {s.audit.length === 0 ? <Banner tone="info">No events yet. Open a patient, ask the agent, override a criterion or approve a referral, and each action lands here with the model, prompt and rule-set versions.</Banner> : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead><tr><th>#</th><th>Time</th><th>Actor</th><th>Action</th><th>Subject</th><th>Detail</th><th>Versions and hash</th></tr></thead>
            <tbody>{rows.map((e) => {
              const bad = brokenId !== undefined && e.id === brokenId;
              const after = brokenId !== undefined && e.id > brokenId;
              return (
                <Fragment key={e.id}>
                  <tr style={bad ? { background: 'var(--not-bg)' } : after ? { opacity: 0.6 } : undefined}>
                    <td className="mono">{e.id}{bad && <div className="chip notmet">tampered</div>}{after && <div className="chip gray">unverifiable</div>}</td><td className="small">{e.ts.replace('T', ' ').slice(0, 19)}</td>
                    <td className="small">{e.actor}<div className="muted">{e.role}</div></td><td><span className="chip brand">{e.action}</span></td>
                    <td className="small">{name(e)}</td>
                    <td className="small">{e.detail}{e.snapshot && (
                      <div className="row wrap" style={{ marginTop: 4 }}>
                        <button className="btn sm" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? 'Hide results' : `View ${e.snapshot.rows.length} stored results`}</button>
                        <button className="btn sm" onClick={() => { setReplayOf(e); markTour('replay'); }}>Replay under today’s rules</button>
                      </div>)}</td>
                    <td className="mono muted">{e.versions}<div title={e.hash}>#{(e.hash ?? '').slice(0, 10)}…</div></td>
                  </tr>
                  {open === e.id && e.snapshot && (
                    <tr><td colSpan={7}>
                      <div className="card tight snap">
                        <div className="row wrap" style={{ marginBottom: 6 }}>{e.snapshot.trials.map((t) => <span key={t.code} className={`chip ${t.state}`}>{t.code}: {t.state} · {t.met} met, {t.notmet} not met, {t.unknown + t.review + t.pending} open</span>)}</div>
                        <table><thead><tr><th>Trial</th><th>Criterion</th><th>Result</th><th>Evidence pointers</th></tr></thead>
                          <tbody>{e.snapshot.rows.map((r) => <tr key={r.t + r.c}><td>{r.t}</td><td className="mono">{r.c}</td><td>{r.s}</td><td className="mono">{r.e.length ? r.e.join(', ') : 'none'}</td></tr>)}</tbody></table>
                      </div>
                    </td></tr>
                  )}
                </Fragment>);
            })}</tbody>
          </table>
        </div>
      )}

      {replayOf && (
        <Modal title="Replay under today’s rules" onClose={() => setReplayOf(null)}>
          {!replay ? <p>This entry stored no results.</p> : (
            <>
              <p className="muted small">The chart as it was cited in entry {replayOf.id} (as of {replay.asOf}), judged by the rules as they stand now. Rows you overrode are left out.{replayOf.drill?.length ? ` The extraction drill for ${replayOf.drill.map((k) => FACT_LABEL[k]).join(', ')} was switched on when this was recorded, so it is switched on here too.` : ''}</p>
              <div className="small"><b>Then:</b> <span className="mono">{replay.thenVersions}</span><br /><b>Now:</b> <span className="mono">{fullStamp}</span></div>
              {replay.changed.length === 0 && replay.added.length === 0 ? <Banner tone="info"><b>Nothing would change.</b> All {replay.rows.length} stored results come out the same under today’s rules{replay.skippedOverrides ? ` (${replay.skippedOverrides} overridden row(s) skipped)` : ''}.</Banner> : (
                <>
                  <Banner tone="warn"><b>{replay.changed.length} stored result(s) would differ</b>{replay.added.length ? `, and ${replay.added.length} criterion(s) are new` : ''}. Rule edits and protocol amendments since this run are the cause.</Banner>
                  <table><thead><tr><th>Trial</th><th>Criterion</th><th>Then</th><th>Now</th></tr></thead>
                    <tbody>
                      {replay.changed.map((r) => <tr key={r.trial + r.criterionId}><td>{r.trial}</td><td className="small">{r.text}{r.note && <div className="muted">{r.note}</div>}</td><td>{statusWord(r.then)}</td><td><b>{statusWord(r.now)}</b></td></tr>)}
                      {replay.added.map((r) => <tr key={r.trial + r.criterionId + 'n'}><td>{r.trial}</td><td className="small">{r.text}<div className="muted">New criterion</div></td><td>—</td><td><b>{statusWord(r.now)}</b></td></tr>)}
                    </tbody></table>
                </>
              )}
              <p className="small" style={{ marginTop: 10 }}><Link href="/admin/criteria">Open Criteria review</Link></p>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
