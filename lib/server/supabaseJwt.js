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

import { createHmac, createPublicKey, timingSafeEqual, verify as cryptoVerify } from 'crypto';

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
    const r = await fetchImpl(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: serviceKey, Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const u = await r.json().catch(() => null);
    return u && typeof u.id === 'string' ? { uid: u.id, via: 'auth_api' } : null;
  } catch { return null; }
}
