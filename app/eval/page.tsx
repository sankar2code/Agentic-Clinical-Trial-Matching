'use client';
import { useState } from 'react';
import { VARIANT_INFO, runEval, variantTrials, type EvalReport, type Variant } from '@/lib/eval';
import { CRIT_TRUTH, CRIT_TRUTH_AGENT, goldPairs } from '@/lib/golden';
import { useApp } from '@/lib/store';
import { Banner, Sec } from '@/components/ui';

const ORDER: Variant[] = ['baseline', 'previous', 'candidate', 'current'];

export default function EvalPage() {
  const { s, trials, log, markTour } = useApp();
  const [variant, setVariant] = useState<Variant>('baseline');
  const [report, setReport] = useState<EvalReport | null>(null);
  const [all, setAll] = useState<Record<string, EvalReport> | null>(null);

  const trialsFor = (v: Variant) => (v === 'current' ? trials.filter((t) => !t.hiddenUntilOpened || s.opened.includes(t.id)) : variantTrials(v));
  const run = (v: Variant) => {
    const r = runEval(trialsFor(v));
    setReport(r);
    log('eval.run', `Offline eval on ${r.ruleSet}: gate ${r.gate.toUpperCase()}${r.failed.length ? ` (failed: ${r.failed.join(', ')})` : ''}; ${r.pairs} pairs, ${r.labels} criterion labels.`);
    if (v === 'previous' || v === 'candidate') markTour('eval');
  };
  const runEvery = () => {
    const out: Record<string, EvalReport> = {};
    for (const v of ORDER) out[v] = runEval(trialsFor(v));
    setAll(out);
    markTour('eval');
    log('eval.run', `Offline eval on every ruleset: ${ORDER.map((v) => `${out[v].ruleSet} ${out[v].gate}`).join(', ')}.`);
  };
  const download = () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `eval-${report.ruleSet}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const edits = Object.keys(s.rules).length;
  const labels = Object.keys(CRIT_TRUTH).length + Object.keys(CRIT_TRUTH_AGENT).length;
  return (
    <div>
      <h1>Offline eval harness</h1>
      <p className="muted">PRD section 9: no prompt, model or rule change ships unless the offline suite passes. This runs the real engine and the real agent over a hand-labelled golden set and applies the PRD’s thresholds. Two rows are safety rows with zero tolerance.</p>
      <Banner tone="info"><b>Scope.</b> The golden set here is synthetic: 11 patients, {goldPairs().length} patient-trial pairs and {labels} criterion labels, written by hand from the chart text so they can disagree with the engine. The PRD’s real set is 200 pairs labelled by two coordinators and adjudicated by an oncologist. The method is the same; the sample is small, so subgroup figures illustrate the method rather than prove anything.</Banner>

      <div className="card">
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          <div style={{ width: 380 }}>
            <label htmlFor="variant">Ruleset under test</label>
            <select id="variant" value={variant} onChange={(e) => setVariant(e.target.value as Variant)}>
              {ORDER.map((v) => <option key={v} value={v}>{VARIANT_INFO[v].label}</option>)}
            </select>
          </div>
          <button className="btn pri" onClick={() => run(variant)}>Run the gate</button>
          <button className="btn" onClick={runEvery}>Compare all four</button>
        </div>
        <p className="muted small" style={{ margin: '8px 0 0' }}>{VARIANT_INFO[variant].note}{variant === 'current' && (edits > 0 || s.amendments.length > 0) ? ` ${edits} rule decision(s) and ${s.amendments.length} amendment(s) are in force. The golden set predates them, so differences are expected until it is re-adjudicated.` : ''}</p>
      </div>

      {all && (
        <>
          <Sec title="Release gate by ruleset" />
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Ruleset</th><th>Gate</th><th>Failing metrics</th></tr></thead>
              <tbody>{ORDER.map((v) => (
                <tr key={v}><td><b>{all[v].ruleSet}</b><div className="small muted">{VARIANT_INFO[v].label}</div></td>
                  <td><span className={`seal ${all[v].gate === 'pass' ? 'ok' : 'bad'}`}>{all[v].gate === 'pass' ? 'Ship' : 'Blocked'}</span></td>
                  <td className="small">{all[v].failed.length ? all[v].failed.join(', ') : 'None'}</td></tr>))}</tbody>
            </table>
          </div>
          {all.previous.gate === 'fail' && <Banner tone="warn"><b>Before you roll back:</b> the rollback target (1.3.2) fails the same gate. It brings back the stale-lab defect that 1.4.0 fixed, so a rollback is only safe if the target passes.</Banner>}
        </>
      )}

      {report && (
        <>
          <Sec title={`Result: ${report.ruleSet}`} note={`${report.pairs} pairs · ${report.labels} criterion labels`} />
          <Banner tone={report.gate === 'pass' ? 'info' : 'bad'}>
            {report.gate === 'pass' ? <><b>Gate passed.</b> Every metric is at or above its threshold.</> : <><b>Gate failed: do not ship.</b> {report.failed.length} metric(s) below threshold: {report.failed.join(', ')}.</>}
          </Banner>
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Metric</th><th>Level</th><th>Threshold</th><th>Result</th><th>n</th><th>Gate</th></tr></thead>
              <tbody>{report.metrics.map((m) => (
                <tr key={m.id} style={m.critical && !m.pass ? { background: 'var(--not-bg)' } : undefined}>
                  <td>{m.name}{m.critical && <span className="chip notmet" style={{ marginLeft: 6 }}>safety</span>}</td><td>{m.level}</td><td>{m.threshold}</td><td><b>{m.display}</b></td><td className="muted">{m.n}</td>
                  <td><span className={`chip ${m.pass ? 'met' : 'notmet'}`}>{m.pass ? 'Pass' : 'Fail: blocks release'}</span></td></tr>))}</tbody>
            </table>
          </div>

          {report.failures.length > 0 && (
            <>
              <Sec title="What failed" count={report.failures.length} />
              <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
                <table><thead><tr><th>Metric</th><th>Case</th><th>Adjudicated</th><th>System said</th></tr></thead>
                  <tbody>{report.failures.slice(0, 40).map((f, i) => <tr key={i}><td><span className="chip gray">{f.metric}</span></td><td className="mono">{f.subject}</td><td className="small">{f.expected}</td><td className="small"><b>{f.got}</b></td></tr>)}</tbody></table>
              </div>
            </>
          )}

          <Sec title="Subgroup accuracy" note="Pair-level state accuracy by group. Groups are tiny, so this shows the method." />
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table><thead><tr><th>Attribute</th><th>Group</th><th>Pairs</th><th>Accuracy</th></tr></thead>
              <tbody>{report.groups.map((g) => <tr key={g.attribute + g.value}><td>{g.attribute}</td><td>{g.value}</td><td className="muted">{g.n}</td><td>{g.accuracy}%{g.n < 10 && <span className="chip gray" style={{ marginLeft: 6 }}>small n</span>}</td></tr>)}</tbody></table>
          </div>
          <div className="row" style={{ marginTop: 10 }}><button className="btn sm" onClick={download}>Download report (JSON)</button></div>
        </>
      )}
    </div>
  );
}
