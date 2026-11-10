// THE admin-session check. Every endpoint that takes an X-Admin-Token calls requireAdmin — api/admin-stats.js,
// api/employer-claims.js, api/admin-company-audit-{pdf,package}.js, api/admin-rescore-jobs.js — so the rule
// (token in admin_sessions, not expired, account still active) lives in one place.
//
// Returns the session { admin_id, role, username, expires_at, token } or null. Never throws.

import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

export function adminTokenFrom(req, body = null) {
  const h = (req && req.headers) || {};
  const raw = h['x-admin-token'] ?? (typeof h.get === 'function' ? h.get('x-admin-token') : null) ?? (body && body.admin_token) ?? '';
  return String(raw || '').trim();
}

/**
 * Check a session and say why it failed: { sess } | { status: 401 } (read, and missing / expired / disabled) |
 * { status: 503 } (could not be read: timeout, 5xx, network). A slow database must never sign the owner out.
 */
export async function checkAdmin(req, {
  url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY,
  fetchImpl = (...a) => globalThis.fetch(...a), body = null, token = null, timeoutMs = 5000,
} = {}) {
  const t = token != null ? String(token).trim() : adminTokenFrom(req, body);
  if (!t || t.length > 128) return { status: 401 };
  if (!url || !key) return { status: 503 };
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const signal = () => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined);
  let row;
  try {
    const r = await fetchImpl(`${url}/rest/v1/admin_sessions?token=eq.${encodeURIComponent(t)}&select=admin_id,role,expires_at&limit=1`, { headers, signal: signal() });
    if (!r || !r.ok) return { status: r && r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429 ? 401 : 503 };
    const got = await r.json().catch(() => undefined);
    if (!Array.isArray(got)) return { status: 503 };
    row = got[0];
  } catch {
    return { status: 503 };
  }
  if (!row || !(new Date(row.expires_at) > new Date())) return { status: 401 };
  let username = null;
  if (row.admin_id != null) {
    try {
      const a = await fetchImpl(`${url}/rest/v1/admin_accounts?id=eq.${encodeURIComponent(row.admin_id)}&select=username,is_active&limit=1`, { headers, signal: signal() });
      if (!a || !a.ok) return { status: 503 };
      const acct = (await a.json().catch(() => null))?.[0];
      if (acct && acct.is_active === false) return { status: 401 };
      username = acct?.username || null;
    } catch {
      return { status: 503 };
    }
  }
  return { sess: { admin_id: row.admin_id, role: row.role || 'admin', username: username || 'admin', expires_at: row.expires_at, token: t } };
}

/** The session, or null. Callers that must tell 401 from 503 use checkAdmin + adminDenied. */
export async function requireAdmin(req, opts = {}) {
  return (await checkAdmin(req, opts)).sess || null;
}

/** The AdminErr body for a failed check. */
export function adminDenied(status) {
  return status === 503
    ? { status: 503, body: { ok: false, error: 'Couldn’t check your session — try again.', code: 'upstream', retryable: true } }
    : { status: 401, body: { ok: false, error: 'Session expired — log in again', code: 'unauthorized', retryable: false } };
}

export const isModerator = (sess) => !sess || sess.role === 'moderator';

export function hashPw(password, salt) {
  return scryptSync(password, salt, 64).toString('hex');
}

export function verifyPw(password, salt, hash) {
  try {
    const derived = scryptSync(password, salt, 64).toString('hex');
    return timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(String(hash), 'hex'));
  } catch { return false; }
}

export const newToken = () => randomBytes(32).toString('hex');
export const newSalt = () => randomBytes(16).toString('hex');
