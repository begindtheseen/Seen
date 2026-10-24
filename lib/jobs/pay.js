// Pay as the LISTING states it — ONE normaliser for every writer (ingest) and every renderer.
//
// What went wrong before (live audits 2026-10-23/24, matrix of 2,659 rows):
//   • Adzuna annualises an employer-stated hourly wage: "Hourly Wage: $16 – $29" arrived as 33,280 and
//     showed as "$33k" beside that sentence.
//   • Adzuna also passes weekly and monthly figures through as if they were yearly, and the old
//     formatter labelled every number under 10,000 "/hr": a travel nurse's "$2,125 to $2,190 per week"
//     showed as "$8760/hr", a warehouse's weekly "$988–$1,040" as "$988/hr–$1040/hr", "$3,000 per week"
//     as "$12k", and one range mixed units ("$124/hr–$99k").
//
// The rule now: a number's period comes from the posting's own words plus its magnitude, never from
// a guess.
//   hour   $2 – $200
//   week   $200 – $5,000, only when the posting says week / wk / weekly
//   month  $500 – $15,000, only when the posting says month / mo / monthly
//   year   $15,000 and up
// A number that fits no period is shown as the raw amount ("$8,760"), never relabelled. Both ends of
// a range share one period or the range is shown raw. Display: "$16–$29/hr", "$1,040/wk",
// "$3,900/mo", "$52k–$68k/yr". `yearlyMin` / `yearlyMax` are the yearly equivalent (hour × 2,080,
// week × 52, month × 12) — what the listing scorer and the salary_min/max columns hold.

export const HOURS_PER_YEAR = 2080;
const PER_YEAR = { hour: HOURS_PER_YEAR, week: 52, month: 12, year: 1 };
const BANDS = { hour: [2, 200], week: [200, 5000], month: [500, 15000], year: [15000, 5000000] };
const UNIT = { hour: '/hr', week: '/wk', month: '/mo', year: '/yr' };

const NUM = '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,2})?|\\d+(?:\\.\\d{1,2})?)';
const K = '(?:\\s?([kK])(?![a-zA-Z]))?';
const MONEY = `\\$\\s?${NUM}${K}`;
// "$16 – $29", "$16.80 - USD $19.50", "$30-50", "$16.90 to $17.50", "$52k-$68k"
const RANGE = `${MONEY}(?:\\s*(?:-|–|—|to)\\s*(?:USD\\s*)?\\$?\\s?${NUM}${K})?`;

// A period word right AFTER the money: "$17.50 per hour", "$19/hour", "$2,125 to $2,190 per week".
const AFTER_WORDS = {
  hour: '(?:per\\s+hour|an\\s+hour|a\\s+hour|/\\s?hr\\.?|/\\s?hour|hourly|p/h|hr\\b)',
  week: '(?:per\\s+week|a\\s+week|/\\s?week|/\\s?wk\\.?|weekly|wk\\b)',
  month: '(?:per\\s+month|a\\s+month|/\\s?month|/\\s?mo\\b\\.?|monthly)',
  year: '(?:per\\s+year|a\\s+year|/\\s?year|/\\s?yr\\.?|yearly|annually|annual(?:ly)?|per\\s+annum|/\\s?annum|a\\s+yr)',
};
// A period label BEFORE the money: "Hourly Wage: $16 – $29", "hourly base rate of $19",
// "Weekly pay: $1,040", "Annual salary range: $52,000 - $68,000".
const BEFORE_WORDS = {
  hour: 'hourly\\s+(?:wage|pay|rate|base\\s+rate|compensation|range|pay\\s+range|salary)?',
  week: 'weekly\\s+(?:gross\\s+)?(?:pay|rate|wage|stipend|salary|compensation)',
  month: 'monthly\\s+(?:pay|rate|wage|stipend|salary|compensation)',
  year: '(?:annual|yearly|annualized)\\s+(?:base\\s+)?(?:salary|pay|compensation|wage|base)',
};
const LEAD = '\\s*(?:range)?\\s*(?:of|:|is|at|from|starting\\s+at)?\\s*(?:USD\\s*)?';
const PATTERNS = [];
for (const period of Object.keys(PER_YEAR)) {
  PATTERNS.push({ period, re: new RegExp(`(?:USD\\s*)?${RANGE}\\s*(?:USD\\s*)?${AFTER_WORDS[period]}`, 'gi') });
  PATTERNS.push({ period, re: new RegExp(`${BEFORE_WORDS[period]}${LEAD}${RANGE}`, 'gi') });
}
// Words anywhere in the posting that say which period its figures are in.
const HINT_RE = {
  hour: /\b(?:hour|hourly|hr)\b/i,
  week: /\b(?:week|weekly|wk)\b/i,
  month: /\b(?:month|monthly|mo)\b/i,
  year: /\b(?:year|yearly|annual|annually|annum|yr)\b/i,
};

