import { PATIENTS, TRIALS, VERSIONS } from '@/lib/data';
import { isIsoDate, matchAll } from '@/lib/engine';

export const dynamic = 'force-dynamic';

// Synchronous engine run (PRD section 14: /api/match). Engine only, no LLM call.
export async function POST(req: Request) {
  let body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Body must be JSON' }, { status: 400 });
  }
  const { patientId, overlay, overrides, trials, today } = body;
  if (typeof patientId !== 'string') return Response.json({ error: 'patientId is required' }, { status: 400 });
  const p = PATIENTS.find((x) => x.id === patientId);
  if (!p) return Response.json({ error: 'Unknown patient' }, { status: 404 });
  if (!p.treating) return Response.json({ error: 'No treating relationship' }, { status: 403 });
  const t0 = performance.now();
  const matches = matchAll(p, Array.isArray(trials) ? trials : TRIALS.filter((t) => !t.hiddenUntilOpened), { overlay, overrides, today: isIsoDate(today) ? today : undefined });
  return Response.json({ matches, versions: VERSIONS, latencyMs: Math.max(1, Math.round(performance.now() - t0)) });
}
