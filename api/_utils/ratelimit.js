/**
 * Server-side rate limiter using Supabase as the store.
 * Uses an atomic SQL upsert so concurrent requests don't bypass limits.
 * Gracefully degrades: if DB is unreachable, requests are allowed through.
 *
 * Requires the rate_limits table + increment_rate_limit() function.
 * Run supabase/migrations/001_rate_limits.sql once to set up.
 */

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
  // Added for 10k scale
  'job-search':           10,   // each miss calls Claude API — expensive
  'parse-resume':          8,   // large file uploads + Claude
  'report-submit':        15,   // DB writes per hour per IP
  'benchmarks':           40,   // company stats lookups — cheap DB reads
  'fetch-location-jobs':  30,   // Adzuna API calls — protect quota
  'user-sync':           500,   // all user data actions — generous for normal use
  'demand':              120,   // public demand data reads
};

/**
 * Check and enforce rate limit for a request.
 * Returns { allowed: boolean, remaining: number, limit: number }
 */
export async function rateLimit(req, endpoint) {
  const ip = getIP(req);
  const windowHour = Math.floor(Date.now() / 3_600_000); // changes every hour
  const key = `${ip}:${endpoint}:${windowHour}`;
  const limit = LIMITS[endpoint] || 15;

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  // Graceful degradation — if no DB config, allow all requests
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { allowed: true, remaining: limit, limit };
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_rate_limit`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_key: key, p_ttl_seconds: 3600 }),
    });

    if (!res.ok) {
      // DB error — fail open so users aren't blocked by infra issues
      console.warn(`[ratelimit] DB error ${res.status} for ${endpoint}/${ip}`);
      return { allowed: true, remaining: limit, limit };
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
    return { allowed: true, remaining: limit, limit };
  }
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
export async function applyRateLimit(req, res, endpoint) {
  setCORS(req, res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return true; }

  const { allowed, remaining, limit } = await rateLimit(req, endpoint);
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
  // Vercel puts the real client IP in x-forwarded-for
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}
