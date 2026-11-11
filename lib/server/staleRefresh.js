// Stale-job liveness refresh — the shared keyless engine behind BOTH the CLI
// (scripts/refresh-stale-jobs.mjs) and the cron handler (api/refresh-stale-jobs.js),
// so the two can never drift (same pattern as jobSources.js powering api/refresh-jobs.js).
//
// WHY THIS EXISTS
// A job is marked `stale` purely by AGE: public.sweep_stale_jobs (run by api/refresh-jobs.js) flips
// `active → stale` once `last_seen_at` passes 7 days, and deletes it at 14 days.
// The ONLY path back to `active` is re-ingest: when an Adzuna/secondary SEARCH happens to
// re-return the exact listing, upsertJobs() bumps last_seen_at and it flips active again.
// But the ingest rotates ~30 keyword searches per run and Adzuna returns the freshest hits
// first, so the long tail of still-live listings is never re-surfaced by a search — it sits
// `stale`, then `expired`, then gets deleted at its 14-day `expires_at`, even though the
// posting is still open. That inflates the "stale jobs" KPI
// (api/admin-stats.js › `stale_or_expired` = count of availability_status IN (stale,expired)).
//
// WHAT THIS DOES — a real liveness re-check, not a timer. For each stale/expired row it asks the
// listing's source the SAME question the on-open check asks (lib/server/listingLiveness.js probeSource —
// one request: the ATS's job API, Adzuna's /details page, or the job page with every redirect seen):
//   • live  (the source still carries it) → back to `active`, mirroring the ingest's own re-confirmation
//     write EXACTLY (jobSources.js › buildJob): { availability_status:'active', last_seen_at,
//     last_checked_at, expires_at:+14d }. Bumping last_seen_at is what makes the reactivation STICK.
//   • dead  (the source's own word: an ATS API 404/410, Oracle's empty answer, an Ashby board without it, a
//     Workday 403 its own search confirms, a redirect to an error page, or a page whose TEXT says the job is
//     gone) → `expired` with expires_at=now, mirroring admin-stats.js › delete_listing.
//   • unknown (a wall, 5xx, timeout, a bare 404/410 whose page does not say the job is closed, a redirect to a
//     front door or a job list, a list page picked by ?gh_jid=, or the per-host pace spent) → LEFT UNTOUCHED.
//
// Round 2 (2026-11-10): this used to revive any row whose apply_url answered 2xx after redirects — an Adzuna
// /land/ad link forwarding to an employer's home page read as "live" and would have revived a job its source
// says is gone — and to kill any row on a bare 404/410 (Adzuna answered 410 to a sandbox burst for ads that
// were live two days later). One rule for both checks now, so they cannot disagree.
//
// Politeness: probeSource paces each host per instance (≥1 s apart, ≤20 a minute); past that a row is
// 'unknown' (rate_limited) and simply waits for the next run. `availability_status` has a CHECK constraint
// of active/stale/expired/unknown (admin-stats.js), and every value written here is inside it.

import { mapLimit } from './jobSources.js';
import { safeFetch } from './safeFetch.js';
import { probeSource } from './listingLiveness.js';

export const STALE_STATUSES = ['stale', 'expired'];

// apply_url is stored data an employer or a feed wrote, so the real fetch is safeFetch (public
// addresses only, redirects re-checked, body capped). A caller that passes the global fetch for its
// DB reads gets safeFetch for the listing; a test's offline fake is used as given.
export const probeFetch = (fetchImpl) => (!fetchImpl || fetchImpl === globalThis.fetch ? safeFetch : fetchImpl);

const VERDICT = { open: 'live', gone: 'dead', unknown: 'unknown' };

// Check one listing. Never throws — a failed or slow fetch is an 'unknown' verdict.
export async function checkListing(job, { timeoutMs = 12000, fetchImpl = safeFetch } = {}) {
  if (!job || !job.apply_url) return { id: job?.id, verdict: 'unknown', status: null, reason: 'no_url' };
  let timer;
  const p = await Promise.race([
    probeSource(job.apply_url, { fetchImpl: probeFetch(fetchImpl), timeoutMs }),
    new Promise((res) => { timer = setTimeout(() => res({ state: 'unknown', via: 'timeout', status: null, url: null }), timeoutMs + 2500); }),
  ]).finally(() => clearTimeout(timer));
  return {
    id: job.id, company: job.company, title: job.title,
    verdict: VERDICT[p.state] || 'unknown', status: p.status, finalUrl: p.url, via: p.via,
    ...(p.state === 'unknown' ? { reason: p.via } : {}),
  };
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
    const res = await checkListing(job, { timeoutMs, fetchImpl });
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
    // next stale sweep deletes them, so the immediate KPI move = live.
    summary.kpiProjectedAfter = kpiBefore != null ? kpiBefore - live.length : null;
  }
  return summary;
}
