// Cron: Stale-Job Prune. BOUNDED, employer-safe, LOGGED hard-delete of long-dead listings — the
// observable backstop to api/refresh-jobs.js › deleteExpired() (which deletes at expires_at<now
// UNBOUNDED, UNLOGGED, and WITHOUT excluding employer-posted rows). The selection/bounds/delete
// logic lives in the shared, unit-tested engine lib/server/jobPrune.js (injectable fetch) so this
// cron and the tests can never drift — mirrors api/refresh-stale-jobs.js ↔ lib/server/staleRefresh.js.
//
// WHAT IT DELETES: rows where expires_at < now() − graceDays (default 30d) AND is_employer_posted=false,
// capped at maxRows per run so a single invocation stays inside its maxDuration. Because the grace is
// 30 days PAST a 14-day lease, only genuinely long-dead rows (≈44d+ since last seen) are ever eligible —
// the public /jobs feed already stopped showing them weeks earlier (it gates on expires_at>now).
//
// SAFE BY DEFAULT: graceDays is clamped ≥ 0 in the engine, so a not-yet-expired row can never be
// selected. Preview WITHOUT deleting via ?dry=1 (or PRUNE_DRY_RUN=1). Tuning knobs: ?grace=<days>
// (or PRUNE_GRACE_DAYS), ?limit=<rows> (or PRUNE_MAX).
//
// AUTH: fails CLOSED like api/refresh-jobs.js (this is a destructive DELETE endpoint) through the
// shared scheduler-or-admin check in lib/server/cronAuth.js.

import { logError } from '../lib/server/errlog.js';
import { pruneStaleJobs, PRUNE_DEFAULTS } from '../lib/server/jobPrune.js';
import { isCronOrAdmin, claimsVercelCron } from '../lib/server/cronAuth.js';

export default async function handler(req, res) {
  // Fail CLOSED: a destructive endpoint must never be an open trigger. Scheduler (CRON_SECRET when
  // configured) or a valid admin session only — see lib/server/cronAuth.js.
  if (!(await isCronOrAdmin(req))) return res.status(401).json({ error: 'Unauthorized' });
  const isCron = claimsVercelCron(req); // logging context only

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY' });
  }

  const reqUrl = new URL(req.url, 'https://x');
  // Dry-run preview (SELECT + count only, zero writes): ?dry=1 or PRUNE_DRY_RUN=1. Default = apply.
  const apply = !(process.env.PRUNE_DRY_RUN === '1' || reqUrl.searchParams.get('dry') === '1');
  const graceDays = parseInt(reqUrl.searchParams.get('grace') || process.env.PRUNE_GRACE_DAYS || String(PRUNE_DEFAULTS.graceDays), 10);
  const maxRows = parseInt(reqUrl.searchParams.get('limit') || process.env.PRUNE_MAX || String(PRUNE_DEFAULTS.maxRows), 10);

  try {
    const summary = await pruneStaleJobs({
      url: SUPABASE_URL, key: SUPABASE_SERVICE_KEY, apply,
      graceDays: Number.isFinite(graceDays) ? graceDays : PRUNE_DEFAULTS.graceDays,
      maxRows: Number.isFinite(maxRows) ? maxRows : PRUNE_DEFAULTS.maxRows,
    });
    // Always log the outcome — this is the observability deleteExpired lacks.
    console.log(
      `prune-jobs: ${apply ? 'deleted' : 'would delete'} ${apply ? summary.deleted : summary.candidates} ` +
      `long-dead row(s) past expires_at+${summary.graceDays}d (cutoff ${summary.cutoff}` +
      `${summary.capped ? `, capped at ${summary.limit} — more next run` : ''})`
    );
    return res.status(200).json({ ok: true, date: new Date().toISOString(), dry_run: !apply, ...summary });
  } catch (err) {
    console.error('prune-jobs error:', err.message);
    logError('prune-jobs', err.message, { isCron });
    return res.status(500).json({ error: err.message });
  }
}
