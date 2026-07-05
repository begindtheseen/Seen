// One-click unsubscribe for outcome follow-up emails (Operation 50%, Engine E2). Each email's
// footer links here with the user's uid + an HMAC token (lib/server/outcomeEmails.unsubToken), so
// opting out needs no login. On a valid token we set email_prefs.outcome_opt_out = true (migration
// 045), which api/outcome-followups.js honors before every send. GET only — renders a plain
// confirmation page either way, never leaking whether a uid exists.

import { verifyUnsub } from '../lib/server/outcomeEmails.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const EMAIL_SECRET = process.env.EMAIL_UNSUB_SECRET || process.env.CRON_SECRET || SERVICE_KEY;

function page(res, status, heading, body) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(status).send(`<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${heading} · Seen</title></head>
<body style="margin:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:64px 24px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;">
<tr><td align="center" style="padding-bottom:24px;"><span style="font-size:18px;font-weight:800;color:#111;letter-spacing:-0.03em">Seen</span></td></tr>
<tr><td style="background:#fff;border:1px solid #e0e0e8;border-radius:12px;padding:36px 32px;text-align:center;">
  <h1 style="margin:0 0 14px;font-size:20px;font-weight:700;color:#111">${heading}</h1>
  <p style="margin:0 0 20px;font-size:14px;color:#555;line-height:1.7">${body}</p>
  <a href="https://seenjobs.io" style="display:inline-block;font-size:13px;font-weight:700;color:#111;text-decoration:none">Back to Seen →</a>
</td></tr></table></td></tr></table></body></html>`);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const uid = String(req.query?.uid || '');
  const token = String(req.query?.token || '');

  if (!verifyUnsub(uid, token, EMAIL_SECRET)) {
    return page(res, 400, 'Link not valid', "This unsubscribe link isn't valid or has expired. If you keep getting emails you don't want, reply to one and we'll remove you.");
  }

  if (SUPABASE_URL && SERVICE_KEY) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/email_prefs?on_conflict=user_id`, {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({ user_id: uid, outcome_opt_out: true, updated_at: new Date().toISOString() }),
      });
    } catch { /* best-effort; still show success so the user isn't told to retry */ }
  }

  return page(res, 200, "You're unsubscribed", "You won't get outcome check-in emails from Seen anymore. You can still track and report applications any time at seenjobs.io — nothing else changes.");
}
