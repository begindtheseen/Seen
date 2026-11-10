// Job-match emails (owner request 2026-10-24): "If there is a job listing that matches someone's
// resume send them an email inviting them to apply. Give them the Seen link to apply. Up to 2
// emails a day so it has to be the best options on the table. If they change their resume, Seen
// will look for new listings."
//
// Pure, testable logic. The cron (api/cron-job-matches.js) does the reads, the claim, and the send.
//   - pickBestMatch: the ONE listing worth an email right now, or null (most runs send nothing new)
//   - buildJobMatchEmail: subject / html / text
//   - limits: at most MAX_PER_DAY a California day, at least MIN_GAP_HOURS apart
//
// Rebuilt 2026-11-10 (owner: "the recommended job emails should be spot on and pull from her resume and
// from her recently applied to jobs"): the rows come from the SAME matcher as the /jobs rail
// (lib/server/resumeMatches.js → lib/server/jobKeys.js matchListing), so every row already passed the
// field, years, licence, level and place rules and carries `_reason` — the sentence that says why, built
// from her résumé or her applications. A row without a reason is never emailed. On top of that an email
// needs: a Seen page to link to, not applied to / saved / emailed before, a different employer from
// today's other email, and an employer not graded D or F on Seen.

import { gradeLetter, GRADE_BANDS } from '../gradeScale.js';
import { isGradeable } from './reportCounts.js';
import { displayCompanyName } from '../companyNames.js';
import { alertHeadline, alertJobPhrase } from './jobAlerts.js';
import { escapeHtml } from './escapeHtml.js';

export const MAX_PER_DAY = 2;
export const MIN_GAP_HOURS = 4;
/** At most this many more matches ride under the main one in a résumé email (other employers). */
export const MORE_ITEMS = 2;
/** Employers graded below this (D and F) are never emailed about: the bottom of the C band. */
export const MIN_GRADE_SCORE = GRADE_BANDS.find((b) => b.letter === 'C-').min;

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The listing's identity for "never the same job twice": the same role at the same company, from any source. */
export function jobKey(job) {
  return `${norm(job?.title)}|${norm(job?.company)}`.slice(0, 300);
}

/** company_scores is keyed by the lowercased stored name. */
export const companyScoreKey = (name) => String(name || '').toLowerCase().trim();

/**
 * The employer's public verdict for this email, only when Seen shows one on the company page.
 * @returns {{ letter: string, score: number, responsePct: number|null }|null}
 */
export function companyVerdict(scoreRow) {
  if (!scoreRow || !isGradeable(scoreRow)) return null;
  const score = Number(scoreRow.overall_score);
  if (!Number.isFinite(score)) return null;
  const rr = Number(scoreRow.response_rate);
  return { letter: gradeLetter(score), score, responsePct: Number.isFinite(rr) ? Math.round(rr * 100) : null };
}

/**
 * The best listing to email about right now (plus up to MORE_ITEMS more from other employers), or null.
 *
 * @param {Array<object>} ranked findResumeMatches(...).ranked (best first; rows carry _reason, _matchScore)
 * @param {{
 *   emailedKeys?: Set<string>, emailedJobIds?: Set<string>, appliedJobIds?: Set<string>,
 *   appliedKeys?: Set<string>, savedJobIds?: Set<string>, companiesToday?: Set<string>,
 *   scores?: Map<string, object>, alertMode?: boolean,
 * }} ctx  appliedKeys / companiesToday use jobKey / companyScoreKey forms. alertMode: the rows
 *   come from the person's own job alerts (lib/server/jobAlerts.js); they carry no résumé reason.
 * @returns {{ job: object, verdict: object|null, more: Array<{ job: object, verdict: object|null }> }|null}
 */
export function pickBestMatch(ranked, ctx = {}) {
  const has = (set, v) => !!set && set.has(v);
  const candidates = [];
  for (const job of Array.isArray(ranked) ? ranked : []) {
    if (!job?.id || !job.title || !job.company) continue;           // needs a Seen page to link to
    if (!ctx.alertMode && !String(job._reason || '').trim()) continue; // no reason from her résumé → never sent
    const key = jobKey(job);
    const id = String(job.id);
    const co = companyScoreKey(job.company);
    if (has(ctx.emailedKeys, key) || has(ctx.emailedJobIds, id)) continue;
    if (has(ctx.appliedJobIds, id) || has(ctx.appliedKeys, key)) continue;
    if (has(ctx.savedJobIds, id)) continue;
    if (has(ctx.companiesToday, co)) continue;                       // two different employers a day
    const verdict = companyVerdict(ctx.scores?.get(co));
    if (verdict && verdict.score < MIN_GRADE_SCORE) continue;        // never invite to a D or F employer
    // The rail's order is kept exactly: the email is the top of the same ranked list (no grade bonus).
    candidates.push({ job, verdict });
  }
  if (!candidates.length) return null;
  const [top, ...rest] = candidates;
  const more = [];
  const cos = new Set([companyScoreKey(top.job.company)]);
  if (!ctx.alertMode) {
    for (const c of rest) {
      if (more.length >= MORE_ITEMS) break;
      const co = companyScoreKey(c.job.company);
      if (cos.has(co)) continue;
      cos.add(co);
      more.push({ job: c.job, verdict: c.verdict });
    }
  }
  return { job: top.job, verdict: top.verdict, more };
}

