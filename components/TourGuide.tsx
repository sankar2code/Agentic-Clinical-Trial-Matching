'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ROLE_INFO, useApp } from '@/lib/store';
import { TOUR, nextStep, samePage, stepDone, tourProgress, tourSel, type TourStep } from '@/lib/tour';

/** How long a finished step stays on screen before the guide moves on by itself. Hovering the card keeps it. */
const ADVANCE_MS = 4500;
/** Breathing room between the highlighted control and the ring drawn around it. */
const PAD = 6;
/** Pages a step passes through on its way, where its controls are briefly absent (the SMART launch handshake). */
const VIA: Record<string, string> = { launch: '/launch' };

/**
 * Starting, moving and pausing the guide. Moving to a step switches to its role and opens its first page, so the person never has
 * to find the page or the role themselves. Leaving a step first puts the demo back as the next one expects (a drill stopped, the
 * date reset, the tampering undone).
 */
export function useGuide() {
  const app = useApp();
  const router = useRouter();
  const path = usePathname();
  // Read at call time, so a timer set several renders ago still acts on the current state and page.
  const live = useRef({ app, path });
  live.current = { app, path };
  const current = app.s.guide.step ? TOUR.find((t) => t.id === app.s.guide.step) ?? null : null;

  const bring = (to: TourStep) => {
    const { app: a, path: p } = live.current;
    if (a.s.role !== to.role) a.setRole(to.role);
    if (!samePage(p, to.start)) router.push(to.start);
  };
  const go = (to: TourStep | null) => {
    const { app: a } = live.current;
    const from = a.s.guide.step ? TOUR.find((t) => t.id === a.s.guide.step) : undefined;
    if (from && from !== to && from.tidy?.when(a.s)) from.tidy.run(a);
    a.setGuide({ on: true, step: to ? to.id : null });
    if (to) bring(to);
  };
  const start = (id?: string) => go(id ? TOUR.find((t) => t.id === id) ?? null : nextStep(live.current.app.s));
  const pause = () => live.current.app.setGuide({ on: false });
  return { current, go, start, pause, bring };
}

/** The first matching element that is actually laid out (a closed tab or a hidden section does not count). */
function findVisible(names: string): HTMLElement | null {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(tourSel(names)))) if (el.getClientRects().length > 0) return el;
  return null;
}

interface Box { top: number; left: number; width: number; height: number }
/** box: the ring. zone: what the card must not cover (the control's dialog, or the controls that come right after it). */
interface View { box: Box | null; zone: Box | null; cue: number }
const EMPTY: View = { box: null, zone: null, cue: -1 };
const sameBox = (a: Box | null, b: Box | null) => a === b || (!!a && !!b && (['top', 'left', 'width', 'height'] as const).every((k) => Math.round(a[k]) === Math.round(b[k])));
const sameView = (a: View, b: View) => a.cue === b.cue && sameBox(a.box, b.box) && sameBox(a.zone, b.zone);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const boxOf = (el: Element): Box => { const r = el.getBoundingClientRect(); return { top: r.top, left: r.left, width: r.width, height: r.height }; };

/**
 * Below the zone if it fits, else above, else beside it, else a corner that leaves it clear. The card never covers the zone, so
 * the next control (a Save button under a field, the rest of a dialog) stays clickable. Docked when there is nothing to point at.
 */
function place(zone: Box | null, vw: number, vh: number, h: number): CSSProperties {
  if (vw < 800) return zone && zone.top + zone.height / 2 > vh / 2 ? { left: 8, right: 8, top: 8 } : { left: 8, right: 8, bottom: 8 };
  const W = Math.min(360, vw - 16);
  if (!zone) return { right: 16, bottom: 70, width: W };
  const z = zone;
  const gap = 12 + PAD;
  const clear = (top: number, left: number, w: number) => top >= 8 && left >= 8 && top + h <= vh - 8 && left + w <= vw - 8
    && !(left < z.left + z.width + PAD && left + w > z.left - PAD && top < z.top + z.height + PAD && top + h > z.top - PAD);
  const cx = (w: number) => clamp(z.left + z.width / 2 - w / 2, 8, vw - w - 8);
  const ty = clamp(z.top, 8, Math.max(8, vh - h - 8));
  const options: [number, number, number][] = [
    [z.top + z.height + gap, cx(W), W], [z.top - gap - h, cx(W), W],
    [ty, z.left + z.width + gap, W], [ty, z.left - gap - W, W], [ty, z.left + z.width + gap, 300], [ty, z.left - gap - 300, 300],
    [vh - h - 16, vw - W - 16, W], [16, vw - W - 16, W], [vh - h - 16, 236, W],
  ];
  for (const [top, left, w] of options) if (clear(top, left, w)) return { top, left, width: w };
  return { right: 16, bottom: 16, width: W };
}

