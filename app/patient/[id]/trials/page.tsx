'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { FACT_LABEL, TODAY, fmtVal } from '@/lib/data';
import { matchAll, undismissed } from '@/lib/engine';
import { PERM_HINT, useApp } from '@/lib/store';
import { useAgent } from '@/lib/useAgent';
import AskPanel from '@/components/AskPanel';
import ChartData from '@/components/ChartData';
import PathTab from '@/components/PathTab';
import TrialCard from '@/components/TrialCard';
import { signatureOf, snapshotOf } from '@/lib/engine';
import { MANUAL_SEED, goldPairs, pairKey } from '@/lib/golden';
import { SAMPLE_RATE, isoWeek, sampleFor } from '@/lib/rollout';
import { Banner, EvidenceModal, Field, Modal, Sec } from '@/components/ui';
import type { Fact, TrialMatch } from '@/lib/types';

const DISMISS = ['Patient preference', 'Clinically inappropriate', 'Logistics / distance', 'Already screened', 'Other'];

export default function PatientTrials() {
  const { id } = useParams<{ id: string }>();
  const app = useApp();
  const { s, trials, patient, mctx, can, logOnce, recordMatch, dismiss, restore, toggleWatch, track, telem, adjudicate, setManual, markTour, shadowHidden } = app;
  const p = patient(id);
  const { run, ask } = useAgent(id);
  const [tab, setTab] = useState<'trials' | 'path' | 'chart'>('trials');
  const [disagree, setDisagree] = useState<TrialMatch | null>(null);
  const [loading, setLoading] = useState(false);
  const [showFiltered, setShowFiltered] = useState(false);
  const [showInel, setShowInel] = useState(false);
  const [watchOnly, setWatchOnly] = useState(false);
  const [dismissFor, setDismissFor] = useState<TrialMatch | null>(null);
  const [evi, setEvi] = useState<Fact | null>(null);

  useEffect(() => {
    if (s.sim.ehr !== 'slow') return;
    setLoading(true);
    const t = setTimeout(() => setLoading(false), 2200);
    return () => clearTimeout(t);
  }, [id, s.sim.ehr]);

  // The engine is timed where it runs, so the figure does not drift when the page re-renders.
  const { matches, ms } = useMemo(() => {
    if (!p || !p.treating) return { matches: [] as TrialMatch[], ms: 0 };
    const t0 = performance.now();
    const m = matchAll(p, trials, mctx());
    return { matches: m, ms: Math.max(1, Math.round(performance.now() - t0)) };
  }, [p, trials, s.overlay, s.overrides, s.queryDate, s.sim.regression]); // eslint-disable-line react-hooks/exhaustive-deps

  const allowed = !!p && p.treating && s.sim.ehr !== 'down';
  useEffect(() => {
    if (!p) return;
    if (!p.treating) { logOnce(`denied:${id}:${s.role}`, 'access.denied', `Opened ${p.name} without a treating relationship. No data was returned.`, id); return; }
    if (allowed) track('patient.open', { patientId: id });
  }, [id, allowed]); // eslint-disable-line react-hooks/exhaustive-deps
  // Every distinct set of results, with its evidence pointers, goes to the audit log exactly once.
  useEffect(() => {
    if (!allowed || !matches.length) return;
    recordMatch(id, matches);
    telem({ kind: 'engine', ok: true, ms, patientId: id, key: `eng:${id}:${signatureOf(snapshotOf(matches))}:${s.queryDate}:${s.sim.regression}` });
  }, [matches, allowed, s.sim.rollback]); // eslint-disable-line react-hooks/exhaustive-deps
  const mountedAt = useRef(Date.now());
  useEffect(() => { if (p?.treating && s.sim.ehr === 'down') telem({ kind: 'ehr', ok: false, patientId: id, detail: 'FHIR endpoint unavailable', key: `ehr:${id}:${mountedAt.current}` }); }, [id, s.sim.ehr]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!p) return <Banner tone="bad">Unknown patient.</Banner>;
  if (!p.treating) {
    return (
      <div>
        <h1>{p.name}</h1>
        <Banner tone="bad"><b>Access restricted.</b> You do not have a treating relationship with this patient. Trial Match follows the EHR’s existing access rules and shows no data. This attempt was recorded in the audit log.</Banner>
        <Link href="/">Back to schedule</Link>
      </div>
    );
  }
  if (s.sim.ehr === 'down') {
    return (
      <div>
        <h1>{p.name}</h1>
        <Banner tone="bad"><b>Trial Match is unavailable.</b> The EHR FHIR endpoint is not responding. No partial results are shown because they could mislead. Try again shortly or screen manually per protocol.</Banner>
      </div>
    );
  }

  // Rollout mode (PRD section 9). In shadow mode the system runs and logs, but clinicians and coordinators do not see its results.
  if (shadowHidden) {
    const mine = goldPairs().filter((g) => g.pid === id);
    return (
      <div>
        <h1>{p.name} <span className="muted" style={{ fontWeight: 400, fontSize: 15 }}>{p.age}{p.sex} · MRN {p.mrn}</span></h1>
        <Banner tone="rev"><b>Shadow mode.</b> The system is running on this chart and logging its results, but they are hidden from clinicians and coordinators while it is compared against manual screening. Screen as usual. The AI governance reviewer can see the comparison on the Rollout page.</Banner>
        {s.role === 'coordinator' ? (
          <>
            <Sec title="Your screening decisions" note="Recorded as you work; compared with the system later" />
            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
              <table><thead><tr><th>Trial</th><th>Your decision</th></tr></thead><tbody>
                {mine.map((g) => { const key = pairKey(g.pid, g.tid); const t = trials.find((x) => x.id === g.tid)!; return (
                  <tr key={key}><td><b>{t.code}</b><div className="small muted">{t.title}</div></td>
                    <td style={{ width: 200 }}><select aria-label={`Decision for ${t.code}`} value={s.manualScreens[key] ?? MANUAL_SEED[key] ?? 'not screened'} onChange={(e) => setManual(key, e.target.value as 'eligible')}><option>eligible</option><option>not eligible</option><option>not screened</option></select></td></tr>); })}
              </tbody></table>
            </div>
          </>
        ) : <div className="card muted">As the treating oncologist you screen the chart yourself in this mode. Nothing here is hidden from you except the system’s results.</div>}
      </div>
    );
  }

  const live = matches.filter((m) => m.state !== 'filtered');
  const sampleKeys = sampleFor(goldPairs().map((g) => pairKey(g.pid, g.tid)), SAMPLE_RATE, isoWeek(s.queryDate));
  // A dismissed trial is no longer a recommendation: it has no card to adjudicate and should not drive the plan.
  const kept = undismissed(live, s.dismissals, id);
  const reco = kept.filter((m) => m.state === 'eligible' || m.state === 'near');
  const adjudicatedHere = reco.filter((m) => s.adjudications[pairKey(id, m.trial.id)]).length;
  const dismissed = live.filter((m) => s.dismissals[`${id}|${m.trial.id}`]);
  const shown = (arr: TrialMatch[]) => arr.filter((m) => !s.dismissals[`${id}|${m.trial.id}`] && (!watchOnly || s.watchlist.includes(m.trial.id)));
  const eligible = shown(live.filter((m) => m.state === 'eligible'));
  const near = shown(live.filter((m) => m.state === 'near'));
  const inel = shown(live.filter((m) => m.state === 'ineligible'));
  const filtered = matches.filter((m) => m.state === 'filtered');

  const conflicts = live.flatMap((m) => m.results.filter((r) => r.conflict).map((r) => ({ m, r })));
  const staleKeys = Array.from(new Set(live.flatMap((m) => (m.state === 'ineligible' ? [] : m.results.filter((r) => r.stale))).map((r) => r.criterion.rule.fact)));

  const card = (m: TrialMatch) => (
    <TrialCard key={m.trial.id} m={m} pid={id} run={run} watching={s.watchlist.includes(m.trial.id)} onWatch={() => toggleWatch(m.trial.id)}
      canDismiss={can('dismiss')} dismissHint={PERM_HINT.dismiss} onDismiss={() => setDismissFor(m)}
      today={s.queryDate} mode={s.mode} adj={s.adjudications[pairKey(id, m.trial.id)]} canAdjudicate={can('adjudicate')} adjudicateHint={PERM_HINT.adjudicate}
      onAdjudicate={(v) => (v === 'agree' ? adjudicate(pairKey(id, m.trial.id), 'agree') : setDisagree(m))} sampled={sampleKeys.includes(pairKey(id, m.trial.id))} />
  );

  return (
    <div>
      <div className="row between wrap">
        <div>
          <h1>{p.name} <span className="muted" style={{ fontWeight: 400, fontSize: 15 }}>{p.age}{p.sex} · MRN {p.mrn}</span></h1>
          <p className="muted" style={{ marginBottom: 4 }}>{p.headline}</p>
        </div>
        <div className="col" style={{ alignItems: 'flex-end', gap: 2 }}>
          <Link className="btn sm" href={`/patient/${id}/brief`}>Visit brief and handout</Link>
          <span className="chip met">Engine result in {ms} ms</span>
          <span className="muted small">{trials.length} trials · {filtered.length} filtered before any LLM call</span>
        </div>
      </div>

      {s.mode === 'hitl' && reco.length > 0 && <Banner tone="info"><b>Human-in-the-loop.</b> Adjudicate each recommendation as agree or disagree. {adjudicatedHere} of {reco.length} done for this patient.</Banner>}
      {s.mode === 'shadow' && <Banner tone="rev"><b>Shadow mode (reviewer view).</b> Clinicians and coordinators cannot see this page.</Banner>}
      {s.queryDate !== TODAY && <Banner tone="warn"><b>Simulated date {s.queryDate}.</b> Every result below is evaluated as of this date. Decisions (overrides, approvals, adjudication, drafts) are paused until you reset it from the date chip in the top bar.</Banner>}
      {s.sim.ehr === 'slow' && <Banner tone="warn"><b>FHIR is rate-limited.</b> Queries are batched and cached; the engine loads first and the agent enriches rows in place.</Banner>}
      {p.language !== 'English' && <Banner tone="rev"><b>Notes in {p.language}.</b> Extraction confidence is lower for non-English text, so values from those notes are labelled and verified before use. Equity is tracked as a subgroup metric.</Banner>}
      {conflicts.length > 0 && (
        <Banner tone="rev"><b>Conflicting sources.</b> {FACT_LABEL[conflicts[0].r.criterion.rule.fact]}: {conflicts[0].r.evidence.map((f) => `${fmtVal(f.key, f.value)} (${f.source.label}, ${f.date})`).join(' vs ')}. The system does not pick one. Open the checklist to adjudicate.</Banner>
      )}
      {staleKeys.length > 0 && (
        <Banner tone="warn"><b>Stale evidence.</b> {staleKeys.map((k) => FACT_LABEL[k]).join(', ')} {staleKeys.length > 1 ? 'are' : 'is'} outside the trial time window and shown as Unknown. A new draw is needed; the agent cannot fix this from existing notes.</Banner>
      )}

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'trials'} className={tab === 'trials' ? 'on' : ''} onClick={() => setTab('trials')}>Trials</button>
        <button role="tab" aria-selected={tab === 'path'} className={tab === 'path' ? 'on' : ''} onClick={() => { setTab('path'); markTour('path'); }}>Path to eligibility</button>
        <button role="tab" aria-selected={tab === 'chart'} className={tab === 'chart' ? 'on' : ''} onClick={() => setTab('chart')}>Chart data used</button>
      </div>

      {tab === 'chart' ? <ChartData p={p} overlay={s.overlay} today={s.queryDate} /> : tab === 'path' ? (
        <div className="grid2">
          <PathTab p={p} matches={undismissed(matches, s.dismissals, id)} trials={trials} ctx={mctx()} today={s.queryDate} searched={app.searchedFor(id)} canAsk={can('ask') && app.quotaLeft > 0} ask={ask} busy={!!run?.running} />
          <aside className="col askcol"><AskPanel pid={id} run={run} ask={ask} onEvidence={setEvi} /></aside>
        </div>
      ) : (
        <div className="grid2">
          <div>
            {loading ? <><div className="skel" /><div className="skel" /><div className="skel" /></> : (
              <>
                <label className="row" style={{ margin: 0, fontWeight: 400, color: 'var(--ink)' }}><input type="checkbox" style={{ width: 'auto' }} checked={watchOnly} onChange={(e) => setWatchOnly(e.target.checked)} /> Watchlist only</label>
                <Sec title="Likely eligible" count={eligible.length} note="All evaluated criteria met, each with a citation" />
                <div className="col">{eligible.map(card)}{eligible.length === 0 && <div className="card muted">No likely-eligible trial right now.{near.length ? ' See near-eligible below.' : ''}</div>}</div>
                <Sec title="Near-eligible" count={near.length} note="No failed criteria; open items shown" />
                <div className="col">{near.map(card)}{near.length === 0 && <div className="card muted">None.</div>}</div>

                <div className="sec"><h2>Not eligible ({inel.length})</h2><button className="btn sm" aria-expanded={showInel} onClick={() => setShowInel(!showInel)}>{showInel ? 'Hide' : 'Show'}</button></div>
                {showInel && <div className="col">{inel.map(card)}</div>}
                {eligible.length + near.length === 0 && inel.length > 0 && !showInel && <Banner tone="info">No eligible or near-eligible trials. Expand “Not eligible” to see the exact blocking criteria for each trial.</Banner>}

                <div className="sec"><h2>Filtered out ({filtered.length})</h2><button className="btn sm" aria-expanded={showFiltered} onClick={() => setShowFiltered(!showFiltered)}>{showFiltered ? 'Hide' : 'Show'}</button><span className="muted small">Deterministic pre-filter, no model cost</span></div>
                {showFiltered && (
                  <div className="card tight"><table><tbody>{filtered.map((m) => <tr key={m.trial.id}><td><b>{m.trial.code}</b></td><td className="small muted">{m.filterReason}</td></tr>)}</tbody></table></div>
                )}

                {dismissed.length > 0 && (
                  <>
                    <Sec title="Dismissed" count={dismissed.length} />
                    <div className="card tight">{dismissed.map((m) => { const d = s.dismissals[`${id}|${m.trial.id}`]; return (
                      <div key={m.trial.id} className="row between"><span><b>{m.trial.code}</b> <span className="muted small">{d.reason}{d.note ? ` · ${d.note}` : ''} · {d.by}</span></span>
                        <button className="btn sm" disabled={!can('dismiss')} onClick={() => restore(id, m.trial.id)}>Restore</button></div>); })}</div>
                  </>
                )}
              </>
            )}
          </div>
          <aside className="col askcol">
            <AskPanel pid={id} run={run} ask={ask} onEvidence={setEvi} />
          </aside>
        </div>
      )}

      {evi && <EvidenceModal fact={evi} patient={p} onClose={() => setEvi(null)} />}
      {disagree && <DisagreeModal m={disagree} onClose={() => setDisagree(null)} onSave={(reason, note) => { adjudicate(pairKey(id, disagree.trial.id), 'disagree', reason, note); setDisagree(null); }} />}
      {dismissFor && <DismissModal m={dismissFor} onClose={() => setDismissFor(null)} onSave={(r, n) => { dismiss(id, dismissFor.trial.id, r, n); setDismissFor(null); }} />}
    </div>
  );
}