/** Can this user get another job-match email now? sentToday = sends since the California day began. */
export function canSendNow({ sentToday = 0, lastSentAt = null }, nowMs = Date.now()) {
  if (sentToday >= MAX_PER_DAY) return false;
  if (lastSentAt) {
    const t = Date.parse(lastSentAt);
    if (Number.isFinite(t) && nowMs - t < MIN_GAP_HOURS * 3600e3) return false;
  }
  return true;
}

const esc = escapeHtml;

/** "Norwalk" from "Norwalk, CA" / "Culver City, Los Angeles County". */
const cityName = (city) => String(city || 'you').split(',')[0].trim().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** Where the listing is, said once: "Remote", "In Norwalk", "6 miles from Norwalk", or its location text. */
export function whereLine(job, city) {
  if (job?._remote) return 'Remote';
  const loc = String(job?.location || '').trim();
  if (Number.isFinite(job?._miles) && city) {
    const place = cityName(loc) || loc;
    return job._miles <= 1 ? `${place}` : `${place} · ${job._miles} miles from ${cityName(city)}`;
  }
  return loc;
}

/** The grade line, only when Seen shows a public grade. */
function verdictLine(verdict) {
  if (!verdict) return null;
  return verdict.responsePct != null
    ? `${verdict.letter} on Seen · ${verdict.responsePct}% of applicants hear back`
    : `${verdict.letter} on Seen`;
}

/**
 * Plain-language reasons, each one a fact Seen checked. Résumé mode: the match reason (from her résumé
 * or applications) first, then the grade. Alert mode: the alert, the distance, the grade.
 */
export function matchReasons(job, { city = null, verdict = null, alert = null } = {}) {
  const out = [];
  if (alert) {
    out.push(`Matches your job alert “${String(alert.keywords || '').trim()}”${alert.remote ? ' · remote' : ''}`);
    if (!alert.remote) {
      out.push(Number.isFinite(job?._miles)
        ? (job._miles <= 1 ? `In ${cityName(alert.place)}` : `${job._miles} miles from ${alert.place}`)
        : `Within ${alert.miles} miles of ${alert.place}`);
    }
    const v = verdictLine(verdict);
    if (v) out.push(v);
    return out;
  }
  if (job?._reason) out.push(String(job._reason).trim());
  const v = verdictLine(verdict);
  if (v) out.push(v);
  return out;
}

/**
 * A title short enough for a subject line: drops "(Part-Time)", "- Biltmore Fashion Park" style tails
 * when the title is long, and never cuts a word in half.
 */