const num = (s, k) => { const n = Number(String(s || '').replace(/,/g, '')); return k ? n * 1000 : n; };
const positive = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
const fits = (period, v) => { const b = BANDS[period]; return !!b && v >= b[0] && v <= b[1]; };
const both = (period, lo, hi) => fits(period, lo) && (hi == null || fits(period, hi));

function amounts(m) {
  // groups: 1 lo, 2 lo-k, 3 hi, 4 hi-k. "$52-68k" → the k on the high end applies to the low end too.
  // Only when the low number is the smaller one ("$124/hr–$99k" is NOT "$124k").
  const bare = Number(String(m[1]).replace(/,/g, ''));
  const lo = num(m[1], m[2] || (!!m[4] && m[3] != null && bare < 1000 && bare <= Number(String(m[3]).replace(/,/g, ''))));
  const hi = m[3] != null ? num(m[3], m[4]) : null;
  return { lo, hi };
}

function commas(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function cents(v) {
  const r = Math.round(v * 100) / 100;
  return `$${Number.isInteger(r) ? r : r.toFixed(2)}`;
}
function fmtOne(period, v) {
  if (period === 'hour') return cents(v);
  if (period === 'year') return `$${Math.round(v / 1000)}k`;
  if (period === 'week' || period === 'month') return `$${commas(v)}`;
  // Raw amount, no unit: whole dollars with commas from $1,000 up, cents kept below.
  return v >= 1000 || Number.isInteger(v) ? `$${commas(v)}` : cents(v);
}

/**
 * One display string for a pay figure in a known period (or null period = raw amounts).
 * @param {number} lo @param {number|null} hi @param {'hour'|'week'|'month'|'year'|null} period
 */
export function formatPay(lo, hi, period, prefix = '') {
  const a = fmtOne(period, lo);
  const b = hi != null && hi > lo ? fmtOne(period, hi) : null;
  const range = b && b !== a ? `${a}–${b}` : a;
  return `${prefix}${range}${period ? UNIT[period] : ''}`;
}

function build(lo, hi, period, prefix = '') {
  const f = PER_YEAR[period] || 0;
  return {
    lo, hi: hi != null && hi > lo ? hi : null, period: period || null,
    text: formatPay(lo, hi, period || null, prefix),
    yearlyMin: Math.round(lo * f) || 0,
    yearlyMax: Math.round((hi != null && hi > lo ? hi : lo) * f) || 0,
  };
}

/**
 * The pay a listing's own words state — money next to a period word — as { lo, hi, period, text,
 * yearlyMin, yearlyMax }, or null. The first statement whose figure fits its period wins; a
 * "$1,500 sign-on bonus", a tipped "hourly minimum" with no figure, or "$228 per day" states none.
 * @param {string} text the listing title and/or description
 */
export function parseStatedPay(text) {
  const t = String(text || '');
  if (!t || !t.includes('$')) return null;
  const found = [];
  for (const { period, re } of PATTERNS) {
    re.lastIndex = 0;
    for (const m of t.matchAll(re)) found.push({ index: m.index, period, ...amounts(m) });
  }
  found.sort((a, b) => a.index - b.index);
  for (const f of found) {
    if (!both(f.period, f.lo, f.hi)) continue;
    const hi = f.hi != null && f.hi > f.lo ? f.hi : null;
    return build(f.lo, hi, f.period);
  }
  return null;
}

/** The periods a posting's words mention anywhere ("40 hours a week", "monthly stipend"). */
export function periodHints(text) {
  const t = String(text || '');
  return Object.keys(HINT_RE).filter((p) => HINT_RE[p].test(t));
}

/**
 * The period two amounts share, from a period the source declared (trusted when the figures fit
 * it), then magnitude, then the posting's words for the band where magnitude alone cannot tell
 * ($200–$15,000). Null when nothing settles it or the two ends fall in different periods.
 */
export function resolvePeriod(lo, hi, { period = null, hints = [] } = {}) {
  // A source that declares a period Seen does not render (a day, a shift, a fee) → raw, never a guess.
  if (period && !PER_YEAR[period]) return null;
  if (period && both(period, lo, hi)) return period;
  if (both('hour', lo, hi)) return 'hour';
  if (both('year', lo, hi)) return 'year';
  const fitting = ['week', 'month'].filter((p) => hints.includes(p) && both(p, lo, hi));
  return fitting.length === 1 ? fitting[0] : null;
}

function sameMoney(a, b) {
  // Yearly equivalents compared with the rounding a "$33k" tile carries (±1k, or ±10%).
  return Math.abs(a - b) <= Math.max(1000, Math.round(Math.max(a, b) * 0.1));
}

/**
 * THE normaliser. Source amounts (`min`/`max`, any source, any claimed period) + the posting's own
 * text → { lo, hi, period, text, yearlyMin, yearlyMax }, or null when there is no pay at all.
 *   • The posting's own stated pay wins when the source amounts are missing, fit no period, or are
 *     that same pay in another period (an aggregator's annualised "$33k" for "$16/hr").
 *   • A source figure that independently fits a period and is NOT the stated pay restated (a $128k
 *     salary beside a "$50/hr on-call" aside) stays as the source gave it.
 *   • Amounts that fit no period are shown raw (period null, yearly 0) — never relabelled.
 * @param {{ min?: number, max?: number, period?: string|null, text?: string, prefix?: string }} input
 */
export function normalizePay({ min, max, period = null, text = '', prefix = '' } = {}) {
  let lo = positive(min); let hi = positive(max);
  if (!lo && hi) { lo = hi; hi = 0; }
  if (lo && hi && hi < lo) [lo, hi] = [hi, lo];
  const hiOrNull = hi && hi !== lo ? hi : null;
  const stated = parseStatedPay(text);
  if (!lo) return stated;
  const own = resolvePeriod(lo, hiOrNull, { period, hints: periodHints(text) });
  if (stated) {
    if (!own) return stated;
    if (own !== stated.period) {
      const ownLo = lo * PER_YEAR[own]; const ownHi = (hiOrNull || lo) * PER_YEAR[own];
      if (sameMoney(ownLo, stated.yearlyMin) || (stated.hi != null && sameMoney(ownHi, stated.yearlyMax))) return stated;
    }
  }
  return build(lo, hiOrNull, own, prefix);
}

// A stored pay string, any shape Seen or a source ever wrote: "$33k", "$57k–$80k", "$8760/hr",
// "$988/hr–$1040/hr", "$18 - $22 an hour", "From $18 an hour", "$52,000 - $68,000 a year",
// "$45k – $60k / year", "$16–$29/hr", "$1,040/wk", "120K". Anything else (free text an employer
// typed: "Competitive", "DOE + bonus") is not pay we can read → null.
const TOKEN_RE = /\$?\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s?([kK](?![a-zA-Z]))?/g;
const FILLER_RE = /^(?:\s|[-–—/+.,()]|to|usd|from|up|starting|at|per|a|an|hour|hourly|hr|hrs|week|weekly|wk|month|monthly|mo|year|yearly|yr|annual|annually|annum|salary|pay|base|range)*$/i;
export function parsePayText(s) {
  const raw = String(s || '').trim();
  if (!raw || raw.length > 80) return null;
  const tokens = [...raw.matchAll(TOKEN_RE)];
  if (!tokens.length || tokens.length > 2) return null;
  if (!/\$|k\b|K\b/.test(raw)) return null;
  const rest = raw.replace(TOKEN_RE, ' ');
  if (!FILLER_RE.test(rest)) return null;
  const bare = num(tokens[0][1]);
  const lo = num(tokens[0][1], tokens[0][2] || (!!tokens[1]?.[2] && bare < 1000 && bare <= num(tokens[1][1])));
  const hi = tokens[1] ? num(tokens[1][1], tokens[1][2]) : null;
  const period = Object.keys(AFTER_WORDS).find((p) => new RegExp(AFTER_WORDS[p], 'i').test(rest) || HINT_RE[p].test(rest)) || null;
  const prefix = /^\s*from\b/i.test(raw) || /^\s*starting\b/i.test(raw) ? 'From ' : /^\s*up\s+to\b/i.test(raw) ? 'Up to ' : '';
  return { lo, hi, period, prefix };
}

/**
 * The fields a writer stores: { salary, salaryMin, salaryMax } — `salary` the one display string,
 * min/max the yearly equivalent (0 when the period is unknown). Used by every ingest path.
 */
export function payFields({ min, max, period = null, text = '', salaryText = null } = {}) {
  let n = null;
  if (positive(min) || positive(max)) n = normalizePay({ min, max, period, text });
  else if (salaryText) {
    const p = parsePayText(salaryText);
    n = p ? normalizePay({ min: p.lo, max: p.hi, period: p.period, text, prefix: p.prefix }) : null;
    if (!n) return { salary: String(salaryText).trim().slice(0, 120) || null, salaryMin: 0, salaryMax: 0 };
  } else n = parseStatedPay(text);
  if (!n) return { salary: null, salaryMin: 0, salaryMax: 0 };
  return { salary: n.text, salaryMin: n.yearlyMin, salaryMax: n.yearlyMax };
}

/**
 * The pay to show for a listing (renderers). The stored text is re-read through the same rules
 * with the listing's own title + description, so rows written by the old formatter ("$8760/hr",
 * "$12k" for a weekly travel-nurse rate) render correctly without a backfill. Free text an
 * employer typed is shown as written.
 * @param {{ salary?: string|null, title?: string|null, description?: string|null }} job
 */
export function displayPay(job) {
  const salary = job?.salary ? String(job.salary).trim() : '';
  const text = [job?.title, job?.description].filter(Boolean).join('\n');
  if (!salary) return parseStatedPay(text)?.text ?? null;
  const p = parsePayText(salary);
  if (!p) return salary;
  return normalizePay({ min: p.lo, max: p.hi, period: p.period, text, prefix: p.prefix })?.text ?? salary;
}

// ── Back-compat helpers (hour-only views of the same rules) ─────────────────────────────────────

/**
 * The hourly pay a listing's own text states: { lo, hi|null, text }, or null.
 * @param {string} text the listing description (or any pay text)
 */
export function parseHourlyPay(text) {
  const t = String(text || '');
  if (!t || !/hour|hr\b|hourly/i.test(t)) return null;
  const found = [];
  for (const { period, re } of PATTERNS) {
    if (period !== 'hour') continue;
    re.lastIndex = 0;
    for (const m of t.matchAll(re)) found.push({ index: m.index, ...amounts(m) });
  }
  found.sort((a, b) => a.index - b.index);
  for (const f of found) {
    if (!both('hour', f.lo, f.hi)) continue;
    const hi = f.hi != null && f.hi > f.lo ? f.hi : null;
    return { lo: f.lo, hi, text: formatPay(f.lo, hi, 'hour') };
  }
  return null;
}

/** `parseHourlyPay(text).text`, or null. */
export function statedHourlyPay(text) {
  return parseHourlyPay(text)?.text ?? null;
}

/** True for Seen's yearly formats: "$33k", "$57k–$80k", "$52k–$68k/yr". */
export function isYearlyPayText(salary) {
  return /^\$\d+k(?:\s*[–-]\s*\$\d+k)?(?:\/yr)?$/.test(String(salary || '').trim());
}

/**
 * Is a yearly figure just this hourly wage annualised? (±1k, or ±10% of the yearly figure.)
 * @param {number} yearly dollars per year @param {number} hourly dollars per hour
 */
export function isAnnualisedFrom(yearly, hourly) {
  const y = Number(yearly), h = Number(hourly);
  if (!(y > 0) || !(h > 0)) return false;
  const yk = Math.round(y / 1000);
  const hk = Math.round((h * HOURS_PER_YEAR) / 1000);
  return Math.abs(yk - hk) <= Math.max(1, Math.round(yk * 0.1));
}

/** The tile label for a display pay string: "Hourly pay" · "Weekly pay" · "Monthly pay" · "Salary" · "Pay". */
export function payLabel(text) {
  const t = String(text || '');
  if (/\/hr$/.test(t)) return 'Hourly pay';
  if (/\/wk$/.test(t)) return 'Weekly pay';
  if (/\/mo$/.test(t)) return 'Monthly pay';
  if (/\/yr$/.test(t)) return 'Salary';
  return 'Pay';
}
