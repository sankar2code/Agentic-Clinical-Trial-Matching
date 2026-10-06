/* Tamper-evident audit: SHA-256, the hash chain, anchors, and replay under today's rules. */
import { createHash } from 'node:crypto';
import { PATIENTS, TRIALS, TODAY, VERSIONS } from '../../lib/data';
import { AMENDMENTS } from '../../lib/amendments';
import { GENESIS, chainEntry, hashEntry, rewriteHistory, stable, verifyChain, type Anchor } from '../../lib/chain';
import { evidencePointer, matchAll, snapshotOf } from '../../lib/engine';
import { replaySnapshot } from '../../lib/replay';
import { sha256 } from '../../lib/sha';
import { buildTrials } from '../../lib/trials';
import { check, section } from '../harness';
import type { AuditEntry, Fact, Override, Rule } from '../../lib/types';

const live = TRIALS.filter((t) => !t.hiddenUntilOpened);
const P = (id: string) => PATIENTS.find((x) => x.id === id)!;
const stamp = `${VERSIONS.model} · ${VERSIONS.prompt} · ${VERSIONS.rules}`;

// Deterministic pseudo-random so the fuzz is repeatable
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000);

function build(n: number): AuditEntry[] {
  const out: AuditEntry[] = [];
  let prev = GENESIS;
  const snap = snapshotOf(matchAll(P('p2'), live, {}));
  for (let i = 1; i <= n; i++) {
    const e = chainEntry(prev, { id: i, ts: `2026-10-06T10:${String(i % 60).padStart(2, '0')}:00.000Z`, actor: 'Dr. Anika Rao', role: 'Treating oncologist', action: i % 5 === 0 ? 'match.run' : 'agent.ask', patientId: 'p2', trialId: 't1', detail: `entry number ${i}`, versions: stamp, snapshot: i % 5 === 0 ? snap : undefined, asOf: TODAY });
    out.push(e);
    prev = e.hash!;
  }
  return out;
}

