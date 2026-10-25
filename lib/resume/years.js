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
