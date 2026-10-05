// Admin session tokens: what is stored, and how a presented token is checked.
//
// The admin login (api/admin-stats.js) hands the browser a random 32-byte token. Only the SHA-256
// digest of that token is written to admin_sessions.token, so a copy of the table is not a set of
// usable sessions. Every lookup hashes the presented token and filters on the digest; nothing ever
// compares or stores the raw token server-side.
//
// Sessions written before this change hold the raw token in the same column. A presented token is
// hashed before the lookup, so those rows can no longer match anything: the admin signs in once
// more, and the old rows age out at their 8-hour expires_at. No schema change is involved, so an
// older deployment running against the same table keeps working (it just won't see new sessions).

import { createHash } from 'crypto';

/** SHA-256 hex digest of a session token. Hex is URL-safe, so it drops into a PostgREST filter. */
export function hashAdminToken(token) {
  return createHash('sha256').update(String(token ?? ''), 'utf8').digest('hex');
}

/** The admin token a request presents (header first, then the body field admin-stats accepts). */
export function presentedAdminToken(req, body) {
  const h = req?.headers || {};
  return String(h['x-admin-token'] || body?.admin_token || '').trim();
}

/**
 * Look up a live admin session for a presented token. Returns the row (with the requested columns
 * plus expires_at) when it exists and has not expired, else null. Never throws.
 */
export async function findAdminSession(token, {
  SUPABASE_URL = process.env.SUPABASE_URL,
  SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY,
  select = 'expires_at',
} = {}) {
  const raw = String(token || '').trim();
  if (!raw || !SUPABASE_URL || !SERVICE_KEY) return null;
  const parts = String(select).split(',').map(s => s.trim());
  const cols = parts.includes('*') || parts.includes('expires_at') ? select : `${select},expires_at`;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/admin_sessions?token=eq.${hashAdminToken(raw)}&select=${cols}&limit=1`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
    );
    const row = r.ok ? (await r.json())?.[0] : null;
    if (!row || !(new Date(row.expires_at) >= new Date())) return null;
    return row;
  } catch {
    return null;
  }
}
