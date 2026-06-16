// Pure relevance + company-match logic for job search. No I/O → unit-testable.
//
// Two jobs:
//  - relevanceScore/isRelated: keep only listings RELATED to the query (a query
//    token must appear in title/company/description), ranked title > company > desc.
//  - looksLikeCompany: detect a company-name search so it returns that company's
//    listings rather than keyword-matched roles.

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'for', 'in', 'at', 'to', 'jobs', 'job', 'near', 'me', 'remote', 'hiring', 'careers', 'role', 'roles', 'position', 'positions', 'opening', 'openings']);

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

// Relevance score of a listing for a query. Title hits weigh most, then company,
// then description. Returns 0 when no query token appears anywhere (→ unrelated).
export function relevanceScore(job, query) {
  const tokens = tokenize(query);
  if (!tokens.length) return 1; // empty query: everything is "related"
  const title = String(job.title || '').toLowerCase();
  const company = normalizeCompany(job.company);
  const desc = String(job.description || '').toLowerCase();
  const qNorm = normalizeCompany(query);

  let score = 0;
  // Whole-query company match (company search).
  if (qNorm && (company === qNorm || company.includes(qNorm) || (qNorm.length >= 4 && qNorm.includes(company) && company.length >= 4))) {
    score += 60;
  }
  for (const t of tokens) {
    if (title.includes(t)) score += 12;
    else if (company.includes(t)) score += 8;
    else if (desc.includes(t)) score += 3;
  }
  // Phrase bonus: the full query appears verbatim in the title.
  if (qNorm && title.includes(qNorm)) score += 20;
  return score;
}

// Is this listing related enough to show? (Any token hit, by default.)
export function isRelated(job, query, minScore = 1) {
  if (!tokenize(query).length) return true;
  return relevanceScore(job, query) >= minScore;
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

// Filter to related listings and rank by relevance, then quality score.
export function filterAndRank(jobs, query, { minScore = 1 } = {}) {
  const hasQuery = tokenize(query).length > 0;
  const scored = (jobs || [])
    .map((j) => ({ j, r: relevanceScore(j, query) }))
    .filter((x) => !hasQuery || x.r >= minScore);
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

// PostgREST ilike term to pre-filter the DB query to the searched place (city
// preferred, else state name). '' when there's no usable location.
export function locationDbTerm(loc) {
  const p = parseLocation(loc);
  return (p && (p.city || p.stateName)) || '';
}
