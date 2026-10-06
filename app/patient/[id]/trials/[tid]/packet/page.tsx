'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FACT_LABEL, TODAY, fmtVal } from '@/lib/data';
import { describeRule, matchTrial } from '@/lib/engine';
import { readyUntil } from '@/lib/expiry';
import { useApp } from '@/lib/store';
import { Banner, StateChip } from '@/components/ui';
import type { Fact, Patient } from '@/lib/types';

const STATUS: Record<string, string> = { met: 'Met', notmet: 'Not met', unknown: 'Unknown', review: 'Needs review', pending: 'Rule pending' };

function excerpt(p: Patient, f: Fact): string {
  const doc = p.docs.find((d) => d.id === f.source.docId) ?? f.source.inlineDoc;
  if (!doc) return `${f.source.resource}/${f.source.id}`;
  const line = doc.text.split('\n').find((l) => f.source.span && l.includes(f.source.span));
  return line ? `“${line.trim()}”` : `${doc.title}`;
}

export default function Packet() {
  const { id, tid } = useParams<{ id: string; tid: string }>();
  const { s, trials, patient, mctx, markTour, versions, shadowHidden } = useApp();
  const p = patient(id);
  const t = trials.find((x) => x.id === tid);
  if (!p || !t) return <Banner tone="bad">Patient or trial not found.</Banner>;
  if (!p.treating) return <Banner tone="bad"><b>Access restricted.</b> No treating relationship with this patient.</Banner>;
  if (shadowHidden) return <Banner tone="rev"><b>Shadow mode.</b> The packet contains the system’s results, which are hidden from clinicians and coordinators in this mode.</Banner>;

  const m = matchTrial(p, t, mctx());
  const ru = readyUntil(m, s.queryDate);
  const refs = s.referrals.filter((r) => r.patientId === id && r.trialId === tid && r.kind === 'referral');
  const adj = s.adjudications[`${id}|${tid}`];
  const dis = s.dismissals[`${id}|${tid}`];
  const head = s.audit[s.audit.length - 1];
  const rows = (type: 'inclusion' | 'exclusion') => m.results.filter((r) => r.criterion.type === type);

  return (
    <div>
      <p className="small noprint"><Link href={`/patient/${id}/trials/${tid}`}>← {t.code} checklist</Link></p>
      <div className="row between noprint"><h1>Evidence packet</h1><button className="btn pri" onClick={() => { markTour('packet'); window.print(); }}>Print or save as PDF</button></div>
      <div className="paper">
        <h1>Trial screening evidence packet</h1>
        <p className="muted">A screening aid built from the matching engine’s deterministic result. Formal eligibility is confirmed by the trial team per protocol.</p>
        <table>
          <tbody>
            <tr><th>Patient</th><td>{p.name} · {p.age}{p.sex} · MRN {p.mrn}</td><th>Trial</th><td>{t.code} · {t.nct}</td></tr>
            <tr><th>As-of date</th><td>{s.queryDate}{s.queryDate !== TODAY ? ' (simulated)' : ''}</td><th>Phase · sponsor</th><td>{t.phase} · {t.sponsor}</td></tr>
            <tr><th>Rule set</th><td>{t.ruleSet}{t.amendments?.length ? ` (amended ${t.amendments.join(', ')})` : ''}</td><th>Model · prompt</th><td>{versions.model} · {versions.prompt}</td></tr>
          </tbody>
        </table>

        <h2>Result</h2>
        <p><StateChip s={m.state} /> {m.counts.met} met · {m.counts.notmet} not met · {m.counts.unknown} unknown · {m.counts.review} need review{m.counts.pending ? ` · ${m.counts.pending} rule(s) not evaluated` : ''}. Rank score {m.rank} = {m.rankParts.state} (state) {m.rankParts.fit >= 0 ? '+' : '−'} {Math.abs(m.rankParts.fit)} (fit) {m.rankParts.site >= 0 ? '+' : '−'} {Math.abs(m.rankParts.site)} (site) {m.rankParts.distance >= 0 ? '+' : '−'} {Math.abs(m.rankParts.distance)} (distance) {m.rankParts.enrollment >= 0 ? '+' : '−'} {Math.abs(m.rankParts.enrollment)} (enrollment).</p>
        {ru && <p>{ru.expiresOn ? `Evidence valid until ${ru.expiresOn} (${ru.daysLeft} days), limited by ${FACT_LABEL[ru.fact]}.` : ''}{ru.expired.length ? ` Expired: ${ru.expired.map((e) => FACT_LABEL[e.fact]).join(', ')}.` : ''}</p>}
        {m.siteFull && <p>Site status: {t.siteStatus.toLowerCase()} at this campus.</p>}
        {m.filterReason && <p>Filtered out before evaluation: {m.filterReason}.</p>}

        {(['inclusion', 'exclusion'] as const).map((type) => (
          <div key={type} className="keep">
            <h2>{type === 'inclusion' ? 'Inclusion criteria' : 'Exclusion criteria (met = the patient is not excluded)'}</h2>
            <table>
              <thead><tr><th style={{ width: '24%' }}>Criterion</th><th>Result</th><th>Value</th><th>Source and citation</th></tr></thead>
              <tbody>{rows(type).map((r) => (
                <tr key={r.criterion.id}>
                  <td>{r.criterion.text}<div className="muted">{describeRule(r.criterion.rule)}{r.criterion.review !== 'approved' ? ` · rule ${r.criterion.review}` : ''}</div></td>
                  <td><b>{STATUS[r.status]}</b>{r.stale ? ' (stale)' : ''}{r.conflict ? ' (conflict)' : ''}{r.attested ? ' (clinician-attested)' : ''}</td>
                  <td>{r.evidence.length ? r.evidence.map((e) => <div key={e.source.id + e.date}>{fmtVal(e.key, e.value)} · {e.date}{e.confidence !== undefined ? ` · ${Math.round(e.confidence * 100)}%` : ''}</div>) : '—'}</td>
                  <td>{r.evidence.length ? r.evidence.map((e) => <div key={e.source.id + e.date}>{e.source.label} ({e.source.resource}/{e.source.id}){e.source.span ? <div className="muted">{excerpt(p, e)}</div> : null}</div>) : <span className="muted">No source{r.nextStep ? `. Next: ${r.nextStep}` : ''}</span>}
                    {r.override && <div><b>Override:</b> {r.override.by}, {r.override.reason}. {r.override.note}{r.override.citation ? ` Citation: ${r.override.citation}` : ''}</div>}</td>
                </tr>))}</tbody>
            </table>
          </div>
        ))}

        <h2>Decisions and approvals</h2>
        <ul>
          {refs.length === 0 && !adj && !dis && <li>No referral, adjudication or dismissal has been recorded for this pair.</li>}
          {refs.map((r) => <li key={r.id}>Referral {r.status}{r.decidedBy ? ` by ${r.decidedBy}` : ''}; drafted by {r.requestedBy} under {r.versions}; coordinator status: {r.worklist}{r.edited ? '; edited by the clinician before approval' : ''}.</li>)}
          {adj && <li>Clinician {adj.verdict === 'agree' ? 'agreed with' : 'disagreed with'} the recommendation{adj.reason ? ` (${adj.reason})` : ''} · {adj.by}.</li>}
          {dis && <li>Dismissed by {dis.by}: {dis.reason}. {dis.note}</li>}
        </ul>

        <h2>Integrity</h2>
        <p>Audit entries: {s.audit.length}. Chain head: <span className="mono">{head?.hash ?? 'none yet'}</span>. Each entry’s hash covers the one before it, so an edit to any earlier entry changes this value. Verify the chain on the Audit page.</p>
        <p className="muted small">Synthetic data. This packet describes a mockup and is not a clinical record.</p>
      </div>
    </div>
  );
}
