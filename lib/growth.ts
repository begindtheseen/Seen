// Shared server-side helpers for the keyless SEO/GEO growth surfaces (FAQ, compare, reddit, OG
// images). All data comes from the app's OWN proven public endpoint — POST /api/reports — the
// exact pattern app/company/[slug]/layout.tsx getScore() already uses. NO external services.

import { tenureAdjustment } from '@/api/_utils/companyScore.js'
import { firstPartyReportCount as firstPartyCountOf, webClaimCount, isGradeable, MIN_REPORTS_FOR_GRADE } from '@/lib/server/reportCounts.js'

export { MIN_REPORTS_FOR_GRADE }

export type GrowthScore = {
  /** The STORED canonical company name (lowercase, real punctuation — e.g. "lowe's"). */
  company_name?: string | null
  /** False below MIN_REPORTS_FOR_GRADE real reports — then every verdict field below is null. */
  gradeable: boolean
  overall_score: number | null
  ghost_rate: number | null
  response_rate: number | null
  avg_wait_days: number | null
  avg_rounds?: number | null
  report_count: number
  /** Real applicant-report rows behind the score (migration 063). */
  first_party_report_count?: number | null
  /** LLM web-research *claimed* mention count — never applicant reports. */
  web_report_count?: number | null
  data_source?: string | null
  risk_level: 'safe' | 'warn' | 'danger' | null
  industry?: string | null
  waste?: number | null
  summary?: string | null
}

// Honest count for public claims ("N applicant reports", schema.org ratingCount): first-party
// rows only. Legacy rows (pre-063) infer from data_source — only 'reports'-derived scores were
// counted from real rows; anything else is a web-research claim and yields 0 here.
// Canonical implementation lives in lib/server/reportCounts.js (shared with api/*.js + ghostReport).
export function firstPartyReportCount(s: GrowthScore | null | undefined): number {
  return firstPartyCountOf(s)
}

export type LeaderboardRow = {
  name: string
  industry?: string
  verified?: boolean
  score: {
    /** False below MIN_REPORTS_FOR_GRADE real reports — then the verdict fields are null. */
    gradeable: boolean
    overall_score: number | null
    ghost_rate: number | null
    response_rate: number | null
    avg_wait_days: number | null
    /** FUSED total (first-party + web claim) — ordering/scoring only, NEVER label it "reports". */
    report_count: number
    /** Real applicant-report rows behind the score — the only count that may render as "reports". */
    first_party_report_count: number
    /** Web-research claimed mention count — an estimate input, never applicant reports. */
    web_report_count: number
    data_source: string | null
    risk_level: 'safe' | 'warn' | 'danger' | null
    waste: number | null
  }
}

// One company_scores row → LeaderboardRow. Shared by every leaderboard-shaped reader so the honest
// split is always present (a reader that forgot it is how /agencies came to call a web-research
// claim "3,085 applicant reports").
type ScoreDbRow = {
  company_name: string
  industry?: string | null
  verification_status?: string | null
  overall_score?: number | null
  ghost_rate?: number | null
  response_rate?: number | null
  avg_wait_days?: number | null
  waste_score?: number | null
  report_count?: number | null
  first_party_report_count?: number | null
  web_report_count?: number | null
  data_source?: string | null
}
function toLeaderboardRow(c: ScoreDbRow): LeaderboardRow {
  // Grade gate (lib/server/reportCounts.js): below the report bar the row keeps its counts but carries
  // no verdict — every score field is null, never a 0 that would render as an "F".
  const gradeable = isGradeable(c)
  const s = c.overall_score || 0
  return {
    name: c.company_name,
    industry: c.industry || '',
    verified: c.verification_status === 'verified',
    score: {
      gradeable,
      overall_score: gradeable ? s : null,
      ghost_rate: gradeable ? c.ghost_rate || 0 : null,
      response_rate: gradeable ? c.response_rate || 0 : null,
      avg_wait_days: gradeable ? c.avg_wait_days || 0 : null,
      report_count: c.report_count || 0,
      first_party_report_count: firstPartyCountOf(c),
      web_report_count: webClaimCount(c),
      data_source: c.data_source ?? null,
      risk_level: gradeable ? (s >= 70 ? 'safe' : s >= 40 ? 'warn' : 'danger') : null,
      waste: gradeable ? c.waste_score || 0 : null,
    },
  }
}

