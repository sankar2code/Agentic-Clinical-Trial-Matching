import type { FactKey, Op, Rule } from './types';

type Spec =
  | { type: 'number'; min: number; max: number; unit?: string }
  | { type: 'boolean' }
  | { type: 'enum'; allowed: string[] };

export const STAGES = ['IA', 'IB', 'IIA', 'IIB', 'IIIA', 'IIIB', 'IIIC', 'III', 'IV', 'IVA', 'IVB', 'LS', 'ES'];

/** What each computable fact looks like. The reviewer UI and /api/criteria both validate against this. */
export const FACT_SPEC: Record<FactKey, Spec> = {
  age: { type: 'number', min: 0, max: 120, unit: 'years' },
  ecog: { type: 'number', min: 0, max: 4 },
  egfr: { type: 'number', min: 0, max: 200, unit: 'mL/min' },
  pdl1: { type: 'number', min: 0, max: 100, unit: '%' },
  priorLines: { type: 'number', min: 0, max: 10 },
  steroidDose: { type: 'number', min: 0, max: 1000, unit: 'mg/day' },
  anc: { type: 'number', min: 0, max: 50000, unit: '/µL' },
  platelets: { type: 'number', min: 0, max: 2000, unit: 'x10³/µL' },
  lvef: { type: 'number', min: 0, max: 100, unit: '%' },
  bilirubin: { type: 'number', min: 0, max: 50, unit: 'mg/dL' },
  egfrMut: { type: 'boolean' },
  alkFusion: { type: 'boolean' },
  krasG12c: { type: 'boolean' },
  brainMets: { type: 'boolean' },
  strongCyp3a4: { type: 'boolean' },
  diagnosis: { type: 'enum', allowed: ['NSCLC', 'SCLC', 'Mesothelioma'] },
  histology: { type: 'enum', allowed: ['adenocarcinoma', 'squamous', 'large cell', 'small cell', 'epithelioid', 'sarcomatoid'] },
  stage: { type: 'enum', allowed: STAGES },
};

const NUMERIC_OPS: Op[] = ['>=', '<=', '>', '<', '==', '!='];
const BOOL_OPS: Op[] = ['==', '!='];
const ENUM_OPS: Op[] = ['==', '!=', 'in'];

export function opsFor(fact: FactKey): Op[] {
  const s = FACT_SPEC[fact];
  return s.type === 'number' ? NUMERIC_OPS : s.type === 'boolean' ? BOOL_OPS : ENUM_OPS;
}

/** Returns a list of problems; an empty list means the rule is safe to evaluate. */
export function validateRule(r: Rule): string[] {
  const errs: string[] = [];
  const spec = FACT_SPEC[r.fact];
  if (!spec) return [`Unknown field "${String(r.fact)}"`];
  if (!opsFor(r.fact).includes(r.op)) errs.push(`Operator "${r.op}" is not allowed for ${r.fact} (${spec.type}). Allowed: ${opsFor(r.fact).join(', ')}`);
  if (spec.type === 'number') {
    if (typeof r.value !== 'number' || !Number.isFinite(r.value)) errs.push(`${r.fact} needs a number`);
    else if (r.value < spec.min || r.value > spec.max) errs.push(`${r.fact} must be between ${spec.min} and ${spec.max}`);
  } else if (spec.type === 'boolean') {
    if (typeof r.value !== 'boolean') errs.push(`${r.fact} needs true or false`);
  } else if (r.op === 'in') {
    if (!Array.isArray(r.value) || r.value.length === 0) errs.push(`${r.fact} needs a non-empty list`);
    else for (const v of r.value) if (!spec.allowed.includes(v)) errs.push(`"${v}" is not a valid ${r.fact}. Allowed: ${spec.allowed.join(', ')}`);
  } else if (typeof r.value !== 'string' || !spec.allowed.includes(r.value)) {
    errs.push(`${r.fact} must be one of: ${spec.allowed.join(', ')}`);
  }
  if (r.windowDays !== undefined) {
    if (!Number.isInteger(r.windowDays) || r.windowDays < 1 || r.windowDays > 365) errs.push('Time window must be a whole number of days from 1 to 365');
    if (spec.type !== 'number') errs.push('A time window only applies to numeric measurements');
  }
  return errs;
}

/** Turn what the reviewer typed into a typed value for this fact. Never guesses across types. */
export function parseInput(fact: FactKey, op: Op, raw: string): Rule['value'] {
  const spec = FACT_SPEC[fact];
  const t = raw.trim();
  if (spec.type === 'number') return t === '' ? NaN : Number(t);
  if (spec.type === 'boolean') return t === 'true' ? true : t === 'false' ? false : (t as unknown as boolean);
  return op === 'in' ? t.split(',').map((x) => x.trim()).filter(Boolean) : t;
}

export function showValue(v: Rule['value']): string {
  return Array.isArray(v) ? v.join(', ') : String(v);
}
