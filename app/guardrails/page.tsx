'use client';
import { useState } from 'react';
import { ALL_ON, GUARD_INFO, type Guards } from '@/lib/guards';
import { PROBES, SCENARIOS, type Trace } from '@/lib/lab';
import { useApp } from '@/lib/store';
import { Banner, Sec } from '@/components/ui';

const KIND_TEXT = { attack: 'Attack', control: 'Control', result: 'Result' } as const;

function TraceView({ t }: { t: Trace }) {
  const failed = t.verdict === 'failed';
  return (
    <div className={`card ${failed ? '' : ''}`} style={{ borderColor: failed ? 'var(--not)' : undefined }}>
      <div className="row between wrap">
        <div className="row wrap"><b>{t.title}</b><span className="chip gray">{t.prd}</span></div>
        <span className={`seal ${failed ? 'bad' : 'ok'}`}>{failed ? 'FAILED' : 'Blocked'}</span>
      </div>
      <p className="muted small" style={{ margin: '4px 0' }}>{t.threat}</p>
      <div className="trace">
        {t.steps.map((s, i) => (
          <div key={i}>
            <span className={`kind ${s.kind}`}>{KIND_TEXT[s.kind]}</span>
            <span>{s.ok !== undefined && <span className={s.ok ? 'ok-mark' : 'bad-mark'}>{s.ok ? '✓ ' : '✕ '}</span>}{s.label}</span>
          </div>
        ))}
      </div>
      {t.harm && <Banner tone="bad"><b>What goes wrong:</b> {t.harm}</Banner>}
    </div>
  );
}

export default function Guardrails() {
  const { log, markTour } = useApp();
  const [g, setG] = useState<Guards>(ALL_ON);
  const [traces, setTraces] = useState<Record<string, Trace>>({});
  const [probes, setProbes] = useState<Record<string, number | 'error'>>({});
  const off = (Object.keys(g) as (keyof Guards)[]).filter((k) => !g[k]);

  const run = (id: string) => setTraces((t) => ({ ...t, [id]: SCENARIOS.find((s) => s.id === id)!.run(g) }));
  const runAll = () => {
    const next: Record<string, Trace> = {};
    for (const s of SCENARIOS) next[s.id] = s.run(g);
    setTraces(next);
    const failed = Object.values(next).filter((t) => t.verdict === 'failed');
    log('guard.lab', `Guardrail lab run: ${SCENARIOS.length - failed.length} of ${SCENARIOS.length} scenarios blocked${off.length ? `. Controls switched off for this run: ${off.map((k) => GUARD_INFO[k].name).join(', ')}` : ''}${failed.length ? `. Failed: ${failed.map((t) => t.id).join(', ')}` : ''}.`);
    if (off.length > 0) markTour('lab');
  };
  const runProbes = async () => {
    const out: Record<string, number | 'error'> = {};
    for (const p of PROBES) {
      try {
        const res = await fetch(p.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: p.raw ? (p.body as string) : JSON.stringify(p.body) });
        out[p.id] = res.status;
      } catch { out[p.id] = 'error'; }
    }
    setProbes(out);
    log('guard.probes', `HTTP probes: ${PROBES.filter((p) => out[p.id] === p.expect).length} of ${PROBES.length} returned the expected status.`);
  };

  const done = Object.values(traces);
  const held = done.filter((t) => t.verdict === 'blocked').length;
  return (
    <div>
      <h1>Guardrail lab</h1>
      <p className="muted">PRD section 7: the model extracts and explains, but deterministic controls decide what is allowed to stand. Each scenario below runs the app’s real agent, engine or validator against a hostile or faulty input. Switch a control off to see what it was preventing.</p>
      <Banner tone="info">Switching a control off here changes <b>this lab run only</b>. It never weakens the app, and the API routes ignore any attempt to do so.</Banner>

      <div className="grid-lab">
        <div>
          <div className="row between wrap" style={{ marginBottom: 8 }}>
            <button className="btn pri" onClick={runAll}>Run all {SCENARIOS.length} scenarios</button>
            {done.length > 0 && <span className="chip" style={{ background: held === done.length ? 'var(--met-bg)' : 'var(--not-bg)', color: held === done.length ? 'var(--met)' : 'var(--not)' }}>Guardrails held: {held} of {done.length}</span>}
          </div>
          <div className="col">
            {SCENARIOS.map((s) => (
              <div key={s.id}>
                {traces[s.id] ? <TraceView t={traces[s.id]} /> : (
                  <div className="card">
                    <div className="row between wrap"><div className="row wrap"><b>{s.title}</b><span className="chip gray">{s.prd}</span></div><button className="btn sm" onClick={() => run(s.id)}>Run</button></div>
                    <p className="muted small" style={{ margin: '4px 0 0' }}>{s.threat}</p>
                  </div>
                )}
              </div>
            ))}
          </div>

          <Sec title="Real HTTP probes" note="Sent to this app’s own routes" />
          <div className="card">
            <p className="muted small">These are actual requests, answered by the server. They check the controls that live outside the agent.</p>
            <button className="btn pri sm" onClick={runProbes}>Send {PROBES.length} requests</button>
            {Object.keys(probes).length > 0 && (
              <table style={{ marginTop: 8 }}>
                <thead><tr><th>Request</th><th>Control</th><th>Expected</th><th>Got</th></tr></thead>
                <tbody>{PROBES.map((p) => (
                  <tr key={p.id}><td><b>{p.title}</b><div className="small muted">{p.threat}</div></td><td className="small">{p.control}</td><td>{p.expect}</td>
                    <td><span className={`chip ${probes[p.id] === p.expect ? 'met' : 'notmet'}`}>{String(probes[p.id])}</span></td></tr>))}</tbody>
              </table>
            )}
          </div>
        </div>

        <aside className="col askcol">
          <div className="card hl">
            <div className="row between"><h2 style={{ margin: 0 }}>Controls</h2><button className="btn sm" disabled={off.length === 0} onClick={() => setG(ALL_ON)}>All on</button></div>
            <p className="muted small" style={{ margin: '4px 0 8px' }}>{off.length === 0 ? 'Every control is on.' : `${off.length} off. The next run shows what they were stopping.`}</p>
            <div className="col">
              {(Object.keys(GUARD_INFO) as (keyof Guards)[]).map((k) => (
                <label key={k} className="row" style={{ alignItems: 'flex-start', margin: 0, fontWeight: 400, color: 'var(--ink)' }}>
                  <input type="checkbox" style={{ width: 'auto', marginTop: 3 }} checked={g[k]} onChange={(e) => setG({ ...g, [k]: e.target.checked })} />
                  <span><b>{GUARD_INFO[k].name}</b> <span className="chip gray">{GUARD_INFO[k].prd}</span><br /><span className="muted small">{GUARD_INFO[k].what}</span></span>
                </label>
              ))}
            </div>
            <p className="muted small" style={{ marginTop: 8 }}>Try this: turn off only “Injection scan” and run all. Nothing fails, because the tool allowlist is a second layer. Then turn off the allowlist too.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
