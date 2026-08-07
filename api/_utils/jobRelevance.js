// Pure relevance + company-match logic for job search. No I/O → unit-testable.
//
// Two jobs:
//  - relevanceScore/isRelevant: keep only listings GENUINELY related to the query.
//    The bar is a TITLE/role signal — a query token, the query phrase, or a TRUE
//    synonym must appear in the TITLE (or the company, for a company search). A term
//    that appears only in the description, or only via an over-broad expansion token
//    (e.g. the generic word "sales"), is NOT enough. This is the fix for the reported
//    leak: searching "budtender" was returning a "Sales Manager" because expansion
//    terms were tokenized into one loose bag and a description/generic hit cleared the
//    threshold. Now the original query drives relevance and expansion terms only count
//    as SYNONYM PHRASES matched against the title (generic single words are ignored).
//  - looksLikeCompany: detect a company-name search so it returns that company's
//    listings rather than keyword-matched roles.

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'for', 'in', 'at', 'to', 'jobs', 'job', 'near', 'me', 'remote', 'hiring', 'careers', 'role', 'roles', 'position', 'positions', 'opening', 'openings']);

// Single words that are too generic to establish relevance on their own. A synonym that
// is JUST one of these (e.g. expansion returns the bare word "sales" for "budtender") is
// dropped, so it can never rescue an unrelated title like "Sales Manager". Discriminating
// single-word synonyms (cannabis, dispensary, nurse, welder, barista, …) are NOT in here.
const GENERIC_SYNONYM = new Set([
  'sales', 'manager', 'management', 'associate', 'assistant', 'representative', 'rep',
  'coordinator', 'specialist', 'agent', 'clerk', 'staff', 'professional', 'consultant',
  'officer', 'supervisor', 'administrator', 'executive', 'operator', 'general', 'team',
  'member', 'worker', 'personnel', 'employee', 'senior', 'junior', 'entry', 'level',
  'full', 'part', 'time', 'hybrid', 'onsite', 'trainee', 'apprentice',
]);

// Curated true-synonym sets for high-value / niche roles whose synonyms share NO token
// with the query (so a token match can never find them). Keyed by the normalized query.
// This hardens relevance even when the LLM expansion is unavailable or returns junk.
// Callers may pass additional synonyms (the DB/LLM expansion terms) via options.
const ROLE_SYNONYMS = {
  budtender: ['budtender', 'cannabis', 'dispensary', 'marijuana', 'weed', 'cannabis associate', 'dispensary associate', 'dispensary agent', 'cannabis consultant', 'weed dispensary'],
  barista: ['barista', 'coffee', 'espresso', 'cafe', 'coffee shop'],
  bartender: ['bartender', 'barback', 'mixologist', 'bar tender'],
  phlebotomist: ['phlebotomist', 'phlebotomy', 'blood draw'],
  dishwasher: ['dishwasher', 'kitchen steward', 'dish washer'],
  caregiver: ['caregiver', 'caregiving', 'home care aide', 'personal care aide', 'direct support'],
};

export function tokenize(q) {
  return String(q || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t));
}

export function normalizeCompany(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[\s,]+(inc\.?|llc\.?|corp\.?|ltd\.?|co\.|plc\.?|group|holdings|enterprises|solutions|technologies)\.?$/i, '')
    .trim();
}

// Resolve the effective true-synonym phrases for a query: the built-in curated set for
// the query PLUS any caller-provided expansion terms, cleaned. A single-word synonym is
// kept only if it is discriminating (not in GENERIC_SYNONYM and ≥3 chars); multi-word
// phrases are specific enough to keep as-is. Deduped, lowercased.
export function effectiveSynonyms(query, extra = []) {
  const tokens = tokenize(query);
  const qNorm = normalizeCompany(query);
  const built = ROLE_SYNONYMS[tokens.join(' ')] || ROLE_SYNONYMS[qNorm] || ROLE_SYNONYMS[String(query || '').toLowerCase().trim()] || [];
  const out = new Set();
  for (const raw of [...built, ...(Array.isArray(extra) ? extra : [])]) {
    const s = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!s) continue;
    const words = s.split(' ');
    if (words.length === 1) {
      if (s.length >= 3 && !GENERIC_SYNONYM.has(s)) out.add(s);
    } else {
      out.add(s);
    }
  }
  return [...out];
}

