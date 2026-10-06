'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { PATIENTS } from '@/lib/data';
import { isDismissed, matchTrial } from '@/lib/engine';
import { funnel } from '@/lib/funnel';
import { draftReferralText } from '@/lib/agent';
import { useApp } from '@/lib/store';
import { Banner, Bar, Sec, StateChip } from '@/components/ui';

export default function Cohort() {
  const { s, trials, mctx, can, draft, versionStamp, markTour, paused, shadowHidden } = useApp();
  useEffect(() => { markTour('funnel'); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [tid, setTid] = useState('t1');
  const t = trials.find((x) => x.id === tid) ?? trials[0];
  const rows = shadowHidden ? [] : PATIENTS.filter((p) => p.treating).map((p) => ({ p, m: matchTrial(p, t, mctx()), gone: isDismissed(s.dismissals, p.id, t.id) })).sort((a, b) => b.m.rank - a.m.rank);
  const likely = rows.filter((r) => r.m.state === 'eligible' && !r.gone).length;
  const fx = useMemo(() => funnel(t, PATIENTS, mctx(), s.referrals, s.queryDate, s.dismissals), [t, s.overlay, s.overrides, s.referrals, s.queryDate, s.sim.regression, s.dismissals]); // eslint-disable-line react-hooks/exhaustive-deps
  const risk = useMemo(() => trials.map((x) => ({ x, f: funnel(x, PATIENTS, mctx(), s.referrals, s.queryDate, s.dismissals).forecast })).filter((r) => r.f.status === 'under-enrolling' || r.f.status === 'at-risk'), [trials, s.overlay, s.overrides, s.referrals, s.queryDate, s.sim.regression, s.dismissals]); // eslint-disable-line react-hooks/exhaustive-deps
  const top = Math.max(1, ...fx.stages.map((x) => x.n));
  const tone = { 'on-track': 'met', 'at-risk': 'unknown', 'under-enrolling': 'notmet', full: 'gray', paused: 'gray' } as const;
  return (
    <div>
      <h1>Trial cohort pre-screen</h1>
      <p className="muted">Trial-centric view for the PI: find patients for an under-enrolling trial.</p>
      {shadowHidden && <Banner tone="rev"><b>Shadow mode.</b> This page is built from the system’s per-patient results, which are hidden from clinicians and coordinators while it is compared against manual screening. Trial sizes and targets are still shown.</Banner>}
      {!shadowHidden && risk.length > 0 && <Banner tone="warn"><b>{risk.length} trial{risk.length > 1 ? 's are' : ' is'} on course to miss target before accrual closes:</b> {risk.map((r) => `${r.x.code} (short by about ${Math.round(r.f.shortfall)})`).join('; ')}.</Banner>}
      <div className="grid-cohort">
        <div className="col">
          {trials.map((x) => (
            <button key={x.id} className="card tight" style={{ textAlign: 'left', cursor: 'pointer', borderColor: x.id === t.id ? 'var(--brand)' : undefined }} onClick={() => setTid(x.id)}>
              <div className="row between"><b>{x.code}</b><span className="small muted">{x.enrolled}/{x.target}</span></div>
              <Bar v={x.enrolled / x.target} tone={x.enrolled / x.target < 0.3 ? 'warn' : ''} />
              <div className="small muted">{x.status}{x.siteStatus !== 'Open' ? ` · ${x.siteStatus}` : ''}{x.hiddenUntilOpened ? ' · new' : ''}</div>
            </button>
          ))}
        </div>
        <div>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="row between wrap"><div><h2 style={{ margin: 0 }}>{t.code}</h2><div className="muted small">{t.title}</div></div>
              <div className="col" style={{ alignItems: 'flex-end', gap: 2 }}>{!shadowHidden && <span className="kpi">{likely}</span>}<span className="small muted">{shadowHidden ? '' : 'likely eligible · '}gap to target {t.target - t.enrolled}</span></div></div>
          </div>
          {!shadowHidden && <>
          <Sec title="Enrollment funnel" note={`${t.code} · as of ${s.queryDate}`} />
          <div className="card" style={{ marginBottom: 12 }}>
            {fx.stages.map((st) => (
              <div className="funnelrow" key={st.id}>
                <span className="small">{st.label}{st.note && <span className="muted"> · {st.note}</span>}</span>
                <div className="bar tall"><i style={{ width: `${(st.n / top) * 100}%` }} /></div>
                <b style={{ textAlign: 'right' }}>{st.n}</b>
              </div>
            ))}
          </div>
          <div className="gridc" style={{ marginBottom: 12 }}>
            <div className="card"><div className="muted small">Forecast</div><div className="row" style={{ marginTop: 4 }}><span className={`chip ${tone[fx.forecast.status]}`}>{fx.forecast.status}</span></div><div className="small muted" style={{ marginTop: 6 }}>Closes {fx.forecast.closesOn} · {fx.forecast.monthsLeft} months left</div></div>
            <div className="card"><div className="muted small">Still needed</div><div className="kpi">{fx.forecast.remaining}</div><div className="small muted">at {fx.forecast.pace} a month the site projects {fx.forecast.projected} more</div></div>
            <div className="card"><div className="muted small">Projected shortfall</div><div className="kpi">{Math.round(fx.forecast.shortfall)}</div><div className="small muted">needs about {fx.forecast.needPerMonth} a month to close the gap</div></div>
            <div className="card"><div className="muted small">Current pipeline is worth</div><div className="kpi">~{fx.forecast.pipelineYield}</div><div className="small muted">enrollments at historical conversion (35% likely, 15% near); {Math.round(fx.forecast.afterPipeline)} still short</div></div>
          </div>
          {t.criteria.some((c) => c.review !== 'approved') && <Banner tone="rev">Some rules for this trial are not approved yet. Patients can be at most near-eligible until the informaticist approves them.</Banner>}
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Patient</th><th>State</th><th>Fit</th><th>Blocking / open</th><th /></tr></thead>
              <tbody>
                {rows.map(({ p, m, gone }) => (
                  <tr key={p.id} style={gone ? { opacity: 0.6 } : undefined}>
                    <td><Link href={`/patient/${p.id}/trials/${t.id}`}><b>{p.name}</b></Link><div className="small muted">{p.mrn}</div></td>
                    <td><StateChip s={m.state} />{gone && <div className="chip gray">dismissed by clinician</div>}{m.siteFull && <div className="chip unknown">site full</div>}</td>
                    <td style={{ width: 120 }}>{Math.round(m.fit * 100)}%<Bar v={m.fit} /></td>
                    <td className="small">{m.filterReason ?? (m.blockers[0] ? `Blocked: ${m.blockers[0]}` : m.results.filter((r) => ['unknown', 'review', 'pending'].includes(r.status)).map((r) => r.criterion.text)[0] ?? 'None')}</td>
                    <td>{!gone && (m.state === 'eligible' || m.state === 'near') && (s.referrals.some((r) => r.patientId === p.id && r.trialId === t.id && r.kind === 'referral' && r.status !== 'rejected') ? <span className="chip gray">{s.referrals.find((r) => r.patientId === p.id && r.trialId === t.id && r.kind === 'referral' && r.status !== 'rejected')?.status}</span> : <button className="btn sm" disabled={paused || !(can('worklist') || s.role === 'pi')} title={paused ? 'Drafts are paused while the date is simulated' : ''} onClick={() => draft(p.id, t.id, draftReferralText(p, m, versionStamp))}>Request referral</button>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>Requests create a draft for the treating clinician; nothing is sent to the patient or coordinator until approved. Patients the treating clinician dismissed for this trial are left out of the pipeline.</p>
          </>}
        </div>
      </div>
    </div>
  );
}
