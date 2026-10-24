// Where a search typed into the homepage box goes. The box says "Company or job title", so both must
// land somewhere useful (conversion audit 2026-10-24: "barista", "cashier", "driver", "warehouse"
// went to /company/barista → "Can't verify 'barista'", a dead end for the visitor the page invited).
//
// Rule: a query that names a company Seen knows → that company's page; anything else → job search
// (`/jobs?q=…&loc=…`, which reads ?q on load). "Knows" = the SAME resolver every company box uses
// (POST /api/reports {action:'resolve'}: aliases + company_scores), and the match must be the company
// itself, not a word inside a longer name ("software engineer" → "veeam software" is not a match).
//
// Pure; relative imports only so `node --test lib/searchRoute.test.mjs` runs it as is.

export type ResolveCandidate = { name?: string | null; match_confidence?: number | null; via_alias?: boolean | null }

/** The resolver's confidence for a near-exact name (exact = 99, alias = 97, "starbuck" → "starbucks" = 80). */
export const COMPANY_MATCH_MIN = 80

/** The one company slug scheme (CLAUDE.md): lowercase, spaces → hyphens, encodeURIComponent. */
export const companySlug = (name: string): string => encodeURIComponent(name.toLowerCase().trim().replace(/\s+/g, '-'))

// Legal suffixes and punctuation never decide a match: "mcdonalds" = "McDonald's", "walmart inc" = "walmart".
const norm = (s: string): string => s.toLowerCase()
  .replace(/[\s,]+(inc|llc|corp|corporation|co|ltd|plc|company)\.?$/i, '')
  .replace(/[^a-z0-9]+/g, '')

/** The candidate that IS the typed company, or null. `candidates` is the resolver's answer. */
export function knownCompany(query: string, candidates: ResolveCandidate[] | null | undefined): string | null {
  const q = norm(query)
  if (!q) return null
  for (const c of Array.isArray(candidates) ? candidates : []) {
    const name = String(c?.name ?? '').trim()
    if (!name) continue
    if (norm(name) === q) return name
    if (c.via_alias) return name
    if (Number(c.match_confidence) >= COMPANY_MATCH_MIN) return name
  }
  return null
}

/** `/jobs?q=…&loc=…` — the job-search landing for a query (the jobs page reads both on load). */
export function jobsSearchHref(query: string, location = ''): string {
  const q = query.trim()
  const l = location.trim()
  return `/jobs?q=${encodeURIComponent(q)}${l ? `&loc=${encodeURIComponent(l)}` : ''}`
}

/**
 * Route for a homepage search. `candidates` = the resolver's answer for `query`, or null when the lookup
 * failed (offline / API down): then a query is sent to the company page as before, since that page
 * verifies the name itself and now offers "See '{q}' jobs" when it can't.
 * Returns null for an empty query with no location; a location alone opens job search there.
 */
export function homeSearchRoute(query: string, location: string, candidates: ResolveCandidate[] | null): { kind: 'company' | 'jobs'; href: string } | null {
  const q = query.trim()
  const l = location.trim()
  if (!q) return l ? { kind: 'jobs', href: `/jobs?loc=${encodeURIComponent(l)}` } : null
  if (candidates === null) return { kind: 'company', href: `/company/${companySlug(q)}` }
  const hit = knownCompany(q, candidates)
  if (hit) return { kind: 'company', href: `/company/${companySlug(hit)}` }
  return { kind: 'jobs', href: jobsSearchHref(q, l) }
}
