'use client';
import { useState } from 'react';
import { FACT_LABEL, fmtVal } from '@/lib/data';
import { daysBetween, effectiveFacts, visibleAt } from '@/lib/engine';
import { EvidenceModal, Sec } from '@/components/ui';
import type { Fact, FactKey, Patient } from '@/lib/types';

const WHO = { ehr: 'FHIR (coded)', nlp: 'NLP extraction', agent: 'Agent-resolved' } as const;

/** Patient data assembly (PRD P0): what was read from FHIR, what was extracted from notes, and where each value came from. */
export default function ChartData({ p, overlay, today }: { p: Patient; overlay: Record<string, Fact[]>; today: string }) {
  const facts = effectiveFacts(p, overlay).filter((f) => visibleAt(f, today));
  const [evi, setEvi] = useState<Fact | null>(null);
  const keys = Array.from(new Set(facts.map((f) => f.key))) as FactKey[];
  const fhir = facts.filter((f) => f.source.kind === 'FHIR').length;
  const nlp = facts.length - fhir;
  return (
    <div>
      <div className="row wrap" style={{ marginBottom: 8 }}>
        <span className="chip brand">{fhir} coded FHIR values</span>
        <span className="chip brand">{nlp} NLP-extracted values</span>
        <span className="chip gray">{p.docs.length} documents</span>
        {p.docs.some((d) => d.scanned) && <span className="chip unknown">OCR needed</span>}
        {p.docs.some((d) => d.language && d.language !== 'en') && <span className="chip review">non-English notes</span>}
      </div>
      {p.externalOnly.length > 0 && <div className="banner warn"><div><b>Outside the chart:</b> {p.externalOnly.map((k) => FACT_LABEL[k]).join(', ')}. {p.externalNote}</div></div>}
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Field</th><th>Value</th><th>Age</th><th>Source</th><th>Extracted by</th><th /></tr></thead>
          <tbody>
            {keys.flatMap((k) => facts.filter((f) => f.key === k).sort((a, b) => b.date.localeCompare(a.date)).map((f, i, arr) => (
              <tr key={`${k}-${f.date}-${f.source.id}`}>
                <td>{i === 0 ? <b>{FACT_LABEL[k]}</b> : ''}{arr.length > 1 && i === 0 && <div className="small" style={{ color: 'var(--rev)' }}>{arr.length} values</div>}</td>
                <td>{fmtVal(k, f.value)}{f.confidence !== undefined && <span className="muted small"> · {Math.round(f.confidence * 100)}%</span>}</td>
                <td className="small">{daysBetween(f.date, today)} d</td>
                <td className="small">{f.source.label}<div className="muted">{f.source.resource}</div></td>
                <td className="small">{WHO[f.by ?? (f.source.kind === 'FHIR' ? 'ehr' : 'nlp')]}</td>
                <td><button className="btn sm" onClick={() => setEvi(f)}>Source</button></td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
      <Sec title="Documents" count={p.docs.length} />
      <div className="card tight small">
        {p.docs.length === 0 ? <span className="muted">No documents.</span> : p.docs.map((d) => (
          <div key={d.id} className="row between"><span><b>{d.title}</b> <span className="muted">{d.type} · {d.date}</span></span>
            <span className="row">{d.scanned && <span className="chip unknown">scanned, OCR</span>}{d.language && d.language !== 'en' && <span className="chip review">{d.language}</span>}</span></div>
        ))}
      </div>
      {evi && <EvidenceModal fact={evi} patient={p} onClose={() => setEvi(null)} />}
    </div>
  );
}
