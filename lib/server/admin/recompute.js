// Company score recomputes, decoupled from the writes that cause them.
//
// A bulk approve can touch hundreds of companies, and each recompute is several round trips; doing them
// inside the approve request is what made "Approve all" time out AFTER it had written everything (the
// screen said "failed", the next press said "already decided"). Now a write only QUEUES its companies and
// drains what fits in a few seconds; the rest is drained by `recompute_queue_drain`, a job the UI repeats
// until `complete`.
//
// Where the queue lives: the additive table public.company_recompute_queue (migration
// 20261111100000_admin_core.sql). Before that migration the queue is the request itself: the pending
// companies come back in `cursor` and the next drain call carries them — nothing is lost, nothing is
// remembered server-side.

import { recomputeCompanyScoreFromReports } from '../../../api/_utils/reportWrite.js';
import { encodeCursor, decodeCursor, countExact, rows } from './batch.js';
import { eqValue } from '../pgrest.js';

export const companyKey = (name) => String(name || '').toLowerCase().trim();
const MAX_CURSOR_COMPANIES = 2000;

export function packCursor(companies) {
  const list = [...new Set(companies.map(companyKey).filter(Boolean))].slice(0, MAX_CURSOR_COMPANIES);
  return list.length ? encodeCursor(JSON.stringify({ c: list })) : undefined;
}

export function unpackCursor(cursor) {
  const raw = decodeCursorLong(cursor);
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v?.c) ? v.c.map(companyKey).filter(Boolean).slice(0, MAX_CURSOR_COMPANIES) : [];
  } catch { return []; }
}

function decodeCursorLong(c) {
  if (!c || typeof c !== 'string' || c.length > 400_000) return null;
  try { return Buffer.from(c, 'base64url').toString('utf8'); } catch { return decodeCursor(c); }
}

/** Queue companies. { mode: 'table'|'cursor', queued, cursor? } */
export async function enqueueCompanies(db, companies) {
  const list = [...new Set((companies || []).map(companyKey).filter(Boolean))];
  if (!list.length) return { mode: 'table', queued: 0 };
  let tableOk = true;
  for (let i = 0; i < list.length; i += 500) {
    const part = list.slice(i, i + 500).map((k) => ({ company_key: k }));
    const r = await db('company_recompute_queue?on_conflict=company_key', {
      method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(part),
    });
    if (!r || !r.ok) { tableOk = false; break; }
  }
  if (tableOk) return { mode: 'table', queued: list.length };
  return { mode: 'cursor', queued: list.length, cursor: packCursor(list) };
}

/**
 * Recompute until the deadline. Table mode reads the queue; cursor mode works through the carried list.
 * Returns { done, failed, remaining (number|null), complete, cursor?, mode }.
 */
export async function drainRecompute(db, svc, { cursor = null, deadline = Date.now() + 8000, max = 200 } = {}) {
  const carried = unpackCursor(cursor);
  let done = 0, failed = 0;
  if (carried.length) {
    let i = 0;
    for (; i < carried.length && i < max && Date.now() < deadline; i++) {
      const ok = await recomputeCompanyScoreFromReports(db.url, svc, carried[i]).catch(() => false);
      if (ok) done++; else failed++;
    }
    const rest = carried.slice(i);
    return { mode: 'cursor', done, failed, remaining: rest.length, complete: rest.length === 0, cursor: rest.length ? packCursor(rest) : undefined };
  }
  let emptied = false;
  for (let guard = 0; guard < 50 && Date.now() < deadline && done + failed < max; guard++) {
    const r = await db('company_recompute_queue?select=company_key,attempts&order=enqueued_at.asc&limit=10');
    const batch = await rows(r);
    if (!Array.isArray(batch)) {
      // No queue table and nothing carried: nothing to do.
      return { mode: 'none', done, failed, remaining: 0, complete: true };
    }
    if (!batch.length) { emptied = true; break; }
    for (const q of batch) {
      if (Date.now() > deadline) break;
      const ok = await recomputeCompanyScoreFromReports(db.url, svc, q.company_key).catch(() => false);
      if (ok) {
        done++;
        await db(`company_recompute_queue?company_key=eq.${eqValue(q.company_key)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      } else {
        failed++;
        // A company that keeps failing goes to the back after 3 tries instead of blocking the queue.
        const attempts = (Number(q.attempts) || 0) + 1;
        if (attempts >= 3) await db(`company_recompute_queue?company_key=eq.${eqValue(q.company_key)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
        else await db(`company_recompute_queue?company_key=eq.${eqValue(q.company_key)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ attempts, enqueued_at: new Date().toISOString() }) });
      }
    }
  }
  const remaining = await countExact(db, 'company_recompute_queue?select=company_key');
  // A failed count never makes the job loop forever: an empty read already proved the queue is done.
  return { mode: 'table', done, failed, remaining, complete: remaining === 0 || (remaining == null && emptied) };
}

/**
 * Recompute THESE companies first (the ones the caller just changed), until the deadline. Each success
 * leaves the queue; whatever is left stays queued (table mode) or comes back in `cursor` (cursor mode).
 * Returns { done, failed, remaining (number|null), complete, cursor?, mode }.
 */
export async function recomputeNow(db, svc, companies, { mode = 'table', deadline = Date.now() + 8000 } = {}) {
  const list = [...new Set((companies || []).map(companyKey).filter(Boolean))];
  let done = 0, failed = 0, i = 0;
  for (; i < list.length && Date.now() < deadline; i++) {
    const ok = await recomputeCompanyScoreFromReports(db.url, svc, list[i]).catch(() => false);
    if (ok) {
      done++;
      if (mode === 'table') await db(`company_recompute_queue?company_key=eq.${eqValue(list[i])}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    } else failed++;
  }
  const left = list.slice(i);
  if (mode === 'cursor') return { mode, done, failed, remaining: left.length, complete: left.length === 0, cursor: left.length ? packCursor(left) : undefined };
  const remaining = left.length ? await countExact(db, 'company_recompute_queue?select=company_key') : 0;
  return { mode, done, failed, remaining: remaining == null ? left.length : remaining, complete: (remaining ?? left.length) === 0 };
}
