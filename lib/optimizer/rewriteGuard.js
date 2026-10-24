// Rewrite guard — the ONE place that decides whether an optimizer rewrite is worth showing and
// whether it kept the "nothing invented" promise. Pure, deterministic, dependency-free; used by
// the SeenFit generator (lib/optimizer/generateSafeBullets.js), the legacy compat layer
// (lib/server/seenfitCompat.js), the V2 package builder (lib/application-intelligence/index.js)
// and the client (components/ApplyOptimizeModal.tsx), so every surface applies the same rules.
//
// Rules (each pinned by a live audit sentence in rewriteGuard.test.mjs):
//   • A rewrite is SUBSTANTIVE only when it changes words. Stripping a bullet glyph, adding a
//     period, changing case, or inserting a parenthetical "(cashier)" is not an improvement and
//     is never shown as one.
//   • A rewrite is GROUNDED only when every token it adds already appears in the résumé or the
//     posting. "Handled" may replace "Responsible for" only if the person or the posting uses it.
//   • Keywords are compared by keywordKey(): lower-case, punctuation-free, possessive and plural
//     stripped — so "ASSOCIATE", "associates" and "associate's" are one keyword, and a matched
//     keyword can never also be listed as missing.

/** Lower-case word tokens (letters/digits, plus the few symbols skills carry: c#, c++, node.js). */
export function tokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/[^a-z0-9+#.']+/)
    .map((t) => t.replace(/^[.']+|[.']+$/g, ''))
    .filter(Boolean);
}

/** The one keyword identity: case, punctuation, possessive and trailing plural folded away. */
export function keywordKey(s) {
  return tokens(s)
    .map((t) => t.replace(/'s$/, ''))
    .map((t) => (t.length >= 4 && /^[a-z]+s$/.test(t) && !/ss$/.test(t) ? t.slice(0, -1) : t))
    .join(' ');
}

/** Dedupe a keyword list by keywordKey, keeping the first spelling seen. */
export function uniqueKeywords(list) {
  const seen = new Set();
  const out = [];
  for (const k of list || []) {
    const s = String(k || '').trim();
    const key = keywordKey(s);
    if (!s || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** Items of `list` whose keywordKey is not in `exclude` (so matched ∩ missing = ∅). */
export function withoutKeywords(list, exclude) {
  const ex = new Set((exclude || []).map(keywordKey).filter(Boolean));
  return (list || []).filter((k) => !ex.has(keywordKey(k)));
}

// The comparable core of a bullet: no leading glyph, no parentheticals, no punctuation, no case.
function core(text) {
  return String(text || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^\s*[•\-*▪◦·‣–—]+\s*/, '')
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, ' ')
    .trim();
}

/** True when the rewrite changes words — not just punctuation, case, a glyph or a parenthetical. */
export function isSubstantiveRewrite(before, after) {
  const a = core(before);
  const b = core(after);
  return !!b && a !== b;
}

/** Tokens present in `after` that `before` does not contain. */
export function addedTokens(before, after) {
  const have = new Set(tokens(before));
  return [...new Set(tokens(after).filter((t) => !have.has(t)))];
}

/**
 * True when every token the rewrite adds appears in the allowed vocabulary (the résumé and the
 * posting). An empty `added` list is grounded by definition.
 */
export function rewriteIsGrounded(before, after, vocabulary) {
  const vocab = new Set(tokens(Array.isArray(vocabulary) ? vocabulary.join(' ') : vocabulary));
  return addedTokens(before, after).every((t) => vocab.has(t));
}

/**
 * True when a sentence is just a list of nouns — three or more comma-separated items of at most
 * two words each with no verb between them ("sales, associates, associate."). The optimizer must
 * never emit one as a bullet or summary.
 */
const LEAD_IN_RE = /^.*\b(?:with|including|include|such as|in|of|demonstrated|skilled in|proficient in|experience in|skills in)\s+/i;
export function isNounList(text) {
  const body = String(text || '').replace(/[.!?]\s*$/, '');
  const parts = body.split(/,|;/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return false;
  // Count the trailing run of list items: each is at most two words once the lead-in that
  // introduces the list ("…, with demonstrated sales, …") is stripped from it.
  let run = 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    const item = parts[i].replace(LEAD_IN_RE, '');
    const n = tokens(item).length;
    if (n === 0 || n > 2) break;
    run++;
  }
  return run >= 3;
}
