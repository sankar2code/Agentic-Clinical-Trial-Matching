import type { Criterion, Doc, Fact, FactKey, Patient, Rule, Source, SourceKind, Trial, Val } from './types';

// All data below is synthetic. Trial names and NCT-style IDs are fictional.
export const TODAY = '2026-10-06';
export const VERSIONS = { model: 'claude-sonnet (BAA tenant)', prompt: 'extract-v3.2', rules: 'ruleset-1.4.0' };
export const ROLLBACK_VERSIONS = { model: 'claude-sonnet (BAA tenant)', prompt: 'extract-v3.1', rules: 'ruleset-1.3.2' };

export function ago(days: number): string {
  const d = new Date(TODAY + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function src(kind: SourceKind, resource: string, id: string, label: string, docId?: string, span?: string): Source {
  return { kind, resource, id, label, docId, span };
}

function F(key: FactKey, value: Val, daysAgo: number, source: Source, by: Fact['by'] = 'ehr', confidence?: number): Fact {
  return { key, value, date: ago(daysAgo), source, by, confidence };
}

function doc(id: string, type: string, title: string, daysAgo: number, lines: string[], extra: Partial<Doc> = {}): Doc {
  return { id, type, title, date: ago(daysAgo), text: lines.join('\n'), ...extra };
}

const fhirObs = (id: string, label: string) => src('FHIR', 'Observation', id, label);
const fhirCond = (id: string, label: string) => src('FHIR', 'Condition', id, label);
const fhirMed = (id: string, label: string) => src('FHIR', 'MedicationRequest', id, label);

/* ---------------------------------- Patients --------------------------------- */

const p1docs: Doc[] = [
  doc('p1-path', 'Pathology', 'Surgical pathology — LLL core biopsy', 30, [
    'FINAL DIAGNOSIS: Adenocarcinoma of lung, left lower lobe.',
    'IHC: PD-L1 (22C3) Tumor Proportion Score: 80%.',
    'TTF-1 positive. Napsin A positive.',
  ]),
  doc('p1-ngs', 'Genomic', 'Tissue NGS panel (FoundationOne)', 28, [
    'EGFR: no sensitizing mutation detected.',
    'ALK: no rearrangement detected.',
    'KRAS: G12C not detected.',
  ]),
  doc('p1-onc', 'Oncology note', 'Oncology clinic note', 6, [
    'Stage IV adenocarcinoma, treatment-naive for metastatic disease.',
    'ECOG performance status 1. Ambulatory, mild exertional dyspnea.',
    'No prior systemic therapy.',
  ]),
  doc('p1-mri', 'Imaging', 'MRI brain with contrast', 21, ['IMPRESSION: No intracranial metastases.']),
];

const p2docs: Doc[] = [
  doc('p2-path', 'Pathology', 'Outside pathology report (faxed, scanned)', 52, [
    'SURGICAL PATHOLOGY — OUTSIDE FACILITY',
    'DIAGNOSIS: Non-small cell carcinoma, adenocarcinoma type.',
    'PD-L1 22C3 IHC: TPS 60 % (approx.)',
    'Specimen adequate. Scanned copy, OCR text below may contain errors.',
  ], { scanned: true }),
  doc('p2-onc', 'Oncology note', 'Oncology clinic note', 12, [
    'Stage IV NSCLC. ECOG 1. No prior systemic therapy.',
    'No steroid use. No neurologic symptoms.',
  ]),
  doc('p2-ngs', 'Genomic', 'Tissue NGS panel', 45, [
    'EGFR: wild type. ALK: no rearrangement.',
  ]),
  doc('p2-mri', 'Imaging', 'MRI brain', 30, ['No intracranial metastases.']),
];

const p3docs: Doc[] = [
  doc('p3-ngs-tissue', 'Genomic', 'Tissue NGS report', 70, [
    'EGFR exon 21 L858R mutation DETECTED (VAF 22%).',
    'ALK: no rearrangement.',
  ]),
  doc('p3-ngs-ctdna', 'Genomic', 'Plasma ctDNA report', 20, [
    'EGFR: no alterations detected in plasma. Low tumor shed possible; negative result does not exclude tissue mutation.',
  ]),
  doc('p3-path', 'Pathology', 'Pathology report — core biopsy', 70, [
    'Adenocarcinoma of lung.',
    'IHC: PD-L1 TPS 62%.',
  ]),
  doc('p3-onc', 'Oncology note', 'Oncology clinic note', 9, [
    'Stage IV adenocarcinoma. ECOG 1. One prior line: carboplatin/pemetrexed completed 2026-03.',
  ]),
];

const p4docs: Doc[] = [
  doc('p4-onc', 'Oncology note', 'Oncology clinic note', 4, [
    'Stage IV NSCLC, progression on second line. ECOG 3, spends most of the day in bed or chair.',
    'Brain metastases symptomatic, on dexamethasone 16 mg daily (prednisone-equivalent 107 mg).',
  ]),
  doc('p4-mri', 'Imaging', 'MRI brain', 14, ['IMPRESSION: Three enhancing lesions, largest 1.8 cm, consistent with metastases.']),
];

const p5docs: Doc[] = [
  doc('p5-onc', 'Oncology note', 'Oncology clinic note', 5, [
    'Stage IV adenocarcinoma. ECOG 1. Completed 4 cycles carboplatin/pemetrexed/pembrolizumab, progression on imaging.',
    'Guardant360 liquid biopsy sent 2026-09-12. Results available in the Guardant portal; report not yet scanned into the chart.',
  ]),
  doc('p5-path', 'Pathology', 'Surgical pathology', 120, ['Adenocarcinoma. PD-L1 22C3 TPS 10%.']),
];

const p6docs: Doc[] = [
  doc('p6-onc', 'Oncology note', 'Oncology clinic note', 3, [
    'Extensive-stage small cell lung cancer. ECOG 1. Treatment-naive.',
    'Brain MRI negative for metastases.',
  ]),
];

const p7docs: Doc[] = [
  doc('p7-surg', 'Surgical consult', 'Хирургическая консультация (Russian, with interpreter summary)', 8, [
    'Резектабельная аденокарцинома лёгкого, стадия IIA.',
    'Общее состояние: ECOG 0, полностью активна, работает полный день.',
    '(Interpreter summary: stage IIA, performance status 0, fully active.)',
  ], { language: 'ru' }),
  doc('p7-path', 'Pathology', 'Surgical pathology — wedge resection', 18, [
    'Adenocarcinoma, 3.4 cm, margins negative.',
    'PD-L1 22C3 TPS: 5%.',
    'EGFR: no mutation detected. ALK: negative by IHC.',
  ]),
];

const p9docs: Doc[] = [
  doc('p9-ngs', 'Genomic', 'Tissue NGS panel', 33, [
    'ALK: EML4-ALK fusion detected (variant 1).',
    'EGFR: no sensitizing mutation detected.',
    'KRAS: G12C not detected.',
  ]),
  doc('p9-path', 'Pathology', 'Surgical pathology', 38, ['Adenocarcinoma of lung.', 'PD-L1 22C3 TPS: 20%.']),
  doc('p9-onc', 'Oncology note', 'Oncology clinic note', 10, [
    'Stage IV adenocarcinoma, ALK-positive. ECOG 1.',
    'One prior line: carboplatin/pemetrexed completed 2026-06. Progressing on imaging.',
  ]),
];

const p10docs: Doc[] = [
  doc('p10-onc', 'Oncology note', 'Oncology clinic note', 5, [
    'Epithelioid pleural mesothelioma, stage III, unresectable.',
    'ECOG 1. Mild exertional dyspnea, otherwise active.',
    'Treatment-naive.',
  ]),
];

const p11docs: Doc[] = [
  doc('p11-ngs', 'Genomic', 'Tissue NGS panel', 21, [
    'EGFR exon 19 deletion detected.',
    'ALK: no rearrangement detected.',
    'KRAS: G12C not detected.',
  ]),
  doc('p11-path', 'Pathology', 'Surgical pathology', 26, ['Adenocarcinoma of lung.', 'PD-L1 22C3 TPS: 5%.']),
  doc('p11-onc', 'Oncology note', 'Oncology clinic note', 4, [
    'Stage IV adenocarcinoma, EGFR-mutant. ECOG 1. Treatment-naive for metastatic disease.',
    'Seizure disorder on carbamazepine 400 mg twice daily (strong CYP3A4 inducer). Neurology could switch to levetiracetam.',
  ]),
];

export const PATIENTS: Patient[] = [
  {
    tags: ['Clean match'], id: 'p1', name: 'Margaret Chen', mrn: '4400-1821', age: 67, sex: 'F', language: 'English', race: 'Asian',
    headline: 'Stage IV lung adenocarcinoma, PD-L1 80%', visit: 'Today 09:30 · Treatment planning', treating: true,
    scenario: 'Clean eligible match with every Met cited',
    docs: p1docs, hidden: [], externalOnly: [],
    facts: [
      F('age', 67, 0, fhirObs('Patient/p1', 'Patient demographics')),
      F('diagnosis', 'NSCLC', 120, fhirCond('c-p1-1', 'Condition: Malignant neoplasm of lower lobe, left bronchus or lung')),
      F('histology', 'adenocarcinoma', 30, src('Pathology PDF', 'DiagnosticReport', 'dr-p1-path', 'Surgical pathology', 'p1-path', 'Adenocarcinoma of lung, left lower lobe'), 'nlp', 0.98),
      F('stage', 'IV', 6, src('Note', 'DocumentReference', 'doc-p1-onc', 'Oncology clinic note', 'p1-onc', 'Stage IV adenocarcinoma'), 'nlp', 0.97),
      F('ecog', 1, 6, src('Note', 'DocumentReference', 'doc-p1-onc', 'Oncology clinic note', 'p1-onc', 'ECOG performance status 1'), 'nlp', 0.96),
      F('egfr', 72, 9, fhirObs('obs-p1-egfr', 'Observation: eGFR (CKD-EPI)')),
      F('pdl1', 80, 30, src('Pathology PDF', 'DiagnosticReport', 'dr-p1-path', 'Surgical pathology', 'p1-path', 'PD-L1 (22C3) Tumor Proportion Score: 80%'), 'nlp', 0.98),
      F('egfrMut', false, 28, src('Genomic PDF', 'DiagnosticReport', 'dr-p1-ngs', 'Tissue NGS panel', 'p1-ngs', 'EGFR: no sensitizing mutation detected'), 'nlp', 0.97),
      F('alkFusion', false, 28, src('Genomic PDF', 'DiagnosticReport', 'dr-p1-ngs', 'Tissue NGS panel', 'p1-ngs', 'ALK: no rearrangement detected'), 'nlp', 0.97),
      F('krasG12c', false, 28, src('Genomic PDF', 'DiagnosticReport', 'dr-p1-ngs', 'Tissue NGS panel', 'p1-ngs', 'KRAS: G12C not detected'), 'nlp', 0.97),
      F('brainMets', false, 21, src('Imaging', 'DiagnosticReport', 'dr-p1-mri', 'MRI brain', 'p1-mri', 'No intracranial metastases'), 'nlp', 0.99),
      F('priorLines', 0, 6, src('Note', 'DocumentReference', 'doc-p1-onc', 'Oncology clinic note', 'p1-onc', 'No prior systemic therapy'), 'nlp', 0.97),
      F('steroidDose', 0, 9, fhirMed('mr-p1-active', 'Active MedicationRequest list (no corticosteroids)')),
      F('anc', 3400, 9, fhirObs('obs-p1-anc', 'Observation: ANC')),
      F('strongCyp3a4', false, 7, fhirMed('mr-p1-interact', 'Medication review: no strong CYP3A4 inducers or inhibitors')),
      F('platelets', 245, 9, fhirObs('obs-p1-plt', 'Observation: Platelets')),
      F('lvef', 60, 50, fhirObs('obs-p1-lvef', 'Observation: LVEF (echo)')),
    ],
  },
  {
    tags: ['Agent resolves', 'Stale lab', 'Scanned PDF'], id: 'p2', name: 'Robert Alvarez', mrn: '4400-2377', age: 72, sex: 'M', language: 'English', race: 'Hispanic',
    headline: 'Stage IV NSCLC, PD-L1 only in a scanned outside report', visit: 'Today 10:15 · Follow-up', treating: true,
    scenario: 'Unknown resolved by agent from a scanned PDF (medium confidence) plus a stale lab the agent cannot fix',
    docs: p2docs, externalOnly: [],
    hidden: [
      F('pdl1', 60, 52, src('Scanned report', 'DocumentReference', 'doc-p2-path', 'Outside pathology report (scanned)', 'p2-path', 'PD-L1 22C3 IHC: TPS 60 %'), 'agent', 0.82),
    ],
    facts: [
      F('age', 72, 0, fhirObs('Patient/p2', 'Patient demographics')),
      F('diagnosis', 'NSCLC', 100, fhirCond('c-p2-1', 'Condition: Malignant neoplasm of bronchus or lung')),
      F('stage', 'IV', 12, src('Note', 'DocumentReference', 'doc-p2-onc', 'Oncology clinic note', 'p2-onc', 'Stage IV NSCLC'), 'nlp', 0.96),
      F('ecog', 1, 12, src('Note', 'DocumentReference', 'doc-p2-onc', 'Oncology clinic note', 'p2-onc', 'ECOG 1'), 'nlp', 0.95),
      F('egfr', 65, 41, fhirObs('obs-p2-egfr', 'Observation: eGFR (CKD-EPI)')),
      F('egfrMut', false, 45, src('Genomic PDF', 'DiagnosticReport', 'dr-p2-ngs', 'Tissue NGS panel', 'p2-ngs', 'EGFR: wild type'), 'nlp', 0.96),
      F('alkFusion', false, 45, src('Genomic PDF', 'DiagnosticReport', 'dr-p2-ngs', 'Tissue NGS panel', 'p2-ngs', 'ALK: no rearrangement'), 'nlp', 0.96),
      F('brainMets', false, 30, src('Imaging', 'DiagnosticReport', 'dr-p2-mri', 'MRI brain', 'p2-mri', 'No intracranial metastases'), 'nlp', 0.98),
      F('priorLines', 0, 12, src('Note', 'DocumentReference', 'doc-p2-onc', 'Oncology clinic note', 'p2-onc', 'No prior systemic therapy'), 'nlp', 0.95),
      F('steroidDose', 0, 12, fhirMed('mr-p2-active', 'Active MedicationRequest list (no corticosteroids)')),
      F('anc', 3100, 41, fhirObs('obs-p2-anc', 'Observation: ANC')),
      F('strongCyp3a4', false, 7, fhirMed('mr-p2-interact', 'Medication review: no strong CYP3A4 inducers or inhibitors')),
      F('platelets', 210, 41, fhirObs('obs-p2-plt', 'Observation: Platelets')),
      F('lvef', 57, 80, fhirObs('obs-p2-lvef', 'Observation: LVEF (echo)')),
    ],
  },
  {
    tags: ['Conflicting sources'], id: 'p3', name: 'Dorothy Williams', mrn: '4400-3052', age: 59, sex: 'F', language: 'English', race: 'Black',
    headline: 'Stage IV NSCLC, tissue and plasma EGFR results disagree', visit: 'Today 11:00 · Results review', treating: true,
    scenario: 'Conflicting sources: flagged as Needs review, never resolved silently',
    docs: p3docs, hidden: [], externalOnly: [],
    facts: [
      F('age', 59, 0, fhirObs('Patient/p3', 'Patient demographics')),
      F('diagnosis', 'NSCLC', 200, fhirCond('c-p3-1', 'Condition: Malignant neoplasm of bronchus or lung')),
      F('stage', 'IV', 9, src('Note', 'DocumentReference', 'doc-p3-onc', 'Oncology clinic note', 'p3-onc', 'Stage IV adenocarcinoma'), 'nlp', 0.97),
      F('ecog', 1, 9, src('Note', 'DocumentReference', 'doc-p3-onc', 'Oncology clinic note', 'p3-onc', 'ECOG 1'), 'nlp', 0.96),
      F('egfr', 88, 8, fhirObs('obs-p3-egfr', 'Observation: eGFR (CKD-EPI)')),
      F('pdl1', 62, 70, src('Pathology PDF', 'DiagnosticReport', 'dr-p3-path', 'Pathology report — core biopsy', 'p3-path', 'PD-L1 TPS 62%'), 'nlp', 0.93),
      F('egfrMut', true, 70, src('Genomic PDF', 'DiagnosticReport', 'dr-p3-ngs-t', 'Tissue NGS report', 'p3-ngs-tissue', 'EGFR exon 21 L858R mutation DETECTED'), 'nlp', 0.97),
      F('egfrMut', false, 20, src('Genomic PDF', 'DiagnosticReport', 'dr-p3-ngs-p', 'Plasma ctDNA report', 'p3-ngs-ctdna', 'EGFR: no alterations detected in plasma'), 'nlp', 0.95),
      F('alkFusion', false, 70, src('Genomic PDF', 'DiagnosticReport', 'dr-p3-ngs-t', 'Tissue NGS report', 'p3-ngs-tissue', 'ALK: no rearrangement'), 'nlp', 0.96),
      F('brainMets', false, 60, fhirObs('obs-p3-brain', 'Observation: Brain imaging result (negative)')),
      F('priorLines', 1, 9, src('Note', 'DocumentReference', 'doc-p3-onc', 'Oncology clinic note', 'p3-onc', 'One prior line: carboplatin/pemetrexed'), 'nlp', 0.94),
      F('steroidDose', 0, 8, fhirMed('mr-p3-active', 'Active MedicationRequest list (no corticosteroids)')),
      F('anc', 3900, 8, fhirObs('obs-p3-anc', 'Observation: ANC')),
      F('strongCyp3a4', false, 7, fhirMed('mr-p3-interact', 'Medication review: no strong CYP3A4 inducers or inhibitors')),
      F('platelets', 260, 8, fhirObs('obs-p3-plt', 'Observation: Platelets')),
      F('lvef', 58, 20, fhirObs('obs-p3-lvef', 'Observation: LVEF (echo)')),
    ],
  },
  {
    tags: ['No eligible trial'], id: 'p4', name: 'James O’Neill', mrn: '4400-4120', age: 64, sex: 'M', language: 'English', race: 'White',
    headline: 'Stage IV NSCLC, ECOG 3, brain metastases on high-dose steroids', visit: 'Today 13:45 · Goals of care', treating: true,
    scenario: 'No eligible trials: Not met results with the exact blocking criteria',
    docs: p4docs, hidden: [], externalOnly: [],
    facts: [
      F('age', 64, 0, fhirObs('Patient/p4', 'Patient demographics')),
      F('diagnosis', 'NSCLC', 400, fhirCond('c-p4-1', 'Condition: Malignant neoplasm of bronchus or lung')),
      F('stage', 'IV', 4, src('Note', 'DocumentReference', 'doc-p4-onc', 'Oncology clinic note', 'p4-onc', 'Stage IV NSCLC'), 'nlp', 0.97),
      F('ecog', 3, 4, src('Note', 'DocumentReference', 'doc-p4-onc', 'Oncology clinic note', 'p4-onc', 'ECOG 3'), 'nlp', 0.96),
      F('egfr', 70, 5, fhirObs('obs-p4-egfr', 'Observation: eGFR (CKD-EPI)')),
      F('pdl1', 55, 300, fhirObs('obs-p4-pdl1', 'Observation: PD-L1 TPS (discrete result)')),
      F('egfrMut', false, 300, fhirObs('obs-p4-egfrmut', 'Observation: EGFR mutation (discrete result)')),
      F('alkFusion', false, 300, fhirObs('obs-p4-alk', 'Observation: ALK rearrangement (discrete result)')),
      F('krasG12c', false, 300, fhirObs('obs-p4-kras', 'Observation: KRAS G12C (discrete result)')),
      F('brainMets', true, 14, src('Imaging', 'DiagnosticReport', 'dr-p4-mri', 'MRI brain', 'p4-mri', 'Three enhancing lesions'), 'nlp', 0.98),
      F('priorLines', 2, 4, src('Note', 'DocumentReference', 'doc-p4-onc', 'Oncology clinic note', 'p4-onc', 'progression on second line'), 'nlp', 0.93),
      F('steroidDose', 107, 4, fhirMed('mr-p4-dex', 'MedicationRequest: dexamethasone 16 mg daily')),
      F('anc', 5200, 5, fhirObs('obs-p4-anc', 'Observation: ANC')),
      F('strongCyp3a4', false, 7, fhirMed('mr-p4-interact', 'Medication review: no strong CYP3A4 inducers or inhibitors')),
      F('platelets', 310, 5, fhirObs('obs-p4-plt', 'Observation: Platelets')),
      F('lvef', 55, 30, fhirObs('obs-p4-lvef', 'Observation: LVEF (echo)')),
    ],
  },
  {
    tags: ['External result', 'Pending rule'], id: 'p5', name: 'Priya Raman', mrn: '4400-5588', age: 55, sex: 'F', language: 'English', race: 'Asian',
    headline: 'Stage IV NSCLC post-platinum, KRAS result lives in an external portal', visit: 'Tomorrow 08:45 · Pre-visit planning', treating: true,
    scenario: 'Agent cannot resolve: result exists only outside the chart, so it drafts a request and stays Unknown',
    docs: p5docs, hidden: [], externalOnly: ['krasG12c'],
    externalNote: 'Guardant360 portal (external lab). Result not accessible via FHIR or the document store.',
    facts: [
      F('age', 55, 0, fhirObs('Patient/p5', 'Patient demographics')),
      F('diagnosis', 'NSCLC', 150, fhirCond('c-p5-1', 'Condition: Malignant neoplasm of bronchus or lung')),
      F('stage', 'IV', 5, src('Note', 'DocumentReference', 'doc-p5-onc', 'Oncology clinic note', 'p5-onc', 'Stage IV adenocarcinoma'), 'nlp', 0.97),
      F('ecog', 1, 5, src('Note', 'DocumentReference', 'doc-p5-onc', 'Oncology clinic note', 'p5-onc', 'ECOG 1'), 'nlp', 0.96),
      F('egfr', 95, 7, fhirObs('obs-p5-egfr', 'Observation: eGFR (CKD-EPI)')),
      F('pdl1', 10, 120, src('Pathology PDF', 'DiagnosticReport', 'dr-p5-path', 'Surgical pathology', 'p5-path', 'PD-L1 22C3 TPS 10%'), 'nlp', 0.97),
      F('egfrMut', false, 120, fhirObs('obs-p5-egfrmut', 'Observation: EGFR mutation (discrete result)')),
      F('alkFusion', false, 120, fhirObs('obs-p5-alk', 'Observation: ALK rearrangement (discrete result)')),
      F('brainMets', false, 40, fhirObs('obs-p5-brain', 'Observation: Brain imaging result (negative)')),
      F('priorLines', 1, 5, src('Note', 'DocumentReference', 'doc-p5-onc', 'Oncology clinic note', 'p5-onc', 'Completed 4 cycles carboplatin/pemetrexed/pembrolizumab'), 'nlp', 0.94),
      F('steroidDose', 0, 7, fhirMed('mr-p5-active', 'Active MedicationRequest list (no corticosteroids)')),
      F('anc', 4200, 7, fhirObs('obs-p5-anc', 'Observation: ANC')),
      F('strongCyp3a4', false, 7, fhirMed('mr-p5-interact', 'Medication review: no strong CYP3A4 inducers or inhibitors')),
      F('platelets', 280, 7, fhirObs('obs-p5-plt', 'Observation: Platelets')),
      F('lvef', 61, 30, fhirObs('obs-p5-lvef', 'Observation: LVEF (echo)')),
    ],
  },
  {
    tags: ['Site full'], id: 'p6', name: 'Walter Brooks', mrn: '4400-6014', age: 70, sex: 'M', language: 'English', race: 'White',
    headline: 'Extensive-stage SCLC, treatment-naive', visit: 'Today 14:30 · New patient', treating: true,
    scenario: 'Eligible, but the trial is full at this site: shown with a satellite-site alternative',
    docs: p6docs, hidden: [], externalOnly: [],
    facts: [
      F('age', 70, 0, fhirObs('Patient/p6', 'Patient demographics')),
      F('diagnosis', 'SCLC', 25, fhirCond('c-p6-1', 'Condition: Small cell carcinoma of lung')),
      F('stage', 'ES', 3, src('Note', 'DocumentReference', 'doc-p6-onc', 'Oncology clinic note', 'p6-onc', 'Extensive-stage small cell lung cancer'), 'nlp', 0.97),
      F('ecog', 1, 3, src('Note', 'DocumentReference', 'doc-p6-onc', 'Oncology clinic note', 'p6-onc', 'ECOG 1'), 'nlp', 0.96),
      F('egfr', 80, 4, fhirObs('obs-p6-egfr', 'Observation: eGFR (CKD-EPI)')),
      F('brainMets', false, 3, src('Note', 'DocumentReference', 'doc-p6-onc', 'Oncology clinic note', 'p6-onc', 'Brain MRI negative for metastases'), 'nlp', 0.96),
      F('priorLines', 0, 3, src('Note', 'DocumentReference', 'doc-p6-onc', 'Oncology clinic note', 'p6-onc', 'Treatment-naive'), 'nlp', 0.96),
      F('steroidDose', 0, 4, fhirMed('mr-p6-active', 'Active MedicationRequest list (no corticosteroids)')),
      F('anc', 6100, 4, fhirObs('obs-p6-anc', 'Observation: ANC')),
      F('strongCyp3a4', false, 7, fhirMed('mr-p6-interact', 'Medication review: no strong CYP3A4 inducers or inhibitors')),
      F('platelets', 142, 4, fhirObs('obs-p6-plt', 'Observation: Platelets')),
      F('lvef', 59, 40, fhirObs('obs-p6-lvef', 'Observation: LVEF (echo)')),
    ],
  },
  {
    tags: ['Non-English', 'Sparse chart', 'Step cap'], id: 'p7', name: 'Elena Petrova', mrn: '4400-7239', age: 48, sex: 'F', language: 'Russian', race: 'White',
    headline: 'Resectable stage IIA NSCLC, notes partly in Russian', visit: 'Today 15:15 · Surgical follow-up', treating: true,
    scenario: 'Sparse chart, non-English notes: many Unknowns, agent resolves some at reduced confidence',
    docs: p7docs, externalOnly: [],
    hidden: [
      F('ecog', 0, 8, src('Note', 'DocumentReference', 'doc-p7-surg', 'Surgical consult (Russian)', 'p7-surg', 'ECOG 0'), 'agent', 0.66),
      F('pdl1', 5, 18, src('Pathology PDF', 'DiagnosticReport', 'dr-p7-path', 'Surgical pathology', 'p7-path', 'PD-L1 22C3 TPS: 5%'), 'agent', 0.95),
      F('egfrMut', false, 18, src('Pathology PDF', 'DiagnosticReport', 'dr-p7-path', 'Surgical pathology', 'p7-path', 'EGFR: no mutation detected'), 'agent', 0.94),
      F('alkFusion', false, 18, src('Pathology PDF', 'DiagnosticReport', 'dr-p7-path', 'Surgical pathology', 'p7-path', 'ALK: negative by IHC'), 'agent', 0.94),
    ],
    facts: [
      F('age', 48, 0, fhirObs('Patient/p7', 'Patient demographics')),
      F('diagnosis', 'NSCLC', 40, fhirCond('c-p7-1', 'Condition: Malignant neoplasm of upper lobe, right bronchus or lung')),
      F('stage', 'IIA', 8, src('Note', 'DocumentReference', 'doc-p7-surg', 'Surgical consult (Russian)', 'p7-surg', 'стадия IIA'), 'nlp', 0.84),
      F('egfr', 101, 6, fhirObs('obs-p7-egfr', 'Observation: eGFR (CKD-EPI)')),
    ],
  },
  {
    tags: ['Access blocked'], id: 'p8', name: 'Thomas Nguyen', mrn: '4400-8765', age: 61, sex: 'M', language: 'Vietnamese', race: 'Asian',
    headline: 'No treating relationship with this clinician', visit: 'Not on your schedule', treating: false,
    scenario: 'Access control: the EHR’s own access rule blocks the panel',
    docs: [], hidden: [], externalOnly: [], facts: [],
  },
  {
    tags: ['Satellite site'], id: 'p9', name: 'Hannah Fischer', mrn: '4400-9102', age: 52, sex: 'F', language: 'English', race: 'White',
    headline: 'ALK-positive stage IV NSCLC after one platinum line', visit: 'Tomorrow 09:15 · Pre-visit planning', treating: true,
    scenario: 'Eligible only at a satellite site 45 miles away: shown with the distance and a lower rank',
    docs: p9docs, hidden: [], externalOnly: [],
    facts: [
      F('age', 52, 0, fhirObs('Patient/p9', 'Patient demographics')),
      F('diagnosis', 'NSCLC', 160, fhirCond('c-p9-1', 'Condition: Malignant neoplasm of bronchus or lung')),
      F('histology', 'adenocarcinoma', 38, src('Pathology PDF', 'DiagnosticReport', 'dr-p9-path', 'Surgical pathology', 'p9-path', 'Adenocarcinoma of lung'), 'nlp', 0.97),
      F('stage', 'IV', 10, src('Note', 'DocumentReference', 'doc-p9-onc', 'Oncology clinic note', 'p9-onc', 'Stage IV adenocarcinoma'), 'nlp', 0.97),
      F('ecog', 1, 10, src('Note', 'DocumentReference', 'doc-p9-onc', 'Oncology clinic note', 'p9-onc', 'ECOG 1'), 'nlp', 0.96),
      F('egfr', 99, 6, fhirObs('obs-p9-egfr', 'Observation: eGFR (CKD-EPI)')),
      F('pdl1', 20, 38, src('Pathology PDF', 'DiagnosticReport', 'dr-p9-path', 'Surgical pathology', 'p9-path', 'PD-L1 22C3 TPS: 20%'), 'nlp', 0.97),
      F('egfrMut', false, 33, src('Genomic PDF', 'DiagnosticReport', 'dr-p9-ngs', 'Tissue NGS panel', 'p9-ngs', 'EGFR: no sensitizing mutation detected'), 'nlp', 0.97),
      F('alkFusion', true, 33, src('Genomic PDF', 'DiagnosticReport', 'dr-p9-ngs', 'Tissue NGS panel', 'p9-ngs', 'ALK: EML4-ALK fusion detected'), 'nlp', 0.98),
      F('krasG12c', false, 33, src('Genomic PDF', 'DiagnosticReport', 'dr-p9-ngs', 'Tissue NGS panel', 'p9-ngs', 'KRAS: G12C not detected'), 'nlp', 0.97),
      F('brainMets', false, 45, fhirObs('obs-p9-brain', 'Observation: Brain imaging result (negative)')),
      F('priorLines', 1, 10, src('Note', 'DocumentReference', 'doc-p9-onc', 'Oncology clinic note', 'p9-onc', 'One prior line: carboplatin/pemetrexed'), 'nlp', 0.95),
      F('steroidDose', 0, 6, fhirMed('mr-p9-active', 'Active MedicationRequest list (no corticosteroids)')),
      F('strongCyp3a4', false, 6, fhirMed('mr-p9-interact', 'Medication review: no strong CYP3A4 inducers or inhibitors')),
      F('anc', 4400, 6, fhirObs('obs-p9-anc', 'Observation: ANC')),
      F('platelets', 300, 6, fhirObs('obs-p9-plt', 'Observation: Platelets')),
      F('lvef', 62, 35, fhirObs('obs-p9-lvef', 'Observation: LVEF (echo)')),
    ],
  },
  {
    tags: ['Mesothelioma', 'Guardrail catches a bad extraction'], id: 'p10', name: 'Frank Moretti', mrn: '4400-1056', age: 68, sex: 'M', language: 'English', race: 'White',
    headline: 'Unresectable pleural mesothelioma, ECOG only in the note', visit: 'Today 16:00 · New patient', treating: true,
    scenario: 'Different disease group, so every lung trial is filtered. The extractor first returns a wrong ECOG; the span check rejects it and the retry succeeds',
    docs: p10docs, externalOnly: [],
    hidden: [
      { ...F('ecog', 1, 5, src('Note', 'DocumentReference', 'doc-p10-onc', 'Oncology clinic note', 'p10-onc', 'ECOG 1'), 'agent', 0.91), firstAttempt: 0 },
    ],
    facts: [
      F('age', 68, 0, fhirObs('Patient/p10', 'Patient demographics')),
      F('diagnosis', 'Mesothelioma', 60, fhirCond('c-p10-1', 'Condition: Malignant mesothelioma of pleura')),
      F('histology', 'epithelioid', 5, src('Note', 'DocumentReference', 'doc-p10-onc', 'Oncology clinic note', 'p10-onc', 'Epithelioid pleural mesothelioma'), 'nlp', 0.97),
      F('stage', 'III', 5, src('Note', 'DocumentReference', 'doc-p10-onc', 'Oncology clinic note', 'p10-onc', 'stage III'), 'nlp', 0.95),
      F('egfr', 85, 3, fhirObs('obs-p10-egfr', 'Observation: eGFR (CKD-EPI)')),
      F('priorLines', 0, 5, src('Note', 'DocumentReference', 'doc-p10-onc', 'Oncology clinic note', 'p10-onc', 'Treatment-naive'), 'nlp', 0.96),
      F('steroidDose', 0, 3, fhirMed('mr-p10-active', 'Active MedicationRequest list (no corticosteroids)')),
      F('strongCyp3a4', false, 3, fhirMed('mr-p10-interact', 'Medication review: no strong CYP3A4 inducers or inhibitors')),
      F('anc', 4800, 3, fhirObs('obs-p10-anc', 'Observation: ANC')),
      F('platelets', 188, 3, fhirObs('obs-p10-plt', 'Observation: Platelets')),
    ],
  },
  {
    tags: ['Drug interaction'], id: 'p11', name: 'Linda Park', mrn: '4400-1177', age: 58, sex: 'F', language: 'English', race: 'Asian',
    headline: 'EGFR-mutant stage IV NSCLC, on an enzyme-inducing anticonvulsant', visit: 'Today 16:45 · Treatment planning', treating: true,
    scenario: 'A perfect clinical match blocked by one conflicting medication, with the modifiable cause named',
    docs: p11docs, hidden: [], externalOnly: [],
    facts: [
      F('age', 58, 0, fhirObs('Patient/p11', 'Patient demographics')),
      F('diagnosis', 'NSCLC', 90, fhirCond('c-p11-1', 'Condition: Malignant neoplasm of bronchus or lung')),
      F('histology', 'adenocarcinoma', 26, src('Pathology PDF', 'DiagnosticReport', 'dr-p11-path', 'Surgical pathology', 'p11-path', 'Adenocarcinoma of lung'), 'nlp', 0.97),
      F('stage', 'IV', 4, src('Note', 'DocumentReference', 'doc-p11-onc', 'Oncology clinic note', 'p11-onc', 'Stage IV adenocarcinoma'), 'nlp', 0.97),
      F('ecog', 1, 4, src('Note', 'DocumentReference', 'doc-p11-onc', 'Oncology clinic note', 'p11-onc', 'ECOG 1'), 'nlp', 0.96),
      F('egfr', 91, 5, fhirObs('obs-p11-egfr', 'Observation: eGFR (CKD-EPI)')),
      F('pdl1', 5, 26, src('Pathology PDF', 'DiagnosticReport', 'dr-p11-path', 'Surgical pathology', 'p11-path', 'PD-L1 22C3 TPS: 5%'), 'nlp', 0.97),
      F('egfrMut', true, 21, src('Genomic PDF', 'DiagnosticReport', 'dr-p11-ngs', 'Tissue NGS panel', 'p11-ngs', 'EGFR exon 19 deletion detected'), 'nlp', 0.98),
      F('alkFusion', false, 21, src('Genomic PDF', 'DiagnosticReport', 'dr-p11-ngs', 'Tissue NGS panel', 'p11-ngs', 'ALK: no rearrangement detected'), 'nlp', 0.97),
      F('krasG12c', false, 21, src('Genomic PDF', 'DiagnosticReport', 'dr-p11-ngs', 'Tissue NGS panel', 'p11-ngs', 'KRAS: G12C not detected'), 'nlp', 0.97),
      F('brainMets', false, 30, fhirObs('obs-p11-brain', 'Observation: Brain imaging result (negative)')),
      F('priorLines', 0, 4, src('Note', 'DocumentReference', 'doc-p11-onc', 'Oncology clinic note', 'p11-onc', 'Treatment-naive for metastatic disease'), 'nlp', 0.96),
      F('steroidDose', 0, 5, fhirMed('mr-p11-active', 'Active MedicationRequest list (no corticosteroids)')),
      F('strongCyp3a4', true, 5, fhirMed('mr-p11-cbz', 'MedicationRequest: carbamazepine 400 mg BID (strong CYP3A4 inducer)')),
      F('anc', 3800, 5, fhirObs('obs-p11-anc', 'Observation: ANC')),
      F('platelets', 270, 5, fhirObs('obs-p11-plt', 'Observation: Platelets')),
      F('lvef', 60, 25, fhirObs('obs-p11-lvef', 'Observation: LVEF (echo)')),
    ],
  },
];

/* ----------------------------------- Trials ---------------------------------- */

let cid = 0;
function C(type: Criterion['type'], text: string, fact: FactKey, op: Rule['op'], value: Rule['value'], unknownStep: string, windowDays?: number, review: Criterion['review'] = 'approved', parseConfidence = 0.96): Criterion {
  cid += 1;
  return { id: `c${cid}`, type, text, rule: { fact, op, value, windowDays }, review, parseConfidence, unknownStep };
}

const ageC = () => C('inclusion', 'Age 18 years or older', 'age', '>=', 18, 'Confirm date of birth in registration');
const nsclc = () => C('inclusion', 'Histologically or cytologically confirmed non-small cell lung cancer', 'diagnosis', '==', 'NSCLC', 'Confirm histology in pathology report');

export const TRIALS: Trial[] = [
  {
    id: 't1', nct: 'NCT06100101', code: 'KEYSTONE-A', title: 'Pembrolizumab plus novel TIGIT inhibitor vs pembrolizumab, first-line PD-L1 high metastatic NSCLC',
    phase: 'Phase 3', sponsor: 'Synthetic Pharma A', disease: 'NSCLC', stages: ['IV', 'IVA', 'IVB'], status: 'Recruiting', siteStatus: 'Open', siteMiles: 0, enrolled: 142, target: 600,
    arm: 'First-line immunotherapy', pacePerMonth: 24, closesOn: '2027-06-30', ruleSet: 'ruleset-1.4.0',
    criteria: [
      ageC(), nsclc(),
      C('inclusion', 'Stage IV (metastatic) disease', 'stage', 'in', ['IV', 'IVA', 'IVB'], 'Confirm stage in oncology note'),
      C('inclusion', 'PD-L1 tumor proportion score of 50% or higher', 'pdl1', '>=', 50, 'Locate PD-L1 result in pathology, or order PD-L1 IHC (22C3)'),
      C('inclusion', 'ECOG performance status 0 to 1 within 28 days', 'ecog', '<=', 1, 'Document ECOG at next visit', 28),
      C('inclusion', 'Estimated GFR of 60 mL/min or higher within 28 days', 'egfr', '>=', 60, 'Repeat basic metabolic panel (eGFR)', 28),
      C('exclusion', 'No EGFR-sensitizing mutation', 'egfrMut', '==', false, 'Locate or order EGFR mutation testing'),
      C('exclusion', 'No ALK rearrangement', 'alkFusion', '==', false, 'Locate or order ALK testing'),
      C('exclusion', 'No untreated brain metastases', 'brainMets', '==', false, 'Order or locate brain MRI'),
      C('exclusion', 'No systemic corticosteroids above 10 mg/day prednisone-equivalent', 'steroidDose', '<=', 10, 'Reconcile medication list'),
      C('exclusion', 'No prior systemic therapy for metastatic disease', 'priorLines', '<=', 0, 'Document treatment history'),
    ],
  },
  {
    id: 't2', nct: 'NCT06100202', code: 'HELIX-EGFR', title: 'EGFR/MET bispecific antibody combination in EGFR-mutant advanced NSCLC after at most one prior line',
    phase: 'Phase 2', sponsor: 'Synthetic Pharma B', disease: 'NSCLC', stages: ['IIIB', 'IIIC', 'IV', 'IVA', 'IVB'], status: 'Recruiting', siteStatus: 'Open', siteMiles: 0, enrolled: 38, target: 90,
    arm: 'EGFR-targeted combination', pacePerMonth: 4, closesOn: '2027-02-28', ruleSet: 'ruleset-1.4.0',
    criteria: [
      ageC(), nsclc(),
      C('inclusion', 'Locally advanced or metastatic disease (stage IIIB to IV)', 'stage', 'in', ['IIIB', 'IIIC', 'IV', 'IVA', 'IVB'], 'Confirm stage in oncology note'),
      C('inclusion', 'Documented EGFR exon 19 deletion or L858R mutation', 'egfrMut', '==', true, 'Locate or order EGFR mutation testing'),
      C('inclusion', 'ECOG performance status 0 to 2 within 28 days', 'ecog', '<=', 2, 'Document ECOG at next visit', 28),
      C('inclusion', 'No more than one prior line of systemic therapy', 'priorLines', '<=', 1, 'Document treatment history'),
      C('inclusion', 'Absolute neutrophil count of 1,500/µL or higher within 14 days', 'anc', '>=', 1500, 'Repeat CBC with differential', 14),
      C('inclusion', 'LVEF of 50% or higher within 90 days', 'lvef', '>=', 50, 'Order echocardiogram', 90),
      C('exclusion', 'No concurrent strong CYP3A4 inducers or inhibitors', 'strongCyp3a4', '==', false, 'Reconcile the medication list for interacting drugs'),
    ],
  },
  {
    id: 't3', nct: 'NCT06100303', code: 'SOTERIA-G12C', title: 'KRAS G12C inhibitor with pembrolizumab in previously treated KRAS G12C-mutant NSCLC',
    phase: 'Phase 2', sponsor: 'Synthetic Pharma C', disease: 'NSCLC', stages: ['IV', 'IVA', 'IVB'], status: 'Recruiting', siteStatus: 'Open', siteMiles: 0, enrolled: 21, target: 60,
    arm: 'KRAS-targeted therapy', pacePerMonth: 2, closesOn: '2027-04-30', ruleSet: 'ruleset-1.4.0',
    criteria: [
      ageC(), nsclc(),
      C('inclusion', 'Stage IV disease', 'stage', 'in', ['IV', 'IVA', 'IVB'], 'Confirm stage in oncology note'),
      C('inclusion', 'KRAS G12C mutation confirmed by an approved assay', 'krasG12c', '==', true, 'Locate KRAS result, or obtain external lab report / order NGS'),
      C('inclusion', 'At least one prior line of platinum-based therapy', 'priorLines', '>=', 1, 'Document treatment history'),
      C('inclusion', 'ECOG performance status 0 to 1 within 28 days', 'ecog', '<=', 1, 'Document ECOG at next visit', 28),
      C('inclusion', 'Absolute neutrophil count of 1,500/µL or higher within 14 days', 'anc', '>=', 1500, 'Repeat CBC with differential', 14),
      C('inclusion', 'LVEF of 50% or higher within 90 days (revised in v2, awaiting reviewer)', 'lvef', '>=', 50, 'Order echocardiogram', 90, 'pending', 0.71),
    ],
  },
  {
    id: 't4', nct: 'NCT06100404', code: 'AURORA-ES', title: 'Chemo-immunotherapy plus DLL3 bispecific in extensive-stage small cell lung cancer',
    phase: 'Phase 3', sponsor: 'Synthetic Pharma D', disease: 'SCLC', stages: ['ES'], status: 'Recruiting', siteStatus: 'Enrollment full', siteMiles: 0, enrolled: 80, target: 80,
    arm: 'First-line ES-SCLC', pacePerMonth: 6, closesOn: '2026-12-31', ruleSet: 'ruleset-1.4.0',
    criteria: [
      ageC(),
      C('inclusion', 'Histologically confirmed small cell lung cancer', 'diagnosis', '==', 'SCLC', 'Confirm histology in pathology report'),
      C('inclusion', 'Extensive-stage disease', 'stage', 'in', ['ES'], 'Confirm stage in oncology note'),
      C('inclusion', 'ECOG performance status 0 to 2 within 28 days', 'ecog', '<=', 2, 'Document ECOG at next visit', 28),
      C('inclusion', 'Platelet count of 100,000/µL or higher within 14 days', 'platelets', '>=', 100, 'Repeat CBC', 14),
      C('inclusion', 'Absolute neutrophil count of 1,500/µL or higher within 14 days', 'anc', '>=', 1500, 'Repeat CBC with differential', 14),
      C('exclusion', 'No prior systemic therapy for small cell lung cancer', 'priorLines', '<=', 0, 'Document treatment history'),
    ],
  },
  {
    id: 't5', nct: 'NCT06100505', code: 'PRISM-ALK', title: 'Next-generation ALK inhibitor in ALK-positive advanced NSCLC',
    phase: 'Phase 2', sponsor: 'Synthetic Pharma E', disease: 'NSCLC', stages: ['IIIB', 'IIIC', 'IV', 'IVA', 'IVB'], status: 'Recruiting', siteStatus: 'Open', siteMiles: 45, enrolled: 12, target: 40,
    arm: 'ALK-targeted therapy (satellite site)', pacePerMonth: 1.5, closesOn: '2027-05-31', ruleSet: 'ruleset-1.4.0',
    criteria: [
      ageC(), nsclc(),
      C('inclusion', 'Documented ALK rearrangement', 'alkFusion', '==', true, 'Locate or order ALK testing'),
      C('inclusion', 'ECOG performance status 0 to 1 within 28 days', 'ecog', '<=', 1, 'Document ECOG at next visit', 28),
      C('inclusion', 'No more than two prior lines of therapy', 'priorLines', '<=', 2, 'Document treatment history'),
    ],
  },
  {
    id: 't6', nct: 'NCT06100606', code: 'ASCENT-ADJ', title: 'Adjuvant immunotherapy after complete resection of stage II to IIIA NSCLC',
    phase: 'Phase 3', sponsor: 'Synthetic Pharma F', disease: 'NSCLC', stages: ['IIA', 'IIB', 'IIIA'], status: 'Recruiting', siteStatus: 'Open', siteMiles: 12, enrolled: 210, target: 450,
    arm: 'Adjuvant (resected)', pacePerMonth: 12, closesOn: '2027-09-30', ruleSet: 'ruleset-1.4.0',
    criteria: [
      ageC(), nsclc(),
      C('inclusion', 'Resected stage IIA to IIIA disease', 'stage', 'in', ['IIA', 'IIB', 'IIIA'], 'Confirm stage in surgical note'),
      C('inclusion', 'ECOG performance status 0 to 1 within 28 days', 'ecog', '<=', 1, 'Document ECOG at next visit', 28),
      C('inclusion', 'PD-L1 tumor proportion score of 1% or higher', 'pdl1', '>=', 1, 'Locate PD-L1 result in pathology'),
      C('exclusion', 'No EGFR-sensitizing mutation', 'egfrMut', '==', false, 'Locate or order EGFR mutation testing'),
      C('exclusion', 'No ALK rearrangement', 'alkFusion', '==', false, 'Locate or order ALK testing'),
      C('inclusion', 'Estimated GFR of 45 mL/min or higher within 28 days', 'egfr', '>=', 45, 'Repeat basic metabolic panel', 28),
      C('exclusion', 'No prior systemic anticancer therapy for this malignancy', 'priorLines', '<=', 0, 'Document treatment history'),
    ],
  },
  {
    id: 't7', nct: 'NCT06100707', code: 'PLEURA-1', title: 'Dual checkpoint blockade in unresectable pleural mesothelioma',
    phase: 'Phase 2', sponsor: 'Synthetic Pharma G', disease: 'Mesothelioma', stages: ['III', 'IV'], status: 'Recruiting', siteStatus: 'Open', siteMiles: 0, enrolled: 9, target: 30,
    arm: 'Mesothelioma', pacePerMonth: 1, closesOn: '2027-08-31', ruleSet: 'ruleset-1.4.0',
    criteria: [
      ageC(),
      C('inclusion', 'Confirmed pleural mesothelioma', 'diagnosis', '==', 'Mesothelioma', 'Confirm histology'),
      C('inclusion', 'Unresectable stage III to IV disease', 'stage', 'in', ['III', 'IV'], 'Confirm stage in oncology note'),
      C('inclusion', 'ECOG performance status 0 to 1 within 28 days', 'ecog', '<=', 1, 'Document ECOG at next visit', 28),
      C('inclusion', 'Platelet count of 100,000/µL or higher within 14 days', 'platelets', '>=', 100, 'Repeat CBC', 14),
    ],
  },
  {
    id: 't8', nct: 'NCT06100808', code: 'HERALD-8', title: 'HER2-directed antibody-drug conjugate in HER2-mutant NSCLC',
    phase: 'Phase 2', sponsor: 'Synthetic Pharma H', disease: 'NSCLC', stages: ['IV', 'IVA', 'IVB'], status: 'Suspended', siteStatus: 'Closed to accrual', siteMiles: 0, enrolled: 17, target: 50,
    arm: 'HER2-targeted', pacePerMonth: 2, closesOn: '2027-03-31', ruleSet: 'ruleset-1.4.0',
    criteria: [ageC(), nsclc()],
  },
  {
    id: 't9', nct: 'NCT06100909', code: 'NOVA-SHP2', title: 'SHP2 inhibitor plus pembrolizumab in PD-L1 positive metastatic NSCLC, any line',
    phase: 'Phase 2', sponsor: 'Synthetic Pharma I', disease: 'NSCLC', stages: ['IV', 'IVA', 'IVB'], status: 'Recruiting', siteStatus: 'Open', siteMiles: 0, enrolled: 0, target: 70,
    arm: 'New trial (opens via monitoring demo)', pacePerMonth: 3, closesOn: '2027-12-31', ruleSet: 'ruleset-1.4.0', hiddenUntilOpened: true,
    criteria: [
      ageC(), nsclc(),
      C('inclusion', 'Stage IV disease', 'stage', 'in', ['IV', 'IVA', 'IVB'], 'Confirm stage in oncology note', undefined, 'pending', 0.93),
      C('inclusion', 'PD-L1 tumor proportion score of 1% or higher', 'pdl1', '>=', 1, 'Locate PD-L1 result in pathology', undefined, 'pending', 0.95),
      C('inclusion', 'ECOG performance status 0 to 1 within 28 days', 'ecog', '<=', 1, 'Document ECOG at next visit', 28, 'pending', 0.94),
      C('exclusion', 'No EGFR-sensitizing mutation', 'egfrMut', '==', false, 'Locate or order EGFR mutation testing', undefined, 'pending', 0.96),
      C('exclusion', 'No ALK rearrangement', 'alkFusion', '==', false, 'Locate or order ALK testing', undefined, 'pending', 0.96),
      C('inclusion', 'Estimated GFR of 45 mL/min or higher within 28 days', 'egfr', '>=', 45, 'Repeat basic metabolic panel', 28, 'pending', 0.92),
    ],
  },
];

// Dev-time guard: every cited span must really appear in its document.
if (process.env.NODE_ENV !== 'production') {
  for (const p of PATIENTS) {
    for (const f of [...p.facts, ...p.hidden]) {
      if (f.source.docId && f.source.span) {
        const d = p.docs.find((x) => x.id === f.source.docId);
        if (!d || !d.text.includes(f.source.span)) console.warn(`[data] span not found for ${p.id}/${f.key}: "${f.source.span}"`);
      }
    }
  }
}

export const FACT_LABEL: Record<FactKey, string> = {
  diagnosis: 'Diagnosis', histology: 'Histology', stage: 'Stage', age: 'Age', ecog: 'ECOG', egfr: 'eGFR', pdl1: 'PD-L1 TPS',
  egfrMut: 'EGFR mutation', alkFusion: 'ALK rearrangement', krasG12c: 'KRAS G12C', brainMets: 'Brain metastases', priorLines: 'Prior lines',
  steroidDose: 'Steroid dose (pred. equiv.)', strongCyp3a4: 'Strong CYP3A4 inducer/inhibitor', anc: 'ANC', platelets: 'Platelets', lvef: 'LVEF', bilirubin: 'Bilirubin',
};

export const FACT_UNIT: Partial<Record<FactKey, string>> = { egfr: 'mL/min', pdl1: '%', steroidDose: 'mg/day', anc: '/µL', platelets: 'x10³/µL', lvef: '%', age: 'y' };

export function fmtVal(key: FactKey, v: Val): string {
  if (typeof v === 'boolean') {
    if (key === 'brainMets') return v ? 'Present' : 'Absent';
    if (key === 'strongCyp3a4') return v ? 'Yes' : 'No';
    return v ? 'Detected' : 'Not detected';
  }
  const u = FACT_UNIT[key];
  return u ? `${v} ${u}` : String(v);
}