export function shortTitle(title, max = 48) {
  let t = String(title || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  t = t.replace(/\s*\([^)]*\)/g, '').trim();
  t = t.split(/\s+[-–—|,]\s+/)[0].trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 12)).trim()}…`;
}

/** Subject for a résumé match: role, employer and city, nothing promised. */
export function resumeSubject(job) {
  const company = displayCompanyName(job.company) || job.company;
  const place = job._remote ? 'remote' : cityName(job.location);
  return `${shortTitle(job.title, 44)} at ${company}${place && place !== 'You' ? `, ${place}` : ''}`;
}

/**
 * @param {{ job: object, verdict?: object|null, city?: string|null, applyUrl: string, unsubUrl: string,
 *   companyPageUrl?: string|null, alert?: object|null, settingsUrl?: string|null,
 *   more?: Array<{ job: object, verdict?: object|null, url: string }> }} p
 *   alert: the job alert this listing matched (alerts mode); the email then speaks about the alert,
 *   never the résumé. more: other matches from other employers (résumé mode), each with its Seen link.
 * @returns {{ subject: string, html: string, text: string }}
 */
export function buildJobMatchEmail({ job, verdict = null, city = null, applyUrl, unsubUrl, companyPageUrl = null, alert = null, settingsUrl = null, more = [] }) {
  const company = displayCompanyName(job.company) || job.company;
  const title = String(job.title || '').trim();
  const reasons = matchReasons(job, { city, verdict, alert });
  const where = alert ? (job._remote ? 'Remote' : String(job.location || '').trim()) : whereLine(job, city);
  const pay = String(job.salary || '').trim();
  const extra = alert ? [] : (Array.isArray(more) ? more : []).filter((m) => m?.job && m.url && m.job._reason);
  const subject = alert
    ? `New ${alertJobPhrase(alert)}: ${shortTitle(title, 40)} at ${company}`
    : resumeSubject(job);
  const fromApplied = job?._basis === 'applied';
  const eyebrow = alert ? `Your job alert: ${alertHeadline(alert)}` : (fromApplied ? 'Picked from the jobs you applied to' : 'Picked from your résumé');
  const footA = alert
    ? `You get at most ${MAX_PER_DAY} of these a day, only for new listings that match the job alerts in your Seen settings.`
    : `You get at most ${MAX_PER_DAY} of these a day. Seen sends one only when a live listing near you fits the jobs on your résumé or the ones you applied to in the last 60 days, and you meet what it asks for.`;
  const footB = alert ? 'Change your alerts in Settings on Seen' : 'Update your résumé on Seen and the next picks follow it.';

  const facts = [where, pay].filter(Boolean).map(esc).join(' · ');
  const reasonRows = reasons.map((r, i) => `<tr><td style="padding:3px 0;font-size:${i === 0 && !alert ? 14 : 13}px;color:${i === 0 && !alert ? '#111' : '#333'};line-height:1.5">${alert ? '✓&nbsp; ' : ''}${esc(r)}</td></tr>`).join('');
  const companyLink = companyPageUrl
    ? `<p style="margin:18px 0 0;font-size:12px;color:#666;line-height:1.6">See what applicants report about ${esc(company)} before you apply: <a href="${esc(companyPageUrl)}" style="color:#111">${esc(company)} on Seen</a></p>`
    : '';
  const moreHtml = extra.length
    ? `<p style="margin:26px 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#888">Also a fit</p>${extra.map((m) => {
      const co = displayCompanyName(m.job.company) || m.job.company;
      const w = whereLine(m.job, city);
      return `<p style="margin:0 0 14px;font-size:13px;line-height:1.5;color:#333"><a href="${esc(m.url)}" style="color:#111;font-weight:700;text-decoration:none">${esc(String(m.job.title || '').trim())}</a><br/>${esc(co)}${w ? ` · ${esc(w)}` : ''}${m.job.salary ? ` · ${esc(String(m.job.salary))}` : ''}<br/><span style="color:#555">${esc(String(m.job._reason))}</span></p>`;
    }).join('')}`
    : '';

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:48px 24px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
<tr><td align="center" style="padding-bottom:28px;">
  <span style="font-size:18px;font-weight:800;color:#111;letter-spacing:-0.03em">Seen</span>
</td></tr>
<tr><td style="background:#fff;border:1px solid #e0e0e8;border-radius:12px;padding:36px 32px;">
  <p style="margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#888">${esc(eyebrow)}</p>
  <h1 style="margin:0 0 6px;font-size:22px;font-weight:700;color:#111;line-height:1.25">${esc(title)}</h1>
  <p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#333">${esc(company)}</p>
  ${facts ? `<p style="margin:0 0 18px;font-size:13px;color:#777">${facts}</p>` : '<div style="height:14px"></div>'}
  ${reasonRows ? `<table cellpadding="0" cellspacing="0" style="margin:0 0 24px">${reasonRows}</table>` : ''}
  <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:#111;">
    <a href="${esc(applyUrl)}" style="display:inline-block;padding:13px 26px;font-size:14px;font-weight:700;color:#fff;text-decoration:none;border-radius:8px;">View and apply on Seen →</a>
  </td></tr></table>
  ${companyLink}
  ${moreHtml}
</td></tr>
<tr><td align="center" style="padding-top:20px;font-size:11px;color:#999;line-height:1.8">
  ${esc(footA)}<br/>
  ${alert && settingsUrl ? `<a href="${esc(settingsUrl)}" style="color:#999;text-decoration:underline">${esc(footB)}</a>` : esc(footB)}<br/>
  Seen · <a href="https://seenjobs.io" style="color:#999">seenjobs.io</a> · <a href="${esc(unsubUrl)}" style="color:#999;text-decoration:underline">Stop job match emails</a>
</td></tr>
</table></td></tr></table>
</body></html>`;

  const text = [
    eyebrow,
    '',
    `${title}`,
    `${company}${facts ? ` · ${[where, pay].filter(Boolean).join(' · ')}` : ''}`,
    '',
    ...reasons.map((r) => (alert ? `- ${r}` : r)),
    '',
    `View and apply on Seen: ${applyUrl}`,
    companyPageUrl ? `What applicants report about ${company}: ${companyPageUrl}` : '',
    ...(extra.length ? ['', 'Also a fit:', ...extra.flatMap((m) => {
      const co = displayCompanyName(m.job.company) || m.job.company;
      const w = whereLine(m.job, city);
      return [`- ${String(m.job.title || '').trim()} · ${co}${w ? ` · ${w}` : ''}`, `  ${m.job._reason}`, `  ${m.url}`];
    })] : []),
    '',
    alert
      ? `${footA} ${footB}${settingsUrl ? `: ${settingsUrl}` : '.'}`
      : `${footA} ${footB}`,
    `Stop job match emails: ${unsubUrl}`,
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');

  return { subject, html, text };
}
