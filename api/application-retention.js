// Daily cron: clear the employer's copy of declined / withdrawn Apply-on-Seen applications 30 days
// after the decision (lib/server/applicationRetention.js has the policy and why). Vercel crons fire
// as GET with the CRON_SECRET bearer (lib/server/cronAuth.js); an admin can also POST. Safe to run any time: the 30-day
// cutoff is fixed, so an extra run only clears what is already due. No-op before migration
// 20261018170000.

import { purgeDecidedApplications } from '../lib/server/applicationRetention.js';
import { lifecycleAvailable, deleteResumeObjects } from '../lib/server/seenApplyStore.js';
import { isVercelCron, hasCronSecret, hasAdminSession } from '../lib/server/cronAuth.js';

export default async function handler(req, res) {
  // Vercel's cron (GET + its CRON_SECRET bearer), a manual run with the secret, or an admin POST.
  // Before 2026-10-24 any POST ran it and the cron GET was refused (lib/server/cronAuth.js).
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const allowed = req.method === 'GET' ? isVercelCron(req) : (hasCronSecret(req) || await hasAdminSession(req));
  if (!allowed) return res.status(401).json({ error: 'Unauthorized' });
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'DB not configured' });
  const db = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!(await lifecycleAvailable(db))) return res.status(200).json({ ok: true, available: false });

  // A few batches per run keeps one run bounded; whatever is left is cleared tomorrow.
  const total = { scanned: 0, cleared: 0, fileErrors: 0 };
  for (let i = 0; i < 5; i++) {
    const r = await purgeDecidedApplications({ db, deleteFiles: (paths) => deleteResumeObjects({ SUPABASE_URL, SERVICE_KEY, paths }) });
    total.scanned += r.scanned; total.cleared += r.cleared; total.fileErrors += r.fileErrors;
    if (r.scanned < 200 || !r.cleared) break;
  }
  if (total.fileErrors) console.warn('[application-retention] résumé file deletes failed:', total.fileErrors);
  return res.status(200).json({ ok: true, ...total });
}