const LEADERBOARD_SELECT = 'company_name,overall_score,ghost_rate,response_rate,avg_wait_days,waste_score,report_count,first_party_report_count,web_report_count,data_source,data_quality,verification_status,industry'

// These SEO/GEO helpers NEVER self-fetch the app's own live API (https://seenjobs.io/api/reports).
// A build-time self-fetch has no timeout by default and would pin a `next build` worker forever if
// the live site is slow/unreachable — and gating on NEXT_PHASE proved unreliable across build
// environments (static generation can run in worker processes where the env var isn't observed).
// So these server helpers read the cached scores DIRECTLY from Supabase in BOTH build and runtime:
// deterministic, fast, and impossible to hang on a self-response. On-demand scoring for long-tail
// companies still happens on the CLIENT company page (app/company/[slug]/page.tsx is 'use client'
// and calls /api/reports from the browser), which primes the cache these helpers read.
//
// Every read is capped with AbortSignal.timeout — Node's fetch has no default timeout.
// Tight on purpose: this fetch runs INSIDE the OG-image render. Link crawlers (Reddit ≈4s
// total) cache "no preview" forever for a URL whose image blows their budget — an 8s timeout
// (×2 with the fuzzy retry) did exactly that. Worst case now: fast branded no-data card,
// which beats a permanently blank unfurl.
const FETCH_TIMEOUT_MS = 2500

// Service-key Supabase creds. These functions are ONLY called from server components (no
// 'use client' importer calls getScore/getLeaderboard), the service key is not NEXT_PUBLIC_, and
// it is referenced only inside this function body — so it can never reach a client bundle.
function sbCreds(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  return url && key ? { url, key } : null
}

// Mirror of api/reports.js `_fuzzyNamePattern` — a slug decodes hyphens to spaces ("coca cola"),
// so a token-wildcard ilike still matches the stored ("coca*cola") score row.
const fuzzyPattern = (name: string) =>
  encodeURIComponent(String(name).toLowerCase().trim().replace(/[\s-]+/g, '*'))

