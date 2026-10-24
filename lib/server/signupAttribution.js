// record_attribution (api/user-sync.js): store how a NEW account first arrived on Seen, once.
//
// The browser sends the device's first touch (+ the latest external touch) kept by lib/attribution.js.
// Every field is cleaned again here with the same rules (cleanTouch), whatever the client sent.
// Rules:
//   - the account must be younger than ATTRIBUTION_ACCOUNT_MAX_DAYS (read from the auth server, never the
//     client) — an older account is not a sign-up from this touch;
//   - the touch must predate the sign-up (SIGNUP_SLACK_MS for clock skew) — a device that only met Seen
//     after the account existed (the confirmation link opened on a laptop) is not how the person arrived;
//   - insert-only: on_conflict=user_id + resolution=ignore-duplicates, so the first record wins.
// `final` tells the browser to forget the touch (true) or keep it for a later try (false).
// Deploy order: this ships before migration 20261024180000_signup_attribution.sql; a missing table is
// { reason: 'not_ready', final: false } and nothing else happens.

import { cleanTouch } from '../attribution.js';
import { isMissingTable } from './growthRewards.js';

export const ATTRIBUTION_ACCOUNT_MAX_DAYS = 7;
export const SIGNUP_SLACK_MS = 60 * 60e3;
const LAST_TOUCH_FIELDS = ['landing_path', 'referrer_host', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref_code', 'first_seen_at'];

/** The row to insert, or { error } when the request cannot be stored. Pure. */
export function attributionRow(uid, body, { accountCreatedAt, nowMs = Date.now() } = {}) {
  const created = Date.parse(String(accountCreatedAt || ''));
  if (!Number.isFinite(created)) return { error: 'failed', final: false };
  if (nowMs - created > ATTRIBUTION_ACCOUNT_MAX_DAYS * 86400e3) return { error: 'too_old', final: true };
  const first = cleanTouch(body && body.first_touch, nowMs);
  if (!first || !first.first_seen_at) return { error: 'invalid', final: true };
  if (Date.parse(first.first_seen_at) > created + SIGNUP_SLACK_MS) return { error: 'after_signup', final: true };
  const lastClean = cleanTouch(body && body.last_touch, nowMs);
  const last = lastClean ? Object.fromEntries(LAST_TOUCH_FIELDS.map((k) => [k, lastClean[k] ?? null])) : null;
  return {
    row: {
      user_id: uid,
      ...first,
      last_touch: last,
      account_created_at: new Date(created).toISOString(),
      recorded_at: new Date(nowMs).toISOString(),
    },
  };
}

/** Insert the row once. Never throws. */
export async function recordSignupAttribution(db, uid, body, opts = {}) {
  const built = attributionRow(uid, body, opts);
  if (built.error) return { ok: false, reason: built.error, final: built.final };
  let r;
  try {
    r = await db('signup_attribution?on_conflict=user_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify(built.row),
    });
  } catch { return { ok: false, reason: 'failed', final: false }; }
  const text = await r.text().catch(() => '');
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  if (!r.ok) {
    if (isMissingTable(r.status, parsed)) return { ok: false, reason: 'not_ready', final: false };
    return { ok: false, reason: 'failed', final: false };
  }
  const inserted = Array.isArray(parsed) ? parsed.length : 0;
  return inserted ? { ok: true, recorded: true, final: true } : { ok: true, recorded: false, reason: 'already_recorded', final: true };
}
