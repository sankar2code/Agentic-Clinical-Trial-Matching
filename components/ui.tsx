'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { FACT_LABEL, fmtVal } from '@/lib/data';
import type { CStatus, Fact, MatchState, Patient, TrialMatch } from '@/lib/types';

export const STATUS_TEXT: Record<CStatus, string> = { met: 'Met', notmet: 'Not met', unknown: 'Unknown', review: 'Needs review', pending: 'Rule pending' };
const STATUS_ICON: Record<CStatus, string> = { met: '✓', notmet: '✕', unknown: '?', review: '⚑', pending: '…' };

export function StatusChip({ s, n }: { s: CStatus; n?: number }) {
  return <span className={`chip ${s}`}>{STATUS_ICON[s]} {STATUS_TEXT[s]}{n !== undefined ? ` ${n}` : ''}</span>;
}

const STATE_TEXT: Record<MatchState, string> = { eligible: 'Likely eligible', near: 'Near-eligible', ineligible: 'Not eligible', filtered: 'Filtered out' };
export function StateChip({ s }: { s: MatchState }) {
  return <span className={`chip ${s}`}>{STATE_TEXT[s]}</span>;
}

export function Bar({ v, tone = '' }: { v: number; tone?: string }) {
  return <div className={`bar ${tone}`} role="presentation"><i style={{ width: `${Math.max(0, Math.min(100, v * 100))}%` }} /></div>;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const box = ref.current;
    (box?.querySelector<HTMLElement>('input,select,textarea') ?? box)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); return; }
      if (e.key !== 'Tab' || !box) return;
      const items = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, []);
  return (
    <div className="modalbg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="modal" ref={ref} tabIndex={-1}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <h2 id={titleId} style={{ margin: 0 }}>{title}</h2>
          <button className="btn sm" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** A label that wraps its control, so screen readers and click targets are always correctly associated. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

/** Edits are held locally and committed once (on blur or Save), so the audit log records one edit, not one per keystroke. */
export function DraftEditor({ value, disabled, label, onCommit }: { value: string; disabled?: boolean; label: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const dirty = v !== value;
  return (
    <div>
      <textarea aria-label={label} value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={() => { if (dirty && !disabled) onCommit(v); }} />
      {dirty && !disabled && (
        <div className="row" style={{ marginTop: 6 }}>
          <button className="btn sm" onClick={() => onCommit(v)}>Save edits</button>
          <span className="muted small">Unsaved changes. Saving records a single audit entry.</span>
        </div>
      )}
    </div>
  );
}

function Highlighted({ text, span }: { text: string; span?: string }) {
  if (!span) return <>{text}</>;
  const i = text.indexOf(span);
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark>{span}</mark>{text.slice(i + span.length)}</>;
}

export function EvidenceModal({ fact, patient, onClose }: { fact: Fact; patient: Patient; onClose: () => void }) {
  const doc = patient.docs.find((d) => d.id === fact.source.docId) ?? fact.source.inlineDoc;
  const conf = fact.confidence;
  return (
    <Modal title={`Evidence: ${FACT_LABEL[fact.key]}`} onClose={onClose}>
      <div className="row wrap" style={{ marginBottom: 8 }}>
        <span className="chip brand">{fact.source.kind}</span>
        <span className="chip gray">{fact.source.resource}/{fact.source.id}</span>
        <span className="chip gray">dated {fact.date}</span>
        {conf !== undefined && <span className={`chip ${conf >= 0.9 ? 'met' : conf >= 0.7 ? 'unknown' : 'review'}`}>confidence {Math.round(conf * 100)}%</span>}
        {fact.by === 'agent' && <span className="chip brand">resolved by agent</span>}
      </div>
      <p><b>Value:</b> {fmtVal(fact.key, fact.value)}</p>
      {doc ? (
        <>
          <p className="muted small">{doc.title} · {doc.date}{doc.scanned ? ' · scanned (OCR)' : ''}. The highlighted text is the cited span; the value was checked against it.</p>
          <div className="doc"><Highlighted text={doc.text} span={fact.source.span} /></div>
        </>
      ) : (
        <>
          <p className="muted small">Coded FHIR R4 resource (read live at query time).</p>
          <div className="doc">{JSON.stringify({ resourceType: fact.source.resource, id: fact.source.id, code: fact.key, valueQuantity: { value: fact.value }, effectiveDateTime: fact.date, text: fact.source.label }, null, 2)}</div>
        </>
      )}
    </Modal>
  );
}

export function Banner({ tone, children }: { tone: 'warn' | 'bad' | 'info' | 'rev'; children: ReactNode }) {
  return <div className={`banner ${tone}`} role={tone === 'bad' ? 'alert' : 'status'}><div>{children}</div></div>;
}

export function Sec({ title, count, note }: { title: string; count?: number; note?: string }) {
  return <div className="sec"><h2>{title}{count !== undefined ? ` (${count})` : ''}</h2>{note && <span className="muted small">{note}</span>}</div>;
}

/** Shows how the rank was built, so ordering is never a black box (PRD: ordered by fit, proximity, enrollment). */
export function RankBreakdown({ m }: { m: TrialMatch }) {
  const p = m.rankParts;
  const sign = (n: number) => (n >= 0 ? `+ ${n}` : `− ${Math.abs(n)}`);
  return (
    <div className="small muted">
      Rank score <b>{m.rank}</b> = {p.state} ({m.state === 'eligible' ? 'likely eligible' : m.state === 'near' ? 'near-eligible' : 'not eligible'}) {sign(p.fit)} clinical fit {sign(p.site)} ({m.siteFull ? 'site full' : 'site open'}) {sign(p.distance)} distance ({m.trial.siteMiles} mi) {sign(p.enrollment)} enrollment headroom ({m.trial.enrolled}/{m.trial.target})
    </div>
  );
}
