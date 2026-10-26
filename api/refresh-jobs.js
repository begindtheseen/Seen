import { getQueryExpansion } from '../lib/server/expand.js';
import { mergeCompanies } from '../lib/server/merge.js';
import { logError } from '../lib/server/errlog.js';
// Source fetchers, company create, and job upsert live in the shared keyless engine so
// this cron and the on-demand search top-up (api/jobs.js) can never drift.
import {
  fetchAdzuna,
  fetchSecondarySources,
  resolveCompanyIds,
  upsertJobs,
  mapLimit,
} from '../lib/server/jobSources.js';
// Employer-direct ATS ingestion + self-growing source registry (multi-source engine).
// Stale-job protocol (age → stale → delete): one batched Postgres function, shared with the admin
// "clear stale now" action. Replaced deleteExpired() + markStaleJobs(), which could not finish.
import { runStaleSweep } from '../lib/server/staleSweep.js';
import { JOB_SEARCHES } from '../lib/server/jobSearchCatalog.js';
import { fetchUsaJobs, usajobsCredentials } from '../lib/server/usajobs.js';
import { pacificHour, pacificDayOfYear } from '../lib/time/pacific.js';
import { isVercelCron } from '../lib/server/cronAuth.js';

// Refresh a batch of registered employer-direct ATS boards straight from the source. Fail-open +
// bounded so it never breaks the cron or exceeds the function time budget. Returns a small summary.
//
// DISCOVERY NO LONGER LIVES HERE. Common Crawl source discovery ran at the tail of this handler on
// leftover budget and registered exactly zero boards for its entire life. It now has its own
// invocation, budget and crons in api/discover-sources.js (#276). The tail-end copy was kept for one
// more cycle only to preserve a diagnostic reading, and is deleted here rather than left dormant:
// the page-rotation bug in #273 survived precisely because nobody was watching code that still ran.
// Must stay under the maxDuration in vercel.json (300s) with room to serialize the response.
const HANDLER_BUDGET_MS = Number(process.env.REFRESH_JOBS_BUDGET_MS || 270_000);
// Slice of the run the stale sweep may use. It is batched and resumable, so a backlog it cannot
// finish carries to the next run rather than costing this run its ingestion.
const SWEEP_BUDGET_MS = Number(process.env.REFRESH_JOBS_SWEEP_BUDGET_MS || 45_000);

// 240 searches across 12 batches of 20. 6 cron runs/day → all 12 batches covered in 2 days.
// Adzuna free tier: 250 calls/day — 120/day (20×6) stays well within limit.
// Each Adzuna call returns up to 50 jobs → ~6,000 new listings refreshed every 2 days.

// The niche list lives in lib/server/jobSearchCatalog.js (shared with the Mac-local Indeed presets).
const ALL_SEARCHES = JOB_SEARCHES;

// 30 Adzuna searches/run × 6 runs/day = 180 calls/day — safely under the 250/day
// free-tier cap while re-confirming more existing listings each run (cuts the stale
// count). All 30 run in parallel, each ≤8s, so wall-clock stays well within the 60s
// maxDuration. The full ALL_SEARCHES list is covered every ~36 hours.
const BATCH_SIZE = 30;

// Progressive rotation — cycles through ALL batches over time rather than
// repeating the same 6 forever. Uses day-of-year so each cron run advances
// through the full search list over ~2 days, then wraps around.
function getCurrentBatch() {
  const BATCH_HOURS = [2, 6, 10, 14, 18, 22];
  const now = new Date();
  const hour = pacificHour(now);
  const runsPerDay = BATCH_HOURS.length;
  const totalBatches = Math.ceil(ALL_SEARCHES.length / BATCH_SIZE);
  const runOfDay = BATCH_HOURS.reduce((best, h, i) => {
    return Math.abs(h - hour) < Math.abs(BATCH_HOURS[best] - hour) ? i : best;
  }, 0);
  const dayOfYear = pacificDayOfYear(now);
  return (dayOfYear * runsPerDay + runOfDay) % totalBatches;
}

// Exact row count of the jobs table (via PostgREST count=exact Content-Range header).
// Used to split a merge-duplicates upsert into NEW inserts vs updates of existing rows.
async function jobCount(supabaseUrl, serviceKey) {
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/jobs?select=id`, {
      method: 'HEAD',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Prefer: 'count=exact', Range: '0-0' },
    });
    const cr = r.headers.get('content-range'); // e.g. "0-0/5194"
    const total = cr && cr.includes('/') ? parseInt(cr.split('/')[1], 10) : NaN;
    return Number.isFinite(total) ? total : null;
  } catch (_e) { return null; }
}

// Count of ACTIVE listings only — drives the autonomous auto-heal trigger below.
async function activeJobCount(supabaseUrl, serviceKey) {
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/jobs?select=id&availability_status=eq.active`, {
      method: 'HEAD',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Prefer: 'count=exact', Range: '0-0' },
    });
    const cr = r.headers.get('content-range');
    const total = cr && cr.includes('/') ? parseInt(cr.split('/')[1], 10) : NaN;
    return Number.isFinite(total) ? total : null;
  } catch (_e) { return null; }
}

