'use client';
import { TOUR, nextStep, stepDone, tourProgress } from '@/lib/tour';
import { ROLE_INFO, useApp } from '@/lib/store';
import { useGuide } from '@/components/TourGuide';
import { Bar, Sec } from '@/components/ui';
import type { Role } from '@/lib/types';

const ACTS = ['At the point of care', 'Trust and safety', 'Running the program', 'Outcomes'] as const;

export default function Tour() {
  const { s, markTour, reset } = useApp();
  const { start } = useGuide();
  const { done, total } = tourProgress(s);
  const upNext = nextStep(s);
  return (
    <div>
      <h1>Guided tour</h1>
      <p className="muted">{total} steps through the product, in the order a PRD reviewer would ask about them. The guide opens each page for you, switches to the right role, rings the exact control to use, and moves on as soon as the app sees you do it. Most steps take one or two clicks.</p>
      <div className="card">
        <div className="row between wrap">
          <b>{done} of {total} done</b>
          {upNext ? <button className="btn pri" onClick={() => start(upNext.id)}>{done === 0 ? 'Start the guided tour' : `Resume: ${upNext.title}`} →</button> : <span className="chip met">Tour complete</span>}
        </div>
        <div style={{ marginTop: 8 }}><Bar v={done / total} tone="good" /></div>
        <p className="small muted" style={{ margin: '8px 0 0' }}>You can pause the guide at any time with ✕ and pick it up again from the top bar.</p>
      </div>

      {ACTS.map((act) => (
        <div key={act}>
          <Sec title={act} />
          <div className="col">
            {TOUR.filter((t) => t.act === act).map((t) => {
              const ok = stepDone(s, t);
              return (
                <div key={t.id} className="card tourstep">
                  <span className={`dot ${ok ? 'on' : ''}`} aria-label={ok ? 'done' : 'not done'}>{ok ? '✓' : TOUR.indexOf(t) + 1}</span>
                  <div>
                    <div className="row wrap"><b>{t.title}</b><span className="chip gray">{t.prd}</span><span className="chip brand">{ROLE_INFO[t.role as Role].title}</span></div>
                    <p style={{ margin: '4px 0' }}>{t.doThis}</p>
                    <p className="small muted" style={{ margin: 0 }}><b>Notice:</b> {t.look}</p>
                  </div>
                  <div className="col" style={{ alignItems: 'flex-end', gap: 4 }}>
                    <button className="btn sm pri" onClick={() => start(t.id)}>{ok ? 'Show me again' : 'Guide me'}</button>
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
