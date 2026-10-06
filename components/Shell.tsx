'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AGENT_QUOTA, ROLE_INFO, useApp } from '@/lib/store';
import { TODAY } from '@/lib/data';
import { addDays } from '@/lib/expiry';
import { MODE_INFO } from '@/lib/rollout';
import { tourProgress } from '@/lib/tour';
import { daysBetween } from '@/lib/engine';
import { Field } from '@/components/ui';
import type { Role } from '@/lib/types';

const NAV: { href: string; label: string; icon: string; group: string }[] = [
  { href: '/', label: 'EHR schedule', icon: '▦', group: 'Clinician' },
  { href: '/worklist', label: 'Coordinator worklist', icon: '☰', group: 'Research team' },
  { href: '/trials', label: 'Trial cohort pre-screen', icon: '◎', group: 'Research team' },
  { href: '/admin/criteria', label: 'Criteria review', icon: '✎', group: 'Admin' },
  { href: '/monitoring', label: 'Monitoring & trial sync', icon: '↻', group: 'Admin' },
  { href: '/audit', label: 'Audit log', icon: '§', group: 'Governance' },
  { href: '/metrics', label: 'Metrics & readiness', icon: '▲', group: 'Governance' },
  { href: '/eval', label: 'Eval harness', icon: '✓', group: 'Quality and safety' },
  { href: '/guardrails', label: 'Guardrail lab', icon: '⛨', group: 'Quality and safety' },
  { href: '/rollout', label: 'Rollout modes', icon: '⇄', group: 'Quality and safety' },
  { href: '/ops', label: 'Ops dashboard', icon: '◔', group: 'Quality and safety' },
  { href: '/tour', label: 'Guided tour', icon: '➜', group: 'Demo' },
];

function SimPanel() {
  const { s, setSim, simLab, simReport, simTrial, reset, fillQuota, quotaLeft } = useApp();
  const [open, setOpen] = useState(false);
  return (
    <div className="sim">
      {!open ? (
        <button className="btn pri simbtn" style={{ float: 'right' }} onClick={() => setOpen(true)} aria-expanded="false" aria-label="Scenario controls"><span aria-hidden="true">⚙</span><span className="hide-sm"> Scenario controls</span></button>
      ) : (
        <div className="card" role="region" aria-label="Scenario controls">
          <div className="row between"><b>Scenario controls</b><button className="btn sm" onClick={() => setOpen(false)}>Hide</button></div>
          <p className="muted small">Force the failure and event paths from the PRD.</p>
          <div className="col">
            <Field label="Agent service">
              <select value={s.sim.agent} onChange={(e) => setSim({ agent: e.target.value as 'normal' })}>
                <option value="normal">Normal</option><option value="timeout">Times out mid-run</option><option value="down">Down (engine-only fallback)</option>
              </select>
            </Field>
            <Field label="EHR / FHIR">
              <select value={s.sim.ehr} onChange={(e) => setSim({ ehr: e.target.value as 'normal' })}>
                <option value="normal">Normal</option><option value="slow">Rate-limited (slow)</option><option value="down">Unavailable (no partial results)</option>
              </select>
            </Field>
            <label className="row" style={{ margin: 0 }}><input type="checkbox" style={{ width: 'auto' }} checked={s.sim.rollback} onChange={(e) => setSim({ rollback: e.target.checked })} /> Roll back to the previous rule set and prompt</label>
            <label className="row" style={{ margin: 0 }}><input type="checkbox" style={{ width: 'auto' }} checked={s.sim.regression} onChange={(e) => setSim({ regression: e.target.checked })} /> Drill: PD-L1 extraction silently breaks</label>
            <div className="row wrap">
              <button className="btn sm" onClick={simLab}>New lab arrives</button>
              <button className="btn sm" onClick={simReport}>New report arrives</button>
              <button className="btn sm" onClick={simTrial}>New trial opens</button>
            </div>
            <div className="row wrap">
              <button className="btn sm" onClick={fillQuota}>Use up my agent quota</button>
              <span className="muted small">{quotaLeft} of {AGENT_QUOTA} runs left</span>
            </div>
            <button className="btn sm dng" onClick={() => { if (confirm('Reset all demo state (overrides, referrals, audit log)?')) reset(); }}>Reset demo data</button>
          </div>
        </div>
      )}
    </div>
  );
}

