// The held queue's duplicate-of-live check, remembered between reads (round 10).
//
// Why: the list's check against published reports is time-boxed, so on a slow database most rows came back
// "not yet checked" and the "Approve all positive (N)" count moved for ~40 s after load (44 → 23 → 140). Now a check
// result is kept per report id + a hash of the report's compare key (company + outcome + text, `dupKey`), so the next
// read applies it without a database round trip and the count is the same on every load.
//
// Where it lives: the additive table public.admin_dup_checks (migration 20261111130000_admin_dup_checks.sql). Before
// that migration (or when it cannot be read) the cache is this process's memory — same rules, per instance.
//
// When an entry stops counting:
//   - the report's compare key changed (text, outcome or company edited) → the hash differs → checked again;
//   - it is older than DUP_CACHE.ttlMs;
//   - a report of that company changed state (approved, rejected, restored, merged, outcome corrected): every path
//     that changes a company's reports queues its score (recompute.js enqueueCompanies), and that call clears the
//     company's entries here, so a copy whose original was just published is never read as clean from the cache.
// The bulk approve still re-checks at decision time (case-insensitive) and never trusts the cache.

import { createHash } from 'crypto';
import { readAll, chunk } from './batch.js';
import { inList } from '../pgrest.js';
import { companyCompareKey } from '../reportReview.js';

export const DUP_CACHE = { ttlMs: 15 * 60_000, table: 'admin_dup_checks' };
const memory = new Map(); // report_id → { report_id, key_hash, company, duplicate_of, checked_at }

// v2: the key compares the company case-insensitively with whitespace collapsed; v1 entries (exact-name reads) never match.
export const keyHash = (key) => createHash('sha256').update(`v2\n${String(key)}`).digest('hex').slice(0, 32);

/** Every fresh entry → Map<report_id, entry>. `source` = 'table' | 'memory'. Never throws. */
export async function loadDupCache(db) {
  const since = new Date(Date.now() - DUP_CACHE.ttlMs).toISOString();
  const got = await readAll(db, DUP_CACHE.table, { select: 'report_id,key_hash,company,duplicate_of,checked_at', filter: `checked_at=gte.${encodeURIComponent(since)}`, idCol: 'report_id', max: 100000 }).catch(() => ({ ok: false }));
  if (got.ok) return { source: 'table', entries: new Map(got.rows.map((e) => [String(e.report_id), e])) };
  const cut = Date.now() - DUP_CACHE.ttlMs;
  const entries = new Map();
  for (const [id, e] of memory) { if (Date.parse(e.checked_at) >= cut) entries.set(id, e); else memory.delete(id); }
  return { source: 'memory', entries };
}

/** Store results (best effort, time-boxed by the caller's budget). Memory always; the table when it exists. */
export async function saveDupCache(db, entries, { source = 'table', deadline = Date.now() + 2000 } = {}) {
  for (const e of entries) memory.set(String(e.report_id), e);
  if (source !== 'table' || !entries.length) return { saved: 0 };
  // Entries past a day are never read again (reports leave the queue): drop them as we write.
  await db(`${DUP_CACHE.table}?checked_at=lt.${encodeURIComponent(new Date(Date.now() - 86400e3).toISOString())}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => null);
  let saved = 0;
  for (const part of chunk(entries, 500)) {
    if (Date.now() > deadline) break;
    const r = await db(`${DUP_CACHE.table}?on_conflict=report_id`, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(part) }).catch(() => null);
    if (!r || !r.ok) break;
    saved += part.length;
  }
  return { saved };
}

/** A company's reports changed: its cached results no longer count. Never throws. */
export async function clearDupCache(db, companies) {
  const keys = [...new Set((companies || []).map(companyCompareKey).filter(Boolean))];
  if (!keys.length) return;
  const set = new Set(keys);
  for (const [id, e] of memory) if (set.has(e.company)) memory.delete(id);
  for (const part of chunk(keys, 40)) {
    await db(`${DUP_CACHE.table}?company=in.${inList(part)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => null);
  }
}

/** Tests: forget the process memory. */
export function resetDupMemory() { memory.clear(); }
