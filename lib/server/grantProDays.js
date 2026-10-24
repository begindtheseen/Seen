// The ONE place that adds Seen Pro time to an account (ai_credits.pro_until). Used by Stripe one-time
// fulfillment (lib/server/stripeFulfillment.js, the Interview Sprint) and by the growth rewards
// (lib/server/growthRewards.js: report a tracked outcome, invite a friend).
//
// Two ways to add days, chosen by the caller:
//   stack: false  → pro_until = GREATEST(pro_until, now + days). Migration 044's rule for a purchase:
//                   a second Sprint bought during the first never shortens the window, and the
//                   overlap is not added on top (unchanged since 2026-07-04).
//   stack: true   → pro_until = GREATEST(pro_until, now) + days. A reward is ADDED after the Pro time
//                   already left, so three rewards in a row are nine days, not three.
//
// Concurrency: the write is a compare-and-set. The PATCH repeats the pro_until value it read
// (`pro_until=eq.<value>` or `pro_until=is.null`), so two grants racing on one account cannot both
// extend from the same starting point and lose days: the loser matches no row, re-reads and tries
// again. No database function is needed, so this works on every schema the app runs against.
import { ensureCreditsRow } from './ensureCreditsRow.js';
import { pacificDate } from '../time/pacific.js';

const DAY_MS = 86400e3;

/**
 * The pro_until a grant produces. Pure.
 * @param {string|null|undefined} currentIso  the account's current pro_until
 * @param {number} days
 * @param {{ stack?: boolean, nowMs?: number }} [opts]
 * @returns {string} ISO timestamp
 */
export function nextProUntil(currentIso, days, { stack = true, nowMs = Date.now() } = {}) {
  const add = Math.max(0, Number(days) || 0) * DAY_MS;
  const cur = currentIso ? Date.parse(currentIso) : NaN;
  const current = Number.isFinite(cur) ? cur : 0;
  if (stack) return new Date(Math.max(current, nowMs) + add).toISOString();
  return new Date(Math.max(current, nowMs + add)).toISOString();
}

/**
 * Add `days` of Pro to `uid`.
 * @param {(path: string, opts?: object) => Promise<Response>} db  PostgREST fetcher with the service key
 * @param {string} uid
 * @param {number} days
 * @param {{ stack?: boolean, today?: string, nowMs?: number, extra?: (row: object) => object, attempts?: number }} [opts]
 *   extra: more columns to write in the SAME patch, computed from the row as read (fulfillment adds
 *   purchased_credits this way, so a retry after a lost race recomputes it from the fresh row too).
 * @returns {Promise<{ ok: true, pro_until: string, previous: string|null } | { ok: false, reason: string }>}
 */
export async function grantProDays(db, uid, days, { stack = true, today = pacificDate(), nowMs, extra, attempts = 4 } = {}) {
  const n = Math.max(0, Math.round(Number(days) || 0));
  if (!uid || n <= 0) return { ok: false, reason: 'nothing_to_grant' };
  for (let i = 0; i < attempts; i++) {
    const read = await db(`ai_credits?user_id=eq.${uid}&limit=1`).catch(() => null);
    if (!read || !read.ok) return { ok: false, reason: 'row_read_failed' };
    let row = (await read.json().catch(() => []))?.[0] || null;
    if (!row) {
      row = await ensureCreditsRow(db, uid, today);
      if (!row) return { ok: false, reason: 'row_create_failed' };
    }
    const previous = row.pro_until || null;
    const proUntil = nextProUntil(previous, n, { stack, nowMs: nowMs ?? Date.now() });
    const guard = previous ? `pro_until=eq.${encodeURIComponent(previous)}` : 'pro_until=is.null';
    const patch = { ...(extra ? extra(row) : {}), pro_until: proUntil };
    const up = await db(`ai_credits?user_id=eq.${uid}&${guard}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    }).catch(() => null);
    if (!up || !up.ok) return { ok: false, reason: 'row_update_failed' };
    const changed = await up.json().catch(() => null);
    // PostgREST answers return=representation with the updated rows: [] means another write moved
    // pro_until first, so read again. A body that is not an array (a proxy or fake that sends no
    // rows) cannot say either way and is taken as applied, which is what the write was before.
    if (!Array.isArray(changed) || changed.length > 0) return { ok: true, pro_until: proUntil, previous };
  }
  return { ok: false, reason: 'contended' };
}