function DismissModal({ m, onClose, onSave }: { m: TrialMatch; onClose: () => void; onSave: (r: string, n: string) => void }) {
  const [r, setR] = useState(DISMISS[0]);
  const [n, setN] = useState('');
  return (
    <Modal title={`Dismiss ${m.trial.code}`} onClose={onClose}>
      <div className="col">
        <Field label="Reason"><select value={r} onChange={(e) => setR(e.target.value)}>{DISMISS.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Note"><input value={n} onChange={(e) => setN(e.target.value)} /></Field>
        <button className="btn pri" onClick={() => onSave(r, n)}>Dismiss and log</button>
      </div>
    </Modal>
  );
}

const REASONS = ['wrong value', 'wrong source', 'outdated evidence', 'wrong rule', 'clinical judgement'] as const;
function DisagreeModal({ m, onClose, onSave }: { m: TrialMatch; onClose: () => void; onSave: (r: (typeof REASONS)[number], n: string) => void }) {
  const [r, setR] = useState<(typeof REASONS)[number]>(REASONS[0]);
  const [n, setN] = useState('');
  return (
    <Modal title={`Disagree with ${m.trial.code}`} onClose={onClose}>
      <p className="muted">The reason code routes the fix: extraction errors to ML, rule errors to the informaticist, confirmed cases into the golden set.</p>
      <div className="col">
        <Field label="Reason code (required)"><select value={r} onChange={(e) => setR(e.target.value as (typeof REASONS)[number])}>{REASONS.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Note"><textarea style={{ minHeight: 70 }} value={n} onChange={(e) => setN(e.target.value)} /></Field>
        <button className="btn pri" onClick={() => onSave(r, n)}>Record disagreement</button>
      </div>
    </Modal>
  );
}
