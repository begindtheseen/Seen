// Transactional employer emails (claims). Key-activated via RESEND_KEY (or RESEND_API_KEY) — a
// silent no-op when neither is set, so CI/previews and un-configured environments never fail and
// never send. Mirrors the best-effort Resend pattern in lib/server/employerFulfillment.js.
//
// These are the "your claim is live" notifications for the ADMIN-APPROVED CLAIMS model (migration
// 053): sent when a claim is approved — instantly on a work-email domain match, or later when an
// admin approves a manual request. Sending never blocks the claim; a failure is swallowed.

const DASHBOARD_URL = 'https://seenjobs.io/employers/dashboard';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function resendKey() {
  return process.env.RESEND_KEY || process.env.RESEND_API_KEY || '';
}

/**
 * Notify an employer that their company claim is approved and their dashboard is scoped to them.
 * `auto` distinguishes the instant work-email path from a manual admin approval, only in copy.
 * Returns { ok } / { skipped } — best-effort, never throws.
 */
export async function sendClaimApprovedEmail({ to, company, auto = false } = {}) {
  const KEY = resendKey();
  if (!KEY || !to || !company) return { ok: false, skipped: true };
  const display = esc(company);
  const lead = auto
    ? `We matched your work email to <strong>${display}</strong>, so your claim is approved automatically — no waiting.`
    : `Your claim for <strong>${display}</strong> has been approved.`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Seen <noreply@seenjobs.io>',
        to: [to],
        subject: `You now manage ${company} on Seen`,
        html: `<div style="font-family:-apple-system,sans-serif;font-size:14px;color:#111;line-height:1.7">
          <p>${lead}</p>
          <p>Your dashboard, analytics, and posting updates are now scoped to your company. From here you can post roles, see the outcomes candidates reported about you, and dispute anything inaccurate.</p>
          <p><a href="${DASHBOARD_URL}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:700">Open your dashboard →</a></p>
          <p style="color:#666;font-size:12px">Reputation on Seen is candidate-reported and money never changes a transparency score — claiming your company lets you respond and post, not edit your grade.</p>
        </div>`,
      }),
    });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}
