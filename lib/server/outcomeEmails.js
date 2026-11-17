// Pure, testable logic for the Day-7/14/30 outcome follow-up email loop (Operation 50%,
// Engine E2). The impure cron (api/outcome-followups.js) handles DB reads, email sends, and the
// idempotency log; everything decidable without I/O lives here so it can be unit-tested:
//   - which milestone (if any) an application is due for, by age + current status
//   - the email subject/html/text for each milestone
//   - the HMAC unsubscribe token (one-click opt-out, no login)
//
// Dependency-free except node:crypto (a builtin) so it stays safe to import from any server path.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { escapeHtml } from './escapeHtml.js';

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

// ── One-click unsubscribe token (HMAC over the list + uid) ──────────────────────────────────
// Each email list has its own token, so a job-match unsubscribe link can never be replayed to stop
// the outcome check-ins (or the reverse). 'outcome' keeps the exact bytes older emails were signed with.
export const UNSUB_LISTS = ['outcome', 'job_matches'];

export function unsubToken(uid, secret, list = 'outcome') {
  return createHmac('sha256', String(secret || '')).update(`${list}:${uid}`).digest('hex');
}

export function verifyUnsub(uid, token, secret, list = 'outcome') {
  if (!uid || !token || !UNSUB_LISTS.includes(list)) return false;
  const expected = unsubToken(uid, secret, list);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(token), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The tracker URL that opens one application card: /tracker?app=<id> (falls back to /tracker). */
export function trackerAppUrl(site, appId) {
  const base = `${String(site || 'https://seenjobs.io').replace(/\/+$/, '')}/tracker`;
  return appId ? `${base}?app=${encodeURIComponent(String(appId))}` : base;
}

// Text and attribute values alike (the links sit inside href="…"), so quotes are escaped too.
const esc = escapeHtml;

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
      body: `Two weeks in on your ${co} application. Did it move forward to a screen or interview, or has it gone quiet? If you got an interview, mark it on the card — Seen then shows what happened to other people who interviewed at ${co}, and when to follow up.`,
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
 * @param {Object} links - { reportUrl (the button: the application's tracker card), unsubUrl }
 * @returns {{ subject: string, html: string, text: string }}
 */
export function buildEmail(app, day, links = {}) {
  const company = app?.company || '';
  const role = app?.role || '';
  const { kicker, heading, body, cta } = milestoneCopy(day, company);
  const reportUrl = links.reportUrl || trackerAppUrl('https://seenjobs.io', app?.id);
  const unsubUrl = links.unsubUrl || 'https://seenjobs.io/api/unsubscribe';
  const subject =
    day === 7 ? `Did ${company || 'they'} get back to you?`
    : day === 14 ? `Any word from ${company || 'them'}?`
    : `What happened with ${company || 'your application'}?`;

  const roleLine = role && company ? `${esc(role)} at ${esc(company)}` : esc(role || company);
  const html = emailLayout({ kicker, heading, roleLine, body, cta, url: reportUrl, unsubUrl,
    note: 'Every outcome you log — good or bad — becomes real data other applicants can see before they apply. That\'s the whole point of Seen.' });
  const text = `${heading}\n\n${body}\n\n${cta}: ${reportUrl}\n\nStop these check-ins: ${unsubUrl}`;

  return { subject, html, text };
}

/** The one email layout (Seen's light email card): kicker, heading, an optional role line, the body, one button,
 *  a grey note and the unsubscribe line. Every value is escaped here. */
function emailLayout({ kicker, heading, roleLine = '', body, cta, url, unsubUrl, note }) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
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
    <a href="${esc(url)}" style="display:inline-block;padding:13px 26px;font-size:14px;font-weight:700;color:#fff;text-decoration:none;border-radius:8px;">${esc(cta)} →</a>
  </td></tr></table>
  <div style="background:#f0f0f4;border-radius:8px;padding:14px 18px;font-size:12px;color:#555;line-height:1.65;margin-top:26px;">
    ${esc(note)}
  </div>
</td></tr>
<tr><td align="center" style="padding-top:20px;font-size:11px;color:#aaa;line-height:1.8">
  Seen · <a href="https://seenjobs.io" style="color:#aaa">seenjobs.io</a><br/>
  <a href="${esc(unsubUrl)}" style="color:#aaa;text-decoration:underline">Stop these check-ins</a>
</td></tr>
</table></td></tr></table>
</body></html>`;
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Thu, Nov 19" for a YYYY-MM-DD day. */
function dayLabel(day) {
  const [y, m, d] = String(day || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  return `${WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${MO[m - 1]} ${d}`;
}

/**
 * The hiring-event emails ("I'm going" on a listing — lib/tracker/eventPlan.js): `eve` the day before, `after` from
 * the day after while "How did it go?" is unanswered. Facts only from the plan the posting gave (label, day, hours,
 * place); the button opens the application on the tracker.
 * @param {{ id, company, role }} app
 * @param {'eve'|'after'} kind
 * @param {{ label: string, day: string, time?: string|null, where?: string|null, virtual?: boolean }} plan — `day` is YYYY-MM-DD
 * @param {{ reportUrl?: string, unsubUrl?: string }} links
 */
export function buildEventEmail(app, kind, plan, links = {}) {
  const company = app?.company || 'the employer';
  const label = String(plan?.label || 'Hiring event');
  const lower = label.toLowerCase();
  const url = links.reportUrl || trackerAppUrl('https://seenjobs.io', app?.id);
  const unsubUrl = links.unsubUrl || 'https://seenjobs.io/api/unsubscribe';
  const when = [dayLabel(plan?.day), plan?.time, plan?.virtual ? 'virtual' : plan?.where].filter(Boolean).join(' · ');
  const copy = kind === 'eve'
    ? {
        subject: `Tomorrow: ${label} at ${company}`,
        kicker: 'Tomorrow',
        heading: `${label} at ${company} is tomorrow`,
        body: `${when ? when + '. ' : ''}Check the posting before you go for what to bring and whether you need to RSVP.`,
        cta: 'Open it on your tracker',
        note: 'After the event, one tap on your tracker says how it went. It shows the next applicant what this employer\'s events lead to.',
      }
    : {
        subject: `How did the ${lower} at ${company} go?`,
        kicker: `${label} check-in`,
        heading: `How did the ${lower} at ${company} go?`,
        body: `One tap on your tracker: got an offer, interviewed and waiting, went with nothing yet, or didn't go.${when ? ` (${when})` : ''}`,
        cta: 'Answer on your tracker',
        note: 'Every answer — good or bad — becomes real data other applicants can see before they go. That\'s the whole point of Seen.',
      };
  const roleLine = app?.role && app?.company ? `${esc(app.role)} at ${esc(app.company)}` : '';
  const html = emailLayout({ ...copy, roleLine, url, unsubUrl });
  const text = `${copy.heading}\n\n${copy.body}\n\n${copy.cta}: ${url}\n\nStop these check-ins: ${unsubUrl}`;
  return { subject: copy.subject, html, text };
}
