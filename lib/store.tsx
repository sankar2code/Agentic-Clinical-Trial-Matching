'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PATIENTS, ROLLBACK_VERSIONS, TODAY, TRIALS, VERSIONS, ago } from './data';
import { AMENDMENTS } from './amendments';
import { GENESIS, anchorHead, chainEntry, repairLog, tamperLog, type Anchor, type TamperState } from './chain';
import { diffMatches, isIsoDate, matchAll, matchTrial, overrideKey, signatureOf, snapshotOf } from './engine';
import { canDo, hiddenByShadow, isSimulated, PERM_HINT, type Action } from './perm';
import { reconfirmation } from './referral';
import { isoWeek, reviewKey } from './rollout';
import { buildTrials, type AppliedAmendment } from './trials';
import type {
  Adjudication, AuditEntry, DoubleReview, DraftKind, Dismissal, Fact, FactKey, HandoutRecord, ManualDecision, Mode, Override, Patient, ReviewStatus,
  Referral, Role, Rule, Snapshot, Telemetry, Trial, TrialMatch, UsageEvent, Verdict,
} from './types';

export const ROLE_INFO: Record<Role, { name: string; title: string; home: string }> = {
  oncologist: { name: 'Dr. Anika Rao', title: 'Treating oncologist', home: '/' },
  coordinator: { name: 'Jonah Mensah', title: 'Research coordinator', home: '/worklist' },
  pi: { name: 'Dr. Lena Okafor', title: 'Principal investigator', home: '/trials' },
  informaticist: { name: 'Sam Ortiz', title: 'Clinical informaticist', home: '/admin/criteria' },
  governance: { name: 'Priya Shah', title: 'AI governance reviewer', home: '/audit' },
};

export { PERM_HINT };
export type { Action };

/** PRD section 10: per-user query limits. A small number so the limit is easy to see in a demo. */
export const AGENT_QUOTA = 10;

export interface MonEvent { id: number; ts: string; kind: 'lab' | 'report' | 'trial' | 'rule' | 'amendment' | 'system'; text: string; diffs: string[] }

export interface Sim { agent: 'normal' | 'down' | 'timeout'; ehr: 'normal' | 'slow' | 'down'; rollback: boolean; /** Regression drill: PD-L1 extraction silently stops working. */ regression: boolean }

export type { TamperState };

export interface State {
  role: Role;
  overlay: Record<string, Fact[]>;
  overrides: Record<string, Override>;
  dismissals: Record<string, Dismissal>;
  referrals: Referral[];
  audit: AuditEntry[];
  rules: Record<string, { review: ReviewStatus; by: string; rule?: Rule; at: string }>;
  opened: string[];
  amendments: AppliedAmendment[];
  sim: Sim;
  events: MonEvent[];
  watchlist: string[];
  seen: Record<string, boolean>;
  lastSig: Record<string, string>;
  quota: Partial<Record<Role, number>>;
  usage: UsageEvent[];
  telemetry: Telemetry[];
  searched: Record<string, FactKey[]>; // negative-result cache: values searched for with no result, per chart version
  queryDate: string; // the as-of date every result is evaluated for
  handouts: Record<string, HandoutRecord>;
  anchors: Anchor[];
  tamper: TamperState | null;
  mode: Mode;
  adjudications: Record<string, Adjudication>;
  doubleReviews: Record<string, DoubleReview>;
  manualScreens: Record<string, ManualDecision>;
  tour: Record<string, boolean>;
}

const INITIAL: State = {
  role: 'oncologist', overlay: {}, overrides: {}, dismissals: {}, referrals: [], audit: [], rules: {}, opened: [], amendments: [],
  sim: { agent: 'normal', ehr: 'normal', rollback: false, regression: false }, events: [], watchlist: ['t1'], seen: {}, lastSig: {}, quota: {}, usage: [], telemetry: [],
  searched: {}, queryDate: TODAY, handouts: {}, anchors: [], tamper: null, mode: 'hitl', adjudications: {}, doubleReviews: {}, manualScreens: {}, tour: {},
};

// Bump when the persisted shape changes so an old browser state never crashes the new build.
const KEY = 'ctm-mockup-v3';

export function effectiveTrials(s: Pick<State, 'rules' | 'opened' | 'amendments'>): Trial[] {
  return buildTrials(TRIALS, s.rules, s.opened, s.amendments);
}

