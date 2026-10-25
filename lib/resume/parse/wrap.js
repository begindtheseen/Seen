// Wrapped-line signals shared by the line merger (preprocess.js), the experience parser's safety
// net (experience.js) and the skills merger (index.js).
//
// The bug class this exists for (live on seenjobs.io 2026-10-25): a bullet whose text wraps back
// to the LEFT MARGIN (under the bullet glyph, not under the bullet text) produced a physical line
// such as "calendar.", "(1,800 subscribers)." or "reconciliation breaks 92%." with no glyph, at
// the header indent. The merger rejected it (indent left of the bullet text), and the experience
// parser then promoted it to a new ROLE with no employer and no dates. Studio rebuilds from the
// saved plain text, where the same line has no geometry at all, so both paths need the same
// text-only judgement: does this line read like the END of a sentence, or like a header?
//
// Pure, no I/O.

import { TITLE_WORD_RE, COMPANY_SUFFIX_RE, LOCATION_RE, LOCATION_INLINE_RE, EMPLOYMENT_TYPE_RE } from './lexicon.js';
import { findDateRange } from './dates.js';

/** A sentence end: . ! ? optionally closed by a quote or bracket. (";" "," ":" are NOT ends.) */
export const SENTENCE_END_RE = /[.!?]["'’”)\]]?$/;
// A line that stops on a word that cannot end a phrase ("…using a shared", "…for the program").
const OPEN_WORD_END_RE = /(?:^|\s)(?:a|an|the|and|or|nor|but|of|in|on|at|to|for|with|by|from|into|onto|via|per|as|than|across|over|under|about|between|through|within|without|including|its|their|our|his|her|my|your|&)$/;
// A line that stops on a joiner character ("…English /", "…Kafka +", "…year-over-", "…cash,").
const OPEN_CHAR_END_RE = /[,;/+&–—-]$/;
// Header separators: a "Title — Company" or "Company | City" shape is never a wrapped tail.
const HEADER_SEP_RE = /\s(?:—|–|\||@|·|•)\s|\s-\s|\s{3,}|\t/;
// Lowercase-led brand / product spellings ("eBay", "iCIMS", "iPhone") are not lowercase tails.
const CAMEL_BRAND_RE = /^[a-z]{1,3}[A-Z]/;

/** Does `text` stop mid-phrase (no sentence end, or on an open word / joiner)? */
export function endsOpen(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return !SENTENCE_END_RE.test(t);
}

/** Does `text` stop on a word or character that a phrase cannot end on? */
export function endsOnJoiner(text) {
  const t = String(text || '').trim();
  return OPEN_WORD_END_RE.test(t) || OPEN_CHAR_END_RE.test(t);
}

/** Header vocabulary inside a line: a title word, an employer suffix, a location or a type. */
export function hasHeaderShape(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (HEADER_SEP_RE.test(t)) return true;
  if (findDateRange(t)) return true;
  const bare = t.replace(/[.,;:]+$/, '');
  if (TITLE_WORD_RE.test(bare) || COMPANY_SUFFIX_RE.test(bare)) return true;
  if (LOCATION_RE.test(bare) || LOCATION_INLINE_RE.test(bare)) return true;
  if (/^[(\[]?[^()\[\]]*[)\]]?$/.test(bare) && EMPLOYMENT_TYPE_RE.test(bare) && bare.split(/\s+/).length <= 3) return true;
  return false;
}

/**
 * How strongly does `text`, read on its own, look like the wrapped END of the previous line?
 *   'strong' — it starts lowercase ("calendar.", "p99 latency…"), with punctuation
 *              ("(1,800 subscribers)."), or with a number followed only by lowercase words
 *              ("3 quarters in a row."). Headers never start this way.
 *   'weak'   — a short capitalized fragment that closes a sentence ("Writing.") and carries no
 *              header vocabulary; only a continuation when the previous line ran full and open.
 *   null     — reads like a line of its own.
 */
export function tailKind(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  if (findDateRange(t)) return null;
  if (/^[a-z]/.test(t)) {
    if (CAMEL_BRAND_RE.test(t)) return null;
    // A bare employment type ("freelance", "part-time") on its own line is header data.
    if (t.split(/\s+/).length <= 2 && EMPLOYMENT_TYPE_RE.test(t) && t.replace(EMPLOYMENT_TYPE_RE, '').replace(/[\s,.()-]/g, '') === '') return null;
    return 'strong';
  }
  if (/^[(\[{,;:%&+/'"’”.)]/.test(t)) {
    // "(Contract)" / "(Remote)" lines are header data, not a sentence tail.
    if (/^[(\[][^()\[\]]*[)\]]\.?$/.test(t) && hasHeaderShape(t.replace(/[()[\].]/g, ''))) return null;
    return 'strong';
  }
  if (/^\d/.test(t)) {
    // "3 quarters in a row." / "1,800 subscribers)." — a count, then lowercase words only.
    // "24 Hour Fitness" / "7-Eleven" / "3M" are names.
    const rest = t.replace(/^[\d.,%+$x×/:-]+/, '');
    if (!/[A-Z]/.test(rest) && /[a-z]/.test(rest)) return 'strong';
    return null;
  }
  const words = t.split(/\s+/).length;
  if (words <= 4 && SENTENCE_END_RE.test(t) && !hasHeaderShape(t)) return 'weak';
  return null;
}

/** Join a wrapped tail onto its line: a hyphen at a line end stays (compound words), no glyph is invented. */
export function joinWrapped(a, b) {
  const left = String(a || '').trim();
  const right = String(b || '').trim();
  if (!left) return right;
  if (!right) return left;
  const joiner = /-$/.test(left) && /^[a-z]/.test(right) ? '' : ' ';
  return (left + joiner + right).replace(/\s+/g, ' ').trim();
}

// A role header's date range that wrapped after its dash: "… Jan 2025 –" / "Aug 2025".
const DANGLING_RANGE_RE = /(?:\b(?:19|20)\d{2}|['’]\d{2})\s*(?:[–—-]|\bto|\buntil|\bthrough)$/i;
const RANGE_END_START_RE = /^(?:present|current|now|today|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(?:19|20)\d{2}|(?:spring|summer|fall|autumn|winter)\s+(?:19|20)\d{2}|(?:0?[1-9]|1[0-2])[/.](?:19|20)?\d{2}|(?:19|20)\d{2})\b/i;
export function isDanglingRange(cur, next) {
  return DANGLING_RANGE_RE.test(String(cur || '').trim()) && RANGE_END_START_RE.test(String(next || '').trim());
}
