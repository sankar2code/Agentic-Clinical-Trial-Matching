import { PATIENTS, TRIALS } from '@/lib/data';
import { runAgent } from '@/lib/agent';
import { isIsoDate } from '@/lib/engine';

export const dynamic = 'force-dynamic';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_QUESTION = 400;
const MODES = ['normal', 'timeout', 'down'];

// Streams agent progress as server-sent events (PRD section 14: /api/agent).
// Mockup note: this route has no database, so the client sends its working state (overlay, overrides, rules) and the
// server trusts it. A production build would own that state server-side. Patient access is still enforced here.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Body must be JSON' }, { status: 400 });
  }
  const { patientId, question, trials, overlay, overrides, existing, versions, skip, today, dropNlp, mode } = body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (typeof patientId !== 'string' || typeof question !== 'string') return Response.json({ error: 'patientId and question are required strings' }, { status: 400 });
  if (question.trim().length === 0 || question.length > MAX_QUESTION) return Response.json({ error: `Question must be 1 to ${MAX_QUESTION} characters` }, { status: 400 });
  if (mode !== undefined && !MODES.includes(mode)) return Response.json({ error: 'Unknown mode' }, { status: 400 });
  if (mode === 'down') return Response.json({ error: 'Agent service unavailable' }, { status: 503 });
  const p = PATIENTS.find((x) => x.id === patientId);
  if (!p) return Response.json({ error: 'Unknown patient' }, { status: 404 });
  if (!p.treating) return Response.json({ error: 'No treating relationship' }, { status: 403 });

  const result = runAgent(p, Array.isArray(trials) ? trials : TRIALS.filter((t) => !t.hiddenUntilOpened), question, [], overlay ?? {}, overrides ?? {}, { existing: Array.isArray(existing) ? existing : [], versions: typeof versions === 'string' ? versions : undefined, skip: Array.isArray(skip) ? skip : [], today: isIsoDate(today) ? today : undefined, dropNlp: Array.isArray(dropNlp) ? dropNlp : undefined });
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
      send({ type: 'start', intent: result.intent });
      let sent = 0;
      for (const s of result.steps) {
        await sleep(650);
        send({ type: 'step', step: s });
        sent += 1;
        if (mode === 'timeout' && sent === 1) {
          await sleep(900);
          send({ type: 'error', message: 'Agent timed out after 90 s. Showing engine-only results.' });
          controller.close();
          return;
        }
      }
      await sleep(350);
      if (mode === 'timeout') { // a run with no tool calls still times out in this scenario
        send({ type: 'error', message: 'Agent timed out after 90 s. Showing engine-only results.' });
        controller.close();
        return;
      }
      send({ type: 'done', result });
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform' } });
}
