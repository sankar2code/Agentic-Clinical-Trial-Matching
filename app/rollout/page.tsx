'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PATIENTS, TODAY, TRIALS } from '@/lib/data';
import { agentComplete, runEval } from '@/lib/eval';
import { MANUAL_SEED, MANUAL_WHY, goldPairs, pairKey } from '@/lib/golden';
import { matchAll } from '@/lib/engine';
import { MODE_INFO, SAMPLE_RATE, agreeRate, compareShadow, exitCriteria, isoWeek, recommendationsOf, reviewKey, reviewState, sampleFor, shadowStats } from '@/lib/rollout';
import { PERM_HINT, useApp } from '@/lib/store';
import { Banner, Sec, StateChip } from '@/components/ui';
import type { Mode, MatchState } from '@/lib/types';

const MODES: Mode[] = ['shadow', 'hitl', 'steady'];

export default function Rollout() {
  const { s, trials, mctx, can, setMode, adjudicate, secondReview, markTour } = useApp();
  const [tab, setTab] = useState<'mode' | 'shadow' | 'review'>('mode');
  const [source, setSource] = useState<'agent' | 'chart'>('agent');
  const live = useMemo(() => trials.filter((t) => !t.hiddenUntilOpened || s.opened.includes(t.id)), [trials, s.opened]);

  const ev = useMemo(() => runEval(live), [live]);
  const systemStates = (withAgent: boolean) => {
    const out: Record<string, MatchState> = {};
    for (const p of PATIENTS.filter((x) => x.treating)) {
      const overlay = withAgent ? agentComplete(p, live).overlay : [];
      for (const m of matchAll(p, live, { overlay: { [p.id]: overlay } })) if (m.state !== 'filtered') out[pairKey(p.id, m.trial.id)] = m.state;
    }
    return out;
  };
  // The real pipeline is chart plus agent. The toggle below only changes what the comparison table shows, never the gate.
  const sysAgent = useMemo(() => systemStates(true), [live]); // eslint-disable-line react-hooks/exhaustive-deps
  const sysChart = useMemo(() => (source === 'chart' ? systemStates(false) : {}), [live, source]); // eslint-disable-line react-hooks/exhaustive-deps
  const manual = { ...MANUAL_SEED, ...s.manualScreens };
  const rows = useMemo(() => compareShadow(source === 'agent' ? sysAgent : sysChart, manual), [sysAgent, sysChart, source, s.manualScreens]); // eslint-disable-line react-hooks/exhaustive-deps
  const stats = useMemo(() => shadowStats(rows), [rows]);
  const gateStats = useMemo(() => shadowStats(compareShadow(sysAgent, manual)), [sysAgent, s.manualScreens]); // eslint-disable-line react-hooks/exhaustive-deps
  const system = source === 'agent' ? sysAgent : sysChart;

  // Recommendations as the clinician sees them on today's chart, with this session's evidence and decisions. Exit criteria are
  // judged on the real date, not on a simulated one, and a trial the clinician dismissed has no card to adjudicate, so it is not counted.
  const recs = useMemo(() => recommendationsOf(PATIENTS, live, { ...mctx(), today: TODAY }, s.dismissals), [live, s.overlay, s.overrides, s.dismissals, s.sim.regression]); // eslint-disable-line react-hooks/exhaustive-deps
  const adjudicated = recs.filter((r) => s.adjudications[pairKey(r.pid, r.tid)]);
  const adjMap = Object.fromEntries(adjudicated.map((r) => [pairKey(r.pid, r.tid), s.adjudications[pairKey(r.pid, r.tid)]]));
  const rate = agreeRate(adjMap);

  const crit = exitCriteria(s.mode, { gatePass: ev.gate === 'pass', failedGate: ev.failed, stats: gateStats, recommendations: recs.length, adjudicated: adjudicated.length, agreeRate: rate, disagreements: adjudicated.length - adjudicated.filter((r) => s.adjudications[pairKey(r.pid, r.tid)].verdict === 'agree').length });
  const allOk = crit.every((c) => c.ok);
  const week = isoWeek(s.queryDate);
  const sampleKeys = sampleFor(goldPairs().map((g) => pairKey(g.pid, g.tid)), SAMPLE_RATE, week);
  const slot = s.role === 'coordinator' ? 'coordinator' : s.role === 'governance' ? 'governance' : null;

  const next: Record<Mode, Mode | null> = { shadow: 'hitl', hitl: 'steady', steady: null };
  const prev: Record<Mode, Mode | null> = { shadow: null, hitl: 'shadow', steady: 'hitl' };
  const nm = (id: string) => TRIALS.find((t) => t.id === id)?.code ?? id;
  const pn = (id: string) => PATIENTS.find((p) => p.id === id)?.name ?? id;

  return (
    <div>
      <h1>Rollout modes</h1>
      <p className="muted">PRD section 9: shadow first, then human-in-the-loop, then steady state with a weekly double-review. Each step is earned with evidence, not a button. Current mode: <b>{MODE_INFO[s.mode].label}</b>.</p>
      <div className="tabs" role="tablist">
        {([['mode', 'Mode and exit criteria'], ['shadow', 'Shadow comparison'], ['review', 'Adjudication and sampling']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>

      {tab === 'mode' && (
        <>
          <div className="gridc">
            {MODES.map((m) => (
              <div key={m} className={`card ${s.mode === m ? 'hl' : ''}`}>
                <div className="row between"><h2 style={{ margin: 0 }}>{MODE_INFO[m].label}</h2>{s.mode === m && <span className="chip brand">Current</span>}</div>
                <p className="small" style={{ margin: '6px 0' }}>{MODE_INFO[m].summary}</p>
                <p className="small muted" style={{ margin: 0 }}>{MODE_INFO[m].rule}</p>
              </div>
            ))}
          </div>

          <Sec title={s.mode === 'steady' ? 'Steady state' : `Exit criteria: ${MODE_INFO[s.mode].label} → ${MODE_INFO[next[s.mode]!].label}`} note="Computed live from the eval harness, the shadow comparison and your adjudications" />
          <div className="card">
            {s.mode === 'steady' ? <p className="muted">There is no further mode. Quality is held by the weekly double-review sample and the ops alerts.</p> : (
              <div className="col">{crit.map((c) => (
                <div key={c.id} className="row" style={{ alignItems: 'flex-start' }}><span className={c.ok ? 'ok-mark' : 'bad-mark'} style={{ width: 18 }}>{c.ok ? '✓' : '✕'}</span><span><b>{c.label}</b><br /><span className="small muted">{c.detail}</span></span></div>
              ))}</div>
            )}
            <div className="row wrap" style={{ marginTop: 12 }}>
              {next[s.mode] && <button className="btn pri" disabled={!can('mode') || !allOk} title={!can('mode') ? PERM_HINT.mode : !allOk ? 'Exit criteria are not all met' : ''} onClick={() => setMode(next[s.mode]!)}>Promote to {MODE_INFO[next[s.mode]!].label}</button>}
              {prev[s.mode] && <button className="btn dng" disabled={!can('mode')} title={can('mode') ? '' : PERM_HINT.mode} onClick={() => setMode(prev[s.mode]!)}>Demote to {MODE_INFO[prev[s.mode]!].label}</button>}
              {!can('mode') && <span className="muted small">{PERM_HINT.mode}.</span>}
            </div>
            {s.mode === 'hitl' && !allOk && <p className="small muted" style={{ marginTop: 8 }}>To unlock steady state, the treating oncologist adjudicates each recommendation on the patient pages, or use the “Adjudication and sampling” tab.</p>}
          </div>
          {ev.gate === 'fail' && (
            <Banner tone="bad"><b>The eval gate is failing on the current rules</b> ({ev.failed.join(', ')}). Promotion is blocked. See the <Link href="/eval">Eval harness</Link>.
              {(Object.keys(s.rules).length > 0 || s.amendments.length > 0) && <> {Object.keys(s.rules).length} reviewer decision(s) and {s.amendments.length} protocol amendment(s) have changed the rules since the golden set was labelled, so differences are expected. The set must be re-adjudicated against the new protocol before the next promotion.</>}</Banner>
          )}
        </>
      )}

      {tab === 'shadow' && (
        <>
          <p className="muted">While in shadow mode coordinators screen as usual, and the system’s result for the same patient and trial is logged beside theirs. “Truth” is the adjudicated label from the golden set.</p>
          <div className="row" style={{ marginBottom: 8 }}>
            <label className="row" style={{ margin: 0, fontWeight: 400, color: 'var(--ink)' }}>System result:
              <select style={{ width: 230, marginLeft: 8 }} value={source} onChange={(e) => setSource(e.target.value as 'agent')}><option value="agent">After the agent has run</option><option value="chart">Chart as it stands (engine only)</option></select></label>
          </div>
          <div className="gridc">
            <div className="card"><div className="muted small">Pairs compared</div><div className="kpi">{stats.n}</div></div>
            <div className="card"><div className="muted small">Agreement</div><div className="kpi">{stats.agreement}%</div><div className="small muted">Cohen’s kappa {stats.kappa}</div></div>
            <div className="card"><div className="muted small">System: precision / recall</div><div className="kpi">{stats.system.precision}% / {stats.system.recall}%</div><div className="small muted">{stats.system.tp} found, {stats.system.fp} wrongly flagged, {stats.system.fn} missed</div></div>
            <div className="card"><div className="muted small">Manual: precision / recall</div><div className="kpi">{stats.manual.precision}% / {stats.manual.recall}%</div><div className="small muted">{stats.manual.tp} found, {stats.manual.fp} wrongly flagged, {stats.manual.fn} missed</div></div>
          </div>
          {stats.incrementalFinds.length > 0 && <Banner tone="info"><b>The system found {stats.incrementalFinds.length} eligible patient{stats.incrementalFinds.length > 1 ? 's' : ''} that manual screening missed:</b> {stats.incrementalFinds.map((r) => `${pn(r.pid)} for ${nm(r.tid)}`).join('; ')}.</Banner>}
          {stats.catches.length > 0 && <Banner tone="info"><b>The system caught {stats.catches.length} wrongly flagged patient{stats.catches.length > 1 ? 's' : ''}:</b> {stats.catches.map((r) => `${pn(r.pid)} for ${nm(r.tid)}`).join('; ')}.</Banner>}
          <Sec title="Where they disagree" count={rows.filter((r) => !r.agree).length} />
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Patient and trial</th><th>Coordinator</th><th>System</th><th>Truth</th><th>Who was right</th><th>Why</th></tr></thead>
              <tbody>{rows.filter((r) => !r.agree || r.manualPos !== r.truthPos).map((r) => (
                <tr key={r.pair}>
                  <td><b>{pn(r.pid)}</b><div className="small muted">{nm(r.tid)}</div></td>
                  <td><span className={`chip ${r.manual === 'eligible' ? 'met' : 'gray'}`}>{r.manual}</span>{s.manualScreens[r.pair] && <div className="small muted">recorded this session</div>}</td>
                  <td><StateChip s={r.system} /></td><td><StateChip s={r.truth} /></td>
                  <td><span className={`chip ${r.right === 'system' ? 'brand' : r.right === 'manual' ? 'unknown' : r.right === 'both' ? 'met' : 'notmet'}`}>{r.right}</span></td>
                  <td className="small">{MANUAL_WHY[r.pair] ?? ''}</td>
                </tr>))}
                {rows.every((r) => r.agree && r.manualPos === r.truthPos) && <tr><td colSpan={6} className="muted">No disagreements.</td></tr>}</tbody>
            </table>
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>Coordinators record their own decisions on each patient page while the mode is Shadow. Switch to the coordinator role and open any patient to try it.</p>
        </>
      )}

      {tab === 'review' && (
        <>
          <Sec title="Human-in-the-loop adjudication" note={`${adjudicated.length} of ${recs.length} recommendations adjudicated · ${rate}% agreement`} />
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Patient and trial</th><th>System</th><th>Clinician</th><th /></tr></thead>
              <tbody>{recs.map((r) => { const a = s.adjudications[pairKey(r.pid, r.tid)]; return (
                <tr key={r.pid + r.tid}><td><b>{r.name}</b><div className="small muted">{r.code}</div></td><td><StateChip s={r.state} /></td>
                  <td>{a ? <span className={`chip ${a.verdict === 'agree' ? 'met' : 'notmet'}`}>{a.verdict}{a.reason ? `: ${a.reason}` : ''}</span> : <span className="muted small">not adjudicated</span>}</td>
                  <td><Link className="btn sm" href={`/patient/${r.pid}/trials`}>Open</Link></td></tr>); })}</tbody>
            </table>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn sm" disabled={!can('adjudicate') || adjudicated.length === recs.length} title={can('adjudicate') ? '' : PERM_HINT.adjudicate} onClick={() => { recs.filter((r) => !s.adjudications[pairKey(r.pid, r.tid)]).forEach((r) => adjudicate(pairKey(r.pid, r.tid), 'agree')); }}>Demo shortcut: agree with all remaining</button>
            <span className="muted small">Each one is logged as a real adjudication by the treating oncologist.</span>
          </div>

          <Sec title="Weekly double-review sample" note={`${SAMPLE_RATE}% of ${goldPairs().length} results, week ${week}, chosen deterministically`} />
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Sampled result</th><th>System</th><th>Coordinator</th><th>Governance</th><th>Reviewers</th></tr></thead>
              <tbody>{sampleKeys.map((k) => { const [pid, tid] = k.split('|'); const d = s.doubleReviews[reviewKey(week, k)]; const st = reviewState(d); const sys = system[k]; return (
                <tr key={k}><td><b>{pn(pid)}</b><div className="small muted">{nm(tid)}</div></td><td>{sys && <StateChip s={sys} />}</td>
                  {(['coordinator', 'governance'] as const).map((sl) => (
                    <td key={sl}>{d?.[sl] ? <span className={`chip ${d[sl] === 'agree' ? 'met' : 'notmet'}`}>{d[sl]}</span> : (
                      <span title={slot === sl ? '' : PERM_HINT.secondReview}>
                        <button className="btn sm" disabled={slot !== sl} onClick={() => { secondReview(k, sl, 'agree'); markTour('rollout'); }}>Agree</button>{' '}
                        <button className="btn sm dng" disabled={slot !== sl} onClick={() => secondReview(k, sl, 'disagree')}>Disagree</button></span>)}</td>))}
                  <td>{st.complete ? <span className={`chip ${st.agree ? 'met' : 'unknown'}`}>{st.agree ? 'reviewers agree' : 'reviewers differ: escalate'}</span> : <span className="muted small">awaiting both</span>}</td></tr>); })}</tbody>
            </table>
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>The sample is a hash of the week and the pair, so it is the same on every machine and nobody can choose which results get checked. Each sampled result needs two independent reviews: one from a coordinator and one from the governance reviewer.</p>
        </>
      )}
    </div>
  );
}
