// Résumé date grammar — the ONE place dates are parsed and formatted.
//
// Résumés write dates every way imaginable: "January 2020", "Jan. 2020", "01/2020", "1/20",
// "2020-01", "Q3 2019", "Summer 2021", "'19", "2020", "Present / Current / Now / Ongoing /
// To date". A range joins two of them with "-", "–", "—", "to", "through", "until", "till".
// Everything downstream (parser, serializer, health timeline checks, renderers) uses the
// normalized token form produced here:
//   token = 'YYYY-MM' | 'YYYY' | 'present' | ''        (never a Date object — no timezone drift)
// Pure, deterministic, dependency-free.

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const SEASONS = { spring: 3, summer: 6, fall: 9, autumn: 9, winter: 12 };

const MONTH_RE = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const SEASON_RE = '(?:spring|summer|fall|autumn|winter)';
const PRESENT_RE = '(?:present|current(?:ly)?|now|ongoing|to\\s*date|till\\s*date|today)';

// One date token, with named alternatives captured for normalization.
//   month-year:  Jan 2020 / January, 2020 / Jan. 2020 / Jan '20
//   numeric:     01/2020 / 1-2020 / 01.2020 / 1/20
//   iso:         2020-01 / 2020/01
//   quarter:     Q1 2020
//   season:      Summer 2021
//   year:        2020 / '20
export const DATE_TOKEN_SRC =
  `(?:${MONTH_RE}\\.?,?\\s*(?:\\d{4}|'\\d{2}|\\d{2})(?!\\d)` +   // Jan 2020 / Jan '20 / Jan, 2020 (4-digit year first)
  `|(?:0?[1-9]|1[0-2])\\s*[\\/.-]\\s*(?:\\d{4}|\\d{2})\\b` +    // 01/2020 / 1-20
  `|(?:19|20)\\d{2}\\s*[\\/-]\\s*(?:0?[1-9]|1[0-2])\\b` +     // 2020-01
  `|q[1-4]\\s*(?:19|20)\\d{2}` +                              // Q1 2020
  `|${SEASON_RE}\\s*(?:19|20)\\d{2}` +                        // Summer 2021
  `|(?:19|20)\\d{2}\\b` +                                     // 2020
  `|'\\d{2}\\b)`;                                             // '19

const RANGE_SEP_SRC = `\\s*(?:[-–—−]+|to|through|thru|until|till|→)\\s*`;

export const DATE_TOKEN_RE = new RegExp(DATE_TOKEN_SRC, 'i');
export const PRESENT_TOKEN_RE = new RegExp(`\\b${PRESENT_RE}\\b`, 'i');
// Full range: <token> <sep> <token|present>. Also accepts a bare "<token> – " with present
// implied? No — a dangling separator is ambiguous; we require both ends.
export const DATE_RANGE_RE = new RegExp(`(${DATE_TOKEN_SRC})${RANGE_SEP_SRC}(${DATE_TOKEN_SRC}|${PRESENT_RE})`, 'i');
// A single token that is explicitly "present" (used for "Since 2019", "2019 – Present" etc.)
const SINCE_RE = new RegExp(`\\bsince\\s+(${DATE_TOKEN_SRC})`, 'i');

