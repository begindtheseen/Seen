// Resolve the signed-in user from a Supabase access token WITHOUT a network round trip.
//
// Why: the project signs user tokens with an asymmetric ES256 key (verified 2026-10-24 at
// /auth/v1/.well-known/jwks.json), so the HS256 check every handler carried never passed and
// EVERY /api/user-sync call paid one extra HTTPS round trip to /auth/v1/user before its first DB
// read — on top of the rate-limit RPC. The dashboard fires several of these at mount.
//
// Order: HS256 with SUPABASE_JWT_SECRET (legacy projects) → ES256/RS256 against the project's JWKS,
// cached in module scope for the life of the warm function (re-fetched at most once a minute when a
// token names an unknown kid — a key rotation) → the /auth/v1/user API as the last resort, so a
// JWKS outage can never lock users out.
//
// Only `sub` (the user id) and `exp` are trusted from the payload, and only after the signature
// verifies; the anon and service_role keys carry no `sub` and are refused.
//
// A signature says who the token was ISSUED to, not that its session still exists: "Sign out of all
// devices" deletes the sessions, but an access token stays signed and unexpired for up to an hour.
// `sessionStillValid` asks the auth server (GoTrue answers 403 session_not_found for a deleted
// session); callers run it IN PARALLEL with their other first-hop work (api/user-sync.js runs it
// beside the rate-limit RPC), so revocation holds without adding a serial round trip.

import { createHash, createHmac, createPublicKey, timingSafeEqual, verify as cryptoVerify } from 'crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decodePart(part) {
  try { return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')); } catch { return null; }
}

/** Header + payload of a JWT without verifying anything. null when it is not a three-part token. */
export function decodeJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const header = decodePart(parts[0]);
  const payload = decodePart(parts[1]);
  if (!header || !payload) return null;
  return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature: parts[2] };
}

function acceptablePayload(payload, nowSec) {
  if (!payload || typeof payload.sub !== 'string' || !UUID.test(payload.sub)) return false;
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) return false;
  return true;
}

/** Verify an HS256 Supabase JWT locally. Returns the payload or null. */
export function verifyHs256(token, secret, now = Date.now) {
  try {
    const t = decodeJwt(token);
    if (!t || !secret) return null;
    const mac = createHmac('sha256', secret).update(t.signingInput).digest('base64url');
    const sigBuf = Buffer.from(t.signature, 'base64url');
    const macBuf = Buffer.from(mac, 'base64url');
    if (sigBuf.length !== macBuf.length || !timingSafeEqual(sigBuf, macBuf)) return null;
    return acceptablePayload(t.payload, Math.floor(now() / 1000)) ? t.payload : null;
  } catch { return null; }
}

// ── JWKS cache (per Supabase URL; lives as long as the function instance) ─────────────────────────
const JWKS_REFETCH_MS = 60_000;
const jwksCache = new Map(); // url → { keys: Map<kid, KeyObject>, fetchedAt }

/** Test seam: forget every cached key set. */
export function resetJwksCache() { jwksCache.clear(); }