// True iff a synonym appears in the title as a real token/phrase (word-boundary for a
// single word so "cannabis" doesn't match inside another word; substring for a phrase).
function titleHasSynonym(title, syn) {
  if (!syn) return false;
  if (syn.includes(' ')) return title.includes(syn);
  return new RegExp(`(^|[^a-z0-9])${syn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(title);
}

// Whole-query company match (a company-name search like "stripe").
function isCompanyMatch(company, qNorm) {
  return !!qNorm && (company === qNorm || company.includes(qNorm) || (qNorm.length >= 4 && qNorm.includes(company) && company.length >= 4));
}

// Relevance score of a listing for a query — used for RANKING. Title hits weigh most,
// then company, then description; a true-synonym phrase in the title adds a boost; the
// full query phrase in the title adds a big bonus. Returns 0 when nothing matches.
// Description hits still contribute to the RANK (as a weak tiebreaker) but — unlike the
// old behavior — a description-only hit does NOT make a listing relevant (see isRelevant).
export function relevanceScore(job, query, { synonyms = [] } = {}) {
  const tokens = tokenize(query);
  if (!tokens.length) return 1; // empty query: everything is "related"
  const title = String(job.title || '').toLowerCase();
  const company = normalizeCompany(job.company);
  const desc = String(job.description || '').toLowerCase();
  const qNorm = normalizeCompany(query);

  let score = 0;
  if (isCompanyMatch(company, qNorm)) score += 60;
  for (const t of tokens) {
    if (title.includes(t)) score += 12;
    else if (company.includes(t)) score += 8;
    else if (desc.includes(t)) score += 3;
  }
  // Phrase bonus: the full query appears verbatim in the title.
  if (qNorm && title.includes(qNorm)) score += 20;
  // True-synonym title match (e.g. "budtender" → a "Cannabis Dispensary Associate").
  for (const syn of effectiveSynonyms(query, synonyms)) {
    if (titleHasSynonym(title, syn)) score += 12;
  }
  return score;
}

// Is this listing GENUINELY related enough to show? The bar is a TITLE or COMPANY signal:
//  • a company-name match (company search), OR
//  • a query token in the title, OR
//  • the full query phrase in the title, OR
//  • a TRUE synonym (curated or caller-supplied expansion) in the title.
// A match found ONLY in the description, or ONLY via a generic expansion word, is NOT
// enough — that was the "budtender → Sales Manager" leak.
export function isRelevant(job, query, { synonyms = [] } = {}) {
  const tokens = tokenize(query);
  if (!tokens.length) return true; // empty query: everything is "related"
  const title = String(job.title || '').toLowerCase();
  const company = normalizeCompany(job.company);
  const qNorm = normalizeCompany(query);

  if (isCompanyMatch(company, qNorm)) return true;
  for (const t of tokens) { if (title.includes(t)) return true; }
  if (qNorm && title.includes(qNorm)) return true;
  for (const syn of effectiveSynonyms(query, synonyms)) { if (titleHasSynonym(title, syn)) return true; }
  return false;
}

// Back-compat alias. Older callers used isRelated(job, query[, minScore]); the strict
// title/synonym bar replaces the numeric threshold, so a legacy numeric arg is ignored.
export function isRelated(job, query, opts = {}) {
  return isRelevant(job, query, (opts && typeof opts === 'object') ? opts : {});
}

// Detect a company-name search: the whole query closely matches a known company.
// `knownCompanies` is an optional array/Set of company names (raw or normalized).
export function looksLikeCompany(query, knownCompanies) {
  const qn = normalizeCompany(query);
  if (!qn || qn.split(/\s+/).length > 4) return false;
  if (!knownCompanies) return false;
  const set = (Array.isArray(knownCompanies) ? knownCompanies : [...knownCompanies]).map(normalizeCompany);
  if (set.includes(qn)) return true;
  return set.some((c) => c && c.length >= 4 && (c === qn || c.includes(qn) || qn.includes(c)));
}

// Filter to GENUINELY related listings (strict title/synonym bar) and rank by relevance,
// then quality score. `synonyms` are the query's expansion terms (canonical + related)
// used as true-synonym signals — matched as title phrases, never scattered as loose tokens.
export function filterAndRank(jobs, query, { synonyms = [] } = {}) {
  const hasQuery = tokenize(query).length > 0;
  const scored = (jobs || [])
    .map((j) => ({ j, r: relevanceScore(j, query, { synonyms }) }))
    .filter((x) => !hasQuery || isRelevant(x.j, query, { synonyms }));
  scored.sort((a, b) => (b.r - a.r) || ((b.j.score || 0) - (a.j.score || 0)));
  return scored.map((x) => x.j);
}

// ── Location matching ────────────────────────────────────────────────────────
// Job locations are free-form strings ("Austin, Travis County", "Old Sixth Ward,
// Houston", "Dallas, Texas", "US"). The searched city almost always appears in the
// string, so we match on the city name (best signal), then same-state, then
// remote/national. Cross-location listings are dropped.

const US_STATES = {
  al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california',
  co: 'colorado', ct: 'connecticut', de: 'delaware', fl: 'florida', ga: 'georgia',
  hi: 'hawaii', id: 'idaho', il: 'illinois', in: 'indiana', ia: 'iowa', ks: 'kansas',
  ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland', ma: 'massachusetts',
  mi: 'michigan', mn: 'minnesota', ms: 'mississippi', mo: 'missouri', mt: 'montana',
  ne: 'nebraska', nv: 'nevada', nh: 'new hampshire', nj: 'new jersey', nm: 'new mexico',
  ny: 'new york', nc: 'north carolina', nd: 'north dakota', oh: 'ohio', ok: 'oklahoma',
  or: 'oregon', pa: 'pennsylvania', ri: 'rhode island', sc: 'south carolina',
  sd: 'south dakota', tn: 'tennessee', tx: 'texas', ut: 'utah', vt: 'vermont',
  va: 'virginia', wa: 'washington', wv: 'west virginia', wi: 'wisconsin', wy: 'wyoming',
  dc: 'district of columbia',
};
const STATE_BY_NAME = Object.fromEntries(Object.entries(US_STATES).map(([a, n]) => [n, a]));

// Parse a free-form location into { city, stateAbbr, stateName, remote }.
export function parseLocation(loc) {
  const s = String(loc || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const remote = /\bremote\b/.test(s);
  const cleaned = s.replace(/\bremote\b/g, ' ').replace(/\s+/g, ' ').replace(/^[,\s]+|[,\s]+$/g, '').trim();
  if (!cleaned) return { city: '', stateAbbr: '', stateName: '', remote };

  const parts = cleaned.split(',').map((p) => p.trim()).filter(Boolean);
  let city = parts[0] || '';
  let stateAbbr = '', stateName = '';
  const setState = (tok) => {
    if (US_STATES[tok]) { stateAbbr = tok; stateName = US_STATES[tok]; return true; }
    if (STATE_BY_NAME[tok]) { stateAbbr = STATE_BY_NAME[tok]; stateName = tok; return true; }
    return false;
  };

  if (parts.length > 1) {
    setState(parts[parts.length - 1]);
  } else if (city.includes(' ')) {
    // "austin tx" — state as the trailing word.
    const w = city.split(' ');
    if (setState(w[w.length - 1])) city = w.slice(0, -1).join(' ');
  }
  // A bare state ("texas" / "tx") with no city.
  if (parts.length === 1 && !city.includes(' ') && !stateAbbr && setState(city)) city = '';

  return { city: city.length >= 2 ? city : '', stateAbbr, stateName, remote };
}

// Higher = better location match. 3 city · 2 same-state · 1 remote/national · 0 none.
export function locationScore(jobLocation, parsed) {
  if (!parsed) return 1;
  const jl = String(jobLocation || '').toLowerCase().trim();
  if (!jl) return 1; // unknown location — don't penalise
  if (parsed.city && parsed.city.length >= 2 && jl.includes(parsed.city)) return 3;
  if (parsed.stateName && jl.includes(parsed.stateName)) return 2;
  if (parsed.stateAbbr && new RegExp(`(^|[^a-z])${parsed.stateAbbr}([^a-z]|$)`).test(jl)) return 2;
  if (jl === 'us' || jl === 'usa' || jl === 'united states' || /\bremote\b/.test(jl)) return 1;
  return 0;
}

// Keep only listings in/near the searched location, ranked city → state → remote,
// preserving the input (relevance) order within each tier. No location → unchanged.
export function filterByLocation(jobs, loc) {
  const p = parseLocation(loc);
  if (!p || (!p.city && !p.stateAbbr && !p.stateName && !p.remote)) return Array.isArray(jobs) ? jobs : [];
  const kept = [];
  (jobs || []).forEach((j, i) => {
    const s = locationScore(j.location, p);
    if (s > 0) kept.push({ j, s, i });
  });
  kept.sort((a, b) => (b.s - a.s) || (a.i - b.i));
  return kept.map((k) => k.j);
}

// Rank by proximity (city → state → remote/national → unknown → far) WITHOUT dropping
// anything. Used as a graceful widen: when strict filterByLocation would return too few,
// we still surface the closest available listings first instead of showing nothing.
export function sortByProximity(jobs, loc) {
  const p = parseLocation(loc);
  if (!p || (!p.city && !p.stateAbbr && !p.stateName && !p.remote)) return Array.isArray(jobs) ? jobs.slice() : [];
  return (jobs || [])
    .map((j, i) => ({ j, s: locationScore(j.location, p), i }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map((x) => x.j);
}

// PostgREST ilike term to pre-filter the DB query to the searched place (city
// preferred, else state name). '' when there's no usable location.
export function locationDbTerm(loc) {
  const p = parseLocation(loc);
  return (p && (p.city || p.stateName)) || '';
}
