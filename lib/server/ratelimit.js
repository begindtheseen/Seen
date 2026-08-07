/**
 * Server-side rate limiter using Supabase as the store.
 * Uses an atomic SQL upsert so concurrent requests don't bypass limits.
 * Gracefully degrades: if DB is unreachable, requests are allowed through.
 *
 * Requires the rate_limits table + increment_rate_limit() function.
 * Run supabase/migrations/001_rate_limits.sql once to set up.
 */

import { verifyJWTLocal } from './employerAuth.js';

const ALLOWED_ORIGINS = [
  'https://seenjobs.io',
  'https://www.seenjobs.io',
];

/** Per-hour limits by endpoint key */
const LIMITS = {
  'company-score':        20,
  'resume-scanner':       10,
  'resume-coach':          5,
  'resume-proposal':       5,
  'resume-hiring_manager': 6,
  'resume-insider_intel':  6,
  'job-insights':         20,
  'reports':              30,
  'apply':                10,
  // ── Job search: TIERED, per user-or-IP bucket (see resolveRateBucket) ──────────
  // The old single 'job-search: 10/hr/IP' gate 429'd the whole search — including the
  // cheap DB-first path — and every user behind one IP (household/office/CGNAT) shared
  // the one bucket, so a handful of testers blanked search for each other. Search is
  // DB-first and the LLM expansion is cached forever (query_expansions), so the cheap
  // path needs only an ABUSE cap; the genuinely expensive part (live Adzuna aggregation)
  // gets its own small per-bucket cap plus a GLOBAL platform budget. Exhausting the
  // top-up caps degrades to DB-only results — it never blanks the search.
  'job-search':          600,   // hard ABUSE cap per bucket (~10/min sustained) → only then 429
  'job-search-topup':     30,   // expensive live-aggregation eligibility per bucket
  'agg-global':          600,   // GLOBAL per-hour budget for live aggregation (all users combined)
  'job-read':            300,   // cheap DB reads: job detail, company jobs, recommended
  'parse-resume':          8,   // large file uploads + Claude
  'report-submit':        15,   // DB writes per hour per IP
  'benchmarks':           40,   // company stats lookups — cheap DB reads
  'fetch-location-jobs':  60,   // Adzuna API calls — protect quota
  'user-sync':           500,   // all user data actions — generous for normal use
  'demand':              120,   // public demand data reads
  // Resume-tool actions that were relying on the fallback default (making the
  // limit implicit). Named explicitly so each has an intentional, tuned cap.
  'optimizer':            15,   // deterministic advantage/humanize package build
  'import-listing':       20,   // paste-a-link imports — each one fetches an external page
  'email-analysis':       10,   // sends mail via Resend — keep tight
  'download-resume':      20,   // deterministic PDF rebuild of the user's own résumé
  'employer-listings':    30,   // employer portal "my listings" lookup — cheap DB read
  'employer-close':       10,   // each close fetches the listing's own URL + may write
};

/**
 * Resolve the rate bucket for a request: the SIGNED-IN USER when the request carries a
 * locally-verifiable Supabase JWT (HS256 — no network call on the hot path), else the IP.
 * Per-user buckets are what make shared IPs (a household, an office, mobile CGNAT) scale:
 * three signed-in users on one WiFi each get their own allowance instead of starving each
 * other. An unverifiable/expired token just falls back to the IP bucket — rate keying
 * needs a stable bucket, not perfect auth.
 */
export function resolveRateBucket(req, jwtSecret = process.env.SUPABASE_JWT_SECRET) {
  const auth = String(req.headers?.authorization || '');
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token && jwtSecret) {
    const payload = verifyJWTLocal(token, jwtSecret);
    if (payload?.sub) return { key: `user:${payload.sub}`, kind: 'user' };
  }
  return { key: `ip:${getIP(req)}`, kind: 'ip' };
}

/**
 * Check and enforce rate limit for a request.
 * opts.bucketKey overrides the default IP bucket (pass resolveRateBucket(req).key so
 * signed-in users are limited per user, not per shared IP).
 * Returns { allowed: boolean, remaining: number, limit: number }
 */
