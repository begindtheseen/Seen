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
