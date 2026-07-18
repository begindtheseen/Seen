// Stale-job liveness refresh — the shared keyless engine behind BOTH the CLI
// (scripts/refresh-stale-jobs.mjs) and the cron handler (api/refresh-stale-jobs.js),
// so the two can never drift (same pattern as jobSources.js powering api/refresh-jobs.js).
//
// WHY THIS EXISTS
// A job is marked `stale` purely by AGE: api/refresh-jobs.js › markStaleJobs() flips
// `active → stale` once `last_seen_at` passes 7 days, and `stale → expired` at 14 days.
// The ONLY path back to `active` is re-ingest: when an Adzuna/secondary SEARCH happens to
// re-return the exact listing, upsertJobs() bumps last_seen_at and it flips active again.
// But the ingest rotates ~30 keyword searches per run and Adzuna returns the freshest hits
// first, so the long tail of still-live listings is never re-surfaced by a search — it sits
// `stale`, then `expired`, then gets deleted at its 14-day `expires_at`, even though the
// posting is still open. That inflates the "stale jobs" KPI
// (api/admin-stats.js › `stale_or_expired` = count of availability_status IN (stale,expired)).
//
// WHAT THIS DOES — a real liveness re-check, not a timer. For each stale/expired row it
// fetches the listing's own `apply_url` and re-derives status from what actually comes back:
//   • live  (final HTTP 2xx, no dead-end marker in the page) → back to `active`, mirroring
//     the ingest's own re-confirmation write EXACTLY (jobSources.js › buildJob):
//     { availability_status:'active', last_seen_at, last_checked_at, expires_at:+14d }.
//     Bumping last_seen_at is what makes the reactivation STICK — otherwise markStaleJobs
//     would re-stale it on its next run. A 2xx on the listing's source URL is a first-party
//     confirmation the source still carries it — the same signal the ingest trusts.
//   • dead  (HTTP 404/410, or a 2xx page whose body says the posting is gone) → `expired`
//     with expires_at=now, mirroring admin-stats.js › delete_listing so the next
//     refresh-jobs cron's deleteExpired() purges it from the corpus.
//   • unknown (403/429/5xx/timeout/network error — no reliable signal) → LEFT UNTOUCHED.
//     Precision-first: we never guess a listing dead or alive on a blocked/ambiguous fetch.
//
// Reactivating still-live listings is what reduces the stale KPI; confirming-dead ones queues
// them for purge. Nothing is fabricated — every write mirrors an existing code path, and the
// verdict comes from a real fetch. `availability_status` has a CHECK constraint of
// active/stale/expired/unknown (admin-stats.js), and every value written here is inside it.

import { mapLimit } from './jobSources.js';
import { browserHeaders } from './listingImport.js';

export const STALE_STATUSES = ['stale', 'expired'];

// Phrase-level "this posting is gone" markers. Deliberately specific so a legit description
// that merely contains the word "expired" is not mis-read as dead (precision over recall).
export const DEAD_MARKERS = [
  /no longer (available|accepting|active|open|posted|being accepted)/i,
  /this (job|position|posting|vacancy|role|listing|ad|opportunity) (has |is )?(expired|closed|been filled|no longer)/i,
  /(job|position|posting|page|listing|vacancy) (not found|no longer exists|has been removed)/i,
  /has been filled/i,
  /applications? (are |is )?(now )?closed/i,
  /404\b[^.]{0,40}\bnot found/i,
];

// Pure verdict from an HTTP outcome. status === null means the fetch never completed
// (timeout / DNS / network). Kept pure + exported so the test suite covers it directly.
export function classifyLiveness({ status, body = '' }) {
  if (status == null) return 'unknown';
  if (status === 404 || status === 410) return 'dead';
  if (status >= 200 && status < 300) {
    if (body && DEAD_MARKERS.some((re) => re.test(body))) return 'dead';
    return 'live';
  }
  // 3xx shouldn't reach here (redirect:'follow' resolves them); 401/403/405/429/5xx carry no
  // trustworthy liveness signal — a bot block is not a dead job.
  return 'unknown';
}