async function loadJwks(url, fetchImpl) {
  const r = await fetchImpl(`${url}/auth/v1/.well-known/jwks.json`, { signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error(`jwks ${r.status}`);
  const body = await r.json();
  const keys = new Map();
  for (const jwk of (Array.isArray(body?.keys) ? body.keys : [])) {
    if (!jwk || typeof jwk.kid !== 'string') continue;
    try { keys.set(jwk.kid, { key: createPublicKey({ key: jwk, format: 'jwk' }), alg: jwk.alg }); } catch { /* skip an unusable key */ }
  }
  return keys;
}

async function keyFor(url, kid, fetchImpl, now) {
  let entry = jwksCache.get(url);
  if (!entry || (!entry.keys.has(kid) && now() - entry.fetchedAt > JWKS_REFETCH_MS)) {
    const keys = await loadJwks(url, fetchImpl);
    entry = { keys, fetchedAt: now() };
    jwksCache.set(url, entry);
  }
  return entry.keys.get(kid) || null;
}

/** Verify an ES256 / RS256 Supabase JWT against the project's JWKS. Returns the payload or null. */
export async function verifyWithJwks(token, supabaseUrl, { fetchImpl = fetch, now = Date.now } = {}) {
  const t = decodeJwt(token);
  if (!t || typeof t.header.kid !== 'string') return null;
  const alg = t.header.alg;
  if (alg !== 'ES256' && alg !== 'RS256') return null;
  let entry;
  try { entry = await keyFor(supabaseUrl, t.header.kid, fetchImpl, now); } catch { return null; }
  if (!entry || (entry.alg && entry.alg !== alg)) return null;
  try {
    const sig = Buffer.from(t.signature, 'base64url');
    const data = Buffer.from(t.signingInput);
    const ok = alg === 'ES256'
      ? cryptoVerify('sha256', data, { key: entry.key, dsaEncoding: 'ieee-p1363' }, sig)
      : cryptoVerify('sha256', data, entry.key, sig);
    if (!ok) return null;
  } catch { return null; }
  return acceptablePayload(t.payload, Math.floor(now() / 1000)) ? t.payload : null;
}

/**
 * The user id behind a Bearer token, or null. `via` says which check passed ('hs256' | 'jwks' |
 * 'auth_api') so a log line can show whether the network fallback is still being hit.
 */
export async function resolveUid(token, { supabaseUrl, serviceKey, jwtSecret = process.env.SUPABASE_JWT_SECRET, fetchImpl = fetch, now = Date.now } = {}) {
  if (!token) return null;
  const local = jwtSecret ? verifyHs256(token, jwtSecret, now) : null;
  if (local) return { uid: local.sub, via: 'hs256' };
  const asym = await verifyWithJwks(token, supabaseUrl, { fetchImpl, now });
  if (asym) return { uid: asym.sub, via: 'jwks' };
  try {
    const r = await fetchImpl(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: serviceKey, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const u = await r.json().catch(() => null);
    return u && typeof u.id === 'string' ? { uid: u.id, via: 'auth_api' } : null;
  } catch { return null; }
}

// ── The answer, remembered briefly per token (per warm instance) ──────────────────────────────────
// A page load sends several /api/user-sync calls with the same token at once (dashboard: load, get_credits,
// load_profile…); each asked the auth server the same question, and when the auth server was slow (it reads the
// same database) every one of them waited up to the timeout. One question per token per SESSION_CACHE_MS, shared
// by calls in flight together. The cost: a "Sign out of all devices" reaches a device's next call within
// SESSION_CACHE_MS (30 s) instead of at once — the access token itself stays valid for up to an hour, so this
// keeps the revocation check, it only lets its answer be 30 s old. "Ended" is remembered as well; "could not tell"
// (null) never is.
export const SESSION_CACHE_MS = 30_000;
const _sessionCache = new Map(); // sha256(token) → { at, ok: true|false } | { p: Promise }
/** Test seam. */
export function resetSessionCache() { _sessionCache.clear(); }
export async function sessionStillValidCached(token, opts = {}) {
  const now = (opts.now || Date.now)();
  const key = createHash('sha256').update(String(token || '')).digest('base64url');
  const hit = _sessionCache.get(key);
  if (hit && hit.p) return hit.p;
  if (hit && now - hit.at < SESSION_CACHE_MS) return hit.ok;
  const p = sessionStillValid(token, opts).then((ok) => {
    if (ok === null) _sessionCache.delete(key);
    else _sessionCache.set(key, { at: (opts.now || Date.now)(), ok });
    return ok;
  }, () => { _sessionCache.delete(key); return null; });
  _sessionCache.set(key, { p });
  if (_sessionCache.size > 5000) _sessionCache.delete(_sessionCache.keys().next().value);
  return p;
}

/**
 * Does the session behind this (already signature-verified) token still exist? true / false, or null
 * when the auth server could not answer in time — the caller then relies on the signature alone
 * rather than hanging a request on an auth outage (the 2026-10-24 audit's 15 s 504s were requests
 * waiting on network calls with no timeout).
 */
export async function sessionStillValid(token, { supabaseUrl, serviceKey, fetchImpl = fetch, timeoutMs = 2500 } = {}) {
  try {
    const r = await fetchImpl(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (r.ok) return true;
    if (r.status === 401 || r.status === 403 || r.status === 404) return false;
    return null;
  } catch { return null; }
}
