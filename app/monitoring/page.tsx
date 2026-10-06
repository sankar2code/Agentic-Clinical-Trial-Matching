'use client';
import Link from 'next/link';
import { PATIENTS, TODAY, TRIALS, ago } from '@/lib/data';
import { AMENDMENTS, amendedSince, describeAmendment } from '@/lib/amendments';
import { describeRule } from '@/lib/engine';
import { PERM_HINT, useApp } from '@/lib/store';
import { Banner, Bar, Sec } from '@/components/ui';

export default function Monitoring() {
  const { s, trials, simLab, simReport, simTrial, applyNextAmendment, can, shadowHidden } = useApp();
  const waiting = AMENDMENTS.filter((a) => !s.amendments.some((x) => x.id === a.id));
  const flagged = s.referrals.filter((r) => r.kind === 'referral' && r.status !== 'rejected').filter((r) => amendedSince(r, s.amendments).length > 0);
  const ev = [...s.events].reverse();
  return (
    <div>
      <h1>Monitoring and trial sync</h1>
      <p className="muted">Trials sync nightly from ClinicalTrials.gov, with site status and enrollment from the institution’s trial management system. P2 feature: re-screen patients when a new trial opens or a new lab or report arrives.</p>

      <Sec title="Trial ingestion" count={trials.length} note={`Last sync ${TODAY} 02:00 · next ${ago(-1)} 02:00`} />
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Trial</th><th>ClinicalTrials.gov</th><th>Trial management system</th><th>Enrollment</th><th>Rules</th></tr></thead>
          <tbody>
            {trials.map((t) => {
              const approved = t.criteria.filter((c) => c.review === 'approved').length;
              const conf = Math.round((t.criteria.reduce((a, c) => a + c.parseConfidence, 0) / t.criteria.length) * 100);
              return (
                <tr key={t.id}>
                  <td><b>{t.code}</b>{t.amendments?.length ? <span className="chip review" style={{ marginLeft: 6 }}>Amended {t.amendments.join(', ')}</span> : null}<div className="small muted">{t.nct} · {t.phase}</div></td>
                  <td className="small"><span className={`chip ${t.status === 'Recruiting' ? 'met' : 'unknown'}`}>{t.status}</span><div className="muted">{t.criteria.length} criteria parsed · {conf}% mean parse confidence</div></td>
                  <td className="small"><span className={`chip ${t.siteStatus === 'Open' ? 'met' : 'unknown'}`}>Site {t.siteStatus.toLowerCase()}</span>{t.siteMiles > 0 && <div className="muted">satellite, {t.siteMiles} mi</div>}</td>
                  <td style={{ minWidth: 120 }}><div className="small">{t.enrolled}/{t.target}</div><Bar v={t.enrolled / t.target} /></td>
                  <td className="small"><span className={`chip ${approved === t.criteria.length ? 'met' : 'pending'}`}>{approved}/{t.criteria.length} approved</span>{approved < t.criteria.length && <div><Link href="/admin/criteria">Review</Link></div>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Sec title="Nightly sync and protocol amendments" note={`${waiting.length} waiting on ClinicalTrials.gov · ${s.amendments.length} applied`} />
      <div className="card">
        <div className="row between wrap">
          <div><b>Run the nightly sync</b><div className="small muted">Pulls the next trial record update. A changed criterion goes back to review under a new id and is not evaluated until a reviewer approves it, so no one stays likely eligible on a rule that no longer exists.</div></div>
          <button className="btn pri" disabled={waiting.length === 0 || !can('sync')} title={can('sync') ? '' : PERM_HINT.sync} onClick={applyNextAmendment}>{waiting.length ? `Sync next update (${waiting[0].id}: ${TRIALS.find((x) => x.id === waiting[0].trialId)?.code})` : 'Up to date'}</button>
        </div>
      </div>
      {s.amendments.map((ap) => {
        const a = AMENDMENTS.find((x) => x.id === ap.id)!;
        const base = TRIALS.find((x) => x.id === a.trialId)!;
        const rows = describeAmendment(base, a);
        return (
          <div className="card" key={a.id} style={{ marginTop: 10 }}>
            <div className="row between wrap"><div className="row wrap"><b>{base.code}</b><span className="chip review">{a.id} · {a.version}</span><span className={`chip ${a.effect === 'widens' ? 'met' : 'unknown'}`}>{a.effect} the population</span></div><span className="small muted">posted {a.postedOn} · {a.source}</span></div>
            <p className="small" style={{ margin: '6px 0' }}>{a.summary}</p>
            <table>
              <thead><tr><th style={{ width: '48%' }}>Before</th><th>After</th></tr></thead>
              <tbody>{rows.map((r, i) => (
                <tr key={i}><td>{r.before ? <><div>{r.before.text}</div><div className="mono muted">{describeRule(r.before.rule)}</div></> : <span className="muted">—</span>}</td>
                  <td>{r.after ? <><div><b>{r.after.text}</b></div><div className="mono muted">{describeRule(r.after.rule)}</div></> : <span className="muted">Removed</span>}</td></tr>))}</tbody>
            </table>
            <p className="small" style={{ margin: '8px 0 0' }}>The new rules are waiting in <Link href="/admin/criteria">Criteria review</Link>. Each shows its impact on the cohort before you approve it.</p>
          </div>
        );
      })}
      {flagged.length > 0 && (
        <Banner tone="warn"><b>{flagged.length} referral{flagged.length > 1 ? 's were' : ' was'} written under the old protocol:</b> {flagged.map((r) => `${PATIENTS.find((p) => p.id === r.patientId)?.name} → ${TRIALS.find((x) => x.id === r.trialId)?.code}`).join('; ')}. Approved ones go back to the coordinator to re-confirm on the <Link href="/worklist">worklist</Link>; drafts need to be written again before they are approved.</Banner>
      )}

      <Sec title="Fire an event" />
      <div className="gridc">
        <div className="card"><h3>New lab result</h3><p className="small muted">eGFR 68 arrives for Robert Alvarez, replacing the stale 41-day-old value.</p><button className="btn pri sm" onClick={simLab} disabled={s.events.some((e) => e.kind === 'lab')}>Send event</button></div>
        <div className="card"><h3>New report scanned</h3><p className="small muted">The Guardant360 report for Priya Raman lands in the chart, resolving the KRAS Unknown.</p><button className="btn pri sm" onClick={simReport} disabled={s.events.some((e) => e.kind === 'report')}>Send event</button></div>
        <div className="card"><h3>New trial opens</h3><p className="small muted">NOVA-SHP2 syncs from ClinicalTrials.gov. Its rules queue for review before anyone can be called eligible.</p><button className="btn pri sm" onClick={simTrial} disabled={s.opened.includes('t9')}>Send event</button></div>
      </div>
      {s.opened.includes('t9') && <Banner tone="rev">NOVA-SHP2 is waiting in <Link href="/admin/criteria">Criteria review</Link>. Approve its rules as the informaticist; each approval re-screens the cohort and lands in the feed below.</Banner>}
      <Sec title="Event feed" count={ev.length} />
      {ev.length === 0 ? <div className="card muted">No events yet.</div> : (
        <div className="col">{ev.map((e) => (
          <div className="card" key={e.id}>
            <div className="row between"><span className="chip brand">{e.kind}</span><span className="small muted">{e.ts.replace('T', ' ').slice(0, 19)}</span></div>
            <p style={{ margin: '6px 0' }}>{e.text}</p>
            {shadowHidden ? (e.diffs.length > 0 && <div className="small muted">Patient-level results are hidden in shadow mode.</div>) : e.diffs.map((d) => <div key={d} className="small"><span className="chip met">re-screen</span> {d}</div>)}
          </div>))}</div>
      )}
      <Sec title="Nightly re-screen budget (planning)" />
      <div className="card small"><b>~5,000</b> active patients × <b>10%</b> with new data = <b>~500</b> re-screens a night at ≤ $0.05 each, about $750 a month. A deterministic pre-filter runs first; unchanged patients cost nothing.</div>
    </div>
  );
}
