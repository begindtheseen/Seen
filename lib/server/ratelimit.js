/**
 * Server-side rate limiter using Supabase as the store.
 * Uses an atomic SQL upsert so concurrent requests don't bypass limits.
 *
 * When the shared counter cannot be reached (DB outage, timeout, missing config) the limiter does
 * NOT simply wave requests through. What happens depends on what the endpoint costs:
 *   - FAIL_CLOSED endpoints (paid AI calls, outbound email, outbound fetches that write to shared
 *     tables, login): the request is refused with 503 until the counter is back. These flows need
 *     the database anyway, so an outage already breaks them; refusing keeps an outage from turning
 *     into unlimited spend or spam.
 *   - Everything else: an in-memory, per-instance counter enforces the same limit. Real users never
 *     notice; a flood is still capped on every warm instance.
 *
 * Buckets: a request that carries a locally verifiable Supabase JWT is limited per USER; anything
 * else is limited per client IP (see resolveRateBucket). Callers can still pass opts.bucketKey.
 *
 * Requires the rate_limits table + increment_rate_limit() function.
 * Run supabase/migrations/001_rate_limits.sql once to set up.
 */

import { verifyJWTLocal } from './employerAuth.js';
import { allowOrigin } from './cors.js';

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
  'user-sync-write':     300,   // per-user mutating tracker/profile actions (api/user-sync.js)
  'admin-login':           5,   // per IP per 15-minute window (api/admin-stats.js passes windowSec)
};

/**
 * Endpoints that must NOT run when the shared counter is unavailable: each request spends money
 * (Anthropic / Adzuna), sends email, fetches third-party pages into the shared corpus, or guards a
 * login. Every 'resume-*' AI tool is included by prefix.
 */
const FAIL_CLOSED = new Set([
  'resume',
  'job-insights',
  'parse-resume',
  'email-analysis',
  'apply',
  'import-listing',
  'fetch-location-jobs',
  'admin-login',
]);

export function isFailClosedEndpoint(endpoint) {
  return FAIL_CLOSED.has(endpoint) || String(endpoint).startsWith('resume-');
}

// ── In-memory fallback counter (per warm instance) ──────────────────────────────
// Used only while the shared counter is unreachable, for endpoints that are not FAIL_CLOSED.
const memoryCounters = new Map(); // key -> { count, expiresAt }
const MEMORY_MAX_KEYS = 5000;

function memoryIncrement(key, ttlMs, now = Date.now()) {
  let entry = memoryCounters.get(key);
  if (!entry || entry.expiresAt <= now) {
    if (memoryCounters.size >= MEMORY_MAX_KEYS) {
      for (const [k, v] of memoryCounters) if (v.expiresAt <= now) memoryCounters.delete(k);
      // Still full of live keys: drop the oldest insertions rather than grow without bound.
      while (memoryCounters.size >= MEMORY_MAX_KEYS) memoryCounters.delete(memoryCounters.keys().next().value);
    }
    entry = { count: 0, expiresAt: now + ttlMs };
    memoryCounters.set(key, entry);
  }
  entry.count += 1;
  return entry.count;
}

/** Test hook: forget every in-memory count. */
export function _resetMemoryCounters() {
  memoryCounters.clear();
}

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
 * Bucket: opts.bucketKey when given, else the signed-in user (verified JWT) or the client IP.
 * opts.limit / opts.windowSec override the per-hour default for a caller with its own policy.
 * opts.failClosed forces the closed policy for an endpoint not in FAIL_CLOSED.
 * Returns { allowed, remaining, limit, count?, unavailable? } — unavailable:true means the request
 * was refused because the shared counter could not be reached (callers should answer 503).
 */
export async function rateLimit(req, endpoint, opts = {}) {
  const bucket = opts.bucketKey || resolveRateBucket(req).key;
  const windowSec = opts.windowSec || 3600;
  const windowIdx = Math.floor(Date.now() / (windowSec * 1000));
  const key = `${bucket}:${endpoint}:${windowIdx}`;
  const limit = opts.limit || LIMITS[endpoint] || 15;
  const failClosed = !!opts.failClosed || isFailClosedEndpoint(endpoint);

  const degrade = (why) => {
    console.warn(`[ratelimit] counter unavailable for ${endpoint} (${why}) — ${failClosed ? 'refusing' : 'in-memory fallback'}`);
    if (failClosed) return { allowed: false, remaining: 0, limit, unavailable: true };
    const count = memoryIncrement(key, windowSec * 1000);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), limit, count, fallback: 'memory' };
  };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return degrade('not configured');

  // A fail-closed endpoint is about to do seconds of paid work, so it can afford to wait longer for
  // the counter before treating a slow DB as an outage. Cheap endpoints keep the tight budget.
  const timeoutMs = failClosed ? 1500 : 350;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_rate_limit`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_key: key, p_ttl_seconds: windowSec }),
      signal: abort.signal,
    });
    if (!res.ok) return degrade(`HTTP ${res.status}`);

    const count = Number(await res.json()); // increment_rate_limit returns INTEGER directly
    if (!Number.isFinite(count)) return degrade('bad response');
    const allowed = count <= limit;
    if (!allowed) {
      console.warn(`[ratelimit] BLOCKED ${endpoint} from ${bucket} (count: ${count}/${limit})`);
    }
    return { allowed, remaining: Math.max(0, limit - count), limit, count };
  } catch (e) {
    return degrade(e?.name === 'AbortError' ? 'timeout' : (e?.message || 'error'));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GLOBAL (platform-wide, not per-user) hourly budget for an expensive shared resource —
 * e.g. live Adzuna aggregation. Same atomic counter, fixed 'global' bucket. Callers treat
 * "not allowed" as "skip the expensive path and degrade", never as a user-facing error.
 */
export async function rateLimitGlobal(endpoint) {
  // Guards a PAID shared resource (live Adzuna / Anthropic). Fail CLOSED: if the counter is
  // unreachable, skip the expensive path (callers degrade to DB) rather than let a limiter blip
  // wave through an uncapped, billable fan-out.
  return rateLimit({ headers: {} }, endpoint, { bucketKey: 'global', failClosed: true });
}

/**
 * Set CORS headers. Exact-match production origins; loopback origins only outside production
 * (lib/server/cors.js).
 */
export function setCORS(req, res) {
  res.setHeader('Access-Control-Allow-Origin', allowOrigin(req.headers?.origin));
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

  const { allowed, remaining, limit, unavailable } = await rateLimit(req, endpoint, opts);
  res.setHeader('X-RateLimit-Limit', limit);
  res.setHeader('X-RateLimit-Remaining', remaining);

  if (unavailable) {
    res.setHeader('Retry-After', '30');
    res.status(503).json({ error: 'This feature is briefly unavailable — try again in a moment.' });
    return true;
  }
  if (!allowed) {
    res.status(429).json({
      error: 'Too many requests — slow down.',
      retry_after: '1 hour',
    });
    return true;
  }
  return false;
}

/** The client IP used for per-IP buckets (x-real-ip on Vercel; see below). */
export function getIP(req) {
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
