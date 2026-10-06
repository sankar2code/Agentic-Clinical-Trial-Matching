'use client';
import Link from 'next/link';
import { useState } from 'react';
import { FACT_LABEL } from '@/lib/data';
import { readyUntil } from '@/lib/expiry';
import type { Run } from '@/lib/useAgent';
import { Bar, RankBreakdown, StateChip, StatusChip } from '@/components/ui';
import type { Adjudication, Mode, TrialMatch } from '@/lib/types';

const PHRASE: Record<string, string> = {
  query_fhir: 'Querying FHIR for',
  search_notes: 'Searching notes and reports for',
  ocr_document: 'Reading the scanned report for',
  extract_value: 'Extracting',
  scan_source: 'Scanning the source for',
  check_external_source: 'Checking external sources for',
  draft_task: 'Drafting a request for',
};

/** Live status for a row while the agent runs, e.g. "Searching notes and reports for PD-L1 TPS". */
function liveStatus(m: TrialMatch, run: Run | null): string | null {
  if (!run?.running || m.unknownKeys.length === 0) return null;
  const last = run.steps[run.steps.length - 1];
  if (last?.key && m.unknownKeys.includes(last.key)) return `${PHRASE[last.tool] ?? 'Working on'} ${FACT_LABEL[last.key]}…`;
  return 'Queued: waiting for the agent…';
}

export default function TrialCard({ m, pid, run, watching, onWatch, canDismiss, dismissHint, onDismiss, today, mode, adj, canAdjudicate, adjudicateHint, onAdjudicate, sampled }: {
  m: TrialMatch; pid: string; run: Run | null; watching: boolean; onWatch: () => void; canDismiss: boolean; dismissHint: string; onDismiss: () => void;
  today: string; mode: Mode; adj?: Adjudication; canAdjudicate: boolean; adjudicateHint: string; onAdjudicate: (v: 'agree' | 'disagree') => void; sampled: boolean;
}) {
  const [why, setWhy] = useState(false);
  const t = m.trial;
  const open = m.results.filter((r) => ['unknown', 'review', 'pending'].includes(r.status));
  const status = liveStatus(m, run);
  const ru = readyUntil(m, today);
  const recommendation = m.state === 'eligible' || m.state === 'near';
  return (
    <div className={`card ${m.state === 'ineligible' ? 'dim' : ''}`}>
      <div className="row between wrap">
        <div className="row wrap"><b>{t.code}</b><StateChip s={m.state} /><span className="chip gray">{t.phase}</span>
          {m.siteFull && <span className="chip unknown">Site {t.siteStatus.toLowerCase()}</span>}
          {t.siteMiles > 0 && <span className="chip gray">{t.siteMiles} mi satellite</span>}
          {t.amendments?.length ? <span className="chip review" title="A protocol amendment changed this trial's criteria">Amended {t.amendments.join(', ')}</span> : null}
          {m.counts.pending > 0 && <span className="chip pending">{m.counts.pending} rule not evaluable</span>}
          {sampled && mode === 'steady' && <span className="chip review" title="Chosen by the deterministic weekly 5% sample">Selected for double review</span>}
          {status && <span className="chip brand pulse" aria-live="polite">{status}</span>}</div>
        <button className="btn sm" aria-pressed={watching} onClick={onWatch}>{watching ? '★ Watching' : '☆ Watch'}</button>
      </div>
      <p className="muted small" style={{ margin: '4px 0 8px' }}>{t.title} · {t.nct} · {t.enrolled}/{t.target} enrolled</p>
      <div className="row"><div className="grow"><Bar v={m.fit} tone={m.state === 'eligible' ? 'good' : m.state === 'ineligible' ? 'bad' : 'warn'} /></div><span className="small muted">{Math.round(m.fit * 100)}% criteria met</span></div>
      <div className="row wrap" style={{ margin: '8px 0' }}>
        <StatusChip s="met" n={m.counts.met} />{m.counts.notmet > 0 && <StatusChip s="notmet" n={m.counts.notmet} />}
        {m.counts.unknown > 0 && <StatusChip s="unknown" n={m.counts.unknown} />}{m.counts.review > 0 && <StatusChip s="review" n={m.counts.review} />}
      </div>
      {ru && (
        <div className="small" style={{ margin: '0 0 6px' }}>
          {ru.expiresOn && <span className={`chip ${ru.daysLeft <= 3 ? 'notmet' : ru.daysLeft <= 14 ? 'unknown' : 'met'}`}>⏱ Evidence valid until {ru.expiresOn} ({ru.daysLeft} d) · limited by {FACT_LABEL[ru.fact]}</span>}
          {ru.expired.length > 0 && <span className="chip notmet" style={{ marginLeft: 6 }}>Expired: {ru.expired.map((e) => FACT_LABEL[e.fact]).join(', ')}</span>}
        </div>
      )}
      {m.blockers.length > 0 && <p className="small"><b>Blocked by:</b> {m.blockers.slice(0, 2).join('; ')}{m.blockers.length > 2 ? ` (+${m.blockers.length - 2})` : ''}</p>}
      {m.state === 'near' && open.length > 0 && <p className="small"><b>To confirm:</b> {open.slice(0, 2).map((r) => `${r.criterion.text} → ${r.nextStep ?? r.message}`).join('; ')}</p>}
      {m.siteFull && <p className="small muted">Clinically eligible, but this site is {t.siteStatus.toLowerCase()}. Discuss the waitlist or a satellite site with the coordinator.</p>}
      {t.siteMiles > 0 && m.state === 'eligible' && <p className="small muted">Open at a satellite site {t.siteMiles} miles away. Confirm the patient can travel before referring.</p>}
      {mode === 'hitl' && recommendation && (
        <div className="row wrap small" style={{ margin: '6px 0', padding: '6px 8px', background: 'var(--brand-soft)', borderRadius: 8 }}>
          {adj ? <span><b>Adjudicated:</b> {adj.verdict === 'agree' ? '✓ agree' : '✕ disagree'}{adj.reason ? ` (${adj.reason})` : ''} · {adj.by}</span> : <span><b>Adjudicate this recommendation:</b></span>}
          <span title={canAdjudicate ? '' : adjudicateHint}>
            <button className="btn sm" disabled={!canAdjudicate} onClick={() => onAdjudicate('agree')}>Agree</button>{' '}
            <button className="btn sm dng" disabled={!canAdjudicate} onClick={() => onAdjudicate('disagree')}>Disagree</button>
          </span>
        </div>
      )}
      <div className="row wrap" style={{ marginTop: 6 }}>
        <Link className="btn pri sm" href={`/patient/${pid}/trials/${t.id}`}>Open checklist</Link>
        <button className="btn sm" disabled={!canDismiss} title={canDismiss ? '' : dismissHint} onClick={onDismiss}>Dismiss</button>
        <button className="btn sm" aria-expanded={why} onClick={() => setWhy(!why)}>{why ? 'Hide rank' : 'Why this rank?'}</button>
      </div>
      {why && <div style={{ marginTop: 8 }}><RankBreakdown m={m} /></div>}
    </div>
  );
}
