'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { FACT_LABEL } from '@/lib/data';
import { runEval } from '@/lib/eval';
import { ROLE_INFO, useApp } from '@/lib/store';
import { Bar, Sec } from '@/components/ui';
import type { FactKey, Override, Role } from '@/lib/types';

// The North Star figures below are illustrative. The eval gate and the equity table are computed by the real harness.
const CHECK = ['AI governance review approved', 'InfoSec and Cyber review passed (pen test, PHI data-flow)', 'Cloud architecture review passed', 'EHR team integration approval', 'IRB determination for the pre-screening workflow', 'All offline eval thresholds met', 'Clinicians and coordinators trained', 'On-call rotation and downtime procedure in place'];
const EVAL_ITEM = 5;
const OPEN = ['Which disease group pilots first?', 'Does the trial system expose site-level enrollment via API?', 'Where do genomic results land: discrete, PDF, or portal?', 'Does pre-screening fit existing IRB policy?', 'Who signs off each structured rule?', 'Does regulatory agree with the non-device CDS position?', 'Which LLM provider has a BAA?'];

// PRD section 12: every override reason routes to a specific fix.
const ROUTE: Record<Override['reason'], string> = {
  'wrong value': 'ML backlog (extraction error)',
  'wrong source': 'ML backlog (retrieval error)',
  'wrong rule': 'Informaticist (rule error)',
  'outdated evidence': 'Golden set (confirmed case)',
  'clinical judgement': 'Golden set (confirmed case)',
};

