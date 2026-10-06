import { TRIALS } from '@/lib/data';
import { AMENDMENTS, applyAmendment } from '@/lib/amendments';
import { validateRule } from '@/lib/rules';
import type { Rule } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Rule review (PRD section 14: /api/criteria). Validates a structured rule before a reviewer can approve it.
// A malformed rule (for example a non-numeric threshold) would otherwise mark every patient Not met.
export async function POST(req: Request) {
  let body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, errors: ['Body must be JSON'] }, { status: 400 });
  }
  const { trialId, criterionId, rule } = body;
  const trial = TRIALS.find((t) => t.id === trialId);
  if (!trial) return Response.json({ ok: false, errors: ['Unknown trial'] }, { status: 404 });
  // A criterion may be one an amendment created, so look through the trial as each amendment would leave it.
  let stage = trial;
  const known = [...trial.criteria];
  for (const a of AMENDMENTS.filter((x) => x.trialId === trial.id)) { stage = applyAmendment(stage, a); known.push(...stage.criteria); }
  const criterion = known.find((c) => c.id === criterionId);
  if (!criterion) return Response.json({ ok: false, errors: ['Unknown criterion'] }, { status: 404 });
  if (!rule || typeof rule !== 'object') return Response.json({ ok: false, errors: ['rule is required'] }, { status: 400 });
  if (rule.fact !== criterion.rule.fact) return Response.json({ ok: false, errors: ['The field a criterion measures cannot be changed here; reject it and add a new criterion instead'] }, { status: 422 });
  const errors = validateRule(rule as Rule);
  return Response.json({ ok: errors.length === 0, errors }, { status: errors.length === 0 ? 200 : 422 });
}
