// Always-on applicant reports (2026-10-21). The Reddit-archive collector needs no browser and no model, so it
// runs here every hour on Vercel instead of only when the owner's Mac is awake ("my biggest obstacle is the
// computer not being running all the time"). Each run fills the thinnest companies — open listings, fewer
// than 10 applicant reports, companies with a public footprint first (the targets endpoint's fill queue) —
// through the SAME code the Mac collector uses (lib/reports/archiveSource.js + lib/reports/collectorRun.js)
// and the SAME ingest handler, so every account passes the strict first-hand rules twice and is published at
// the Reddit tier (weight 0.3, trust_reason reddit_rule_match). Nothing is invented: a company with no
// first-hand accounts gets none.
//
// Why it is shaped this way (measured 2026-10-21 against the real archive, after the first three cloud runs
// each logged "found 0" for two companies): the archive refused 35 of 52 requests with HTTP 422 "Timeout.
// Maybe slow down a bit" — full-text searches, at any pace (1 s, 6 s or 12 s apart: 1/8, 1/8, 3/8 answered)
// — while plain subreddit listings always answered in 1–2.5 s; the old log dropped the per-company search
// counts and errors, so a run the archive refused read as a clean "found 0"; and the queue's head was ATS-board
// companies (Natera, Brex, Loenbro, Verkada) with no first-hand footprint at all. Now: company subreddits are
// listed instead of searched (archiveHarvest.js), the fill queue puts companies with a footprint first, every
// run's log keeps searches / refusals / reasons, and a run the archive refused says so in its status.
//
// Rotation: every run is logged in public.collector_runs (migration 20261021150000). A company is skipped for
// a number of days set by how its last run ended (retryAfterDays): read to the end and dry → 30, read to the
// end with accounts → 14, goal met → 7, stopped by the clock → 7 (2 when it was still finding accounts, 1 when
// the clock cut it off before 5 answered searches), the archive refused most of its searches → 1. Without the table the run still works (no rotation, no log).
// Each run hands the loop up to CANDIDATES_PER_RUN companies with a per-company cap; the run clock decides
// how many it reaches (a company that is read to the end in 20 s gives its minutes to the next), and the
// ones it never reached stay in the queue.
//
// GET  (Vercel cron, `Authorization: Bearer $CRON_SECRET` or x-vercel-cron) → one run, ≤ ~4 minutes.
// GET  ?runs=1 with `Authorization: Bearer $LOCAL_COMPANY_INTEL_INGEST_SECRET` → the last 50 cloud runs
//      (Seen Command reads this for its Notifications and Home tabs).
// POST ?secret=$CRON_SECRET → a manual run.
import targetsHandler from './local-company-intel-targets.js';
import ingestHandler from './ingest-local-company-intel.js';
import { runCollection } from '../lib/reports/collectorRun.js';
import { redditArchiveSource } from '../lib/reports/archiveSource.js';
import { searchableName } from '../lib/reports/targetNames.js';

export const PIPELINE = 'applicant_reports_cloud';
const RUN_MS = 230_000;          // the function may run 300 s; leave room to write the log
const PER_COMPANY_MIN = 1.9;     // the most one company may take; most take less
const CANDIDATES_PER_RUN = 8;
const QUEUE_LIMIT = 1000;        // how far down the fill queue the rotation can walk
const BELOW = 10;
const HISTORY_DAYS = 30;         // the longest skip in retryAfterDays
const MIN_FAIR_READ = 5;         // answered searches/pages below which a clock-stopped company was not really read

const sb = (path, init = {}) => fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, { ...init,
  headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });

// Call another API handler in-process (no HTTP round trip, no second function invocation).
export function callHandler(handler, { method = 'GET', query = {}, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, setHeader() { return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); return this; }, end() { resolve({ status: this.statusCode, body: null }); return this; } };
    Promise.resolve(handler({ method, query, body, headers }, res)).catch(reject);
  });
}

export { searchableName }; // shared rule: lib/reports/targetNames.js

