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
// AUTH: fails CLOSED like api/refresh-jobs.js (this is a destructive DELETE endpoint) using the three
// mechanisms from api/refresh-stale-jobs.js — the Vercel cron header, CRON_SECRET, or an admin token.

import { logError } from '../lib/server/errlog.js';
import { pruneStaleJobs, PRUNE_DEFAULTS } from '../lib/server/jobPrune.js';

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const adminToken = req.headers['x-admin-token'] || '';
  const isCron = req.headers['x-vercel-cron'] === '1';
  // Fail CLOSED: a destructive endpoint must never be an open trigger. Every non-cron caller must
  // present a valid CRON_SECRET or a valid admin session; a missing/blank secret simply makes the
  // cron-secret path unavailable (callers fall through to 401) — same stance as api/refresh-jobs.js.
  if (!isCron) {
    const authHeader = req.headers['authorization'] || '';
    const querySecret = new URL(req.url, 'https://x').searchParams.get('secret') || '';
    const cronOk = !!cronSecret && (authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret);
    let adminOk = false;
    if (!cronOk && adminToken) {
      const SB = process.env.SUPABASE_URL, SK = process.env.SUPABASE_SERVICE_KEY;
      if (SB && SK) {
        const sr = await fetch(`${SB}/rest/v1/admin_sessions?token=eq.${encodeURIComponent(adminToken)}&select=expires_at&limit=1`, { headers: { apikey: SK, Authorization: `Bearer ${SK}` } });
        const sess = sr.ok ? (await sr.json())?.[0] : null;
        adminOk = !!sess && new Date(sess.expires_at) >= new Date();
      }
    }
    if (!cronOk && !adminOk) return res.status(401).json({ error: 'Unauthorized' });
  }

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
