'use client';
import Link from 'next/link';
import { TOUR, stepDone, tourProgress } from '@/lib/tour';
import { ROLE_INFO, useApp } from '@/lib/store';
import { Bar, Sec } from '@/components/ui';
import type { Role } from '@/lib/types';

const ACTS = ['At the point of care', 'Trust and safety', 'Running the program', 'Outcomes'] as const;

export default function Tour() {
  const { s, setRole, markTour, reset } = useApp();
  const { done, total } = tourProgress(s);
  const nextStep = TOUR.find((t) => !stepDone(s, t));
  return (
    <div>
      <h1>Guided tour</h1>
      <p className="muted">{total} steps through the product, in the order a PRD reviewer would ask about them. Each step names the role to use, what to do, and what to notice. Steps tick themselves when the app sees you do the thing.</p>
      <div className="card">
        <div className="row between"><b>{done} of {total} done</b>{nextStep ? <Link className="btn pri sm" href={nextStep.href}>Next: {nextStep.title} →</Link> : <span className="chip met">Tour complete</span>}</div>
        <div style={{ marginTop: 8 }}><Bar v={done / total} tone="good" /></div>
      </div>

      {ACTS.map((act) => (
        <div key={act}>
          <Sec title={act} />
          <div className="col">
            {TOUR.filter((t) => t.act === act).map((t) => {
              const ok = stepDone(s, t);
              const wrongRole = s.role !== t.role;
              return (
                <div key={t.id} className="card tourstep">
                  <span className={`dot ${ok ? 'on' : ''}`} aria-label={ok ? 'done' : 'not done'}>{ok ? '✓' : TOUR.indexOf(t) + 1}</span>
                  <div>
                    <div className="row wrap"><b>{t.title}</b><span className="chip gray">{t.prd}</span><span className="chip brand">{ROLE_INFO[t.role as Role].title}</span></div>
                    <p style={{ margin: '4px 0' }}>{t.doThis}</p>
                    <p className="small muted" style={{ margin: 0 }}><b>Notice:</b> {t.look}</p>
                  </div>
                  <div className="col" style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Link className="btn sm pri" href={t.href}>Go</Link>
                    {wrongRole && <button className="btn sm" onClick={() => setRole(t.role)}>Switch to {ROLE_INFO[t.role].title.toLowerCase()}</button>}
                    {!t.done && <button className="btn sm" onClick={() => markTour(t.id, !s.tour[t.id])}>{s.tour[t.id] ? 'Unmark' : 'Mark done'}</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn dng sm" onClick={() => { if (confirm('Reset all demo state, including tour progress?')) reset(); }}>Start over with fresh demo data</button>
      </div>
    </div>
  );
}