export function TourChip() {
  const { s } = useApp();
  const { start } = useGuide();
  const p = tourProgress(s);
  if (s.guide.on || p.done >= p.total) return null;
  return (
    <button className="chip brand hide-sm" style={{ border: 0, cursor: 'pointer' }} onClick={() => start(s.guide.step ?? undefined)} title="A guided walkthrough that takes you to each control">
      {s.guide.step ? 'Resume tour' : 'Start tour'} {p.done}/{p.total} ▶
    </button>
  );
}

export default function TourGuide() {
  const { s, ready, setGuide, markTour } = useApp();
  const path = usePathname();
  const { current: t, go, start, pause, bring } = useGuide();
  const [view, setView] = useState<View>(EMPTY);
  const [hold, setHold] = useState(false);
  const [cardH, setCardH] = useState(220);
  const [vp, setVp] = useState({ w: 1280, h: 800 });
  const card = useRef<HTMLDivElement>(null);
  const sRef = useRef(s);
  sRef.current = s;
  const lastEl = useRef<Element | null>(null);
  const on = ready && s.guide.on;
  const done = !!t && stepDone(s, t);

  // A new step starts with the countdown armed and nothing scrolled to yet.
  useEffect(() => { setHold(false); lastEl.current = null; }, [t?.id]);

  // Find what to point at and keep the ring on it while the page scrolls, resizes and re-renders.
  useEffect(() => {
    if (!on || !t) { setView(EMPTY); return; }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    const measure = () => {
      const st = sRef.current;
      let el: HTMLElement | null = null;
      let cue = -1;
      let zoneEl: Element | null = null;
      if (stepDone(st, t)) el = t.notice ? findVisible(t.notice) : null;
      else {
        for (let i = 0; i < t.cues.length; i++) {
          const c = t.cues[i];
          if (c.passed?.(st) || (c.passedIf && document.querySelector(c.passedIf))) continue;
          const e = findVisible(c.at);
          if (e) { el = e; cue = i; zoneEl = c.zone ? findVisible(c.zone) : null; break; }
        }
      }
      const r = el?.getBoundingClientRect();
      // Keep the whole dialog or popover clear when the control is inside one.
      if (el && !zoneEl) zoneEl = el.closest('.modal, .popbox') ?? el;
      const next: View = { box: el ? boxOf(el) : null, zone: zoneEl ? boxOf(zoneEl) : null, cue };
      setView((v) => (sameView(v, next) ? v : next));
      setVp((v) => (v.w === window.innerWidth && v.h === window.innerHeight ? v : { w: window.innerWidth, h: window.innerHeight }));
      // Bring a new target into view once. Controls in the sticky top bar or the floating panel are always in view already.
      if (el && el !== lastEl.current) {
        lastEl.current = el;
        if (r && !el.closest('.top, .sim') && (r.top < 70 || r.bottom > window.innerHeight - 24)) el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
      }
    };
    const soon = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    measure();
    const iv = window.setInterval(measure, 250);
    window.addEventListener('scroll', soon, true);
    window.addEventListener('resize', soon);
    return () => { window.clearInterval(iv); cancelAnimationFrame(raf); window.removeEventListener('scroll', soon, true); window.removeEventListener('resize', soon); };
  }, [on, t?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A finished step moves on by itself, unless the person is reading the card.
  useEffect(() => {
    if (!on || !t || !done || hold || !s.guide.auto) return;
    const next = nextStep(sRef.current, t);
    if (!next) return;
    const id = window.setTimeout(() => go(next), ADVANCE_MS);
    return () => window.clearTimeout(id);
  }, [on, t?.id, done, hold, s.guide.auto]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const h = card.current?.offsetHeight;
    if (h && Math.abs(h - cardH) > 2) setCardH(h);
  });

  // On a phone the card is docked over the bottom of the screen: tell the page how much room to leave under its content.
  const docked = on && vp.w < 800;
  useEffect(() => {
    const root = document.documentElement.style;
    if (docked) root.setProperty('--tour-dock', `${cardH + 16}px`); else root.removeProperty('--tour-dock');
    return () => { root.removeProperty('--tour-dock'); };
  }, [docked, cardH]);

  if (!on) return null;

  const prog = tourProgress(s);
  const complete = prog.done >= prog.total;

  if (!t) {
    return (
      <div className="tour-ui tour-card" style={place(null, vp.w, vp.h, cardH)} ref={card} role="dialog" aria-label="Guided tour">
        <div className="row between"><b>{complete ? 'Tour complete' : 'Guided tour'}</b><button className="btn sm" aria-label="Close the tour" onClick={() => setGuide({ on: false, step: null })}>✕</button></div>
        <p style={{ margin: '6px 0 10px' }}>{complete ? `All ${prog.total} steps done. Every one of them was detected from what you did in the app.` : `${prog.done} of ${prog.total} steps done.`}</p>
        <div className="row wrap">
          {!complete && <button className="btn pri sm" onClick={() => start()}>Continue →</button>}
          <Link className="btn sm" href="/tour">All steps</Link>
          {complete && <button className="btn sm" onClick={() => setGuide({ on: false, step: null })}>Close</button>}
        </div>
      </div>
    );
  }

  const idx = TOUR.indexOf(t);
  const cue = view.cue >= 0 ? t.cues[view.cue] : null;
  const say = cue ? (typeof cue.say === 'function' ? cue.say(s) : cue.say) : null;
  const away = !done && !cue && !samePage(path, t.start) && !(VIA[t.id] && path.startsWith(VIA[t.id]));
  const next = nextStep(s, t);
  const wrongRole = s.role !== t.role;
  const counting = done && !!next && s.guide.auto && !hold;
  const spot: CSSProperties | null = view.box ? { top: view.box.top - PAD, left: view.box.left - PAD, width: view.box.width + PAD * 2, height: view.box.height + PAD * 2 } : null;

  return (
    <>
      {spot && <div className="tour-ui tour-spot" style={spot} aria-hidden="true" />}
      <div className="tour-ui tour-card" style={place(view.zone, vp.w, vp.h, cardH)} ref={card} role="dialog" aria-label="Guided tour"
        // Only a pointer really moving over the card pauses the countdown: a card that lands under a resting cursor does not.
        onPointerMove={(e) => { if (done && (e.movementX || e.movementY)) setHold(true); }} onFocus={() => done && setHold(true)}>
        <div className="row between small muted">
          <span>Step {idx + 1} of {TOUR.length} · {t.act}</span>
          <span className="row" style={{ gap: 6 }}><Link href="/tour">All steps</Link><button className="btn sm" aria-label="Pause the tour" title="Pause the tour (resume from the top bar)" onClick={pause}>✕</button></span>
        </div>
        <div className="bar good" style={{ margin: '6px 0 8px' }}><i style={{ width: `${(prog.done / prog.total) * 100}%` }} /></div>
        <div className="row wrap" style={{ gap: 6 }}><b>{t.title}</b><span className="chip brand">{ROLE_INFO[t.role].title}</span></div>

        <div aria-live="polite" style={{ margin: '6px 0 10px' }}>
          {done ? (
            <>
              <p className="tour-ok">✓ Done</p>
              <p className="small" style={{ margin: 0 }}><b>Notice:</b> {t.look}</p>
              {t.tidy?.when(s) && <p className="small muted" style={{ margin: '6px 0 0' }}>{t.tidy.label}</p>}
            </>
          ) : away ? (
            <>
              <p style={{ margin: '0 0 8px' }}>{t.doThis}</p>
              <button className="btn pri sm" onClick={() => bring(t)}>Take me there →</button>
            </>
          ) : (
            <>
              <p style={{ margin: 0 }}>{say ?? t.doThis}</p>
              {t.cues.length > 1 && cue && <p className="small muted" style={{ margin: '4px 0 0' }}>Action {view.cue + 1} of {t.cues.length}</p>}
              {wrongRole && <p className="small" style={{ margin: '6px 0 0' }}>This step uses the {ROLE_INFO[t.role].title.toLowerCase()} role. <button className="btn sm" onClick={() => bring(t)}>Switch</button></p>}
            </>
          )}
        </div>

        <div className="row between wrap" style={{ gap: 6 }}>
          <span className="row" style={{ gap: 6 }}>
            <button className="btn sm" disabled={idx === 0} onClick={() => go(TOUR[idx - 1])}>← Back</button>
            {!done && <button className="btn sm" disabled={!next} onClick={() => go(next)}>Skip</button>}
          </span>
          {done ? <button className="btn pri sm" onClick={() => go(next)}>{next ? `Next: ${next.title} →` : 'Finish ✓'}</button>
            : !t.done && !away ? <button className="btn sm" title="For when the app cannot see this step" onClick={() => markTour(t.id)}>Mark done</button> : null}
        </div>
        {counting && <div className="tour-count" aria-hidden="true"><i key={t.id} style={{ animationDuration: `${ADVANCE_MS}ms` }} /></div>}
        <label className="row small" style={{ margin: '8px 0 0', fontWeight: 400 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={s.guide.auto} onChange={(e) => setGuide({ auto: e.target.checked })} />
          Move on by itself when a step is done{counting ? ' (move the pointer here to stay)' : ''}
        </label>
      </div>
    </>
  );
}
