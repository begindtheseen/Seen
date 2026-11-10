// How many years of experience a résumé SUPPORTS — the one place a "N+ years" claim is computed.
//
// 2026-10-25 (Tasha, Dev, Maria + the Pro-tools harness, 10 fixtures): summaries said
// "3+ years of experience" for a new grad whose only marketing job lasted 8 months, "8+ years" for
// Dev whose résumé says 6, "10+" for Maria whose résumé says 9, "12+" for a manager whose own
// summary says 9. experienceSpanYears counts from the first job of ANY kind to the latest end —
// the barista and campus jobs, the gaps between jobs, a line-cook job before a warehouse career.
//
// The rules here:
//   • months are counted once per calendar month, however many roles overlap in it;
//   • only the roles the caller says are relevant count (all roles when it says nothing);
//   • a number the résumé states itself ("6 years building payment systems", "two years of
//     customer-facing work") is a ceiling — a summary never claims more than the person did;
//   • under one full year, or with no dates, there is no number: the honest summary says none.
import { fromToken } from './parse/dates.js';
import { escapeRegExp } from '../text/escapeRegExp.js';
import { rolesFromText, resumeLineInfo, relevantExperienceYears } from '../optimizer/extractResumeFacts.js';

const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, twenty: 20 };

function monthOf(tok, now, end) {
  if (tok === 'present') return now.getUTCFullYear() * 12 + now.getUTCMonth();
  const d = fromToken(tok);
  if (!d || d === 'present') return null;
  // a bare year: the start counts from January, the end through December only when it is the
  // start year too — otherwise mid-year (unbiased)
  return d.y * 12 + (d.m ? d.m - 1 : (end ? 5 : 6));
}

/** Distinct calendar months covered by the given roles ({start, end} tokens). */
export function coveredMonths(roles, now = new Date()) {
  const spans = [];
  for (const e of roles || []) {
    if (!e || !e.start) continue;
    const s = monthOf(e.start, now, false);
    const en = monthOf(e.end || 'present', now, true);
    if (s == null || en == null || en < s) continue;
    spans.push([s, en]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  let total = 0, cs = null, ce = null;
  for (const [s, e] of spans) {
    if (ce == null || s > ce + 1) { if (ce != null) total += ce - cs + 1; cs = s; ce = e; }
    else ce = Math.max(ce, e);
  }
  if (ce != null) total += ce - cs + 1;
  return total;
}

/** The largest year count the text states about the person ("6 years", "9+ years", "two years"). */
export function statedYears(text) {
  const src = String(text || '');
  let best = null;
  const re = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty)\s*\+?\s*(?:years?|yrs?)\b(?!\s+old)/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    const n = /^\d/.test(m[1]) ? Number(m[1]) : WORD_NUM[m[1].toLowerCase()];
    if (n >= 1 && n <= 45) best = best == null ? n : Math.max(best, n);
  }
  return best;
}

/**
 * The year count a summary may state, or null.
 * @param {object} doc ResumeDoc (experience[] with start/end tokens, basics.summary)
 * @param {{ relevantIds?: Iterable<string>|null, now?: Date }} opts
 * @returns {{ years: number, computed: number, stated: number|null, basis: string } | null}
 */
export function supportedYears(doc, { relevantIds = null, now = new Date() } = {}) {
  const want = relevantIds ? new Set(relevantIds) : null;
  const roles = (doc.experience || []).filter((e) => !want || want.has(e.id));
  const months = coveredMonths(roles, now);
  const computed = Math.floor(months / 12);
  const stated = statedYears([doc.basics && doc.basics.summary, doc.basics && doc.basics.headline].filter(Boolean).join(' '));
  const years = stated != null ? Math.min(stated, computed) : computed;
  if (!(years >= 1)) return null;
  return { years, computed, stated, basis: want ? 'relevant roles' : 'all roles' };
}

/**
 * ONE years figure for a person, from résumé TEXT — the figure every tool prints (2026-11-10 judge, prep D12: the fit
 * check said 8.1, the paid summary "6+", Prep "I have 6 years" for the same résumé).
 *
 *   careerYears(resumeText) → {
 *     dated:   number — calendar months covered by dated roles ÷ 12, each month once (the fit check's figure);
 *     whole:   integer — floor(dated), for "N+ years" phrasing (0 under one full year);
 *     stated:  number|null — the largest "N years" the summary/headline states about the person;
 *     display: string — "8.1 years" (or "under a year" / "" with no dates);
 *     note:    string|null — set when stated and dated differ by ≥ 1 year: say it once, plainly;
 *     relevantTo(domainStems, { jobFamily }) → number — years in roles that name the domain (or share the job family).
 *   }
 * Prefer `dated` when printing a figure; `stated` is never a floor for a claim (supportedYears keeps it a ceiling).
 */
export function careerYears(resumeText, { now = new Date() } = {}) {
  const text = String(resumeText || '');
  const roles = rolesFromText(text);
  const spans = roles.filter((r) => r.from != null && r.to != null && r.to >= r.from).map((r) => [r.from, Math.min(r.to, now.getFullYear() * 12 + now.getMonth())]).sort((a, b) => a[0] - b[0]);
  let months = 0, cs = null, ce = null;
  for (const [s, e] of spans) {
    if (ce == null || s > ce + 1) { if (ce != null) months += ce - cs + 1; cs = s; ce = e; }
    else ce = Math.max(ce, e);
  }
  if (ce != null) months += ce - cs + 1;
  const dated = Math.round((months / 12) * 10) / 10;
  // the summary / headline: the lines before the first section of jobs
  const top = resumeLineInfo(text).filter((l) => l.kind === 'summary' || (l.section === 'header' && l.text && l.text.length > 25)).map((l) => l.text).join(' ');
  const stated = statedYears(top);
  const display = dated >= 1 ? `${dated} years` : dated > 0 ? 'under a year' : '';
  // "12+ years" with 14 years of dates is consistent; only a figure the dates do not match is worth a word
  const plus = stated != null && new RegExp(`\\b${escapeRegExp(String(stated))}\\s*\\+`).test(top);
  const off = stated != null && dated >= 1 && (plus ? stated - dated >= 1 : Math.abs(stated - dated) >= 1);
  const note = off
    ? `Your summary says ${stated} year${stated === 1 ? '' : 's'}; the dates on your jobs add up to ${dated}. Say which work the ${stated} years count, or make the two agree.`
    : null;
  return {
    dated, whole: Math.floor(dated), stated, display, note,
    relevantTo: (domainStems, opts = {}) => Math.round(relevantExperienceYears(text, domainStems || [], opts).years * 10) / 10,
  };
}
