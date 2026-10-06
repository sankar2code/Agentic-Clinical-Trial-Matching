/* Shared test harness: sections, checks, a crash-safe runner and the final summary. */
let passed = 0;
export const failed: { group: string; name: string; detail: string }[] = [];
let group = '';
export const tally: Record<string, [number, number]> = {};

const queue: (() => Promise<void>)[] = [];

/** Register a section. Bodies may be async. They run in registration order once runAll() is called. */
export function section(name: string, body: () => void | Promise<void>) {
  queue.push(async () => {
    group = name;
    tally[name] = [0, 0];
    console.log(`\n${name}`);
    try {
      await body();
    } catch (e) {
      // A crash is a failure, never a silent abort: later sections still run and the exit code is non-zero.
      tally[name][1] += 1;
      failed.push({ group: name, name: 'section ran to completion without throwing', detail: String((e as Error)?.stack ?? e).split('\n').slice(0, 3).join(' | ') });
      console.log(`  ✗ section crashed: ${(e as Error)?.message ?? e}`);
    }
  });
}

export async function runAll() {
  for (const task of queue) await task();
}

export function check(name: string, ok: boolean, detail = '') {
  tally[group][1] += 1;
  if (ok) { passed += 1; tally[group][0] += 1; return; }
  failed.push({ group, name, detail });
  console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
}

export function summary() {
  console.log('\n──────────────────────────────────────────');
  for (const [g, [ok, total]] of Object.entries(tally)) console.log(`${ok === total ? '✓' : '✗'} ${g}: ${ok}/${total}`);
  console.log(`\n${passed} passed, ${failed.length} failed`);
  if (failed.length) {
    console.log('\nFailures by group:');
    for (const g of Object.keys(tally)) {
      const f = failed.filter((x) => x.group === g);
      if (f.length) console.log(`  ${g}: ${f.length}`);
    }
    process.exit(1);
  }
}
