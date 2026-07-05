// Pure, testable logic for the Day-7/14/30 outcome follow-up email loop (Operation 50%,
// Engine E2). The impure cron (api/outcome-followups.js) handles DB reads, email sends, and the
// idempotency log; everything decidable without I/O lives here so it can be unit-tested:
//   - which milestone (if any) an application is due for, by age + current status
//   - the email subject/html/text for each milestone
//   - the HMAC unsubscribe token (one-click opt-out, no login)
//
// Dependency-free except node:crypto (a builtin) so it stays safe to import from any server path.

import { createHmac, timingSafeEqual } from 'node:crypto';

const DAY_MS = 86400e3;

// Milestones, in the order the playbook Follow-Up System defines them.
export const MILESTONES = [7, 14, 30];

// Statuses that mean the outcome is already known — never nag these. Anything else (active,
// applied, screening, interview, null/unknown) is still "waiting" and worth a nudge.
const RESOLVED_STATUSES = new Set(['hired', 'rejected', 'ghosted', 'withdrawn', 'offer']);

export function isWaiting(app) {
  const s = (app?.status || '').toLowerCase();
  return !RESOLVED_STATUSES.has(s);
}

// Age of an application in whole days, anchored on applied_at, falling back to created_at.
// Returns null when neither timestamp is usable (never guess an age).
export function ageDays(app, nowMs = Date.now()) {
  const raw = app?.applied_at || app?.created_at;
  if (!raw) return null;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return null;
  return Math.floor((nowMs - t) / DAY_MS);
}

// Highest milestone an age has reached (30 ≥ 14 ≥ 7), or null if under 7 days.
export function milestoneForAge(age) {
  if (age == null) return null;
  if (age >= 30) return 30;
  if (age >= 14) return 14;
  if (age >= 7) return 7;
  return null;
}

// The single milestone this application is currently due for, or null. The cron still checks the
// idempotency log before sending — this only decides eligibility by age + status.
export function dueMilestone(app, nowMs = Date.now()) {
  if (!isWaiting(app)) return null;
  return milestoneForAge(ageDays(app, nowMs));
}

// ── One-click unsubscribe token (HMAC over the uid) ─────────────────────────────────────────
export function unsubToken(uid, secret) {
  return createHmac('sha256', String(secret || '')).update(`outcome:${uid}`).digest('hex');
}

export function verifyUnsub(uid, token, secret) {
  if (!uid || !token) return false;
  const expected = unsubToken(uid, secret);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(token), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Milestone copy — one honest question each, matching the Follow-Up System in CLAUDE.md.
function milestoneCopy(day, company) {
  const co = company || 'that company';
  if (day === 7) {
    return {
      kicker: 'Day 7 check-in',
      heading: `Did ${co} respond yet?`,
      body: `It's been about a week since you applied to ${co}. Did you hear anything back — even an auto-reply or a rejection?`,
      cta: 'Update this application',
    };
  }
  if (day === 14) {
    return {
      kicker: 'Day 14 check-in',
      heading: `Any interview with ${co}?`,
      body: `Two weeks in on your ${co} application. Did it move forward to a screen or interview, or has it gone quiet?`,
      cta: 'Log what happened',
    };
  }
  return {
    kicker: 'Day 30 check-in',
    heading: `What happened with ${co}?`,
    body: `It's been a month since you applied to ${co}. However it went — offer, rejection, or total silence — logging it takes 30 seconds and helps the next applicant see the truth about ${co}.`,
    cta: 'Report the outcome',
  };
}

/**
 * Build the follow-up email for one application + milestone.
 * @param {Object} app - { id, company, role }
 * @param {number} day - 7 | 14 | 30
 * @param {Object} links - { reportUrl, unsubUrl }
 * @returns {{ subject: string, html: string, text: string }}
 */
export function buildEmail(app, day, links = {}) {
  const company = app?.company || '';
  const role = app?.role || '';
  const { kicker, heading, body, cta } = milestoneCopy(day, company);
  const reportUrl = links.reportUrl || 'https://seenjobs.io/report';
  const unsubUrl = links.unsubUrl || 'https://seenjobs.io/api/unsubscribe';
  const subject =
    day === 7 ? `Did ${company || 'they'} get back to you?`
    : day === 14 ? `Any word from ${company || 'them'}?`
    : `What happened with ${company || 'your application'}?`;

  const roleLine = role && company ? `${esc(role)} at ${esc(company)}` : esc(role || company);

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:48px 24px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
<tr><td align="center" style="padding-bottom:28px;">
  <span style="font-size:18px;font-weight:800;color:#111;letter-spacing:-0.03em">Seen</span>
</td></tr>
<tr><td style="background:#fff;border:1px solid #e0e0e8;border-radius:12px;padding:36px 32px;">
  <p style="margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#888">${esc(kicker)}</p>
  <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111;line-height:1.25">${esc(heading)}</h1>
  ${roleLine ? `<p style="margin:0 0 14px;font-size:13px;color:#999">${roleLine}</p>` : ''}
  <p style="margin:0 0 24px;font-size:14px;color:#555;line-height:1.7">${esc(body)}</p>
  <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:#111;">
    <a href="${reportUrl}" style="display:inline-block;padding:13px 26px;font-size:14px;font-weight:700;color:#fff;text-decoration:none;border-radius:8px;">${esc(cta)} →</a>
  </td></tr></table>
  <div style="background:#f0f0f4;border-radius:8px;padding:14px 18px;font-size:12px;color:#555;line-height:1.65;margin-top:26px;">
    Every outcome you log — good or bad — becomes real data other applicants can see before they apply. That's the whole point of Seen.
  </div>
</td></tr>
<tr><td align="center" style="padding-top:20px;font-size:11px;color:#aaa;line-height:1.8">
  Seen · <a href="https://seenjobs.io" style="color:#aaa">seenjobs.io</a><br/>
  <a href="${unsubUrl}" style="color:#aaa;text-decoration:underline">Stop these check-ins</a>
</td></tr>
</table></td></tr></table>
</body></html>`;

  const text = `${heading}\n\n${body}\n\n${cta}: ${reportUrl}\n\nStop these check-ins: ${unsubUrl}`;

  return { subject, html, text };
}
