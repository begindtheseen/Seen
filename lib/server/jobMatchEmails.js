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
// The bar is deliberately higher than the /jobs rail's (which shows family matches too): an email
// interrupts someone, so it goes out only when the listing's title carries a role the résumé
// itself names (a whole role phrase, not just the same field) and is not a different field that
// happens to share the words, it is near them or remote, it is
// live, they have not applied to it, saved it, or been emailed about it, and the employer is not
// graded D or F on Seen.

import { gradeLetter, GRADE_BANDS } from '../gradeScale.js';
import { isGradeable } from './reportCounts.js';
import { displayCompanyName } from '../companyNames.js';

export const MAX_PER_DAY = 2;
export const MIN_GAP_HOURS = 4;
/** resumeMatchStrength ≥ 20 ⇔ the title carries a résumé role phrase whole. */
export const MIN_STRENGTH = 20;
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
 * The single best listing to email about right now, or null.
 *
 * @param {Array<object>} ranked findResumeMatches(...).ranked (best first; rows carry _strength etc.)
 * @param {{
 *   emailedKeys?: Set<string>, emailedJobIds?: Set<string>, appliedJobIds?: Set<string>,
 *   appliedKeys?: Set<string>, savedJobIds?: Set<string>, companiesToday?: Set<string>,
 *   scores?: Map<string, object>,
 * }} ctx  appliedKeys / companiesToday use jobKey / companyScoreKey forms.
 */
export function pickBestMatch(ranked, ctx = {}) {
  const has = (set, v) => !!set && set.has(v);
  const candidates = [];
  for (const job of Array.isArray(ranked) ? ranked : []) {
    if (!job?.id || !job.title || !job.company) continue;           // needs a Seen page to link to
    if ((job._strength || 0) < MIN_STRENGTH) continue;               // a role the résumé names
    if (job._family === 'other') continue;                           // same words, different field
    const key = jobKey(job);
    const id = String(job.id);
    const co = companyScoreKey(job.company);
    if (has(ctx.emailedKeys, key) || has(ctx.emailedJobIds, id)) continue;
    if (has(ctx.appliedJobIds, id) || has(ctx.appliedKeys, key)) continue;
    if (has(ctx.savedJobIds, id)) continue;
    if (has(ctx.companiesToday, co)) continue;                       // two different employers a day
    const verdict = companyVerdict(ctx.scores?.get(co));
    if (verdict && verdict.score < MIN_GRADE_SCORE) continue;        // never invite to a D or F employer
    // A well-graded employer edges ahead of an equal match; an ungraded one is not penalised.
    const base = verdict ? String(verdict.letter).charAt(0) : '';
    const bonus = base === 'A' ? 8 : base === 'B' ? 4 : 0;
    candidates.push({ job, verdict, rank: (job._matchScore || 0) + bonus });
  }
  candidates.sort((a, b) => b.rank - a.rank);
  return candidates[0] || null;
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

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const titleCase = (s) => String(s || '').replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** Plain-language reasons, each one a fact Seen checked. */
export function matchReasons(job, { city = null, verdict = null } = {}) {
  const out = [];
  if (job?._phrase) out.push(`Your résumé lists ${titleCase(job._phrase)} experience`);
  // A remote listing already says "Remote" on its location line; only distance is a reason.
  if (job?._remote) { /* shown as the location */ }
  else if (Number.isFinite(job?._miles)) out.push(job._miles <= 1 ? `In ${cityName(city)}` : `${job._miles} miles from ${cityName(city)}`);
  else if (city) out.push(`Near ${cityName(city)}`);
  if (verdict) {
    out.push(verdict.responsePct != null
      ? `${verdict.letter} on Seen · ${verdict.responsePct}% of applicants hear back`
      : `${verdict.letter} on Seen`);
  }
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
const cityName = (city) => String(city || 'you').split(',')[0].trim().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/**
 * @param {{ job: object, verdict?: object|null, city?: string|null, applyUrl: string, unsubUrl: string, companyPageUrl?: string|null }} p
 * @returns {{ subject: string, html: string, text: string }}
 */
export function buildJobMatchEmail({ job, verdict = null, city = null, applyUrl, unsubUrl, companyPageUrl = null }) {
  const company = displayCompanyName(job.company) || job.company;
  const title = String(job.title || '').trim();
  const reasons = matchReasons(job, { city, verdict });
  const where = job._remote ? 'Remote' : String(job.location || '').trim();
  const pay = String(job.salary || '').trim();
  const subject = `${shortTitle(title)} at ${company} matches your résumé`;

  const facts = [where, pay].filter(Boolean).map(esc).join(' · ');
  const reasonRows = reasons.map((r) => `<tr><td style="padding:3px 0;font-size:13px;color:#333;line-height:1.5">✓&nbsp; ${esc(r)}</td></tr>`).join('');
  const companyLink = companyPageUrl
    ? `<p style="margin:18px 0 0;font-size:12px;color:#666;line-height:1.6">See what applicants report about ${esc(company)} before you apply: <a href="${esc(companyPageUrl)}" style="color:#111">${esc(company)} on Seen</a></p>`
    : '';

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:48px 24px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
<tr><td align="center" style="padding-bottom:28px;">
  <span style="font-size:18px;font-weight:800;color:#111;letter-spacing:-0.03em">Seen</span>
</td></tr>
<tr><td style="background:#fff;border:1px solid #e0e0e8;border-radius:12px;padding:36px 32px;">
  <p style="margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#888">A job that matches your résumé</p>
  <h1 style="margin:0 0 6px;font-size:22px;font-weight:700;color:#111;line-height:1.25">${esc(title)}</h1>
  <p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#333">${esc(company)}</p>
  ${facts ? `<p style="margin:0 0 18px;font-size:13px;color:#777">${facts}</p>` : '<div style="height:14px"></div>'}
  ${reasonRows ? `<table cellpadding="0" cellspacing="0" style="margin:0 0 24px">${reasonRows}</table>` : ''}
  <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:#111;">
    <a href="${esc(applyUrl)}" style="display:inline-block;padding:13px 26px;font-size:14px;font-weight:700;color:#fff;text-decoration:none;border-radius:8px;">View and apply on Seen →</a>
  </td></tr></table>
  ${companyLink}
</td></tr>
<tr><td align="center" style="padding-top:20px;font-size:11px;color:#999;line-height:1.8">
  You get at most ${MAX_PER_DAY} of these a day, only when a live listing matches the résumé on your Seen account.<br/>
  Update your résumé on Seen and the next matches follow it.<br/>
  Seen · <a href="https://seenjobs.io" style="color:#999">seenjobs.io</a> · <a href="${esc(unsubUrl)}" style="color:#999;text-decoration:underline">Stop job match emails</a>
</td></tr>
</table></td></tr></table>
</body></html>`;

  const text = [
    'A job that matches your résumé',
    '',
    `${title}`,
    `${company}${facts ? ` · ${[where, pay].filter(Boolean).join(' · ')}` : ''}`,
    '',
    ...reasons.map((r) => `- ${r}`),
    '',
    `View and apply on Seen: ${applyUrl}`,
    companyPageUrl ? `What applicants report about ${company}: ${companyPageUrl}` : '',
    '',
    `You get at most ${MAX_PER_DAY} of these a day, only when a live listing matches the résumé on your Seen account. Update your résumé and the next matches follow it.`,
    `Stop job match emails: ${unsubUrl}`,
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');

  return { subject, html, text };
}
