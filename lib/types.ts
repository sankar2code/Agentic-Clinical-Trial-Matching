export type FactKey =
  | 'diagnosis' | 'histology' | 'stage' | 'age' | 'ecog' | 'egfr' | 'pdl1'
  | 'egfrMut' | 'alkFusion' | 'krasG12c' | 'brainMets' | 'priorLines'
  | 'steroidDose' | 'strongCyp3a4' | 'anc' | 'platelets' | 'lvef' | 'bilirubin';

export type Val = number | string | boolean;

export type SourceKind = 'FHIR' | 'Note' | 'Pathology PDF' | 'Genomic PDF' | 'Imaging' | 'Scanned report';

export interface InlineDoc {
  title: string;
  date: string;
  text: string;
  scanned?: boolean;
}

export interface Source {
  kind: SourceKind;
  resource: string; // e.g. Observation, Condition, DiagnosticReport, DocumentReference
  id: string;
  label: string;
  docId?: string;
  span?: string; // exact text span in the document that supports the value
  inlineDoc?: InlineDoc; // for documents that arrive after the chart was loaded (monitoring events)
}

export interface Fact {
  key: FactKey;
  value: Val;
  date: string; // ISO yyyy-mm-dd
  source: Source;
  confidence?: number; // 0..1, only for NLP-extracted values
  by?: 'ehr' | 'nlp' | 'agent';
  /** Guardrail demo: the first value the (simulated) extractor proposed, which the deterministic check rejects. */
  firstAttempt?: Val;
}

export interface Doc {
  id: string;
  type: string;
  title: string;
  date: string;
  scanned?: boolean;
  language?: string;
  text: string;
}

export interface Patient {
  id: string;
  name: string;
  mrn: string;
  age: number;
  sex: 'F' | 'M';
  language: string;
  race: string;
  headline: string;
  visit: string;
  treating: boolean; // treating relationship (EHR access rule)
  facts: Fact[];
  hidden: Fact[]; // present in documents but not yet extracted; agent can discover
  externalOnly: FactKey[]; // result exists only in an external lab portal
  externalNote?: string;
  docs: Doc[];
  scenario: string; // what this patient demonstrates
  tags: string[];
}

export type Op = '>=' | '<=' | '>' | '<' | '==' | '!=' | 'in';

export interface Rule {
  fact: FactKey;
  op: Op;
  value: Val | string[];
  windowDays?: number;
}

export type ReviewStatus = 'approved' | 'pending' | 'rejected';

export interface Criterion {
  id: string;
  type: 'inclusion' | 'exclusion';
  text: string;
  rule: Rule;
  review: ReviewStatus;
  parseConfidence: number;
  unknownStep: string;
  /** Set when a protocol amendment replaced this criterion; the old wording is kept for the diff. */
  amended?: { amendment: string; from: { text: string; type: 'inclusion' | 'exclusion'; rule: Rule } };
}

export interface Trial {
  id: string;
  nct: string;
  code: string;
  title: string;
  phase: string;
  sponsor: string;
  disease: 'NSCLC' | 'SCLC' | 'Mesothelioma';
  stages: string[];
  status: 'Recruiting' | 'Not yet recruiting' | 'Suspended' | 'Active, not recruiting';
  siteStatus: 'Open' | 'Enrollment full' | 'Closed to accrual';
  siteMiles: number;
  enrolled: number;
  target: number;
  arm: string;
  criteria: Criterion[];
  ruleSet: string;
  hiddenUntilOpened?: boolean;
  /** Ids of protocol amendments applied to this trial, in order. */
  amendments?: string[];
  /** Fixture for the PI funnel: how many patients a month the site has historically enrolled, and when accrual closes. */
  pacePerMonth?: number;
  closesOn?: string;
}

export type CStatus = 'met' | 'notmet' | 'unknown' | 'review' | 'pending';

