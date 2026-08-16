// Seen — Reddit JSON harvest, on its own execution path.
//
// WHY THIS EXISTS. Measured against production on 2026-08-15: the Reddit pipeline in
// api/reports.js had touched 33 of 37,791 companies (0.09%) in two months, its last successful
// extraction was 2026-06-14, and all 630 posts fetched since were recorded as
// 'no_experiences_extracted' — a label that could not be distinguished from an API failure,
// because extractReports swallowed every error as []. On top of that, vercel.json contains no
// Reddit cron at all: the pipeline only ever ran when someone pressed a button in admin.
//
// Three design decisions, each aimed at one of those measured failures:
//
// 1. FIREHOSE, NOT PER-COMPANY SEARCH. The old ingest asked Reddit "find posts about company X"
//    for 25 companies per run. Against a 37,791-company catalogue where most companies are
//    never discussed, nearly every one of those searches is empty by construction — that is the
//    0.09%. Here we pull each subreddit's own listing once and ask which companies appear in
//    the posts we already have. One /new call returns up to 100 posts that are candidates for
//    every company simultaneously.
//
// 2. JSON, NOT RSS. Reddit serves JSON on any listing URL with a `.json` suffix and no auth.
//    RSS gave a title and a tag-stripped body; JSON gives score, comment count, timestamp,
//    author and permalink, which is what recency- and engagement-weighted aggregation needs.
//
// 3. COLLECTION IS SEPARATE FROM INTERPRETATION. Raw posts land in reddit_raw and stay there.
//    Classification reads from that table, so improving the matcher or the classifier never
//    means re-fetching Reddit — the reason the corpus could never be rebuilt before.
//
// Non-destructive by construction: no deletes, no scoring writes, no report creation. It
// harvests, detects company mentions as CLAIMS with confidence, and records what happened.
// Turning matches into weighted reports stays in the existing classified path.

import { listNew, listTop } from '../lib/server/redditJson.js';
import { buildCompanyIndex, detectCompanies } from '../lib/server/redditCompanyMatch.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Job-seeker subs, highest signal first. The harvest is cheap per sub (one request), so unlike
// the old per-company search there is no reason to run only one.
const DEFAULT_SUBS = [
  'recruitinghell', 'jobs', 'cscareerquestions', 'careerguidance', 'AskHR',
  'ExperiencedDevs', 'interviews', 'antiwork', 'ITCareerQuestions', 'GetEmployed',
];

const hdrs = () => ({
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
});

async function authorize(req) {
  if (req.headers['x-vercel-cron'] === '1') return true;

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers['authorization'] || '';
  const querySecret = new URL(req.url, 'https://x').searchParams.get('secret') || '';
  if (cronSecret && (authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret)) return true;

  const adminToken = req.headers['x-admin-token'] || '';
  if (adminToken && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/admin_sessions?token=eq.${encodeURIComponent(adminToken)}&select=expires_at&limit=1`,
        { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
      );
      const sess = r.ok ? (await r.json())?.[0] : null;
      if (sess && new Date(sess.expires_at) >= new Date()) return true;
    } catch { /* fall through to 401 */ }
  }
  return false;
}

// Telemetry is the point, not a nicety: without it a zero-yield run is unfalsifiable.
async function logFetch(row) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/reddit_fetch_log`, {
      method: 'POST', headers: { ...hdrs(), Prefer: 'return=minimal' }, body: JSON.stringify(row),
    });
  } catch { /* telemetry must never break the harvest */ }
}