function fullYear(y) {
  const s = String(y).replace(/^'/, '');
  if (s.length === 4) return Number(s);
  if (s.length === 2) {
    const n = Number(s);
    // Two-digit years: 00–39 → 2000s (résumés rarely reach past the current decade +);
    // 40–99 → 1900s. Deterministic and good enough for employment history.
    return n <= 39 ? 2000 + n : 1900 + n;
  }
  return Number(s);
}

function monthIndex(name) {
  const n = String(name || '').toLowerCase().replace(/\./g, '').slice(0, 3);
  const i = MONTH_ABBR.indexOf(n);
  return i === -1 ? null : i + 1;
}

/**
 * Parse one date token into { y, m|null } or 'present' or null.
 * @param {string} tok
 */
export function parseDateToken(tok) {
  const s = String(tok || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;
  if (new RegExp(`^${PRESENT_RE}$`, 'i').test(s)) return 'present';
  let m;
  // Month name + year
  if ((m = s.match(new RegExp(`^(${MONTH_RE})\\.?,?\\s*(\\d{4}|'\\d{2}|\\d{2})$`, 'i')))) {
    const mi = monthIndex(m[1]);
    return { y: fullYear(m[2]), m: mi };
  }
  // Numeric MM/YYYY or MM/YY
  if ((m = s.match(/^(0?[1-9]|1[0-2])\s*[/.-]\s*(\d{4}|\d{2})$/))) {
    return { y: fullYear(m[2]), m: Number(m[1]) };
  }
  // ISO YYYY-MM
  if ((m = s.match(/^((?:19|20)\d{2})\s*[/-]\s*(0?[1-9]|1[0-2])$/))) {
    return { y: Number(m[1]), m: Number(m[2]) };
  }
  // Quarter
  if ((m = s.match(/^q([1-4])\s*((?:19|20)\d{2})$/))) {
    return { y: Number(m[2]), m: (Number(m[1]) - 1) * 3 + 1 };
  }
  // Season
  if ((m = s.match(new RegExp(`^(${SEASON_RE})\\s*((?:19|20)\\d{2})$`)))) {
    return { y: Number(m[2]), m: SEASONS[m[1]] || null };
  }
  // Bare year / 'YY
  if ((m = s.match(/^((?:19|20)\d{2})$/))) return { y: Number(m[1]), m: null };
  if ((m = s.match(/^'(\d{2})$/))) return { y: fullYear(m[1]), m: null };
  return null;
}

/** { y, m } | 'present' | null → normalized token string. */
export function toToken(d) {
  if (d === 'present') return 'present';
  if (!d || !d.y) return '';
  if (d.m) return `${d.y}-${String(d.m).padStart(2, '0')}`;
  return String(d.y);
}

/** Normalized token → { y, m } | 'present' | null. */
export function fromToken(token) {
  const s = String(token || '').trim();
  if (!s) return null;
  if (s === 'present') return 'present';
  const m = s.match(/^(\d{4})(?:-(\d{2}))?$/);
  if (!m) return parseDateToken(s); // tolerate un-normalized input
  return { y: Number(m[1]), m: m[2] ? Number(m[2]) : null };
}

/** Is this string a valid normalized token? */
export function isToken(token) {
  return token === '' || token === 'present' || /^\d{4}(-\d{2})?$/.test(String(token || ''));
}

/**
 * Find a date range anywhere in a line. Returns null when none.
 * @returns {{ start: string, end: string, raw: string, index: number, startText: string, endText: string } | null}
 */
export function findDateRange(line) {
  const text = String(line || '');
  const m = DATE_RANGE_RE.exec(text);
  if (m) {
    const start = parseDateToken(m[1]);
    const end = parseDateToken(m[2]);
    if (!start) return null;
    const s = toToken(start), e = toToken(end);
    // Reject impossible ranges (end before start) — almost always a false positive like
    // "2 - 2020" captured from a phone number or a count. Allow equal.
    if (end && end !== 'present' && cmpTokens(s, e) > 0) return null;
    return { start: s, end: e || '', raw: m[0], index: m.index, startText: m[1], endText: m[2] };
  }
  const sm = SINCE_RE.exec(text);
  if (sm) {
    const start = parseDateToken(sm[1]);
    if (start) return { start: toToken(start), end: 'present', raw: sm[0], index: sm.index, startText: sm[1], endText: 'present' };
  }
  return null;
}

/**
 * Find a lone date token at the END of a line (education graduation years, certifications):
 * "B.S. Computer Science, 2018" / "PMP (2021)" / "Expected May 2026".
 */
export function findTrailingDate(line) {
  const text = String(line || '').trim();
  const m = text.match(new RegExp(`(?:\\(|,|\\s|^)\\s*(?:expected|anticipated|graduated|grad\\.?|class of)?\\s*(${DATE_TOKEN_SRC})\\)?\\s*$`, 'i'));
  if (!m) return null;
  const d = parseDateToken(m[1]);
  if (!d || d === 'present') return null;
  return { token: toToken(d), raw: m[0], index: m.index, text: m[1], expected: /expected|anticipated/i.test(m[0]) };
}

/** Compare two normalized tokens: negative if a < b. 'present' sorts last; '' sorts first. */
export function cmpTokens(a, b) {
  const rank = (t) => {
    if (t === 'present') return Number.MAX_SAFE_INTEGER;
    const d = fromToken(t);
    if (!d || d === 'present') return -1;
    return d.y * 12 + (d.m || 1);
  };
  return rank(a) - rank(b);
}

/** Months between two tokens (end may be 'present' → now). Null when unknowable. */
export function monthsBetween(startTok, endTok, now = new Date()) {
  const s = fromToken(startTok);
  if (!s || s === 'present') return null;
  let e = fromToken(endTok);
  if (e === 'present' || (!e && endTok === 'present')) e = { y: now.getUTCFullYear(), m: now.getUTCMonth() + 1 };
  if (!e) return null;
  const sm = s.y * 12 + (s.m || 6); // a bare year counts from mid-year — unbiased on average
  const em = e.y * 12 + (e.m || 6);
  return Math.max(0, em - sm);
}

/** Human display: '2021-01' → 'Jan 2021'; '2021' → '2021'; 'present' → 'Present'. */
export function formatDate(token, { style = 'short' } = {}) {
  if (!token) return '';
  if (token === 'present') return 'Present';
  const d = fromToken(token);
  if (!d || d === 'present') return String(token);
  if (!d.m) return String(d.y);
  const name = style === 'long' ? MONTHS[d.m - 1] : MONTH_ABBR[d.m - 1];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${d.y}`;
}

/** 'Jan 2021 – Present' style range text for display/serialization. */
export function formatRange(start, end, opts) {
  const s = formatDate(start, opts), e = formatDate(end, opts);
  if (s && e) return `${s} – ${e}`;
  return s || e || '';
}

/** Strip a date range (and any separator debris around it) from a line. */
export function stripDateRange(line) {
  const r = findDateRange(line);
  if (!r) return String(line || '').trim();
  const text = String(line);
  return (text.slice(0, r.index) + ' ' + text.slice(r.index + r.raw.length))
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s*[|•·,;]\s*$/, '')
    .replace(/^\s*[|•·,;]\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
