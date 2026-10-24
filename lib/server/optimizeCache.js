// Paid-optimize result cache (2026-10-24 résumé audit, C2): "Optimize · 1 credit" re-charged on
// every reopen of the same job with the same résumé while /pricing promised "free once cached".
//
// A paid result is stored per (user, job id or posting text, résumé text) for CACHE_DAYS and
// returned free with `cached: true`; only changed inputs cost a new credit. Storage is the
// existing service-role-only `public.optimizer_runs` table (migration 028: RLS on, no policies;
// indexed by job_id), so no schema change is needed: the cache key lives in `job_id`
// ("paid_optimize:<sha256>") and the full result in `output`. A read or write failure never
// blocks the paid path — it only means the next open charges again, and says nothing false.
import { createHash } from 'node:crypto';

export const CACHE_DAYS = 7;
export const CACHE_PREFIX = 'paid_optimize:';
export const CACHE_ENGINE = 'seenfit-paid-2';

const norm = (s) => String(s || '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim();
const sha = (s) => createHash('sha256').update(s).digest('hex');

/** Fingerprint of a text for the cache key (whitespace-insensitive). */
export function textHash(s) {
  return sha(norm(s)).slice(0, 32);
}

/**
 * The cache key: the user, the job (its id when the listing has one) AND the posting text that was
 * optimized against (a pasted full posting under the same id is a different input), and the résumé.
 */
export function optimizeCacheKey({ uid, jobId, jobDescription, resume }) {
  return CACHE_PREFIX + sha([String(uid || ''), String(jobId || ''), textHash(jobDescription), textHash(resume)].join('|')).slice(0, 48);
}

function dbFetch(path, opts = {}) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

/** The cached result for this key, or null. `{ output, created_at }`. */
export async function readCachedOptimize(uid, key, now = Date.now()) {
  if (!uid || !key) return null;
  try {
    const since = new Date(now - CACHE_DAYS * 86400000).toISOString();
    const r = await dbFetch(`optimizer_runs?user_id=eq.${encodeURIComponent(uid)}&job_id=eq.${encodeURIComponent(key)}&created_at=gte.${encodeURIComponent(since)}&select=output,created_at&order=created_at.desc&limit=1`);
    if (!r || !r.ok) return null;
    const rows = await r.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || !row.output || typeof row.output !== 'object') return null;
    return { output: row.output, created_at: row.created_at || null };
  } catch { return null; }
}

/** Store a paid result. Best-effort: returns true when the row was written. */
export async function writeCachedOptimize(uid, key, output) {
  if (!uid || !key || !output) return false;
  try {
    const r = await dbFetch('optimizer_runs', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        user_id: uid,
        job_id: key,
        fit_score: output._seenfit_score ?? null,
        output,
        engine_version: CACHE_ENGINE,
      }),
    });
    return !!(r && r.ok);
  } catch { return false; }
}