section('13. Tamper-evident audit: SHA-256, the chain, anchors and replay', () => {
  // SHA-256 against Node's crypto
  const fixed = ['', 'abc', 'The quick brown fox jumps over the lazy dog', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(65), 'x'.repeat(119), 'x'.repeat(120), 'x'.repeat(1000), 'héllo wörld — 日本語 ✓ 🙂'];
  for (const v of fixed) check(`sha256 matches Node's crypto for a ${v.length}-character input`, sha256(v) === createHash('sha256').update(v).digest('hex'));
  let allSame = true;
  for (let i = 0; i < 150; i++) {
    const len = Math.floor(rnd() * 300);
    let s = '';
    for (let j = 0; j < len; j++) s += String.fromCharCode(32 + Math.floor(rnd() * 600));
    if (sha256(s) !== createHash('sha256').update(s).digest('hex')) allSame = false;
  }
  check('sha256 matches Node on 150 random strings including non-Latin text', allSame);
  check('sha256 of the empty string is the published value', sha256('') === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

  // Canonical form
  check('stable() ignores key order', stable({ b: 1, a: [{ d: 1, c: 2 }] }) === stable({ a: [{ c: 2, d: 1 }], b: 1 }));
  check('stable() drops undefined so an absent field and an undefined one hash alike', stable({ a: 1, b: undefined }) === stable({ a: 1 }));

  // A clean chain
  const chain = build(25);
  const v = verifyChain(chain);
  check('a clean chain verifies', v.ok && v.checked === 25 && !v.broken && v.unverifiable === 0);
  check('the first entry links to the genesis hash', chain[0].prevHash === GENESIS);
  check('each entry links to the hash of the one before', chain.every((e, i) => i === 0 || e.prevHash === chain[i - 1].hash));
  check('the head hash is the last entry hash', v.head === chain[24].hash);
  check('an empty log verifies trivially', verifyChain([]).ok);
  check('hashing is deterministic', chain.every((e) => hashEntry(e.prevHash!, (({ hash: _h, prevHash: _p, ...b }) => (void _h, void _p, b))(e)) === e.hash));

  // Every single field is bound into the hash
  const fields: (keyof AuditEntry)[] = ['id', 'ts', 'actor', 'role', 'action', 'patientId', 'trialId', 'detail', 'versions', 'asOf'];
  for (const f of fields) {
    const c = chain.map((e) => ({ ...e }));
    (c[9] as unknown as Record<string, unknown>)[f] = typeof c[9][f] === 'number' ? 999 : `${String(c[9][f])}X`;
    const r = verifyChain(c);
    check(`editing "${f}" of an entry is detected at that entry`, !r.ok && r.broken?.id === 10 || (f === 'id' && !r.ok), JSON.stringify(r.broken));
  }

  // Tampering
  const edit = chain.map((e) => (e.id === 12 ? { ...e, detail: 'nothing happened here' } : e));
  const ve = verifyChain(edit);
  check('editing an entry is caught and located', !ve.ok && ve.broken?.id === 12 && ve.broken.reason === 'content changed');
  check('everything after the edit is reported unverifiable', ve.unverifiable === 25 - 12);
  check('everything before the edit is still verified', ve.checked === 11);
  const snapEdit = chain.map((e) => (e.id === 15 ? { ...e, snapshot: { ...e.snapshot!, rows: e.snapshot!.rows.slice(1) } } : e));
  check('editing the stored results inside a snapshot is caught', verifyChain(snapEdit).broken?.id === 15);
  const del = chain.filter((e) => e.id !== 8);
  check('deleting an entry breaks the link at the next entry', verifyChain(del).broken?.reason === 'link broken' && verifyChain(del).broken?.id === 9);
  const swap = chain.map((e) => e);
  [swap[3], swap[4]] = [swap[4], swap[3]];
  check('reordering two entries is caught', !verifyChain(swap).ok);
  const forged = [...chain.slice(0, 10), { ...chain[10], hash: undefined, prevHash: undefined } as AuditEntry, ...chain.slice(11)];
  check('an entry with no hash is rejected as not written by the logger', verifyChain(forged).broken?.reason === 'missing hash');
  const own = chain.map((e) => (e.id === 12 ? chainEntry(e.prevHash!, { ...(({ hash: _h, prevHash: _p, ...b }) => (void _h, void _p, b))(e), detail: 'rewritten' }) : e));
  check('re-hashing only the edited entry still breaks the next link', verifyChain(own).broken?.id === 13 && verifyChain(own).broken?.reason === 'link broken');
  check('inserting a forged entry in the middle is caught', !verifyChain([...chain.slice(0, 5), chainEntry(chain[4].hash!, { id: 99, ts: 'x', actor: 'x', role: 'x', action: 'x', detail: 'forged', versions: 'x' }), ...chain.slice(5)]).ok);

  // An attacker with full write access recomputes every hash: only an anchor exposes it
  const anchor: Anchor = { count: 20, head: chain[19].hash!, ts: 'now' };
  const rewritten = rewriteHistory(chain, 6, 'history was changed');
  check('after a full rewrite the chain looks internally valid', verifyChain(rewritten).ok);
  check('but an anchor taken before the rewrite exposes it', !verifyChain(rewritten, [anchor]).ok && verifyChain(rewritten, [anchor]).anchorFailures[0]?.count === 20);
  check('an anchor does not protect entries written after it', verifyChain(rewriteHistory(chain, 22, 'late edit'), [anchor]).ok);
  check('the rewritten entry really changed', rewritten.find((e) => e.id === 6)!.detail === 'history was changed' && rewritten[5].hash !== chain[5].hash);
  check('an untouched chain passes its own anchors', verifyChain(chain, [anchor, { count: 25, head: chain[24].hash!, ts: 'n' }]).ok);
  const trunc = chain.slice(0, 18);
  check('truncating the log is invisible without an anchor', verifyChain(trunc).ok);
  const tv = verifyChain(trunc, [anchor]);
  check('but an anchor reveals the deleted entries', !tv.ok && /deleted/.test(tv.anchorFailures[0].detail));

  // Replay under today's rules
  const p2 = P('p2');
  const matches = matchAll(p2, live, {});
  const entry: AuditEntry = { id: 1, ts: 'x', actor: 'a', role: 'r', action: 'match.run', patientId: 'p2', detail: 'd', versions: stamp, snapshot: snapshotOf(matches), asOf: TODAY };
  const same = replaySnapshot(entry, p2, live, {}, {})!;
  check('replaying a result against unchanged rules changes nothing', same.changed.length === 0 && same.added.length === 0 && same.rows.length === entry.snapshot!.rows.length);
  check('replay returns null for an entry that stored no results', replaySnapshot({ ...entry, snapshot: undefined }, p2, live, {}, {}) === null);
  const k = live.find((t) => t.code === 'KEYSTONE-A')!;
  const pd = k.criteria.find((c) => c.rule.fact === 'pdl1')!;
  const p1m = matchAll(P('p1'), live, {});
  const e1: AuditEntry = { ...entry, patientId: 'p1', snapshot: snapshotOf(p1m) };
  const tight: Rule = { fact: 'pdl1', op: '>=', value: 90 };
  const edited = buildTrials(TRIALS, { [`t1|${pd.id}`]: { review: 'approved', rule: tight } }, []);
  const r1 = replaySnapshot(e1, P('p1'), edited, {}, {})!;
  check('after a threshold is raised, replay shows that exact result flipping', r1.changed.length === 1 && r1.changed[0].trial === 'KEYSTONE-A' && r1.changed[0].criterionId === pd.id && r1.changed[0].then === 'met' && r1.changed[0].now === 'notmet', JSON.stringify(r1.changed));
  check('replay reports the as-of date it used', r1.asOf === TODAY);
  const amended = buildTrials(TRIALS, {}, [], [{ id: 'A1', appliedAt: 'now' }]);
  const r3 = replaySnapshot({ ...entry, patientId: 'p3', snapshot: snapshotOf(matchAll(P('p3'), live, {})) }, P('p3'), amended, {}, {})!;
  check('after an amendment replaces a criterion, replay shows it as removed', r3.changed.some((c) => c.now === 'removed'));
  check('and lists the replacement criterion as newly added', r3.added.some((a) => a.now === 'pending'));
  // rows the clinician overrode are not replayed (they would show a spurious difference)
  const ov: Record<string, Override> = { [`p1|t1|${pd.id}`]: { to: 'met', reason: 'clinical judgement', note: 'n', citation: 'a real citation here', by: 'x', at: 'x', original: 'met' } };
  const r4 = replaySnapshot(e1, P('p1'), edited, {}, ov)!;
  check('overridden rows are left out of the replay and counted', r4.changed.length === 0 && r4.skippedOverrides === 1);
  // Evidence added later by the agent is part of the chart then only if the entry cited it
  const resolved = P('p2').hidden;
  const afterAgent = matchAll(p2, live, { overlay: { p2: resolved } });
  const e2: AuditEntry = { ...entry, snapshot: snapshotOf(afterAgent) };
  const withCited = replaySnapshot(e2, p2, live, { p2: resolved }, {})!;
  check('an entry that cited agent-resolved evidence replays with it and matches', withCited.changed.length === 0);
  const withoutCited = replaySnapshot(entry, p2, live, { p2: resolved }, {})!;
  check('evidence the entry never cited is not smuggled into the replayed chart', withoutCited.changed.length === 0);
  check('every pointer in a snapshot resolves to a real fact', (() => {
    const pointers = new Set(snapshotOf(afterAgent).rows.flatMap((r) => r.e));
    const facts: Fact[] = [...p2.facts, ...resolved];
    return [...pointers].every((ptr) => facts.some((f) => evidencePointer(f) === ptr));
  })());
  check('the amendment definitions used in replay exist', AMENDMENTS.length >= 2);
});