// Build-time: read one company's cached score straight from Supabase. Mirrors the cache-hit shape
// of api/reports.js `_rowToScore` INCLUDING the tenure adjustment — the OG unfurl and the live
// page must show the SAME grade (a Reddit post whose preview says 78 while the page says 84 reads
// as a lie; audit finding "two different Seen Grades in a single post").
async function scoreFromDb(name: string): Promise<GrowthScore | null> {
  const creds = sbCreds()
  if (!creds) return null
  const headers = { apikey: creds.key, Authorization: `Bearer ${creds.key}` }
  const sel = 'select=company_name,overall_score,ghost_rate,response_rate,avg_wait_days,avg_rounds,report_count,first_party_report_count,web_report_count,data_source,waste_score,industry,raw_summary,avg_tenure_months,tenure_sample_count'
  try {
    const enc = encodeURIComponent(name.toLowerCase().trim())
    let r = await fetch(`${creds.url}/rest/v1/company_scores?company_name=ilike.${enc}&${sel}&order=created_at.desc&limit=1`, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    let rows = r.ok ? await r.json() : null
    if ((!rows || !rows[0]) && /[\s-]/.test(name)) {
      r = await fetch(`${creds.url}/rest/v1/company_scores?company_name=ilike.${fuzzyPattern(name)}&${sel}&order=created_at.desc&limit=1`, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      rows = r.ok ? await r.json() : null
    }
    const row = rows?.[0]
    if (!row || row.overall_score == null) return null
    // Same tenure fold-in as the live read path (api/reports.js _rowToScore) — canonical
    // implementation imported, not mirrored, so the two can't drift.
    const tAdj = tenureAdjustment(row.avg_tenure_months, row.tenure_sample_count)
    const s = Math.max(0, Math.min(100, Math.round(row.overall_score + tAdj)))
    // Same grade gate as api/reports.js gateScore: the OG card, SEO title and page must agree.
    const gradeable = isGradeable(row)
    return {
      company_name: row.company_name ?? null,
      gradeable,
      overall_score: gradeable ? s : null,
      ghost_rate: gradeable ? row.ghost_rate ?? null : null,
      response_rate: gradeable ? row.response_rate ?? null : null,
      avg_wait_days: gradeable ? row.avg_wait_days ?? null : null,
      avg_rounds: gradeable ? row.avg_rounds ?? null : null,
      report_count: row.report_count ?? 0,
      first_party_report_count: row.first_party_report_count ?? null,
      web_report_count: row.web_report_count ?? null,
      data_source: row.data_source ?? null,
      risk_level: gradeable ? (s >= 70 ? 'safe' : s >= 40 ? 'warn' : 'danger') : null,
      industry: row.industry || null,
      waste: gradeable ? row.waste_score ?? null : null,
      summary: row.raw_summary || null,
    }
  } catch {
    return null
  }
}

// Build-time leaderboard read — mirrors the api/reports.js `action:'leaderboard'` mapping exactly.
// `by: 'first_party'` orders by REAL report rows (then fused total) — for surfaces that rank or
// count reported outcomes (/ghost-report, /reddit). The default fused order is dominated by
// web-research claims and can push a company with genuine reports out of the 150-row window.
async function leaderboardFromDb(by: 'fused' | 'first_party' = 'fused'): Promise<LeaderboardRow[]> {
  const creds = sbCreds()
  if (!creds) return []
  const headers = { apikey: creds.key, Authorization: `Bearer ${creds.key}` }
  const order = by === 'first_party' ? 'first_party_report_count.desc.nullslast,report_count.desc' : 'report_count.desc'
  try {
    const r = await fetch(
      `${creds.url}/rest/v1/company_scores?select=${LEADERBOARD_SELECT}&order=${order}&limit=150`,
      { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    )
    if (!r.ok) return []
    const rows = await r.json()
    // A leaderboard ranks verdicts — only gradeable companies are on it.
    return (Array.isArray(rows) ? rows : []).map(toLeaderboardRow).filter((row) => row.score.gradeable)
  } catch {
    return []
  }
}

// Company slug — MUST round-trip through /company/[slug]'s decoder
// (decodeURIComponent(slug).replace(/-/g,' ')). The old version stripped punctuation
// ("H&M" → "hm", "McDonald's" → "mcdonalds"), so every share/sitemap/compare link for a
// punctuated company landed on a page whose name lookup could never match.
export const slugify = (name: string) =>
  encodeURIComponent(name.toLowerCase().trim().replace(/\s+/g, '-'))

export const titleCase = (slug: string) =>
  decodeURIComponent(slug).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

// Canonical display name from a STORED company_name ("lowe's" → "Lowe's"). titleCase is
// slug-oriented (hyphens → spaces, \b-based) and mangles punctuation two ways: the slug path
// renders "Lowe S" and \b\w would render "Lowe'S". This only capitalizes the first letter of
// each space-separated word, so punctuation inside a word survives. Prefer it whenever a
// score row is in hand — the stored name carries the company's real punctuation.
export const displayCompanyName = (name: string) =>
  String(name).split(' ').map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ')

// 0–100 score → letter grade. Matches the scale used on the companies leaderboard.
// Callers must only pass a GRADEABLE score (see GrowthScore.gradeable) — never a 0 stand-in.
export function grade(score: number): string {
  if (score >= 80) return 'A'
  if (score >= 65) return 'B'
  if (score >= 50) return 'C'
  if (score >= 35) return 'D'
  return 'F'
}

export const riskColor = (risk?: string | null): string =>
  risk === 'safe' ? '#10b981' : risk === 'danger' ? '#ef4444' : '#f59e0b'

export const riskLabel = (risk?: string | null): string =>
  risk === 'safe' ? 'SAFE' : risk === 'danger' ? 'DANGER' : 'CAUTION'

export const pct = (v: number | null | undefined) =>
  v == null ? null : Math.round(v * 100)

// A single company's real score — read DIRECTLY from the cached company_scores table (never a
// self-fetch of the live API). Server-only; returns null when no data / creds absent / on failure.
export async function getScore(nameOrSlug: string): Promise<GrowthScore | null> {
  const name = nameOrSlug.includes('-') ? nameOrSlug.replace(/-/g, ' ') : nameOrSlug
  return scoreFromDb(name)
}

// The public leaderboard — read DIRECTLY from company_scores (never a self-fetch of the live API).
export async function getLeaderboard(opts: { by?: 'fused' | 'first_party' } = {}): Promise<LeaderboardRow[]> {
  return leaderboardFromDb(opts.by ?? 'fused')
}

// Batch score lookup by EXACT stored names (company_scores stores names trim().toLowerCase()).
// One PostgREST in.() read — same direct-from-Supabase, timeout-guarded pattern as the helpers
// above (never a self-fetch of the live API). Returns a map keyed by the stored company_name;
// when a company has multiple score rows, the most recent one wins. Names that don't match
// return nothing — callers treat that as "no data", never as a reason to guess.
export async function getScoresByNames(namesLower: string[]): Promise<Map<string, LeaderboardRow>> {
  const out = new Map<string, LeaderboardRow>()
  const creds = sbCreds()
  if (!creds || !namesLower.length) return out
  const headers = { apikey: creds.key, Authorization: `Bearer ${creds.key}` }
  // in.() values are double-quoted (names contain spaces / "/"), then the whole list is
  // URI-encoded. None of our curated names contain a double quote.
  const list = encodeURIComponent(`(${namesLower.map(n => `"${n.trim().toLowerCase()}"`).join(',')})`)
  const sel = `select=${LEADERBOARD_SELECT},created_at`
  try {
    const r = await fetch(
      `${creds.url}/rest/v1/company_scores?company_name=in.${list}&${sel}&order=created_at.desc&limit=200`,
      { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    )
    if (!r.ok) return out
    const rows = await r.json()
    for (const c of Array.isArray(rows) ? rows : []) {
      if (!c?.company_name || out.has(c.company_name)) continue // created_at.desc → first row per name is newest
      out.set(c.company_name, toLeaderboardRow(c))
    }
    return out
  } catch {
    return out
  }
}

// ── Employer perks (Engine E4 — paid Featured placement + Transparency Verified badge) ──────
// Read time-boxed perks from employer_perks (keyed by lowercased company name). Server-only,
// timeout-guarded, direct from Supabase — never a self-fetch of the live API. Perks NEVER touch a
// score: featured is placement, verified is a displayed commitment the admin granted after review.

export type EmployerPerk = { featured: boolean; verified: boolean }

// One company's active perks — for the company page badge. Returns all-false when absent/expired.
export async function getEmployerPerk(nameOrSlug: string): Promise<EmployerPerk> {
  const creds = sbCreds()
  const none = { featured: false, verified: false }
  if (!creds) return none
  const name = (nameOrSlug.includes('-') ? nameOrSlug.replace(/-/g, ' ') : nameOrSlug).toLowerCase().trim()
  const headers = { apikey: creds.key, Authorization: `Bearer ${creds.key}` }
  try {
    const r = await fetch(`${creds.url}/rest/v1/employer_perks?company=eq.${encodeURIComponent(name)}&select=featured_until,verified_until&limit=1`, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!r.ok) return none
    const row = (await r.json())?.[0]
    if (!row) return none
    const now = Date.now()
    const active = (v: string | null) => !!v && Date.parse(v) > now
    return { featured: active(row.featured_until), verified: active(row.verified_until) }
  } catch {
    return none
  }
}

// Set of lowercased company names with an ACTIVE featured perk — for the search placement boost +
// "Featured" badge. Small table; one read, timeout-guarded.
export async function getFeaturedCompanies(): Promise<Set<string>> {
  const out = new Set<string>()
  const creds = sbCreds()
  if (!creds) return out
  const headers = { apikey: creds.key, Authorization: `Bearer ${creds.key}` }
  const nowIso = new Date().toISOString()
  try {
    const r = await fetch(`${creds.url}/rest/v1/employer_perks?featured_until=gt.${encodeURIComponent(nowIso)}&select=company&limit=500`, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!r.ok) return out
    for (const row of (await r.json()) || []) if (row?.company) out.add(String(row.company).toLowerCase())
    return out
  } catch {
    return out
  }
}

// Top long-tail companies seeded for static generation (FAQ pages). These are the names people
// actually type into Google / Reddit ("does <x> ghost applicants"). Real data is fetched per page;
// this is only the static-params seed list — other companies render on-demand.
export const SEED_COMPANIES: string[] = [
  'Amazon', 'Google', 'Apple', 'Microsoft', 'Meta', 'Netflix', 'Tesla', 'Nvidia',
  'Starbucks', 'Target', 'Walmart', 'Costco', 'Chipotle', 'McDonalds', 'Best Buy',
  'Home Depot', 'Lowes', 'Whole Foods', 'Trader Joes', 'CVS', 'Walgreens', 'UPS',
  'FedEx', 'Deloitte', 'Accenture', 'JPMorgan Chase', 'Goldman Sachs', 'Salesforce',
  'Oracle', 'IBM',
]