// Crisis floor — keep in sync with admin-stats.js JOB_HEALTH_MIN_ACTIVE.
const AUTO_HEAL_MIN_ACTIVE = 500;

// Scan every active listing and immediately remove any that fail quality standards.
// Runs every cron hit — cheap (only fetches id + description + apply_url).
async function deleteJunk(supabaseUrl, serviceKey) {
  try {
    // EMPLOYER-POSTED listings are EXCLUDED from the junk sweep. This quality gate (needs a
    // description ≥ 80 chars + an apply_url) is for SCRAPED aggregator rows; a first-party listing
    // an employer posted is curated by them and must never be auto-deleted for a short description.
    // (This is exactly why a freshly-posted employer listing with a brief description vanished.)
    const res = await fetch(
      `${supabaseUrl}/rest/v1/jobs?select=id,description,apply_url&is_employer_posted=eq.false&expires_at=gt.${new Date().toISOString()}&limit=2000`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    if (!res.ok) return { removed: 0 };
    const rows = await res.json();

    const badIds = (rows || []).filter(r =>
      !r.description ||
      r.description.trim().length < 80 ||
      !r.apply_url
    ).map(r => r.id);

    if (!badIds.length) return { removed: 0 };

    // Delete in chunks of 100 to stay inside URL length limits
    for (let i = 0; i < badIds.length; i += 100) {
      const chunk = badIds.slice(i, i + 100);
      await fetch(`${supabaseUrl}/rest/v1/jobs?id=in.(${chunk.join(',')})`, {
        method: 'DELETE',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Prefer: 'return=minimal',
        },
      });
    }

    console.log(`deleteJunk: removed ${badIds.length} junk listings`);
    return { removed: badIds.length };
  } catch(e) {
    console.error('deleteJunk error:', e.message);
    return { removed: 0 };
  }
}