const STATUS_WORD: Record<string, string> = { met: 'Met', notmet: 'Not met', unknown: 'Unknown', review: 'Needs review', pending: 'Rule pending', eligible: 'likely eligible', near: 'near-eligible', ineligible: 'not eligible', filtered: 'filtered out', 'not loaded': 'not loaded' };
const word = (x: string) => STATUS_WORD[x] ?? x;

export const dropFor = (sim: Sim): FactKey[] | undefined => (sim.regression ? ['pdl1'] : undefined);

function describeDiff(before: TrialMatch[], after: TrialMatch[]): string[] {
  const d = diffMatches(before, after);
  return [
    ...d.states.map((x) => `${x.trial}: ${word(x.from)} → ${word(x.to)}`),
    ...d.criteria.map((x) => `${x.trial}, "${x.text}": ${word(x.from)} → ${word(x.to)}`),
  ];
}

interface Ctx {
  s: State;
  ready: boolean;
  trials: Trial[];
  versions: typeof VERSIONS;
  versionStamp: string;
  fullStamp: string;
  actor: string;
  can: (a: Action) => boolean;
  quotaLeft: number;
  /** True while the as-of date is simulated: decisions and drafts are paused. */
  paused: boolean;
  /** True when shadow mode hides the system's results from the current role. */
  shadowHidden: boolean;
  setRole: (r: Role) => void;
  patient: (id: string) => Patient | undefined;
  mctx: () => { overlay: Record<string, Fact[]>; overrides: Record<string, Override>; today: string; dropNlp?: FactKey[] };
  addFacts: (pid: string, facts: Fact[], detail: string) => void;
  override: (pid: string, tid: string, cid: string, o: Omit<Override, 'by' | 'at'>, text: string) => void;
  clearOverride: (pid: string, tid: string, cid: string) => void;
  dismiss: (pid: string, tid: string, reason: string, note: string) => void;
  restore: (pid: string, tid: string) => void;
  draft: (pid: string, tid: string, body: string, kind?: DraftKind, fact?: FactKey) => string;
  editReferral: (id: string, body: string) => void;
  decideReferral: (id: string, d: 'approved' | 'rejected') => void;
  setWorklist: (id: string, st: Referral['worklist']) => void;
  rerunReferral: (id: string) => void;
  setReview: (tid: string, cid: string, review: ReviewStatus, rule?: Rule, text?: string) => void;
  log: (action: string, detail: string, pid?: string, tid?: string) => void;
  logOnce: (key: string, action: string, detail: string, pid?: string, tid?: string) => void;
  recordMatch: (pid: string, matches: TrialMatch[]) => void;
  setSim: (p: Partial<Sim>) => void;
  simLab: () => void;
  simReport: () => void;
  simTrial: () => void;
  fillQuota: () => void;
  consumeRun: () => void;
  searchedFor: (pid: string) => FactKey[];
  markSearched: (pid: string, keys: FactKey[]) => void;
  track: (kind: UsageEvent['kind'], extra?: Partial<UsageEvent>) => void;
  telem: (e: Omit<Telemetry, 'ts'>) => void;
  toggleWatch: (tid: string) => void;
  markSeen: (k: string) => void;
  setQueryDate: (d: string) => void;
  applyNextAmendment: () => void;
  setHandout: (key: string, patch: Partial<HandoutRecord>, detail?: string, pid?: string, tid?: string) => void;
  anchorNow: () => void;
  tamperAudit: (id: number, kind: 'edit' | 'rewrite', detail: string) => void;
  undoTamper: () => void;
  setMode: (m: Mode) => void;
  adjudicate: (pair: string, verdict: Verdict, reason?: Override['reason'], note?: string) => void;
  secondReview: (pair: string, slot: 'coordinator' | 'governance', verdict: Verdict) => void;
  setManual: (pair: string, d: ManualDecision) => void;
  markTour: (id: string, on?: boolean) => void;
  reset: () => void;
}

