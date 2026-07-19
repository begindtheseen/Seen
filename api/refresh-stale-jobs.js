// Cron: Automated Job Refresh. Re-checks the stale/expired backlog's real liveness and corrects
// each row's status, shrinking the "stale jobs" KPI. This is the SCHEDULED front-end for the
// shared engine in lib/server/staleRefresh.js (the same engine scripts/refresh-stale-jobs.mjs
// drives from the CLI, so cron and CLI can never drift — mirrors refresh-jobs.js ↔ jobSources.js).
//
// SAFETY: writes are OFF until STALE_REFRESH_APPLY=1 is set in the environment. Until then every
// scheduled run is a dry-run (reads + classifies + logs what it WOULD change, zero writes), so
// merging + deploying this changes nothing about the data until the owner explicitly enables it —
// the same env-gate stance as OVERNIGHT_AUTOMERGE / PROPOSAL_GATE elsewhere in the system.
// Auth mirrors api/refresh-jobs.js exactly (Vercel cron header, CRON_SECRET, or an admin token).

import { logError } from '../lib/server/errlog.js';
import { refreshStaleJobs } from '../lib/server/staleRefresh.js';

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const adminToken = req.headers['x-admin-token'] || '';
  const isCron = req.headers['x-vercel-cron'] === '1';
  if (!isCron && cronSecret) {
    const authHeader = req.headers['authorization'] || '';
    const querySecret = new URL(req.url, 'https://x').searchParams.get('secret') || '';
    const cronOk = authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret;
    if (!cronOk && !adminToken) return res.status(401).json({ error: 'Unauthorized' });
    if (!cronOk && adminToken) {
      const SB = process.env.SUPABASE_URL, SK = process.env.SUPABASE_SERVICE_KEY;
      if (!SB || !SK) return res.status(401).json({ error: 'Unauthorized' });
      const sr = await fetch(`${SB}/rest/v1/admin_sessions?token=eq.${encodeURIComponent(adminToken)}&select=expires_at&limit=1`, { headers: { apikey: SK, Authorization: `Bearer ${SK}` } });
      const sess = sr.ok ? (await sr.json())?.[0] : null;
      if (!sess || new Date(sess.expires_at) < new Date()) return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY' });
  }

  // Writes require an explicit opt-in. ?apply=1 (admin-triggered) OR STALE_REFRESH_APPLY=1 (cron).
  const reqUrl = new URL(req.url, 'https://x');
  const apply = process.env.STALE_REFRESH_APPLY === '1' || reqUrl.searchParams.get('apply') === '1';
  // Per-run cap keeps the function inside its maxDuration; a daily cron + the 7-day stale window
  // churns the whole backlog over a few runs. The CLI script runs uncapped for a one-pass sweep.
  const limit = parseInt(reqUrl.searchParams.get('limit') || process.env.STALE_REFRESH_LIMIT || '500', 10);
  const concurrency = parseInt(process.env.STALE_REFRESH_CONCURRENCY || '20', 10);
  const timeoutMs = parseInt(process.env.STALE_REFRESH_TIMEOUT_MS || '8000', 10);

  try {
    const summary = await refreshStaleJobs({
      url: SUPABASE_URL, key: SUPABASE_SERVICE_KEY, apply,
      limit: Number.isFinite(limit) ? limit : 500,
      concurrency: Number.isFinite(concurrency) ? concurrency : 20,
      timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 8000,
    });
    return res.status(200).json({ ok: true, date: new Date().toISOString(), dry_run: !apply, ...summary });
  } catch (err) {
    console.error('refresh-stale-jobs error:', err.message);
    logError('refresh-stale-jobs', err.message, { isCron });
    return res.status(500).json({ error: err.message });
  }
}