export default function Metrics() {
  const { s, trials } = useApp();
  const live = useMemo(() => trials.filter((x) => !x.hiddenUntilOpened || s.opened.includes(x.id)), [trials, s.opened]);
  const report = useMemo(() => runEval(live), [live]);
  const evalPass = report.gate === 'pass';
  const [chk, setChk] = useState<boolean[]>(CHECK.map(() => false));
  const ov = Object.values(s.overrides);
  const byReason = ov.reduce<Record<string, number>>((a, o) => ({ ...a, [o.reason]: (a[o.reason] ?? 0) + 1 }), {});
  const agentFacts = Object.values(s.overlay).flat().filter((f) => f.by === 'agent').length;
  const humanResolved = ov.filter((o) => o.original === 'unknown').length;
  const drafts = s.referrals.length;
  const appr = s.referrals.filter((r) => r.status === 'approved').length;
  const edited = s.referrals.filter((r) => r.edited).length;
  const rej = s.referrals.filter((r) => r.status === 'rejected').length;
  const runs = s.audit.filter((e) => e.action === 'agent.run').length;
  const rejected = s.audit.filter((e) => e.action === 'agent.extraction.rejected').length;
  const agentCost = s.audit.filter((e) => e.action === 'agent.run').reduce((a, e) => a + Number(/~\$([\d.]+)/.exec(e.detail)?.[1] ?? 0), 0);
  const attested = ov.filter((o) => o.to === 'met' && o.citation).length;
  const opened = s.usage.filter((u) => u.kind === 'evidence.open').reduce<Record<string, number>>((a, u) => ({ ...a, [u.key!]: (a[u.key!] ?? 0) + 1 }), {});
  const asks = s.usage.filter((u) => u.kind === 'agent.ask').reduce<Record<string, number>>((a, u) => ({ ...a, [u.role]: (a[u.role] ?? 0) + 1 }), {});
  const reviewMin = s.usage.filter((u) => u.kind === 'dwell').reduce((a, u) => a + (u.ms ?? 0), 0) / 60000;
  const checklists = s.usage.filter((u) => u.kind === 'trial.open').length;
  return (
    <div>
      <h1>Metrics and readiness</h1>
      <p className="muted">The North Star cards are illustrative; baselines are measured in shadow mode. The eval gate and equity tables are computed live by the <Link href="/eval">eval harness</Link> on a small synthetic golden set. <b>This session</b> is measured live from what you do in the app.</p>

      <Sec title="North Star" note="illustrative figures" />
      <div className="gridc">
        <div className="card"><div className="muted small">Coordinator-confirmed matches / month</div><div className="kpi">+24%</div><div className="small muted">target +30% at 6 months · accuracy held ≥ 95%</div><Bar v={0.8} tone="warn" /></div>
        <div className="card"><div className="muted small">Coordinator screening time</div><div className="kpi">−46%</div><div className="small muted">target −50%</div><Bar v={0.92} /></div>
        <div className="card"><div className="muted small">Override rate</div><div className="kpi">7.8%</div><div className="small muted">target &lt; 10%, trending down</div><Bar v={0.78} tone="good" /></div>
        <div className="card"><div className="muted small">Unknowns resolved by agent</div><div className="kpi">43%</div><div className="small muted">target ≥ 40%</div><Bar v={1} tone="good" /></div>
      </div>

      <Sec title="Offline eval gate" note={`${report.ruleSet} · computed live on ${report.pairs} golden pairs`} />
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table><thead><tr><th>Metric</th><th>Level</th><th>Threshold</th><th>Current</th><th>Gate</th></tr></thead>
          <tbody>{report.metrics.map((m) => <tr key={m.id}><td>{m.name}</td><td>{m.level}</td><td>{m.threshold}</td><td>{m.display}</td><td><span className={`chip ${m.pass ? 'met' : 'notmet'}`}>{m.pass ? 'Pass' : 'Fail: blocks release'}</span></td></tr>)}</tbody></table>
      </div>
      <p className="small muted" style={{ marginTop: 6 }}>Run it against the rollback target and a candidate release on the <Link href="/eval">Eval harness</Link>. Quality and safety tools: <Link href="/guardrails">Guardrail lab</Link> · <Link href="/rollout">Rollout modes</Link> · <Link href="/ops">Ops dashboard</Link>.</p>

      <Sec title="Equity: pair-level accuracy by subgroup" note="Computed; groups are tiny" />
      <div className="card"><div className="col">{report.groups.map((g) => <div key={g.attribute + g.value} className="row"><span style={{ width: 210 }}>{g.attribute}: {g.value}</span><div className="grow"><Bar v={g.accuracy / 100} tone={g.accuracy < 95 ? 'warn' : 'good'} /></div><span style={{ width: 90, textAlign: 'right' }}>{g.accuracy}% <span className="muted small">n={g.n}</span></span></div>)}</div>
        <p className="small muted" style={{ marginTop: 8 }}>With this few patients a gap says nothing about the real world. It shows how the gate would catch one.</p></div>

      <Sec title="Cost budget" note="~$5,000 / month ceiling" />
      <div className="card"><div className="col">
        {[['Point-of-care match', 2200], ['Nightly re-screen (P2)', 750], ['Criteria parsing', 50]].map(([n, v]) => <div key={n as string} className="row"><span style={{ width: 190 }}>{n}</span><div className="grow"><Bar v={(v as number) / 5000} /></div><span style={{ width: 70, textAlign: 'right' }}>${v}</span></div>)}
        <div className="small muted">Planned total ≈ $3,000 of $5,000. Controls: deterministic pre-filter, per-data-version caching, 8-call cap and token budget per run.</div></div></div>

      <Sec title="This session (live)" note="Product intelligence: every override is a labeled data point" />
      <div className="gridc">
        <div className="card"><div className="kpi">{ov.length}</div><div className="small muted">overrides</div>{Object.entries(byReason).map(([k, v]) => <div className="small" key={k}>{k}: {v} → <span className="muted">{ROUTE[k as Override['reason']]}</span></div>)}{ov.length === 0 && <div className="small muted">None yet. Each reason code routes to ML, informatics, or the golden set.</div>}{attested > 0 && <div className="small" style={{ color: 'var(--rev)' }}>{attested} Met by clinician attestation (no system citation)</div>}</div>
        <div className="card"><div className="kpi">{runs}</div><div className="small muted">agent runs · ~${agentCost.toFixed(2)}</div><div className="small">{agentFacts} values resolved by the agent · {humanResolved} Unknowns resolved by a human override</div>{rejected > 0 && <div className="small" style={{ color: 'var(--unk)' }}>{rejected} extraction(s) rejected by the span check</div>}</div>
        <div className="card"><div className="kpi">{drafts}</div><div className="small muted">drafts (referrals and records requests)</div><div className="small">{appr} approved · {edited} edited · {rej} rejected</div></div>
        <div className="card"><div className="kpi">{s.audit.length}</div><div className="small muted">audit entries</div></div>
        <div className="card"><div className="kpi">{checklists}</div><div className="small muted">checklists opened · {reviewMin.toFixed(1)} min in review</div>
          {Object.entries(opened).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => <div className="small" key={k}>{FACT_LABEL[k as FactKey]} evidence opened {v}×</div>)}</div>
        <div className="card"><div className="small muted">Agent questions by user</div>{Object.entries(asks).map(([r, n]) => <div className="small" key={r}>{ROLE_INFO[r as Role].name}: {n}</div>)}{Object.keys(asks).length === 0 && <div className="small muted">None yet.</div>}</div>
      </div>

      <Sec title="Launch checklist" />
      <div className="card"><div className="col">{CHECK.map((c, i) => {
        const blocked = i === EVAL_ITEM && !evalPass;
        return (
          <label key={c} className="row" style={{ margin: 0, fontWeight: 400, color: 'var(--ink)' }}>
            <input type="checkbox" style={{ width: 'auto' }} disabled={blocked} checked={!blocked && chk[i]} onChange={() => setChk(chk.map((x, j) => (j === i ? !x : x)))} /> {c}
            {blocked && <span className="chip notmet">blocked: the eval gate is failing on {report.failed.join(', ')}</span>}
          </label>
        );
      })}
        <div className="small muted">{chk.filter((x, i) => x && !(i === EVAL_ITEM && !evalPass)).length} of {CHECK.length} complete.</div></div></div>

      <Sec title="Open questions from the PRD" />
      <div className="card"><ul style={{ margin: 0, paddingLeft: 18 }}>{OPEN.map((o) => <li key={o}>{o}</li>)}</ul></div>
    </div>
  );
}