const C = createContext<Ctx | null>(null);
export const useApp = () => {
  const v = useContext(C);
  if (!v) throw new Error('useApp outside provider');
  return v;
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<State>(INITIAL);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setS({ ...INITIAL, ...parsed, sim: { ...INITIAL.sim, ...(parsed.sim ?? {}) } });
      }
    } catch { /* ignore a corrupt or blocked store */ }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage full or blocked: the app still works for the session */ }
  }, [s, ready]);

  const versions = s.sim.rollback ? ROLLBACK_VERSIONS : VERSIONS;
  const actor = ROLE_INFO[s.role].name;
  const trials = useMemo(() => effectiveTrials(s), [s.rules, s.opened, s.amendments]); // eslint-disable-line react-hooks/exhaustive-deps
  const vs = `${versions.model} · ${versions.prompt} · ${versions.rules}`;
  const versionStamp = `${versions.rules} · ${versions.prompt}`;

  // Every entry is chained to the one before it with SHA-256, so any later edit is detectable (PRD: audit log is append-only).
  const withLog = (st: State, action: string, detail: string, pid?: string, tid?: string, as?: Role, snapshot?: Snapshot): State => {
    const role = as ?? st.role;
    const prev = st.audit[st.audit.length - 1]?.hash ?? GENESIS;
    const entry = chainEntry(prev, {
      id: st.audit.length + 1, ts: new Date().toISOString(), actor: ROLE_INFO[role].name, role: ROLE_INFO[role].title, action, patientId: pid, trialId: tid,
      detail: st.queryDate !== TODAY ? `${detail} [as-of ${st.queryDate}]` : detail, versions: vs, snapshot, asOf: st.queryDate, drill: snapshot ? dropFor(st.sim) : undefined,
    });
    return { ...st, audit: [...st.audit, entry] };
  };

  const log = useCallback((action: string, detail: string, pid?: string, tid?: string) => setS((st) => withLog(st, action, detail, pid, tid)), [vs]); // eslint-disable-line react-hooks/exhaustive-deps
  // Atomic: the check and the write happen in one state update, so a double-invoked effect cannot log twice.
  const logOnce = useCallback((key: string, action: string, detail: string, pid?: string, tid?: string) => setS((st) => (st.seen[key] ? st : withLog({ ...st, seen: { ...st.seen, [key]: true } }, action, detail, pid, tid))), [vs]); // eslint-disable-line react-hooks/exhaustive-deps

  const recordMatch = useCallback((pid: string, matches: TrialMatch[]) => setS((st) => {
    const snap = snapshotOf(matches);
    const sig = signatureOf(snap) + vs + st.queryDate;
    if (st.lastSig[pid] === sig) return st;
    const first = st.lastSig[pid] === undefined;
    const c = (k: string) => snap.trials.filter((t) => t.state === k).length;
    const detail = `${first ? 'Engine-only match run' : 'Match re-run after evidence, rules or the as-of date changed'}: ${snap.trials.length} live trials, ${c('eligible')} likely eligible, ${c('near')} near-eligible, ${c('ineligible')} not eligible. ${snap.rows.length} criterion results stored with evidence pointers.`;
    return withLog({ ...st, lastSig: { ...st.lastSig, [pid]: sig } }, first ? 'match.run' : 'match.rerun', detail, pid, undefined, undefined, snap);
  }), [vs]); // eslint-disable-line react-hooks/exhaustive-deps

  const mc = (st: State) => ({ overlay: st.overlay, overrides: st.overrides, today: st.queryDate, dropNlp: dropFor(st.sim) });
  // Decisions and drafts are made against today's chart. Every writer of one returns the state untouched while the date is simulated.
  const paused = (st: State) => isSimulated(st.queryDate);
  const patientMatches = (st: State, pid: string) => matchAll(PATIENTS.find((x) => x.id === pid)!, effectiveTrials(st), mc(st));

  // Re-screen every patient you can see and report which trial states moved.
  const cohortChanges = (before: State, after: State): string[] => {
    const out: string[] = [];
    for (const p of PATIENTS.filter((x) => x.treating)) {
      const d = diffMatches(patientMatches(before, p.id), patientMatches(after, p.id));
      d.states.forEach((x) => out.push(`${p.name}: ${x.trial} ${word(x.from)} → ${word(x.to)}`));
    }
    return out;
  };

  const ctx: Ctx = {
    s, ready, trials, versions, versionStamp, fullStamp: vs, actor,
    can: (a) => canDo(s.role, a, s.queryDate),
    quotaLeft: Math.max(0, AGENT_QUOTA - (s.quota[s.role] ?? 0)),
    paused: isSimulated(s.queryDate),
    shadowHidden: hiddenByShadow(s.mode, s.role),
    setRole: (r) => setS((st) => withLog({ ...st, role: r }, 'role.switch', `Switched demo role to ${ROLE_INFO[r].title}`, undefined, undefined, r)),
    patient: (id) => PATIENTS.find((p) => p.id === id),
    mctx: () => mc(s),
    log, logOnce, recordMatch,
    addFacts: (pid, facts, detail) => setS((st) => {
      const have = st.overlay[pid] ?? [];
      const fresh = facts.filter((f) => !have.some((h) => h.key === f.key && h.date === f.date && String(h.value) === String(f.value) && h.source.id === f.source.id));
      if (!fresh.length) return st;
      return withLog({ ...st, overlay: { ...st.overlay, [pid]: [...have, ...fresh] } }, 'agent.resolve', detail, pid);
    }),
    override: (pid, tid, cid, o, text) => setS((st) => paused(st) ? st : withLog({
      ...st, overrides: { ...st.overrides, [overrideKey(pid, tid, cid)]: { ...o, by: ROLE_INFO[st.role].name, at: new Date().toISOString() } },
    }, 'criterion.override', `${text}: ${o.original} → ${o.to}. Reason code: ${o.reason}. ${o.note}${o.citation ? ` Citation: ${o.citation}` : ''}`, pid, tid)),
    clearOverride: (pid, tid, cid) => setS((st) => {
      if (paused(st)) return st;
      const next = { ...st.overrides };
      delete next[overrideKey(pid, tid, cid)];
      return withLog({ ...st, overrides: next }, 'criterion.override.cleared', `Removed override on ${cid}`, pid, tid);
    }),
    dismiss: (pid, tid, reason, note) => setS((st) => paused(st) ? st : withLog({
      ...st, dismissals: { ...st.dismissals, [`${pid}|${tid}`]: { reason, note, by: ROLE_INFO[st.role].name, at: new Date().toISOString() } },
    }, 'trial.dismiss', `Dismissed trial. Reason: ${reason}. ${note}`, pid, tid)),
    restore: (pid, tid) => setS((st) => {
      if (paused(st)) return st;
      const next = { ...st.dismissals };
      delete next[`${pid}|${tid}`];
      return withLog({ ...st, dismissals: next }, 'trial.restore', 'Restored dismissed trial', pid, tid);
    }),
    draft: (pid, tid, body, kind = 'referral', fact) => {
      const id = `r${Date.now()}${Math.floor(Math.random() * 1000)}`;
      setS((st) => {
        if (paused(st)) return st;
        const clash = st.referrals.find((r) => r.patientId === pid && r.kind === kind && (kind === 'referral' ? r.trialId === tid : r.fact === fact) && r.status !== 'rejected');
        if (clash) return st; // never create a duplicate of a draft or approved item
        const r: Referral = { id, kind, patientId: pid, trialId: tid, fact, body, status: 'draft', createdAt: new Date().toISOString(), worklist: 'new', versions: vs, requestedBy: ROLE_INFO[st.role].name };
        return withLog({ ...st, referrals: [...st.referrals, r] }, kind === 'referral' ? 'referral.drafted' : 'records.drafted', kind === 'referral' ? 'Referral drafted (waiting for clinician approval)' : `Records request drafted for ${fact} (waiting for clinician approval)`, pid, tid);
      });
      return id;
    },
    editReferral: (id, body) => setS((st) => {
      const r = st.referrals.find((x) => x.id === id);
      if (!r || r.body === body || paused(st)) return st;
      return withLog({ ...st, referrals: st.referrals.map((x) => (x.id === id ? { ...x, body, edited: true } : x)) }, `${r.kind === 'referral' ? 'referral' : 'records'}.edited`, 'Clinician edited the draft before approval', r.patientId, r.trialId);
    }),
    decideReferral: (id, d) => setS((st) => {
      const r = st.referrals.find((x) => x.id === id);
      if (!r || r.status !== 'draft' || paused(st)) return st;
      const pre = r.kind === 'referral' ? 'referral' : 'records';
      return withLog({ ...st, referrals: st.referrals.map((x) => (x.id === id ? { ...x, status: d, decidedBy: ROLE_INFO[st.role].name, decidedAt: new Date().toISOString() } : x)) }, `${pre}.${d}`, d === 'approved' ? (r.kind === 'referral' ? 'Referral approved and released to the coordinator worklist' : 'Records request approved and released to Health Information Management') : 'Rejected; nothing sent', r.patientId, r.trialId);
    }),
    setWorklist: (id, stt) => setS((st) => {
      const r = st.referrals.find((x) => x.id === id);
      if (paused(st)) return st;
      return withLog({ ...st, referrals: st.referrals.map((x) => (x.id === id ? { ...x, worklist: stt } : x)) }, 'worklist.status', `Coordinator set status to ${stt}`, r?.patientId, r?.trialId);
    }),
    // A real re-run: the match is computed again under the rules in force now, its results are stored with their evidence, and the
    // referral is re-confirmed only if the patient is still a candidate. Otherwise it stays flagged for the treating clinician.
    rerunReferral: (id) => setS((st) => {
      const r = st.referrals.find((x) => x.id === id);
      const p = r && PATIENTS.find((x) => x.id === r.patientId);
      const t = r && effectiveTrials(st).find((x) => x.id === r.trialId);
      if (!r || !p || !t || paused(st)) return st;
      const m = matchTrial(p, t, mc(st));
      const { holds, detail } = reconfirmation(m, versionStamp);
      const referrals = holds ? st.referrals.map((x) => (x.id === id ? { ...x, versions: vs, confirmedAt: new Date().toISOString() } : x)) : st.referrals;
      return withLog({ ...st, referrals }, 'worklist.rerun', detail, r.patientId, r.trialId, undefined, snapshotOf([m]));
    }),
    setReview: (tid, cid, review, rule, text) => setS((st) => {
      const after: State = { ...st, rules: { ...st.rules, [`${tid}|${cid}`]: { review, rule, by: ROLE_INFO[st.role].name, at: new Date().toISOString() } } };
      let next = withLog(after, `rule.${review}`, text ?? `Rule ${cid} ${review}`, undefined, tid);
      const changes = cohortChanges(st, after);
      if (changes.length) {
        const code = TRIALS.find((t) => t.id === tid)?.code ?? tid;
        const live = effectiveTrials(after).find((t) => t.id === tid);
        const allApproved = !!live && live.criteria.every((c) => c.review === 'approved');
        const ev: MonEvent = { id: next.events.length + 1, ts: new Date().toISOString(), kind: 'rule', text: `A rule change for ${code} re-screened the cohort${allApproved ? '. All of its rules are approved, so the trial is live' : ''}.`, diffs: changes };
        next = withLog({ ...next, events: [...next.events, ev] }, 'monitor.rescreen', ev.text, undefined, tid);
      }
      return next;
    }),
    setSim: (p) => setS((st) => withLog({ ...st, sim: { ...st.sim, ...p } }, 'sim.change', `Scenario control: ${JSON.stringify(p)}`)),
    simLab: () => setS((st) => {
      const f: Fact = { key: 'egfr', value: 68, date: TODAY, by: 'ehr', source: { kind: 'FHIR', resource: 'Observation', id: 'obs-p2-egfr-new', label: 'Observation: eGFR (CKD-EPI), new result' } };
      if ((st.overlay.p2 ?? []).some((x) => x.source.id === f.source.id)) return st;
      const after = { ...st, overlay: { ...st.overlay, p2: [...(st.overlay.p2 ?? []), f] } };
      const diffs = describeDiff(patientMatches(st, 'p2'), patientMatches(after, 'p2'));
      const ev: MonEvent = { id: st.events.length + 1, ts: new Date().toISOString(), kind: 'lab', text: 'New eGFR 68 mL/min for Robert Alvarez arrived from the event feed. The patient was re-screened automatically.', diffs: diffs.length ? diffs : ['No criterion changed.'] };
      return withLog({ ...after, events: [...st.events, ev] }, 'monitor.rescreen', ev.text, 'p2');
    }),
    simReport: () => setS((st) => {
      const f: Fact = {
        key: 'krasG12c', value: true, date: ago(2), by: 'ehr', confidence: 0.97,
        source: {
          kind: 'Genomic PDF', resource: 'DiagnosticReport', id: 'dr-p5-guardant', label: 'Guardant360 report (now scanned into the chart)', span: 'KRAS: G12C mutation detected',
          inlineDoc: { title: 'Guardant360 liquid biopsy report', date: ago(2), text: 'GUARDANT360 CDx — PLASMA\nKRAS: G12C mutation detected (VAF 4.1%).\nEGFR: no alterations detected.\nALK: no fusions detected.' },
        },
      };
      if ((st.overlay.p5 ?? []).some((x) => x.source.id === f.source.id)) return st;
      const after = { ...st, overlay: { ...st.overlay, p5: [...(st.overlay.p5 ?? []), f] } };
      const diffs = describeDiff(patientMatches(st, 'p5'), patientMatches(after, 'p5'));
      const ev: MonEvent = { id: st.events.length + 1, ts: new Date().toISOString(), kind: 'report', text: 'The Guardant360 report for Priya Raman was scanned into the chart: KRAS G12C detected. The patient was re-screened.', diffs: diffs.length ? diffs : ['No criterion changed.'] };
      return withLog({ ...after, events: [...st.events, ev] }, 'monitor.rescreen', ev.text, 'p5');
    }),
    simTrial: () => setS((st) => {
      if (st.opened.includes('t9')) return st;
      const ev: MonEvent = { id: st.events.length + 1, ts: new Date().toISOString(), kind: 'trial', text: 'NOVA-SHP2 (NCT06100909) opened and synced from ClinicalTrials.gov. Six criteria were drafted by the model and queued for informatics review. Patients are only near-eligible until each rule is approved.', diffs: [] };
      return withLog({ ...st, opened: [...st.opened, 't9'], events: [...st.events, ev] }, 'trial.ingested', ev.text, undefined, 't9');
    }),
    fillQuota: () => setS((st) => withLog({ ...st, quota: { ...st.quota, [st.role]: AGENT_QUOTA } }, 'sim.change', `Scenario control: agent quota filled for ${ROLE_INFO[st.role].title}`)),
    consumeRun: () => setS((st) => ({ ...st, quota: { ...st.quota, [st.role]: (st.quota[st.role] ?? 0) + 1 } })),
    // The cache key changes when a new document or result arrives for the patient, which invalidates it. The agent's own findings do not.
    searchedFor: (pid) => s.searched[`${pid}@${(s.overlay[pid] ?? []).filter((f) => f.by !== 'agent').length}`] ?? [],
    markSearched: (pid, keys) => setS((st) => {
      const k = `${pid}@${(st.overlay[pid] ?? []).filter((f) => f.by !== 'agent').length}`;
      const have = st.searched[k] ?? [];
      const next = Array.from(new Set([...have, ...keys]));
      return next.length === have.length ? st : { ...st, searched: { ...st.searched, [k]: next } };
    }),
    // Page-view style events are ignored when the identical event was just recorded, so a double-invoked effect cannot inflate analytics.
    track: (kind, extra) => setS((st) => {
      const last = st.usage[st.usage.length - 1];
      const now = Date.now();
      const same = last && last.kind === kind && last.role === st.role && last.patientId === extra?.patientId && last.trialId === extra?.trialId && last.key === extra?.key;
      if (same && kind !== 'dwell' && kind !== 'agent.ask' && now - Date.parse(last.ts) < 1500) return st;
      return { ...st, usage: [...st.usage, { ts: new Date(now).toISOString(), role: st.role, kind, ...extra }].slice(-600) };
    }),
    // Operational telemetry. An event with a key is recorded once per key, so a re-render cannot inflate the numbers.
    telem: (e) => setS((st) => {
      if (e.key && st.telemetry.some((t) => t.key === e.key)) return st;
      return { ...st, telemetry: [...st.telemetry, { ts: new Date().toISOString(), ...e }].slice(-500) };
    }),
    toggleWatch: (tid) => setS((st) => ({ ...st, watchlist: st.watchlist.includes(tid) ? st.watchlist.filter((x) => x !== tid) : [...st.watchlist, tid] })),
    markSeen: (k) => setS((st) => (st.seen[k] ? st : { ...st, seen: { ...st.seen, [k]: true } })),
    setQueryDate: (d) => setS((st) => (st.queryDate === d || !isIsoDate(d) ? st : withLog({ ...st, queryDate: d }, 'sim.change', d === TODAY ? 'Time travel reset to the real as-of date' : `Time travel: results now evaluated as of ${d}`))),
    applyNextAmendment: () => setS((st) => {
      const next = AMENDMENTS.find((a) => !st.amendments.some((x) => x.id === a.id));
      if (!next) return st;
      const after: State = { ...st, amendments: [...st.amendments, { id: next.id, appliedAt: new Date().toISOString() }] };
      const code = TRIALS.find((t) => t.id === next.trialId)?.code ?? next.trialId;
      const changes = cohortChanges(st, after);
      const ev: MonEvent = {
        id: st.events.length + 1, ts: new Date().toISOString(), kind: 'amendment',
        text: `${next.version} for ${code} was posted on ClinicalTrials.gov (${next.summary}) ${next.changes.length} criterion change${next.changes.length > 1 ? 's' : ''} went back to review and are not evaluated until a reviewer approves them.`,
        diffs: changes.length ? changes : ['No patient changed state yet.'],
      };
      return withLog({ ...after, events: [...st.events, ev] }, 'trial.amended', ev.text, undefined, next.trialId);
    }),
    setHandout: (key, patch, detail, pid, tid) => setS((st) => {
      if (paused(st)) return st;
      const cur = st.handouts[key] ?? { status: 'draft' as const, interpreterReviewed: false };
      const next: HandoutRecord = { ...cur, ...patch };
      const withH = { ...st, handouts: { ...st.handouts, [key]: next } };
      return detail ? withLog(withH, `handout.${next.status}`, detail, pid, tid) : withH;
    }),
    anchorNow: () => setS((st) => {
      const anchors = anchorHead(st.audit, st.anchors, !!st.tamper, new Date().toISOString());
      if (!anchors) return st;
      const a = anchors[anchors.length - 1];
      return withLog({ ...st, anchors }, 'audit.anchor', `Anchored the audit head (entry ${a.count}, ${a.head.slice(0, 12)}…) to write-once storage`);
    }),
    tamperAudit: (id, kind, detail) => setS((st) => {
      if (st.tamper) return st;
      const r = tamperLog(st.audit, id, kind, detail);
      return r ? { ...st, audit: r.audit, tamper: r.tamper } : st;
    }),
    undoTamper: () => setS((st) => {
      if (!st.tamper) return st;
      const r = repairLog(st.audit, st.anchors, st.tamper);
      return { ...st, audit: r.audit, anchors: r.anchors, tamper: null };
    }),
    setMode: (m) => setS((st) => (st.mode === m ? st : withLog({ ...st, mode: m }, 'rollout.mode', `Rollout mode changed from ${st.mode} to ${m}`))),
    adjudicate: (pair, verdict, reason, note) => setS((st) => {
      if (paused(st)) return st;
      const [pid, tid] = pair.split('|');
      const a: Adjudication = { verdict, reason, note, by: ROLE_INFO[st.role].name, at: new Date().toISOString() };
      return withLog({ ...st, adjudications: { ...st.adjudications, [pair]: a } }, 'recommendation.adjudicated', `Clinician ${verdict === 'agree' ? 'agreed with' : 'disagreed with'} the recommendation${reason ? ` (${reason})` : ''}. ${note ?? ''}`.trim(), pid, tid);
    }),
    secondReview: (pair, slot, verdict) => setS((st) => {
      const [pid, tid] = pair.split('|');
      const key = reviewKey(isoWeek(st.queryDate), pair);
      const cur = st.doubleReviews[key] ?? {};
      return withLog({ ...st, doubleReviews: { ...st.doubleReviews, [key]: { ...cur, [slot]: verdict } } }, 'sample.reviewed', `${slot === 'coordinator' ? 'Coordinator' : 'Governance reviewer'} ${verdict === 'agree' ? 'agreed with' : 'disagreed with'} the sampled result`, pid, tid);
    }),
    setManual: (pair, d) => setS((st) => {
      const [pid, tid] = pair.split('|');
      return withLog({ ...st, manualScreens: { ...st.manualScreens, [pair]: d } }, 'shadow.manual', `Coordinator recorded a manual screening decision: ${d}`, pid, tid);
    }),
    markTour: (id, on = true) => setS((st) => ({ ...st, tour: { ...st.tour, [id]: on } })),
    reset: () => { setS(INITIAL); try { localStorage.removeItem(KEY); } catch { /* ignore */ } },
  };

  return <C.Provider value={ctx}>{children}</C.Provider>;
}