export interface Override {
  to: 'met' | 'notmet';
  reason: 'wrong value' | 'wrong source' | 'outdated evidence' | 'wrong rule' | 'clinical judgement';
  note: string;
  /** Required when overriding to Met without system evidence (PRD section 6: no Met without a citation). */
  citation?: string;
  by: string;
  at: string;
  original: CStatus;
}

export interface CritResult {
  criterion: Criterion;
  status: CStatus;
  evidence: Fact[];
  message: string;
  nextStep?: string;
  stale?: boolean;
  conflict?: boolean;
  lowConfidence?: boolean;
  override?: Override;
  attested?: boolean; // Met by clinician attestation rather than system evidence
  resolvable?: boolean; // agent could plausibly find it in the chart
}

export type MatchState = 'eligible' | 'near' | 'ineligible' | 'filtered';

export interface RankParts { state: number; fit: number; site: number; distance: number; enrollment: number }

export interface TrialMatch {
  trial: Trial;
  state: MatchState;
  results: CritResult[];
  counts: Record<CStatus, number>;
  fit: number;
  rank: number;
  rankParts: RankParts;
  filterReason?: string;
  siteFull: boolean;
  unknownKeys: FactKey[];
  blockers: string[];
}

export interface Dismissal { reason: string; note: string; by: string; at: string }

export type DraftKind = 'referral' | 'records-request';

export interface Referral {
  id: string;
  kind: DraftKind;
  patientId: string;
  trialId: string;
  fact?: FactKey; // for records requests: the missing result being requested
  body: string;
  status: 'draft' | 'approved' | 'rejected';
  createdAt: string;
  decidedBy?: string;
  decidedAt?: string;
  /** When a coordinator last re-ran the match and the evidence still held. A change to the protocol after this date flags the referral. */
  confirmedAt?: string;
  edited?: boolean;
  worklist: 'new' | 'screening' | 'consented' | 'declined' | 'screen-failed';
  versions: string; // model, prompt and rule-set versions in force when drafted
  requestedBy: string;
}

export interface SnapRow { t: string; c: string; s: CStatus; e: string[] }
export interface SnapTrial { code: string; state: MatchState; met: number; notmet: number; unknown: number; review: number; pending: number }
export interface Snapshot { trials: SnapTrial[]; rows: SnapRow[] }

export interface AuditEntry {
  id: number;
  ts: string;
  actor: string;
  role: string;
  action: string;
  patientId?: string;
  trialId?: string;
  detail: string;
  versions: string;
  snapshot?: Snapshot;
  /** The as-of date the results were evaluated for (differs from today when time travelling). */
  asOf?: string;
  /** Fields the PD-L1 style regression drill had switched off when these results were computed, so a replay can switch them off too. */
  drill?: FactKey[];
  /** Tamper-evident chain: hash of the previous entry, and hash of this one including that link. */
  prevHash?: string;
  hash?: string;
}

export type Role = 'oncologist' | 'coordinator' | 'pi' | 'informaticist' | 'governance';

export interface UsageEvent {
  ts: string;
  role: Role;
  kind: 'patient.open' | 'trial.open' | 'evidence.open' | 'agent.ask' | 'dwell';
  patientId?: string;
  trialId?: string;
  key?: FactKey;
  ms?: number;
}

export type Mode = 'shadow' | 'hitl' | 'steady';
export type Verdict = 'agree' | 'disagree';
export interface Adjudication { verdict: Verdict; reason?: Override['reason']; note?: string; by: string; at: string }
export interface DoubleReview { coordinator?: Verdict; governance?: Verdict }
export type ManualDecision = 'eligible' | 'not eligible' | 'not screened';
/** `hash` is the hash of the exact text that was approved: approval stops counting when the text changes. */
export interface HandoutRecord { status: 'draft' | 'approved'; interpreterReviewed: boolean; by?: string; at?: string; hash?: string }
export interface Telemetry { ts: string; kind: 'engine' | 'agent' | 'ehr'; ok: boolean; ms?: number; steps?: number; tokens?: number; cost?: number; capHit?: boolean; patientId?: string; detail?: string; key?: string }