export async function rateLimit(req, endpoint, opts = {}) {
  const ip = opts.bucketKey || getIP(req);
  const windowHour = Math.floor(Date.now() / 3_600_000); // changes every hour
  const key = `${ip}:${endpoint}:${windowHour}`;
  const limit = LIMITS[endpoint] || 15;
  // Fail policy on limiter error. Per-user/IP caps fail OPEN — an infra blip must never block a
  // real user. But a caller guarding a PAID external call (rateLimitGlobal) passes failClosed:true,
  // so a blip degrades to "skip the expensive path" instead of waving through an uncapped spend.
  const onFail = opts.failClosed
    ? { allowed: false, remaining: 0, limit }
    : { allowed: true, remaining: limit, limit };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  // Graceful degradation — if no DB config, apply this call's fail policy
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return onFail;
  }

  try {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 350);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_rate_limit`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_key: key, p_ttl_seconds: 3600 }),
      signal: abort.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      // DB error — fail open so users aren't blocked by infra issues
      console.warn(`[ratelimit] DB error ${res.status} for ${endpoint}/${ip}`);
      return onFail;
    }

    const count = await res.json(); // increment_rate_limit returns INTEGER directly
    const allowed = count <= limit;
    if (!allowed) {
      console.warn(`[ratelimit] BLOCKED ${endpoint} from ${ip} (count: ${count}/${limit})`);
    }
    return { allowed, remaining: Math.max(0, limit - count), limit, count };
  } catch (e) {
    // Network/timeout — fail open
    console.warn(`[ratelimit] exception for ${endpoint}:`, e.message);
    return onFail;
  }
}

/**
 * GLOBAL (platform-wide, not per-user) hourly budget for an expensive shared resource —
 * e.g. live Adzuna aggregation. Same atomic counter, fixed 'global' bucket. Fail-open like
 * rateLimit: an infra blip must never block users. Callers treat "not allowed" as "skip
 * the expensive path and degrade", never as a user-facing error.
 */
export async function rateLimitGlobal(endpoint) {
  // Guards a PAID shared resource (live Adzuna / Anthropic). Fail CLOSED: if the counter is
  // unreachable, skip the expensive path (callers degrade to DB) rather than let a limiter blip
  // wave through an uncapped, billable fan-out.
  return rateLimit({ headers: {} }, endpoint, { bucketKey: 'global', failClosed: true });
}

/**
 * Set CORS headers. Restricts to seenjobs.io in production,
 * allows all origins in local dev (localhost / 127.0.0.1).
 */
export function setCORS(req, res) {
  const origin = req.headers.origin || '';
  const isDev = !origin || origin.includes('localhost') || origin.includes('127.0.0.1');
  const isAllowed = isDev || ALLOWED_ORIGINS.includes(origin);
  res.setHeader('Access-Control-Allow-Origin', isAllowed ? (origin || '*') : 'https://seenjobs.io');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
}

/**
 * Handle preflight and return rate-limit headers on 429.
 * Returns true if the caller should stop processing (OPTIONS or blocked).
 */
export async function applyRateLimit(req, res, endpoint, opts = {}) {
  setCORS(req, res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return true; }

  const { allowed, remaining, limit } = await rateLimit(req, endpoint, opts);
  res.setHeader('X-RateLimit-Limit', limit);
  res.setHeader('X-RateLimit-Remaining', remaining);

  if (!allowed) {
    res.status(429).json({
      error: 'Too many requests — slow down.',
      retry_after: '1 hour',
    });
    return true;
  }
  return false;
}

function getIP(req) {
  const h = req.headers || {};
  // Prefer x-real-ip: on Vercel it is set by the edge to the TRUE client IP and cannot be spoofed
  // by the client. x-forwarded-for's LEFT-most value IS client-controllable (a client can send its
  // own XFF header), so keying rate-limit buckets on it let one host rotate the header to mint
  // unlimited fresh buckets and nullify every per-IP cap. Preferring x-real-ip means that spoofable
  // XFF path is only ever reached OFF Vercel (local/dev), where the threat model doesn't apply.
  const real = h['x-real-ip'];
  if (real) return String(real).split(',')[0].trim();
  const fwd = h['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}