// Fetch one listing and classify it. IO is isolated here; `fetchImpl` is injectable so the
// test suite runs fully offline. Never throws — a failed fetch is an 'unknown' verdict.
export async function checkListing(job, { timeoutMs = 12000, fetchImpl = fetch, seed = 0 } = {}) {
  if (!job || !job.apply_url) return { id: job?.id, verdict: 'unknown', status: null, reason: 'no_url' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetchImpl(job.apply_url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: browserHeaders(job.apply_url, { seed }),
    });
    let body = '';
    if (resp.status >= 200 && resp.status < 300) {
      try { body = (await resp.text()).slice(0, 8000); } catch { /* body optional */ }
    }
    return {
      id: job.id, company: job.company, title: job.title,
      verdict: classifyLiveness({ status: resp.status, body }),
      status: resp.status, finalUrl: resp.url,
    };
  } catch (e) {
    return { id: job.id, company: job.company, title: job.title, verdict: 'unknown', status: null, reason: e?.name || 'error' };
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

// Exact count of the stale/expired backlog — the KPI this job moves.
export async function staleCount(url, key, fetchImpl = fetch) {
  const r = await fetchImpl(`${url}/rest/v1/jobs?select=id&availability_status=in.(stale,expired)`, {
    method: 'HEAD',
    headers: { ...authHeaders(key), Prefer: 'count=exact', Range: '0-0' },
  });
  const cr = r.headers.get('content-range') || '';
  const n = cr.includes('/') ? parseInt(cr.split('/')[1], 10) : NaN;
  return Number.isFinite(n) ? n : null;
}

async function pageStale(url, key, offset, pageSize, fetchImpl) {
  const cols = 'id,company,title,apply_url,availability_status,last_seen_at,expires_at';
  const r = await fetchImpl(
    `${url}/rest/v1/jobs?select=${cols}&availability_status=in.(stale,expired)&order=id&offset=${offset}&limit=${pageSize}`,
    { headers: authHeaders(key) },
  );
  if (!r.ok) throw new Error(`stale page read failed at offset ${offset}: HTTP ${r.status}`);
  return r.json();
}

async function patchByIds(url, key, ids, patch, fetchImpl, chunkSize = 100) {
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize).map((id) => encodeURIComponent(String(id))).join(',');
    const r = await fetchImpl(`${url}/rest/v1/jobs?id=in.(${chunk})`, {
      method: 'PATCH',
      headers: { ...authHeaders(key), Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error(`PATCH failed: HTTP ${r.status}`);
  }
}

const pick = (r) => ({ id: r.id, company: r.company, title: r.title, status: r.status });

// The full sweep. Dry-run by default (apply:false) — reads + classifies + tallies, ZERO writes.
// apply:true performs the reactivation / expiry PATCHes (batched by id). Returns a summary.
export async function refreshStaleJobs(opts = {}) {
  const {
    url, key, apply = false, limit = 0, pageSize = 500,
    concurrency = 10, timeoutMs = 12000, fetchImpl = fetch, onProgress,
  } = opts;
  if (!url || !key) throw new Error('refreshStaleJobs: url and key are required');

  const now = new Date();
  const nowISO = now.toISOString();
  const expiresISO = new Date(now.getTime() + 14 * 86400000).toISOString(); // matches jobSources.buildJob

  const kpiBefore = await staleCount(url, key, fetchImpl);

  const jobs = [];
  for (let offset = 0; ; offset += pageSize) {
    const rows = await pageStale(url, key, offset, pageSize, fetchImpl);
    if (!Array.isArray(rows) || rows.length === 0) break;
    jobs.push(...rows);
    if (limit && jobs.length >= limit) { jobs.length = limit; break; }
    if (rows.length < pageSize) break;
  }

  let done = 0;
  const results = await mapLimit(jobs, concurrency, async (job, i) => {
    const res = await checkListing(job, { timeoutMs, fetchImpl, seed: i });
    done += 1;
    if (onProgress && (done % 25 === 0 || done === jobs.length)) onProgress({ done, total: jobs.length });
    return res;
  });

  const live = results.filter((r) => r.verdict === 'live');
  const dead = results.filter((r) => r.verdict === 'dead');
  const unknown = results.filter((r) => r.verdict === 'unknown');

  const summary = {
    apply, scanned: jobs.length, kpiBefore,
    live: live.length, dead: dead.length, unknown: unknown.length,
    reactivated: 0, expired: 0,
    sampleLive: live.slice(0, 10).map(pick),
    sampleDead: dead.slice(0, 10).map(pick),
  };

  if (apply) {
    if (live.length) {
      await patchByIds(url, key, live.map((r) => r.id),
        { availability_status: 'active', last_seen_at: nowISO, last_checked_at: nowISO, expires_at: expiresISO },
        fetchImpl);
      summary.reactivated = live.length;
    }
    if (dead.length) {
      await patchByIds(url, key, dead.map((r) => r.id),
        { availability_status: 'expired', expires_at: nowISO, last_checked_at: nowISO },
        fetchImpl);
      summary.expired = dead.length;
    }
    summary.kpiAfter = await staleCount(url, key, fetchImpl);
  } else {
    // Reactivations leave the stale set immediately; confirmed-dead rows stay counted until the
    // next refresh-jobs cron's deleteExpired() purges them, so the immediate KPI move = live.
    summary.kpiProjectedAfter = kpiBefore != null ? kpiBefore - live.length : null;
  }
  return summary;
}
