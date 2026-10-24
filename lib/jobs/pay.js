// Pay as the LISTING states it.
//
// Adzuna normalises every employer-stated wage to a yearly figure, so a posting whose own text says
// "Hourly Wage: $16 – $29" arrived as salary_min 33,280 and Seen printed a "$33k" salary tile next
// to that sentence (live audit 2026-10-23, iPhone). Prod 2026-10-24: 667 active Adzuna rows carry a
// "$NNk" salary beside hourly wording. Nothing here invents a number: `statedHourlyPay` returns the
// hourly figure only when the description itself states one, formatted the way Seen formats pay.
// Used at ingest (lib/server/jobSources.js adzunaPay) for new rows and at display time
// (`displayPay`) for the rows already stored.

const MONEY = '\\$\\s?(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{1,2})?)';
// "$16 – $29", "$16.80 - USD $19.50", "$30-50", "$16.90 to $17.50"
const RANGE = `${MONEY}(?:\\s*(?:-|–|—|to)\\s*(?:USD\\s*)?\\$?\\s?(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{1,2})?))?`;
const HOURLY_WORDS = '(?:per\\s+hour|an\\s+hour|/\\s?hr\\.?|/\\s?hour|hourly|hr\\b)';
// Money followed by an hourly word within a few characters: "$17.50 per hour", "$19/hour", "$40/hr",
// "Pay Range: $18.50 - $19 / hour", "$16.90 to $17.50 Hourly".
const AFTER_RE = new RegExp(`(?:USD\\s*)?${RANGE}\\s*(?:USD\\s*)?${HOURLY_WORDS}`, 'i');
// An hourly label before the money: "Hourly Wage: $16 – $29", "Hourly Pay Range: $25.36 - $38.04",
// "hourly base rate of $19", "hourly rate: $22".
const BEFORE_RE = new RegExp(`hourly\\s+(?:wage|pay|rate|base\\s+rate|compensation|range|pay\\s+range|salary)?\\s*(?:range)?\\s*(?:of|:|is|at|from|starting\\s+at)?\\s*(?:USD\\s*)?${RANGE}`, 'i');

const num = (s) => Number(String(s || '').replace(/,/g, ''));
// Hourly pay for a real job sits in this band; outside it the match was something else
// ("$1,500 sign-on … hourly", a yearly figure).
const MIN_HOURLY = 5;
const MAX_HOURLY = 400;

function fmtHourly(v) {
  const r = Math.round(v * 100) / 100;
  return `$${Number.isInteger(r) ? r : r.toFixed(2)}`;
}

/**
 * The hourly pay a listing's own text states: { lo, hi|null, text } with `text` as Seen formats pay
 * ("$16–$29/hr", "$17.50/hr"), or null when the text states no hourly figure.
 * @param {string} text the listing description (or any pay text)
 */
export function parseHourlyPay(text) {
  const t = String(text || '');
  if (!t || !/hour|hr\b|hourly/i.test(t)) return null;
  const candidates = [];
  for (const re of [AFTER_RE, BEFORE_RE]) {
    const m = t.match(re);
    if (m) candidates.push(m);
  }
  for (const m of candidates) {
    const lo = num(m[1]);
    const hi = m[2] != null ? num(m[2]) : null;
    if (!(lo >= MIN_HOURLY && lo <= MAX_HOURLY)) continue;
    if (hi != null && !(hi >= MIN_HOURLY && hi <= MAX_HOURLY)) continue;
    if (hi != null && hi > lo) return { lo, hi, text: `${fmtHourly(lo)}–${fmtHourly(hi)}/hr` };
    return { lo, hi: null, text: `${fmtHourly(lo)}/hr` };
  }
  return null;
}

/** `parseHourlyPay(text).text`, or null. */
export function statedHourlyPay(text) {
  return parseHourlyPay(text)?.text ?? null;
}

/** True for Seen's yearly formats: "$33k", "$57k–$80k". */
export function isYearlyPayText(salary) {
  return /^\$\d+k(?:\s*[–-]\s*\$\d+k)?$/.test(String(salary || '').trim());
}

// A full-time year of hourly pay — the factor aggregators annualise with (40 h × 52 wk).
export const HOURS_PER_YEAR = 2080;

/**
 * Is a yearly figure just this hourly wage annualised? Compared in thousands with the rounding a
 * "$33k" tile carries (±1k, or ±10% of the yearly figure when that is larger).
 * @param {number} yearly dollars per year
 * @param {number} hourly dollars per hour
 */
export function isAnnualisedFrom(yearly, hourly) {
  const y = Number(yearly), h = Number(hourly);
  if (!(y > 0) || !(h > 0)) return false;
  const yk = Math.round(y / 1000);
  const hk = Math.round((h * HOURS_PER_YEAR) / 1000);
  return Math.abs(yk - hk) <= Math.max(1, Math.round(yk * 0.1));
}

function yearlyFromText(salary) {
  const m = String(salary || '').trim().match(/^\$(\d+)k(?:\s*[–-]\s*\$(\d+)k)?$/);
  return m ? { lo: Number(m[1]) * 1000, hi: m[2] ? Number(m[2]) * 1000 : null } : null;
}

/**
 * The pay to show for a listing. When its own description states an hourly figure and the stored
 * yearly text is that wage annualised (an aggregator's "$33k" for "$16/hr"), the hourly figure is
 * shown — the wage the listing actually states. A stored yearly salary that is NOT the hourly
 * figure annualised (a $128k role with a "$50/hr on-call" aside) stays as stored; a listing with no
 * stored pay shows the hourly figure its text states. Otherwise the stored pay text, or null.
 * @param {{ salary?: string|null, description?: string|null }} job
 */
export function displayPay(job) {
  const salary = job?.salary ? String(job.salary).trim() : '';
  const hourly = parseHourlyPay(job?.description);
  if (!hourly) return salary || null;
  if (!salary) return hourly.text;
  const yearly = yearlyFromText(salary);
  if (yearly && (isAnnualisedFrom(yearly.lo, hourly.lo) || (yearly.hi != null && hourly.hi != null && isAnnualisedFrom(yearly.hi, hourly.hi)))) return hourly.text;
  return salary;
}