/**
 * Days before a company is tried again, from its row in a run's summary ({found, searches, failed_searches,
 * stopped_by}); a row with no stats (a run logged before 2026-10-21 B, or one that never finished) → 7.
 */
export function retryAfterDays(row) {
  if (!row || typeof row !== 'object' || row.searches == null) return 7;
  const found = Number(row.found) || 0, searches = Number(row.searches) || 0, failed = Number(row.failed_searches) || 0;
  // It never got a fair read: try again tomorrow.
  if (row.stopped_by === 'archive_busy' || row.stopped_by === 'error' || (searches > 0 && failed * 2 >= searches)) return 1;
  if (row.stopped_by === 'exhausted') return found > 0 ? 14 : 30;
  if (row.stopped_by === 'time' && found > 0) return 2;
  // The clock cut it off before a real read (it started in the last seconds of a run).
  if (row.stopped_by === 'time' && searches - failed < MIN_FAIR_READ) return 1;
  return 7;
}

/** Companies to skip now (lowercased names), from the recent run log. */
export function skippedCompanies(rows, nowMs) {
  const latest = new Map(); // name → { at, days }
  for (const run of rows) {
    const at = Date.parse(run.started_at);
    if (!Number.isFinite(at)) continue;
    const stats = new Map((run.summary?.companies || []).map((c) => [String(c.company).toLowerCase(), c]));
    for (const name of run.companies || []) {
      const key = String(name).toLowerCase();
      const prev = latest.get(key);
      if (prev && prev.at >= at) continue;
      // A run still 'running' long after it began died before it could log; its companies get a short skip.
      const days = run.status === 'running' ? 1 : retryAfterDays(stats.get(key));
      latest.set(key, { at, days });
    }
  }
  return new Set([...latest].filter(([, v]) => nowMs < v.at + v.days * 86_400_000).map(([k]) => k));
}

async function recentRuns(nowMs) {
  const since = new Date(nowMs - HISTORY_DAYS * 86_400_000).toISOString();
  const r = await sb(`collector_runs?pipeline=eq.${PIPELINE}&started_at=gte.${since}&select=started_at,status,companies,summary&order=started_at.desc&limit=1000`).catch(() => null);
  if (!r || !r.ok) return { ok: false, skip: new Set() };
  return { ok: true, skip: skippedCompanies(await r.json(), nowMs) };
}

/**
 * The run's status from what happened: 'failed' — the ingest failed, or the archive refused EVERY search
 * (never a clean "found 0"); 'partial' — it refused at least half of them; 'complete' otherwise. Companies the
 * clock did not reach are normal (they stay in the queue), not a partial run.
 */
export function runVerdict(summary, error) {
  if (error) return { status: 'failed', error };
  if (!summary) return { status: 'failed', error: 'no summary' };
  if (!summary.ok) return { status: 'failed', error: summary.ingest_error || 'the run did not finish' };
  const n = Number(summary.searches) || 0, bad = Number(summary.failed_searches) || 0;
  const why = (summary.search_errors || []).slice(0, 2).join('; ');
  if (n > 0 && bad === n) return { status: 'failed', error: `the archive refused every search (${n})${why ? `: ${why}` : ''}`.slice(0, 300) };
  if (n > 0 && bad * 2 >= n) return { status: 'partial', error: `the archive refused ${bad} of ${n} searches${why ? `: ${why}` : ''}`.slice(0, 300) };
  return { status: 'complete', error: null };
}

const compactRow = ({ company, found, new_reports, duplicates, downgraded, stopped_by, searches, failed_searches, search_errors, threads_read, company_subs, error: e }) =>
  ({ company, found, new_reports, duplicates, downgraded, stopped_by, searches, failed_searches, threads_read,
    ...(search_errors?.length ? { search_errors } : {}), ...(company_subs?.length ? { company_subs } : {}), ...(e ? { error: e } : {}) });

