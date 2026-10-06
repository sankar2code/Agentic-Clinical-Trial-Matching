'use client';
import { useMemo } from 'react';
import { FACT_LABEL } from '@/lib/data';
import { TARGETS, alertsFor, opsStats, unknownRates } from '@/lib/ops';
import { dropFor, useApp } from '@/lib/store';
import { Banner, Bar, Sec } from '@/components/ui';

function Spark({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <span className="muted small">not enough data yet</span>;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 120},${28 - (v / max) * 26}`).join(' ');
  return <svg width="124" height="30" role="img" aria-label="trend"><polyline fill="none" stroke={color} strokeWidth="2" points={pts} /></svg>;
}

export default function Ops() {
  const { s, trials, setSim } = useApp();
  const live = trials.filter((t) => !t.hiddenUntilOpened || s.opened.includes(t.id));
  const stats = useMemo(() => opsStats({ telemetry: s.telemetry, audit: s.audit, usage: s.usage, overrides: s.overrides, referrals: s.referrals, trials: live }), [s.telemetry, s.audit, s.usage, s.overrides, s.referrals, live]);
  const ctx = { overlay: s.overlay, overrides: s.overrides, today: s.queryDate };
  const now = useMemo(() => unknownRates(live, { ...ctx, dropNlp: dropFor(s.sim) }), [live, s.overlay, s.overrides, s.queryDate, s.sim.regression]); // eslint-disable-line react-hooks/exhaustive-deps
  const baseline = useMemo(() => unknownRates(live, ctx), [live, s.overlay, s.overrides, s.queryDate]); // eslint-disable-line react-hooks/exhaustive-deps
  const alerts = alertsFor(stats, now, baseline);
  const eng = s.telemetry.filter((t) => t.kind === 'engine').map((t) => t.ms ?? 0).slice(-30);
  const agt = s.telemetry.filter((t) => t.kind === 'agent').map((t) => t.ms ?? 0).slice(-30);
  const crit = alerts.filter((a) => a.severity === 'critical').length;
  const tone = { critical: 'bad', warning: 'warn', info: 'info' } as const;

  return (
    <div>
      <h1>Ops dashboard</h1>
      <p className="muted">PRD section 10: latency, errors, cost per run, Unknown rate by criterion, override rate and citation-check failures. Everything here is measured from what happens in this session, not made up. Thresholds are the PRD’s.</p>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row between wrap">
          <div><b>Regression drill</b><div className="small muted">Make PD-L1 extraction silently stop working, as a bad prompt release might, and watch the dashboard notice.</div></div>
          <button className={`btn ${s.sim.regression ? 'dng' : 'pri'}`} onClick={() => setSim({ regression: !s.sim.regression })}>{s.sim.regression ? 'Stop the drill' : 'Start the drill'}</button>
        </div>
      </div>

      <Sec title="Alerts" count={alerts.length} note={crit ? `${crit} critical` : 'nothing critical'} />
      {alerts.length === 0 ? <div className="card muted">All clear. Open a patient, run the agent, or start the drill to generate telemetry.</div> : (
        <div className="col">{alerts.map((a) => (
          <Banner key={a.id} tone={tone[a.severity]}><b>{a.severity.toUpperCase()}: {a.title}.</b> {a.detail}<div className="small" style={{ marginTop: 4 }}><b>Runbook:</b> {a.runbook}</div></Banner>
        ))}</div>
      )}

      <Sec title="Service health" />
      <div className="gridc">
        <div className="card"><div className="muted small">Engine latency P50 / P95</div><div className="kpi">{stats.engine.p50} / {stats.engine.p95} ms</div><div className="small muted">target P95 &lt; {TARGETS.engineP95Ms / 1000} s · {stats.engine.n} runs</div><Spark values={eng} color="var(--brand)" /></div>
        <div className="card"><div className="muted small">Agent runs · success</div><div className="kpi">{stats.agent.n} · {stats.agent.successRate}%</div><div className="small muted">{stats.agent.errors} failed or timed out · {stats.agent.capHits} hit the step cap</div></div>
        <div className="card"><div className="muted small">Agent latency P50 / P95</div><div className="kpi">{(stats.agent.p50 / 1000).toFixed(1)} / {(stats.agent.p95 / 1000).toFixed(1)} s</div><div className="small muted">target P95 &lt; {TARGETS.agentP95Ms / 1000} s</div><Spark values={agt} color="var(--unk)" /></div>
        <div className="card"><div className="muted small">EHR failures</div><div className="kpi">{stats.ehrFailures}</div><div className="small muted">FHIR calls that failed this session</div></div>
      </div>

      <Sec title="Cost" note="PRD budget: about $5,000 a month" />
      <div className="card">
        <div className="row"><span style={{ width: 210 }}>Average cost per agent run</span><div className="grow"><Bar v={stats.agent.avgCost / TARGETS.costPerRun} tone={stats.agent.avgCost > TARGETS.costPerRun ? 'bad' : 'good'} /></div><span style={{ width: 150, textAlign: 'right' }}>${stats.agent.avgCost.toFixed(2)} of ${TARGETS.costPerRun.toFixed(2)}</span></div>
        <div className="row" style={{ marginTop: 8 }}><span style={{ width: 210 }}>Projected monthly spend</span><div className="grow"><Bar v={stats.projectedMonthly / TARGETS.monthlyBudget} tone={stats.projectedMonthly > TARGETS.monthlyBudget ? 'bad' : 'good'} /></div><span style={{ width: 150, textAlign: 'right' }}>${stats.projectedMonthly.toLocaleString()} of ${TARGETS.monthlyBudget.toLocaleString()}</span></div>
        <p className="small muted" style={{ marginBottom: 0 }}>Projection = average cost × 200 queries a day × 22 clinic days, plus $750 nightly re-screen and $50 criteria parsing from the PRD. Spent this session: ${stats.agent.totalCost.toFixed(2)}.</p>
      </div>

      <Sec title="Unknown rate by criterion" note="A spike on one field usually means extraction regressed" />
      <div className="card">
        <div className="col">{now.map((n) => { const b = baseline.find((x) => x.fact === n.fact)!; const delta = n.rate - b.rate; return (
          <div key={n.fact} className="row"><span style={{ width: 160 }}>{FACT_LABEL[n.fact]}</span>
            <div className="grow"><Bar v={n.rate / 100} tone={delta >= TARGETS.unknownSpikePts ? 'bad' : ''} /></div>
            <span style={{ width: 210, textAlign: 'right' }} className="small">{n.rate}% <span className="muted">(baseline {b.rate}%{delta ? `, ${delta > 0 ? '+' : ''}${delta.toFixed(1)}` : ''}) · {n.unknown}/{n.total}</span></span></div>); })}</div>
      </div>

      <Sec title="Quality signals" />
      <div className="gridc">
        <div className="card"><div className="muted small">Extractions rejected by the span check</div><div className="kpi">{stats.rejectedExtractions}</div><div className="small muted">Stopped before reaching the chart</div></div>
        <div className="card"><div className="muted small">Documents quarantined for instruction-like text</div><div className="kpi">{stats.quarantined}</div></div>
        <div className="card"><div className="muted small">Override rate</div><div className="kpi">{(stats.override.rate * 100).toFixed(1)}%</div><div className="small muted">{stats.override.overrides} overrides over {stats.override.reviewed} criteria reviewed · target &lt; 10%</div></div>
        <div className="card"><div className="muted small">Drafts approved / edited / rejected</div><div className="kpi">{stats.approvals.approved} / {stats.approvals.edited} / {stats.approvals.rejected}</div></div>
      </div>

      <Sec title="Recent telemetry" count={s.telemetry.length} />
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table><thead><tr><th>Time</th><th>Kind</th><th>Result</th><th>Detail</th></tr></thead>
          <tbody>{[...s.telemetry].reverse().slice(0, 12).map((t, i) => (
            <tr key={i}><td className="small">{t.ts.slice(11, 19)}</td><td><span className="chip gray">{t.kind}</span></td><td><span className={`chip ${t.ok ? 'met' : 'notmet'}`}>{t.ok ? 'ok' : 'failed'}</span></td>
              <td className="small">{t.ms !== undefined ? `${t.ms} ms` : ''}{t.cost !== undefined ? ` · $${t.cost.toFixed(2)}` : ''}{t.steps !== undefined ? ` · ${t.steps} calls` : ''}{t.detail ? ` · ${t.detail}` : ''}</td></tr>))}
            {s.telemetry.length === 0 && <tr><td colSpan={4} className="muted">No telemetry yet. Open a patient to record an engine run.</td></tr>}</tbody></table>
      </div>
    </div>
  );
}