export default async function handler(req, res) {
  const headers = { 'Content-Type': 'application/json' };

  const cronSecret = process.env.CRON_SECRET;
  const adminToken = req.headers['x-admin-token'] || '';
  const isCron     = isVercelCron(req);
  // Vercel kills the function at maxDuration and the caller gets a 504 with NO record of what ran.
  // Stop short of that and return what completed. Kept below the configured ceiling so the response
  // is actually written before the platform pulls the plug.
  const handlerDeadline = Date.now() + HANDLER_BUDGET_MS;
  // Fail CLOSED: every non-cron caller must present a valid cron secret OR a valid
  // admin session token. Authorization must NOT be contingent on CRON_SECRET being
  // set — if that env var is blank/unset, the cron-secret path is simply
  // unavailable and callers fall through to 401. Never let a missing secret turn
  // this expensive + destructive (deleteJunk / stale sweep) endpoint
  // into an open, unauthenticated trigger.
  if (!isCron) {
    const authHeader  = req.headers['authorization'] || '';
    const querySecret = new URL(req.url, 'https://x').searchParams.get('secret') || '';
    const cronOk = !!cronSecret && (authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret);
    let adminOk = false;
    if (!cronOk && adminToken) {
      // Validate admin session token
      const SB = process.env.SUPABASE_URL, SK = process.env.SUPABASE_SERVICE_KEY;
      if (SB && SK) {
        const sr = await fetch(`${SB}/rest/v1/admin_sessions?token=eq.${encodeURIComponent(adminToken)}&select=expires_at&limit=1`, { headers: { apikey: SK, Authorization: `Bearer ${SK}` } });
        const sess = sr.ok ? (await sr.json())?.[0] : null;
        adminOk = !!sess && new Date(sess.expires_at) >= new Date();
      }
    }
    if (!cronOk && !adminOk) return res.status(401).json({ error: 'Unauthorized' });
  }

  const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID;
  const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!ADZUNA_APP_ID || !ADZUNA_APP_KEY) {
    return res.status(500).json({ error: 'Missing ADZUNA_APP_ID or ADZUNA_APP_KEY' });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY' });
  }

  try {
    const [junkResult, sweep] = await Promise.all([
      deleteJunk(SUPABASE_URL, SUPABASE_SERVICE_KEY),
      // Capped so a large backlog cannot starve ingestion; it resumes on the next run (six a day).
      runStaleSweep({
        url: SUPABASE_URL, key: SUPABASE_SERVICE_KEY, mode: 'scheduled',
        deadline: Math.min(handlerDeadline, Date.now() + SWEEP_BUDGET_MS),
      }),
    ]);
    if (!sweep.ok) {
      console.error('stale sweep failed:', sweep.error);
      logError('refresh-jobs', `stale sweep failed: ${sweep.error}`, { isCron });
    }

    // ?all=1 (or ?mode=full): "backfill everything now" emergency mode — runs ALL
    // Adzuna searches AND every keyless source in one invocation. Capped so it stays
    // within the 60s maxDuration. Triggered by an admin "emergency refresh" button.
    const reqUrl = new URL(req.url, 'https://x');
    let fullMode = reqUrl.searchParams.get('all') === '1' || reqUrl.searchParams.get('mode') === 'full';

    // AUTO-HEAL (fully autonomous): if the live-listing pool has fallen into crisis — the SAME
    // threshold the admin dashboard flags — automatically escalate THIS cron run to a full,
    // all-sources backfill. No human click, no waiting: a crisis self-corrects on the very next
    // scheduled run (≤4h away). The full path is already capped for the 60s maxDuration.
    let autoHealed = false;
    if (!fullMode) {
      const activeNow = await activeJobCount(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      if (activeNow != null && activeNow < AUTO_HEAL_MIN_ACTIVE) {
        fullMode = true;
        autoHealed = true;
        console.warn(`AUTO-HEAL: job crisis detected (${activeNow} active < ${AUTO_HEAL_MIN_ACTIVE}) → full all-sources backfill`);
      }
    }

    // Pick which batch to run based on the current California hour.
    // Pass ?batch=N to override (useful for manually triggering a specific batch).
    const batchParam = reqUrl.searchParams.get('batch');
    const batchIndex = batchParam !== null ? parseInt(batchParam) : getCurrentBatch();
    // Full/auto-heal mode: a heavy multi-source backfill capped at 72 Adzuna searches so it
    // reliably completes inside the 60s function limit at 8-concurrent (240 was too many and
    // threw "fetch failed"). Combined with all 5 secondary sources this adds ~600+ listings
    // per run — plenty to clear the crisis floor; the next scheduled runs top up the rest.
    const searches = fullMode
      ? ALL_SEARCHES.slice(0, 72)
      : ALL_SEARCHES.slice(batchIndex * BATCH_SIZE, (batchIndex + 1) * BATCH_SIZE);

    const dbHeaders = {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    };

    // Resolve canonical form for each search term (query_expansions cache; the raw term on a miss).
    // Bounded to 10 concurrent — in full/auto-heal mode this can be 72 terms, and firing them
    // all at once contributed to the same socket exhaustion ("fetch failed") the mapLimit fix targets.
    const canonicalMap = Object.fromEntries(
      await mapLimit(searches, 10, async s => {
        const qNorm = s.what.toLowerCase().trim();
        const { canonical } = await getQueryExpansion(qNorm, SUPABASE_URL, dbHeaders);
        return [s.what, canonical];
      })
    );

    // Run Adzuna searches (bounded to 8 concurrent) AND the keyless secondary sources.
    // fetchAdzuna already isolates its own failures (returns []), so no listing can break
    // the run; bounding concurrency prevents "fetch failed" from socket exhaustion.
    // USAJOBS runs the same searches when its key is set (lib/server/usajobs.js); [] otherwise.
    const usajobsCreds = usajobsCredentials();
    const [adzunaArrays, secondary, usajobsArrays] = await Promise.all([
      mapLimit(searches, 8, async s => {
        const jobs = await fetchAdzuna(s.what, s.where, ADZUNA_APP_ID, ADZUNA_APP_KEY);
        const canonical = canonicalMap[s.what] || s.what.toLowerCase().trim();
        return jobs.map(j => ({ ...j, search_query: canonical }));
      }),
      // Secondary sources self-tag their own search_query and isolate their own failures.
      fetchSecondarySources().catch(e => {
        console.warn('secondary sources error (non-fatal):', e.message);
        return { jobs: [], bySource: {} };
      }),
      usajobsCreds
        ? mapLimit(searches, 4, async s => {
          const jobs = await fetchUsaJobs(s.what, s.where, { credentials: usajobsCreds, radiusMiles: 50 });
          const canonical = canonicalMap[s.what] || s.what.toLowerCase().trim();
          return jobs.map(j => ({ ...j, search_query: canonical }));
        })
        : Promise.resolve([]),
    ]);
    const adzunaJobs = adzunaArrays.flat();
    const usajobsJobs = usajobsArrays.flat();
    const allJobs = [...adzunaJobs, ...usajobsJobs, ...secondary.jobs];
    const sourceCounts = { Adzuna: adzunaJobs.length, ...(usajobsCreds ? { USAJOBS: usajobsJobs.length } : {}), ...secondary.bySource };

    // Pre-warm the company-ID cache in batched lookups (one request per ~40 names, not one per
    // company — each request is a billed Supabase gateway log line).
    const uniqueCompanies = [...new Set(allJobs.map(j => j.company).filter(Boolean))];
    await resolveCompanyIds(uniqueCompanies, SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Upsert in batches of 100, SEQUENTIALLY. These used to run 3 at a time for throughput, but the
    // dedupe trigger UPDATEs (and sometimes DELETEs) the existing row a duplicate matches, so two
    // concurrent batches holding overlapping listings acquire the same row locks in opposite order
    // and deadlock — production logged 40P01 on the first run after the trigger was rekeyed, and a
    // deadlock costs the whole batch. Sequential batches cannot deadlock against each other, and
    // the 300s budget (#267) leaves ample room for the extra round trips.
    const UPSERT_BATCH = 100;
    const upsertBatches = Array.from({ length: Math.ceil(allJobs.length / UPSERT_BATCH) }, (_, i) =>
      allJobs.slice(i * UPSERT_BATCH, (i + 1) * UPSERT_BATCH)
    );
    // Count before/after the upserts so we can report NEW listings vs updates of
    // existing ones (a merge-duplicates upsert can't tell them apart on its own).
    const countBefore = await jobCount(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const upsertResults = [];
    for (const batch of upsertBatches) {
      if (Date.now() >= handlerDeadline) {
        console.warn(`refresh-jobs: out of time after ${upsertResults.length}/${upsertBatches.length} upsert batches`);
        break;
      }
      upsertResults.push(await upsertJobs(batch, SUPABASE_URL, SUPABASE_SERVICE_KEY));
    }
    const countAfter = await jobCount(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const upsertedTotal = upsertResults.reduce((sum, r) => sum + (r.upserted || 0), 0);
    // A rejected batch used to read as "found nothing" — upsertJobs swallowed !res.ok and returned
    // upserted:0 with no log. Surface it, or a total write failure looks like a quiet day.
    const failedBatches = upsertResults.filter((r) => r.error).map((r) => r.error);
    const rowsDropped = upsertResults.reduce((sum, r) => sum + (r.dropped || 0), 0);
    const inserted = (countBefore != null && countAfter != null) ? Math.max(0, countAfter - countBefore) : null;
    const updated = inserted != null ? Math.max(0, upsertedTotal - inserted) : null;

    // Employer-direct boards (Greenhouse/Lever/Ashby/…) sync in api/refresh-employer-boards.js, on
    // their own hourly invocation. Here they ran last on whatever budget was left, 24 at a time.

    // Job insights are now generated deterministically on demand (lib/server/jobInsights.js
    // via api/job-insights.js) — no Anthropic pre-generation needed in the cron.

    // Sunday only: backfill company_id on jobs that are missing it + merge duplicates
    let merged = 0;
    if (new Date().getDay() === 0 && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      // Backfill: find jobs with no company_id, stamp them
      try {
        const h = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` };
        const nullRes = await fetch(
          `${SUPABASE_URL}/rest/v1/jobs?company_id=is.null&select=id,company&limit=500`,
          { headers: h }
        );
        if (nullRes.ok) {
          const nullJobs = (await nullRes.json()) || [];
          const nullIds = await resolveCompanyIds(nullJobs.map(j => j.company), SUPABASE_URL, SUPABASE_SERVICE_KEY);
          for (const [i, j] of nullJobs.entries()) {
            const cid = nullIds[i];
            if (cid) {
              await fetch(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${j.id}`, {
                method: 'PATCH',
                headers: { ...h, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
                body: JSON.stringify({ company_id: cid }),
              });
            }
          }
          console.log(`BACKFILL: stamped company_id on ${nullJobs?.length || 0} jobs`);
        }
      } catch(e) { console.error('backfill error (non-fatal):', e.message); }

      const mr = await mergeCompanies(SUPABASE_URL, SUPABASE_SERVICE_KEY).catch(() => ({}));
      merged = mr.deleted || 0;
    }

    return res.status(200).json({
      ok: true,
      date: new Date().toISOString(),
      mode: fullMode ? 'full' : 'batch',
      auto_healed: autoHealed,
      batch: fullMode ? 'all' : batchIndex,
      searches: searches.length,
      found: allJobs.length,
      bySource: sourceCounts,
      upserted: upsertedTotal,
      inserted,
      updated,
      failed_batches: failedBatches.length,
      rows_dropped: rowsDropped,
      upsert_errors: failedBatches.slice(0, 3),
      purged: junkResult.removed,
      stale_sweep: sweep,
      merged,
    });

  } catch (err) {
    console.error('refresh-jobs error:', err.message);
    logError('refresh-jobs', err.message, { isCron });
    return res.status(500).json({ error: err.message });
  }
}
