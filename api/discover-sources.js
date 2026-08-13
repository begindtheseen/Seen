// Seen — ATS SOURCE DISCOVERY, on its own execution path.
//
// WHY THIS IS A SEPARATE FUNCTION. Discovery used to live at the tail of api/refresh-jobs.js, after
// deleteExpired/deleteJunk/markStaleJobs and the whole Adzuna sweep, running on whatever budget was
// left. It never once registered a board: company_sources sat at 27 hand-typed seeds from 2026-08-07
// with ZERO discovered_via='crawl' rows. PR #273 fixed four real defects in the sweep itself (a
// once-daily 02:00Z gate, a CDX page that never rotated, a deadline the function did not accept, and a
// summary that could not say why a zero was a zero) — and the 08-13 02:00Z run still returned zero
// while NOT being starved, which proved the defects were not the whole story.
//
// The measurement that settled it (owner probe against CC-MAIN-2026-30, 2026-08-13): every pattern
// returns HTTP 200 with real tenant rows — Common Crawl is up, not blocking, and the CDX patterns are
// correct — but the seven of them cost 19.3s SEQUENTIALLY at limit=3, with careers.smartrecruiters.com
// at 9.0s and *.recruitee.com at 7.0s on their own. That is per-pattern index seek time, not row
// transfer, so it does not shrink at the real limit=300. A sweep that costs tens of seconds cannot be
// the last thing a handler does with its leftovers. It needs its own invocation. That is this file.
//
// Nothing here is destructive: it performs no deletes, no stale marking, and no job upserts. It reads
// the Common Crawl index and upserts rows into company_sources. The scheduled refresh then ingests
// whatever it registered on the next run, because dueSources() orders last_successful_sync
// asc.nullsfirst — newly discovered boards are picked up FIRST.

import { discoverFromCommonCrawl } from '../lib/jobs/discovery.js';
import { logError } from '../lib/server/errlog.js';

// Must stay under the maxDuration declared for this function in vercel.json (300s), with room to
// serialize the response. Discovery gets the WHOLE budget here — that is the entire point.
const BUDGET_MS = Number(process.env.DISCOVER_SOURCES_BUDGET_MS || 240_000);

// Rotation HINT only. discoverFromCommonCrawl clamps it to each pattern's real page count, because
// these host patterns have exactly one page ({"pages":1}) and a cursor past the end is a hard CDX 400,
// not an empty result. #273 rotated blind, reached page 36, and 400ed every request for hours. ?page=N
// overrides the hint for a targeted sweep; it is still clamped.
const PAGES = 40;
const DEFAULT_INTERVAL_MS = 12 * 60 * 60 * 1000; // this endpoint's cron cadence
export const pageFor = (now = Date.now(), intervalMs = DEFAULT_INTERVAL_MS) =>
  Math.floor(now / intervalMs) % PAGES;

// Fail CLOSED, matching api/refresh-jobs.js. Authorization must never be contingent on CRON_SECRET
// being set: if that env var is blank the cron-secret path is simply unavailable and callers fall
// through to 401, rather than the endpoint becoming an open trigger for outbound crawling.
async function authorize(req) {
  if (req.headers['x-vercel-cron'] === '1') return true;

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers['authorization'] || '';
  const querySecret = new URL(req.url, 'https://x').searchParams.get('secret') || '';
  if (cronSecret && (authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret)) return true;

  const adminToken = req.headers['x-admin-token'] || '';
  const SB = process.env.SUPABASE_URL, SK = process.env.SUPABASE_SERVICE_KEY;
  if (adminToken && SB && SK) {
    try {
      const r = await fetch(
        `${SB}/rest/v1/admin_sessions?token=eq.${encodeURIComponent(adminToken)}&select=expires_at&limit=1`,
        { headers: { apikey: SK, Authorization: `Bearer ${SK}` } }
      );
      const sess = r.ok ? (await r.json())?.[0] : null;
      if (sess && new Date(sess.expires_at) >= new Date()) return true;
    } catch { /* fall through to 401 */ }
  }
  return false;
}

// Vercel crons fire as GET, so GET must reach the work — a POST-only handler would make the schedule
// a silent no-op (the mistake api/demand.js and api/reports.js already had to correct).
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await authorize(req))) return res.status(401).json({ error: 'Unauthorized' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY' });
  }

  const params = new URL(req.url, 'https://x').searchParams;
  const pageParam = params.get('page');
  const limitParam = params.get('limit');
  const page = pageParam !== null && Number.isFinite(Number(pageParam))
    ? Math.abs(Math.trunc(Number(pageParam))) % PAGES
    : pageFor();
  const perPatternLimit = limitParam !== null && Number.isFinite(Number(limitParam))
    ? Math.min(1000, Math.max(1, Math.trunc(Number(limitParam))))
    : 300;

  const startedAt = Date.now();
  try {
    const summary = await discoverFromCommonCrawl({
      supabaseUrl: SUPABASE_URL,
      serviceKey: SUPABASE_SERVICE_KEY,
      perPatternLimit,
      page,
      maxRegister: 200,
      deadline: startedAt + BUDGET_MS,
    });

    // One line that states the outcome outright. The absence of exactly this is why a sweep returning
    // nothing looked identical to a sweep that never ran, for three weeks.
    console.log(
      `discover-sources: crawl=${summary.crawl} page_hint=${summary.page} ` +
      `pages_used=${JSON.stringify(summary.pages_used || [])} ` +
      `patterns=${summary.patterns_swept}/${summary.patterns_total} tenants=${summary.discovered} ` +
      `registered=${summary.registered} new=${summary.new_boards} reason=${summary.reason}` +
      `${summary.detail ? ` detail=${summary.detail}` : ''} ms=${Date.now() - startedAt}`
    );

    return res.status(200).json({
      ok: true,
      date: new Date().toISOString(),
      ms: Date.now() - startedAt,
      per_pattern_limit: perPatternLimit,
      ...summary,
    });
  } catch (e) {
    try { logError('api/discover-sources', e, { page, perPatternLimit }); } catch { /* best-effort */ }
    return res.status(500).json({ ok: false, error: e.message, ms: Date.now() - startedAt });
  }
}
