// Company entity matching for public-record signals (SEC / WARN / H-1B → our companies).
//
// LEGAL-CRITICAL: attaching an official filing to the WRONG company is a false statement about
// an innocent party — the exact defamation the whole data-spine posture exists to avoid. So this
// matcher is deliberately CONSERVATIVE: it prefers a FALSE NEGATIVE (miss a real match — we just
// don't surface that one signal) over a FALSE POSITIVE (mis-attribute). Only 'high' confidence is
// ever surfaced. When SEC's formal "X Platforms, Inc." doesn't reduce to our casual "X", we miss
// it — that's the correct trade under "avoid lawsuits". Pure + deterministic + heavily tested.

// Corporate-form / ultra-generic tokens stripped before comparison. Kept SHORT on purpose:
// every token NOT in here is treated as distinctive and MUST match, so we never collapse two
// different entities (e.g. "Apple" vs "Apple Bank") into one.
const STRIP_TOKENS = new Set([
  'inc', 'incorporated', 'llc', 'llp', 'lp', 'ltd', 'limited', 'co', 'corp', 'corporation',
  'plc', 'sa', 'ag', 'nv', 'bv', 'gmbh', 'pty', 'company', 'holdings', 'holding', 'com', 'the',
  // '&' normalizes to the joiner 'and' — a conjunction, not a distinctive token, so it's dropped
  // for comparison ("Wells Fargo & Company" ≡ "Wells Fargo", "Johnson & Johnson" ≡ "Johnson").
  'and',
]);

// Lowercase, drop CIK/ticker parentheticals, punctuation → space, collapse whitespace.
export function normalizeCompanyName(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/\(\s*cik[^)]*\)/g, ' ')  // "(CIK 0001230276)"
    .replace(/\([^)]*\)/g, ' ')         // any other parenthetical (ticker, etc.)
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')       // punctuation, commas, dots → space
    .replace(/\s+/g, ' ')
    .trim();
}

// Distinctive tokens after stripping corporate-form words. Falls back to the raw tokens when a
// name is ENTIRELY generic (so an all-suffix string never becomes the empty set that matches
// everything).
export function coreTokens(raw) {
  const toks = normalizeCompanyName(raw).split(' ').filter(Boolean);
  const core = toks.filter((t) => !STRIP_TOKENS.has(t));
  return core.length ? core : toks;
}

/**
 * Confidence that two company names denote the SAME legal entity.
 * Returns 'high' only on exact normalized equality OR identical distinctive-token SETS.
 * Everything else is 'none' — not safe to surface. There is intentionally no fuzzy middle.
 */
export function companyMatchConfidence(a, b) {
  const na = normalizeCompanyName(a);
  const nb = normalizeCompanyName(b);
  if (!na || !nb) return 'none';
  if (na === nb) return 'high';

  const ca = coreTokens(a);
  const cb = coreTokens(b);
  if (!ca.length || !cb.length) return 'none';

  const sa = new Set(ca);
  const sb = new Set(cb);
  // Same distinctive-token set (order-independent) → same entity. A single extra distinctive
  // token on either side (e.g. "General" vs "General Motors", "Apple" vs "Apple Bank") fails.
  const sameSet = sa.size === sb.size && [...sa].every((t) => sb.has(t));
  return sameSet ? 'high' : 'none';
}

/**
 * Best HIGH-confidence match for a source (official-record) company name against our candidates.
 * @param {string} sourceName
 * @param {Array<string|{name:string,key?:string}>} candidates
 * @returns {{name:string, key:string|null, confidence:'high'}|null}  null when nothing is safe.
 */
export function bestCompanyMatch(sourceName, candidates = []) {
  for (const c of candidates) {
    const name = typeof c === 'string' ? c : c && c.name;
    if (!name) continue;
    if (companyMatchConfidence(sourceName, name) === 'high') {
      return { name, key: typeof c === 'string' ? null : (c.key ?? null), confidence: 'high' };
    }
  }
  return null;
}

// ── O(1) index matching ──────────────────────────────────────────────────────
// For matching a batch of source names against thousands of our companies, precompute a key =
// the distinctive-token set, order-independent. Two names share a key IFF companyMatchConfidence
// would return 'high' on their core sets — so an index hit is exactly a high-confidence match.
// (Exact-normalized-equality high cases also share a key, since equal strings → equal core sets.)
export function companyIndexKey(name) {
  const core = coreTokens(name);
  return core.length ? [...core].sort().join(' ') : '';
}

// Build a Map<indexKey, {name, key}> from our candidates (first writer wins on collision).
export function buildCompanyIndex(candidates = []) {
  const idx = new Map();
  for (const c of candidates) {
    const name = typeof c === 'string' ? c : c && c.name;
    if (!name) continue;
    const k = companyIndexKey(name);
    if (k && !idx.has(k)) idx.set(k, { name, key: typeof c === 'string' ? null : (c.key ?? null) });
  }
  return idx;
}

// Look a source (official-record) name up in the index. null when no high-confidence match.
export function matchViaIndex(index, sourceName) {
  const k = companyIndexKey(sourceName);
  if (!k) return null;
  const hit = index.get(k);
  return hit ? { name: hit.name, key: hit.key, confidence: 'high' } : null;
}
