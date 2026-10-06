import { sha256 } from './sha';
import type { AuditEntry } from './types';

export const GENESIS = '0'.repeat(64);

/** JSON with keys sorted, so the same entry always hashes the same way. */
export function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
}

type Body = Omit<AuditEntry, 'hash' | 'prevHash'>;
const body = (e: AuditEntry): Body => { const { hash: _h, prevHash: _p, ...rest } = e; void _h; void _p; return rest; };

export const hashEntry = (prev: string, e: Body) => sha256(`${prev}|${stable(e)}`);

/** Append-time: link an entry to the one before it. */
export function chainEntry(prev: string, e: Body): AuditEntry {
  return { ...e, prevHash: prev, hash: hashEntry(prev, e) };
}

export interface Anchor { count: number; head: string; ts: string }

export interface Verification {
  ok: boolean;
  checked: number;
  head: string;
  broken?: { id: number; reason: 'content changed' | 'link broken' | 'missing hash'; detail: string };
  /** Entries after the first break: their own hashes can no longer be trusted. */
  unverifiable: number;
  anchorFailures: { count: number; detail: string }[];
}

/** Recompute the whole chain. The first break is reported; everything after it is unverifiable. */
export function verifyChain(entries: AuditEntry[], anchors: Anchor[] = []): Verification {
  let prev = GENESIS;
  let broken: Verification['broken'];
  let checked = 0;
  for (const e of entries) {
    if (broken) continue;
    if (!e.hash || e.prevHash === undefined) broken = { id: e.id, reason: 'missing hash', detail: 'This entry carries no hash, so it was not written by the logger.' };
    else if (e.prevHash !== prev) broken = { id: e.id, reason: 'link broken', detail: 'This entry does not link to the one before it: an entry was removed, inserted or reordered.' };
    else if (hashEntry(prev, body(e)) !== e.hash) broken = { id: e.id, reason: 'content changed', detail: 'The stored hash does not match the entry text: it was edited after it was written.' };
    else { prev = e.hash; checked += 1; }
  }
  const anchorFailures: Verification['anchorFailures'] = [];
  for (const a of anchors) {
    const at = entries[a.count - 1];
    if (!at) anchorFailures.push({ count: a.count, detail: `Anchored at entry ${a.count}, but the log now has only ${entries.length} entries: entries were deleted.` });
    else if (at.hash !== a.head) anchorFailures.push({ count: a.count, detail: `The anchored head hash for entry ${a.count} no longer matches: history before this point was rewritten.` });
  }
  return { ok: !broken && anchorFailures.length === 0, checked, head: entries[entries.length - 1]?.hash ?? GENESIS, broken, unverifiable: broken ? entries.length - checked - 1 : 0, anchorFailures };
}

/** What an attacker with full write access can do: edit an entry, then recompute every hash after it so the chain looks fine. */
export function rewriteHistory(entries: AuditEntry[], id: number, detail: string): AuditEntry[] {
  let prev = GENESIS;
  return entries.map((e) => {
    const next = body(e.id === id ? { ...e, detail } : e);
    const out = chainEntry(prev, next);
    prev = out.hash!;
    return out;
  });
}

/* ---------- The attacker simulation, as pure functions so the rules can be tested without a browser ---------- */

export interface TamperState {
  id: number;
  kind: 'edit' | 'rewrite';
  /** The honest log as it stood before the tampering. */
  original: AuditEntry[];
}

/** Edit one entry in place, or rewrite history from it and recompute every hash so the chain still looks valid. */
export function tamperLog(entries: AuditEntry[], id: number, kind: TamperState['kind'], detail: string): { audit: AuditEntry[]; tamper: TamperState } | null {
  if (!entries.some((e) => e.id === id)) return null;
  const audit = kind === 'edit' ? entries.map((e) => (e.id === id ? { ...e, detail } : e)) : rewriteHistory(entries, id, detail);
  return { audit, tamper: { id, kind, original: entries } };
}

/**
 * Undo the simulated tampering. Entries written while it was in place are chained onto the honest log again. An anchor
 * survives only if it agrees with the restored log: one taken while the log was tampered with holds a hash of a log that
 * no longer exists, and keeping it would show a failure that nothing could clear.
 */
export function repairLog(entries: AuditEntry[], anchors: Anchor[], t: TamperState): { audit: AuditEntry[]; anchors: Anchor[] } {
  const base = t.original;
  const later = entries.filter((e) => e.id > base.length);
  let prev = base[base.length - 1]?.hash ?? GENESIS;
  const rechained = later.map((e) => { const out = chainEntry(prev, body(e)); prev = out.hash!; return out; });
  const audit = [...base, ...rechained];
  return { audit, anchors: anchors.filter((a) => audit[a.count - 1]?.hash === a.head) };
}

/** Anchor the current head. Refused while the log is tampered with: the anchor would certify the tampering and nothing could clear it. */
export function anchorHead(entries: AuditEntry[], anchors: Anchor[], tampered: boolean, ts: string): Anchor[] | null {
  const last = entries[entries.length - 1];
  if (!last?.hash || tampered) return null;
  return [...anchors, { count: entries.length, head: last.hash, ts }];
}
