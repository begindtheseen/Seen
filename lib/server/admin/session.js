// Sign in / sign out. One submit = one attempt and at most one session: a client that fires the same
// submit twice (the old login form did, on Enter) passes the same `submit_id`, and the second copy is answered
// without counting another attempt or opening a second session.

import { ok, fail, logSafe } from './respond.js';
import { hashPw, verifyPw, newToken, newSalt } from './auth.js';
import { rows } from './batch.js';
import { eqValue } from '../pgrest.js';

const SUBMIT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

async function bump(url, key, p_key, ttl, fetchImpl) {
  try {
    const r = await fetchImpl(`${url}/rest/v1/rpc/increment_rate_limit`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_key, p_ttl_seconds: ttl }),
    });
    if (!r.ok) return null;
    const n = Number(await r.json());
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

export async function login(req, res, { db, url, key, body, fetchImpl = (...a) => globalThis.fetch(...a) }) {
  const username = String(body.username || '').trim().slice(0, 100);
  const password = String(body.password || '');
  if (!username || !password) return fail(res, 400, 'Username and password required');
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim().slice(0, 64);

  // The same submit arriving twice: answer the copy without counting it.
  const submitId = SUBMIT_ID_RE.test(String(body.submit_id || '')) ? String(body.submit_id) : null;
  if (submitId) {
    const seen = await bump(url, key, `admin_login_submit:${submitId}`, 120, fetchImpl);
    if (seen != null && seen > 1) return fail(res, 409, 'Already signing in with this submit.', { code: 'conflict', retryable: false, duplicate_submit: true });
  }

  const window = Math.floor(Date.now() / (15 * 60000));
  const attempts = await bump(url, key, `${ip}:admin_login:${window}`, 900, fetchImpl);
  if (attempts != null && attempts > 5) return fail(res, 429, 'Too many login attempts — try again in 15 minutes', { code: 'rate_limited', retryable: false });

  const list = await rows(await db('admin_accounts?select=id&limit=1'));
  if (!Array.isArray(list)) return fail(res, 502, 'Could not reach the database — try again.');
  if (!list.length) {
    const EU = process.env.ADMIN_USERNAME, EP = process.env.ADMIN_PASSWORD;
    if (!EU || !EP) return fail(res, 503, 'No admin accounts. Set ADMIN_USERNAME and ADMIN_PASSWORD env vars.', { code: 'upstream', retryable: false });
    if (username !== EU || password !== EP) return fail(res, 401, 'Invalid credentials');
    const salt = newSalt();
    await db('admin_accounts', { method: 'POST', body: JSON.stringify({ username: EU, password_hash: hashPw(EP, salt), salt, role: 'super_admin' }), headers: { Prefer: 'return=minimal' } });
  }

  const acct = ((await rows(await db(`admin_accounts?username=eq.${eqValue(username)}&limit=1`))) || [])[0] || null;
  if (!acct) return fail(res, 401, 'Invalid credentials');
  if (!acct.is_active) return fail(res, 401, 'Account disabled');
  if (acct.locked_until && new Date(acct.locked_until) > new Date()) return fail(res, 429, 'Too many failed attempts — try again in 15 minutes', { code: 'rate_limited', retryable: false });

  if (!verifyPw(password, acct.salt, acct.password_hash)) {
    const n = (acct.login_attempts || 0) + 1;
    const patch = { login_attempts: n };
    if (n >= 5) patch.locked_until = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await db(`admin_accounts?id=eq.${eqValue(acct.id)}`, { method: 'PATCH', body: JSON.stringify(patch), headers: { Prefer: 'return=minimal' } });
    return fail(res, 401, 'Invalid credentials');
  }

  const token = newToken();
  const ins = await db('admin_sessions', { method: 'POST', body: JSON.stringify({ token, admin_id: acct.id, role: acct.role, expires_at: new Date(Date.now() + 8 * 3600000).toISOString(), ip_address: ip }), headers: { Prefer: 'return=minimal' } });
  if (!ins.ok) {
    console.error('[admin] session insert failed: %s', logSafe(ins.status));
    return fail(res, 502, 'Could not start a session — try again.');
  }
  await db(`admin_accounts?id=eq.${eqValue(acct.id)}`, { method: 'PATCH', body: JSON.stringify({ login_attempts: 0, locked_until: null, last_login: new Date().toISOString() }), headers: { Prefer: 'return=minimal' } });
  await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: acct.id, username: acct.username, action: 'login', target_type: 'system', metadata: { ip } }), headers: { Prefer: 'return=minimal' } });
  return ok(res, { changed: 1, message: `Signed in as ${acct.username}.`, token, role: acct.role, username: acct.username });
}

export async function logout(ctx) {
  const r = await ctx.db(`admin_sessions?token=eq.${eqValue(ctx.sess.token)}&select=admin_id`, { method: 'DELETE' });
  const changed = r.ok ? ((await r.json().catch(() => [])) || []).length : 0;
  return ok(ctx.res, { changed, message: 'Signed out.' });
}