export async function runCloudCollection({ now = Date.now, sources, targetsCall = callHandler, ingestCall = callHandler } = {}) {
  const secret = process.env.LOCAL_COMPANY_INTEL_INGEST_SECRET;
  if (!secret) return { ok: false, status: 'failed', error: 'LOCAL_COMPANY_INTEL_INGEST_SECRET is not set' };
  const auth = { authorization: `Bearer ${secret}` };
  const started = now();
  const t = await targetsCall(targetsHandler, { query: { below: String(BELOW), limit: String(QUEUE_LIMIT) }, headers: auth });
  if (t.status !== 200) return { ok: false, status: 'failed', error: `targets: ${t.body?.error || t.status}` };
  const recent = await recentRuns(started);
  const queue = (t.body.companies || []).filter((c) => c.company && !c.slug_like && searchableName(c)).map((c) => c.company);
  let targets = queue.filter((c) => !recent.skip.has(c.toLowerCase())).slice(0, CANDIDATES_PER_RUN);
  if (!targets.length) targets = queue.slice(0, CANDIDATES_PER_RUN); // a full lap: start over
  let logId = null;
  if (recent.ok) {
    const r = await sb('collector_runs', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ pipeline: PIPELINE, companies: targets, status: 'running' }) }).catch(() => null);
    if (r?.ok) logId = (await r.json())[0]?.id ?? null;
  }
  const postItems = async (items) => {
    const r = await ingestCall(ingestHandler, { method: 'POST', body: { items, require_existing: true }, headers: auth });
    if (r.status !== 200) throw new Error(`Seen ingest failed (${r.status}): ${r.body?.error || 'unknown error'}`);
    return r.body;
  };
  let summary, thrown = null;
  try {
    summary = await runCollection({ targets, goal: BELOW, minutes: PER_COMPANY_MIN, runDeadline: started + RUN_MS, postItems,
      sources: sources || [redditArchiveSource({ years: 5 })], log: () => {}, warn: () => {}, now, meta: { below: BELOW, queue: t.body.below_count ?? queue.length } });
  } catch (e) { thrown = String(e?.message || e).slice(0, 300); }
  const { status, error } = runVerdict(summary, thrown);
  const compact = summary && { ...summary, companies: summary.companies.map(compactRow) };
  if (logId != null) {
    await sb(`collector_runs?id=eq.${logId}`, { method: 'PATCH', body: JSON.stringify({ status, finished_at: new Date(now()).toISOString(),
      new_reports: summary?.imported_reports || 0, summary: compact,
      // Only companies actually searched count as tried — one the clock never reached stays in the queue.
      ...(summary ? { companies: summary.companies.map((c) => c.company) } : {}), error }) }).catch(() => {});
  }
  return { ok: status !== 'failed', status, id: logId, error, summary: compact };
}

export default async function handler(req, res) {
  const q = req.query || {};
  if (req.method === 'GET' && String(q.runs) === '1') {
    const secret = process.env.LOCAL_COMPANY_INTEL_INGEST_SECRET;
    if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
    const r = await sb('collector_runs?select=id,pipeline,started_at,finished_at,status,companies,new_reports,error,summary&order=started_at.desc&limit=50').catch(() => null);
    if (!r || !r.ok) return res.status(200).json({ ok: true, ready: false, runs: [] });
    return res.status(200).json({ ok: true, ready: true, runs: await r.json() });
  }
  const cron = process.env.CRON_SECRET;
  // Same rule as the other Seen crons: Vercel's header, or the CRON_SECRET bearer Vercel adds when it is set.
  const isCron = req.headers['x-vercel-cron'] === '1' || (cron && req.headers.authorization === `Bearer ${cron}`);
  const manual = req.method === 'POST' && cron && q.secret === cron;
  if (!((req.method === 'GET' && isCron) || manual)) return res.status(401).json({ error: 'Unauthorized' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return res.status(503).json({ error: 'Storage is unavailable.' });
  const out = await runCloudCollection();
  return res.status(out.ok ? 200 : 500).json(out);
}