function TimeTravel() {
  const { s, setQueryDate } = useApp();
  const [open, setOpen] = useState(false);
  const offset = daysBetween(TODAY, s.queryDate);
  const [local, setLocal] = useState(offset);
  useEffect(() => setLocal(offset), [offset]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const out = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', out);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc); };
  }, [open]);
  const commit = (n: number) => setQueryDate(addDays(TODAY, Math.max(-14, Math.min(90, n))));
  const sim = s.queryDate !== TODAY;
  return (
    <div className="pop" ref={ref}>
      <button className={`chip ${sim ? 'sim' : 'brand'}`} style={{ border: 0, cursor: 'pointer' }} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
        ⏱ {sim ? `Simulated ${s.queryDate} (${offset > 0 ? '+' : ''}${offset} d)` : `Evidence as of ${TODAY}`}
      </button>
      {open && (
        <div className="popbox card" role="dialog" aria-label="Time travel">
          <b>Time travel</b>
          <p className="muted small" style={{ margin: '4px 0 8px' }}>Every result is evaluated as of this date. Lab windows age, and anything dated after it does not exist yet.</p>
          <input type="range" min={-14} max={90} step={1} value={local} aria-label="Days from today" onChange={(e) => setLocal(Number(e.target.value))} onMouseUp={() => commit(local)} onTouchEnd={() => commit(local)} onKeyUp={() => commit(local)} />
          <div className="row between small"><span>{addDays(TODAY, local)}</span><span className="muted">{local > 0 ? '+' : ''}{local} days</span></div>
          <div className="row wrap" style={{ marginTop: 8 }}>
            {[-7, 7, 14, 30].map((n) => <button key={n} className="btn sm" onClick={() => commit(offset + n)}>{n > 0 ? '+' : ''}{n} d</button>)}
            <button className="btn sm pri" disabled={!sim} onClick={() => commit(0)}>Reset</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { s, setRole, versions, ready } = useApp();
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [path]);
  const groups = Array.from(new Set(NAV.map((n) => n.group)));
  const onPatient = path.startsWith('/patient');
  const sims = [s.sim.agent !== 'normal' && `agent ${s.sim.agent === 'down' ? 'down' : 'times out'}`, s.sim.ehr !== 'normal' && `EHR ${s.sim.ehr === 'down' ? 'down' : 'slow'}`, s.sim.regression && 'PD-L1 extraction broken'].filter(Boolean) as string[];
  const tour = tourProgress(s);
  return (
    <div className="shell">
      <a className="skip" href="#content">Skip to content</a>
      <aside id="primary-nav" className={`side ${menu ? 'open' : ''}`} aria-label="Primary">
        <div className="brand"><span className="logo">CT</span> Trial Match</div>
        <div className="muted small" style={{ marginBottom: 10 }}>Mockup · synthetic data only</div>
        <nav className="nav">
          {groups.map((g) => (
            <div key={g}>
              <div className="hd">{g}</div>
              {NAV.filter((n) => n.group === g).map((n) => {
                const on = n.href === '/' ? path === '/' || onPatient : path.startsWith(n.href);
                return <Link key={n.href} href={n.href} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}><span aria-hidden="true">{n.icon}</span>{n.label}</Link>;
              })}
            </div>
          ))}
        </nav>
        <p className="muted small" style={{ marginTop: 18 }}>Screening aid only. Formal eligibility is confirmed by the trial team per protocol.</p>
      </aside>
      <main className="main" id="content">
        <div className="top">
          <button className="btn sm menu-btn" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-controls="primary-nav">☰ Menu</button>
          <div className="grow row wrap">
            <TimeTravel />
            <Link href="/rollout" className="chip gray hide-sm" title="Rollout mode (PRD section 9)">Mode: {MODE_INFO[s.mode].label}</Link>
            {tour.done < tour.total && <Link href="/tour" className="chip brand hide-sm">Tour {tour.done}/{tour.total} →</Link>}
            <span className="chip gray hide-sm" title="Every result is stamped with these versions">{versions.rules} · {versions.prompt}</span>
            {s.sim.rollback && <span className="chip review">Rolled back</span>}
            {sims.map((x) => <span key={x} className="chip sim" title="A scenario control is active">Scenario: {x}</span>)}
          </div>
          <div className="row rolebox">
            <label style={{ margin: 0 }} htmlFor="role">Demo role</label>
            <select id="role" value={s.role} onChange={(e) => setRole(e.target.value as Role)}>
              {(Object.keys(ROLE_INFO) as Role[]).map((r) => <option key={r} value={r}>{ROLE_INFO[r].title} · {ROLE_INFO[r].name}</option>)}
            </select>
          </div>
        </div>
        {s.sim.rollback && <div className="banner rev"><div><b>Rollback active.</b> Results below were produced with {versions.rules} / {versions.prompt}. Anything created under the newer version is flagged for re-run in the coordinator worklist.</div></div>}
        {ready ? children : <div className="skel" />}
      </main>
      <SimPanel />
    </div>
  );
}
