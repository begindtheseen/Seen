// What a humanizer may never touch: numbers, dates, phone numbers, e-mail addresses and links.
//
// 2026-10-25 (Dev's Pro run): HumanProof turned "cut reconciliation breaks 92%" into "9%",
// "$1.2B/year" into "B/year", "Mar 2022" into "Mar 202", "(512) 555-0187" into "() -" and
// "300+ stores" into "00+ stores" — under a "no invented numbers" badge. Two seams did it:
// the grounding check knew only the few numbers the fact extractor calls "metrics" (so every
// other number in the user's OWN résumé was "unsupported"), and the stripper removed a number
// as a bare substring, wherever its digits first appeared — inside another number, a date or a
// phone number.
//
// This module is the one place that says what those protected spans are, and the one invariant
// every edit is checked against: the numbers in the text after an edit are exactly the numbers
// before it, minus only the ones the caller deliberately removed. An edit that fails the check
// is thrown away and the user's own line is kept.

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';

// Each entry finds one kind of span a rewrite must leave byte-for-byte alone.
const PROTECTED = [
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,                                                      // e-mail
  /\b(?:https?:\/\/|www\.)[^\s|,;)]+/gi,                                                 // explicit link
  /\b[\w-]+(?:\.[\w-]+)*\.(?:com|io|org|net|dev|co|ai|me|edu|gov|us|app|ly)(?:\/[^\s|,;)]*)?/gi, // bare domain/path
  /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}\b/g,                              // phone
  new RegExp(`\\b${MONTH}\\s*\\d{4}\\b`, 'gi'),                                           // Mar 2022
  /\b\d{1,2}\/(?:19|20)?\d{2}\b(?!\s*(?:%|stars?))/g,                                     // 03/2022
  /\b(?:19|20)\d{2}\s*[–—-]\s*(?:(?:19|20)\d{2}|present|current|now)\b/gi,               // 2014–2016
  /\b(?:19|20)\d{2}\b/g,                                                                  // a year
];

/** Ranges [start, end) of every protected span in `text`, merged and sorted. */
export function protectedRanges(text) {
  const s = String(text || '');
  const out = [];
  for (const re of PROTECTED) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s)) !== null) {
      if (!m[0]) { re.lastIndex++; continue; }
      out.push([m.index, m.index + m[0].length]);
    }
  }
  out.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

/** True when [start, end) touches any protected range. */
export function overlapsProtected(ranges, start, end) {
  for (const [a, b] of ranges) if (start < b && end > a) return true;
  return false;
}

// A number as it is written: digits with their thousands separators and decimals. "92%" → "92",
// "$1.2B" → "1.2", "2,100" → "2100", "1-in-5" → "1" and "5".
const NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g;
const normNum = (n) => n.replace(/,(?=\d{3}\b)/g, '').replace(/,+$/, '');

/** Every number written in `text`, normalized, in order (a multiset as a list). */
export function numbersIn(text) {
  return (String(text || '').match(NUMBER_RE) || []).map(normNum);
}

/** The set of normalized numbers in a text — what "the résumé says this number" means. */
export function numberSet(text) {
  return new Set(numbersIn(text));
}

/** Every protected span's exact text (e-mails, links, phones, dates). */
export function protectedTexts(text) {
  const s = String(text || '');
  return protectedRanges(s).map(([a, b]) => s.slice(a, b));
}

function multiset(list) {
  const m = new Map();
  for (const x of list) m.set(x, (m.get(x) || 0) + 1);
  return m;
}

/**
 * The invariant: `after` carries exactly the numbers of `before` minus the `removed` ones (each a
 * number or a phrase holding numbers), and every protected span of `before` that was not removed
 * is still present verbatim.
 */
export function numbersIntact(before, after, removed = []) {
  const want = multiset(numbersIn(before));
  for (const r of removed) for (const n of numbersIn(r)) {
    const c = want.get(n) || 0;
    if (c > 0) want.set(n, c - 1);
  }
  const got = multiset(numbersIn(after));
  for (const [n, c] of want) if ((got.get(n) || 0) !== c) return false;
  for (const [n, c] of got) if ((want.get(n) || 0) !== c) return false;
  const removedText = removed.join(' ');
  const afterText = String(after || '');
  for (const span of protectedTexts(before)) {
    if (removedText.includes(span)) continue;
    if (!afterText.includes(span)) return false;
  }
  return true;
}
