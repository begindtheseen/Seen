// Day-7/14/30 outcome follow-up cron (Operation 50%, Engine E2 — the data-acquisition engine
// AND a retention channel). Once a day it finds applications that have aged into a milestone and
// are still unresolved, emails the applicant one honest question ("did they respond / interview /
// what happened"), and logs the send so it never repeats.
//
// Contract facts this handler depends on (verified against the schema, not assumed):
//   - Vercel crons fire as GET with header `x-vercel-cron: 1` (see api/demand.js). We route that
//     GET into the run; a manual run is allowed with `?secret=<CRON_SECRET>`.
//   - applications columns: id, user_id, company, role, status, applied_at, created_at
//     (migrations 016 + 037). Age anchors on applied_at, falls back to created_at.
//   - user email lives in auth.users, read via the admin API (same call as api/stripe.js:60).
//   - RESEND_KEY + the verified noreply@seenjobs.io sender are already live (api/apply.js).
//   - outcome_email_log (UNIQUE application_id, milestone_day) + email_prefs — migration 045.
//
// Idempotency: we CLAIM the (application, milestone) log row (unique insert) before sending, so a
// crash or an overlapping run can't double-mail; a hard send failure releases the claim so the
// next run retries. No RESEND_KEY → clean no-op (nothing sent, 200).

import { dueMilestone, buildEmail, unsubToken } from '../lib/server/outcomeEmails.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY = process.env.RESEND_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const EMAIL_SECRET = process.env.EMAIL_UNSUB_SECRET || CRON_SECRET || SERVICE_KEY;
const SITE = 'https://seenjobs.io';
const MAX_SENDS = 100; // per run — keeps us well under the 60s function budget

export default async function handler(req, res) {
  const isCron = req.headers['x-vercel-cron'] === '1';
  const hasSecret = CRON_SECRET && (req.headers['x-cron-secret'] === CRON_SECRET || req.query?.secret === CRON_SECRET);
  if (!isCron && !hasSecret) return res.status(401).json({ error: 'unauthorized' });
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'db_not_configured' });
  if (!RESEND_KEY) return res.status(200).json({ ok: true, skipped: 'no_resend_key', sent: 0 });

  const baseHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
  const q = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...baseHeaders, ...(opts.headers || {}) } });

  const now = Date.now();
  const cutoff = new Date(now - 7 * 86400e3).toISOString();

  // Oldest first so Day-30 applications win the per-run send budget over fresher Day-7 ones.
  const r = await q(`applications?select=id,user_id,company,role,status,applied_at,created_at&created_at=lt.${encodeURIComponent(cutoff)}&order=created_at.asc&limit=1000`);
  if (!r.ok) return res.status(200).json({ ok: false, reason: 'query_failed', sent: 0 });
  const apps = await r.json();

  const optRes = await q('email_prefs?select=user_id&outcome_opt_out=eq.true&limit=10000');
  const optOut = new Set((optRes.ok ? await optRes.json() : []).map((x) => x.user_id));

  const emailCache = new Map();
  async function emailFor(uid) {
    if (emailCache.has(uid)) return emailCache.get(uid);
    let email = null;
    try {
      const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(uid)}`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      });
      if (ur.ok) { const u = await ur.json(); email = u?.email || null; }
    } catch { /* leave null */ }
    emailCache.set(uid, email);
    return email;
  }

  const releaseClaim = (appId, day) =>
    q(`outcome_email_log?application_id=eq.${appId}&milestone_day=eq.${day}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => {});

  let sent = 0, skipped = 0;
  const byMilestone = { 7: 0, 14: 0, 30: 0 };

  for (const app of Array.isArray(apps) ? apps : []) {
    if (sent >= MAX_SENDS) break;
    if (!app.user_id || optOut.has(app.user_id)) { skipped++; continue; }

    const day = dueMilestone(app, now);
    if (!day) { skipped++; continue; }

    const email = await emailFor(app.user_id);
    if (!email) { skipped++; continue; } // no address → skip cleanly, no claim burned

    // Claim BEFORE sending — the unique (application_id, milestone_day) makes this race/retry safe.
    const claim = await q('outcome_email_log', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ application_id: app.id, user_id: app.user_id, milestone_day: day }),
    });
    if (claim.status === 409) { skipped++; continue; } // already sent for this milestone
    if (!claim.ok && claim.status !== 201) { skipped++; continue; }

    const token = unsubToken(app.user_id, EMAIL_SECRET);
    const unsubUrl = `${SITE}/api/unsubscribe?uid=${encodeURIComponent(app.user_id)}&token=${token}`;
    const reportUrl = `${SITE}/report?company=${encodeURIComponent(app.company || '')}`;
    const { subject, html, text } = buildEmail(app, day, { reportUrl, unsubUrl });

    try {
      const send = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'Seen <noreply@seenjobs.io>', to: [email], subject, html, text }),
      });
      if (send.ok) { sent++; byMilestone[day]++; }
      else { await releaseClaim(app.id, day); skipped++; } // let a later run retry
    } catch {
      await releaseClaim(app.id, day);
      skipped++;
    }
  }

  return res.status(200).json({ ok: true, sent, skipped, candidates: (apps || []).length, byMilestone });
}
