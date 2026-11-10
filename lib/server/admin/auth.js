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

export async function requireAdmin(req, {
  url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY,
  fetchImpl = (...a) => globalThis.fetch(...a), body = null, token = null,
} = {}) {
  const t = token != null ? String(token).trim() : adminTokenFrom(req, body);
  if (!t || !url || !key) return null;
  // A token is 64 hex characters (randomBytes(32)); nothing longer than that can be a session.
  if (t.length > 128) return null;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const signal = () => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined);
  try {
    const r = await fetchImpl(`${url}/rest/v1/admin_sessions?token=eq.${encodeURIComponent(t)}&select=admin_id,role,expires_at&limit=1`, { headers, signal: signal() });
    if (!r || !r.ok) return null;
    const row = (await r.json().catch(() => null))?.[0];
    if (!row || !(new Date(row.expires_at) > new Date())) return null;
    let username = null;
    let active = true;
    if (row.admin_id != null) {
      try {
        const a = await fetchImpl(`${url}/rest/v1/admin_accounts?id=eq.${encodeURIComponent(row.admin_id)}&select=username,is_active&limit=1`, { headers, signal: signal() });
        const acct = a && a.ok ? (await a.json().catch(() => null))?.[0] : null;
        if (acct) { username = acct.username || null; active = acct.is_active !== false; }
      } catch { /* the name is for the audit trail only */ }
    }
    if (!active) return null;
    return { admin_id: row.admin_id, role: row.role || 'admin', username: username || 'admin', expires_at: row.expires_at, token: t };
  } catch {
    return null;
  }
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
