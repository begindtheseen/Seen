// One definition of "this request is allowed to run a scheduled job".
//
// Vercel's documented way to authenticate a cron invocation is CRON_SECRET: when that env var is
// set, Vercel sends `Authorization: Bearer <CRON_SECRET>` on every cron request. The
// `x-vercel-cron` header on its own is an ordinary request header, so it cannot be the proof.
//
//   CRON_SECRET set   → a cron caller must present the secret (Authorization: Bearer, or the
//                       x-cron-secret header used by manual triggers). The header alone is refused.
//   CRON_SECRET unset → the x-vercel-cron header is the only signal Vercel sends, so it is accepted
//                       (exactly the behaviour before this module existed; removing it would stop
//                       every cron). Setting CRON_SECRET in Vercel closes that gap without a deploy.
//
// The secret is only ever read from headers, never from the query string: URLs are written to
// request logs, headers carrying credentials are not. Comparisons are constant-time.
//
// Admin-triggered runs keep working through a valid admin session token (X-Admin-Token).

import { createHash, timingSafeEqual } from 'crypto';
import { findAdminSession } from './adminSession.js';

function digest(s) {
  return createHash('sha256').update(String(s), 'utf8').digest();
}

/** Constant-time string equality (hashing first makes the lengths equal). */
export function secretsEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  return timingSafeEqual(digest(a), digest(b));
}

/** True when the request carries the configured CRON_SECRET in a header. False when unset. */
export function hasCronSecret(req, env = process.env) {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const h = req?.headers || {};
  const auth = String(h.authorization || '');
  const bearer = /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, '').trim() : '';
  const header = String(h['x-cron-secret'] || '').trim();
  return secretsEqual(bearer, secret) || secretsEqual(header, secret);
}

/** True when the request claims to be a Vercel cron invocation (routing only, never proof). */
export function claimsVercelCron(req) {
  return String(req?.headers?.['x-vercel-cron'] || '') === '1';
}

/**
 * Is this a scheduled-job caller? With CRON_SECRET configured, only the secret counts. Without it,
 * the Vercel cron header is accepted because nothing stronger exists (see the header comment).
 */
export function isCronAuthorized(req, env = process.env) {
  if (env.CRON_SECRET) return hasCronSecret(req, env);
  return claimsVercelCron(req);
}

/**
 * Cron caller OR a live admin session. Never throws; any lookup failure is a refusal.
 * opts.adminToken overrides the X-Admin-Token header (e.g. admin-stats also accepts a body field).
 */
export async function isCronOrAdmin(req, { env = process.env, adminToken, SUPABASE_URL, SERVICE_KEY } = {}) {
  if (isCronAuthorized(req, env)) return true;
  const token = String(adminToken ?? req?.headers?.['x-admin-token'] ?? '').trim();
  if (!token) return false;
  const sess = await findAdminSession(token, {
    SUPABASE_URL: SUPABASE_URL ?? env.SUPABASE_URL,
    SERVICE_KEY: SERVICE_KEY ?? env.SUPABASE_SERVICE_KEY,
  });
  return !!sess;
}