// Load the company catalogue once per run. PostgREST caps rows per response, so page until
// short-read. Bounded so a catalogue explosion cannot spin the invocation forever — and the
// cap is REPORTED rather than silently truncating (a bounded sweep that does not say it was
// bounded reads as full coverage).
async function loadCompanies(maxPages = 60, pageSize = 1000) {
  const names = [];
  let truncated = false;
  for (let page = 0; page < maxPages; page++) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/companies?select=id,name&order=name.asc&limit=${pageSize}&offset=${page * pageSize}`,
      { headers: hdrs() },
    );
    if (!r.ok) break;
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) return { names, truncated: false };
    names.push(...rows.filter(x => x?.name));
    if (rows.length < pageSize) return { names, truncated: false };
    if (page === maxPages - 1) truncated = true;
  }
  return { names, truncated };
}

export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json');
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ ok: false, error: 'supabase not configured' });
  }
  if (!(await authorize(req))) return res.status(401).json({ ok: false, error: 'unauthorized' });

  const url    = new URL(req.url, 'https://x');
  const subs   = (url.searchParams.get('subs') || '').split(',').map(s => s.trim()).filter(Boolean);
  const mode   = url.searchParams.get('mode') === 'top' ? 'top' : 'new';
  const window = url.searchParams.get('t') || 'week';
  const limit  = Math.min(Number(url.searchParams.get('limit')) || 100, 100);
  const dryRun = url.searchParams.get('dry') === '1';
  const targets = subs.length ? subs : DEFAULT_SUBS;

  const started = Date.now();
  const perSub = [];
  const allPosts = [];

  // Sequential across subs on purpose: concurrent requests from one IP are what trips Reddit's
  // per-IP throttle, and a 429 costs far more than the extra wall-clock.
  for (const sub of targets) {
    const t0 = Date.now();
    const r = mode === 'top'
      ? await listTop(sub, { t: window, limit })
      : await listNew(sub, { limit });
    const ms = Date.now() - t0;

    const usable = (r.items || []).filter(p => !p.removed && (p.title || p.body));
    perSub.push({
      sub, ok: r.ok, status: r.status, host: r.host,
      fetched: r.items?.length || 0, usable: usable.length,
      error: r.error, ms, attempts: r.attempts,
    });
    if (!dryRun) {
      await logFetch({
        endpoint: mode, subreddit: sub, http_status: r.status, host: r.host,
        items: r.items?.length || 0, ok: r.ok, error: r.error, ms, attempts: r.attempts,
      });
    }
    allPosts.push(...usable);
  }

  // Persist raw BEFORE interpreting. If matching or classification is wrong today, the corpus
  // is still on disk to re-run against tomorrow.
  let stored = 0;
  if (!dryRun && allPosts.length) {
    for (let i = 0; i < allPosts.length; i += 100) {
      const chunk = allPosts.slice(i, i + 100).map(p => ({
        post_id: p.id, kind: p.kind, subreddit: p.subreddit, title: p.title, body: p.body,
        author: p.author, created_utc: p.created_utc, score: p.score,
        num_comments: p.num_comments, permalink: p.permalink, raw: p,
      }));
      const w = await fetch(`${SUPABASE_URL}/rest/v1/reddit_raw?on_conflict=post_id`, {
        method: 'POST',
        headers: { ...hdrs(), Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(chunk),
      });
      // A rejected write is surfaced, never swallowed — the exact failure that hid a broken
      // job-ingest batch for days (see upsertJobs, PR #268).
      if (w.ok) stored += chunk.length;
      else console.error(`[reddit-harvest] raw write failed ${w.status}: ${(await w.text()).slice(0, 300)}`);
    }
  }

  // Company detection over what we just harvested.
  const { names: catalogue, truncated } = await loadCompanies();
  const index = buildCompanyIndex(catalogue);

  const matchRows = [];
  const companyTally = {};
  for (const p of allPosts) {
    const hits = detectCompanies(p, index);
    for (const h of hits.slice(0, 5)) {           // a post naming 6+ employers is a listicle, not a report
      matchRows.push({
        post_id: p.id, company_name: h.name,
        company_id: typeof h.id === 'string' ? h.id : null,
        confidence: h.confidence, evidence: h.evidence,
      });
      companyTally[h.name] = (companyTally[h.name] || 0) + 1;
    }
  }

  let matchesWritten = 0;
  if (!dryRun && matchRows.length) {
    for (let i = 0; i < matchRows.length; i += 200) {
      const chunk = matchRows.slice(i, i + 200);
      const w = await fetch(`${SUPABASE_URL}/rest/v1/reddit_company_match?on_conflict=post_id,company_name`, {
        method: 'POST',
        headers: { ...hdrs(), Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(chunk),
      });
      if (w.ok) matchesWritten += chunk.length;
      else console.error(`[reddit-harvest] match write failed ${w.status}: ${(await w.text()).slice(0, 300)}`);
    }
  }

  // A zero has to explain itself. These fields are the difference between "Reddit is blocked
  // from Vercel" and "nobody discussed a tracked company this hour" — two months were lost to
  // not being able to tell them apart.
  const blocked   = perSub.filter(s => s.status === 403 || s.status === 451);
  const throttled = perSub.filter(s => s.status === 429);
  const reason = allPosts.length === 0
    ? (blocked.length ? 'all_hosts_blocked' : throttled.length ? 'rate_limited' : 'no_posts_returned')
    : matchRows.length === 0 ? 'posts_harvested_but_no_tracked_company_named' : null;

  return res.status(200).json({
    ok: true,
    mode, window: mode === 'top' ? window : null, dry_run: dryRun,
    subs_attempted: targets.length,
    subs_ok: perSub.filter(s => s.ok).length,
    posts_usable: allPosts.length,
    raw_stored: stored,
    catalogue_size: catalogue.length,
    catalogue_truncated: truncated,          // never let a capped read look like full coverage
    companies_detected: Object.keys(companyTally).length,
    matches_written: matchesWritten,
    top_companies: Object.entries(companyTally).sort((a, b) => b[1] - a[1]).slice(0, 15),
    reason,
    blocked_subs: blocked.map(s => s.sub),
    throttled_subs: throttled.map(s => s.sub),
    per_sub: perSub,
    ms: Date.now() - started,
  });
}
