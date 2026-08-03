// Renewal-reminder cron (Wave 3 — completes the renewal loop). Emails employers whose Featured /
// Verified / Sponsor perk lapses within 7 days, so paid reach/commitment doesn't silently disappear
// when they're not looking at the dashboard. Uses the owner-approved Resend infra (RESEND_KEY) — a
// no-op until the key is set. Idempotent: each row stores the ISO `until` it was last reminded for
// (renewal_reminded_until), so we email once per period and a renewal re-arms the next reminder.
//
// Vercel crons fire as GET (x-vercel-cron header) — routed into the same logic as an admin POST.
// Renewal reuses the existing one-time checkout; this never charges. Best-effort throughout: a single
// employer's failure never aborts the batch.

import { pickRenewalReminders } from '../lib/server/renewalReminders.js';

const WINDOW_DAYS = 7;

async function sendReminderEmail(to, company, items) {
  const RESEND_KEY = process.env.RESEND_KEY || process.env.RESEND_API_KEY;
  if (!RESEND_KEY || !to) return false; // no-op until email is configured / no address on file
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const soonest = items[0];
  const lines = items.map(i => `<li>${esc(i.label)} — expires in ${i.daysLeft} day${i.daysLeft === 1 ? '' : 's'}</li>`).join('');
  const subject = `Your Seen ${items.length > 1 ? 'placements are' : `${soonest.label} is`} expiring soon`;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Seen <noreply@seenjobs.io>',
        to: [to],
        subject,
        html: `<div style="font-family:-apple-system,sans-serif;font-size:14px;color:#111;line-height:1.7">
          <p>Hi ${esc(company)},</p>
          <p>Your paid placement on Seen is about to lapse:</p>
          <ul>${lines}</ul>
          <p>Renew to keep your reach and badge live — it's a one-time purchase, no auto-charge:</p>
          <p><a href="https://seenjobs.io/employers#promote" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:700">Renew now →</a></p>
          <p style="color:#666;font-size:12px">You're receiving this because you purchased a placement for ${esc(company)}. Renewal never changes your transparency score.</p>
        </div>`,
      }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  const isCron = req.method === 'GET' && (req.headers['x-vercel-cron'] || req.query?.cron);
  if (req.method !== 'POST' && !isCron) return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'DB not configured' });
  const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
  const db = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });

  try {
    const nowISO = new Date().toISOString();
    // Active perks only (any of the three still in the future) — the shaper applies the 7-day window.
    const pr = await db(`employer_perks?or=(featured_until.gt.${encodeURIComponent(nowISO)},verified_until.gt.${encodeURIComponent(nowISO)},sponsor_until.gt.${encodeURIComponent(nowISO)})&select=company,featured_until,verified_until,sponsor_until,renewal_reminded_until&limit=500`);
    const perks = pr.ok ? await pr.json() : [];
    const due = pickRenewalReminders(perks, Date.now(), WINDOW_DAYS);

    let sent = 0, skipped = 0;
    for (const rem of due) {
      // Latest purchaser email for this company (perks.company is lowercased; ilike = case-insensitive exact).
      let to = null;
      try {
        const er = await db(`employer_purchases?company=ilike.${encodeURIComponent(rem.company)}&email=not.is.null&select=email&order=created_at.desc&limit=1`);
        if (er.ok) to = (await er.json())[0]?.email || null;
      } catch { /* fall through — no email */ }

      const ok = await sendReminderEmail(to, rem.company, rem.items);
      if (!ok) { skipped++; continue; } // no key / no email / send failed → leave un-marked so we retry next run
      // Mark this period reminded so we don't re-email until they renew (which changes reminderKey).
      await db(`employer_perks?company=eq.${encodeURIComponent(rem.company)}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ renewal_reminded_until: rem.reminderKey }),
      }).catch(() => {});
      sent++;
    }

    return res.status(200).json({ ok: true, checked: perks.length, due: due.length, sent, skipped });
  } catch (e) {
    console.error('[employer-renewals] error:', e?.message || e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
