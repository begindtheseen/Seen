// Shared server-side helpers for the keyless SEO/GEO growth surfaces (FAQ, compare, reddit, OG
// images). All data comes from the app's OWN proven public endpoint — POST /api/reports — the
// exact pattern app/company/[slug]/layout.tsx getScore() already uses. NO external services.

export type GrowthScore = {
  overall_score: number
  ghost_rate: number | null
  response_rate: number | null
  avg_wait_days: number | null
  avg_rounds?: number | null
  report_count: number
  risk_level: 'safe' | 'warn' | 'danger'
  industry?: string | null
  waste?: number | null
  summary?: string | null
}

export type LeaderboardRow = {
  name: string
  industry?: string
  verified?: boolean
  score: {
    overall_score: number
    ghost_rate: number
    response_rate: number
    avg_wait_days: number
    report_count: number
    risk_level: 'safe' | 'warn' | 'danger'
    waste: number
  }
}

const REPORTS_URL = 'https://seenjobs.io/api/reports'

// Every network call on these SEO/GEO surfaces is capped. Node's fetch has NO default timeout,
// so an uncapped self-fetch during `next build` static generation hangs the whole build forever.
const FETCH_TIMEOUT_MS = 8000

// True only inside `next build`'s static-generation phase (Next sets NEXT_PHASE itself). During
// the build we must NEVER self-fetch the live site (https://seenjobs.io) — a slow/unreachable
// response would pin a build worker indefinitely. Instead we read the cached scores DIRECTLY from
// Supabase (fast, deterministic) and fall back to an honest empty state when data/creds are absent.
// At RUNTIME (ISR revalidation on the deployed site) the live API path is kept — it adds on-demand
// scoring for long-tail companies the build never seeds.
const IS_BUILD = process.env.NEXT_PHASE === 'phase-production-build'

// Service-key Supabase creds. These modules are ALL server components (no 'use client'), and the
// service key is not NEXT_PUBLIC_, so it can never reach a client bundle.
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
// of api/reports.js `_rowToScore` for the fields GrowthScore needs (the small tenure nudge the
// live path adds on read is intentionally skipped — invisible on an SEO page, and ISR re-renders
// hourly through the live path anyway).
async function scoreFromDb(name: string): Promise<GrowthScore | null> {
  const creds = sbCreds()
  if (!creds) return null
  const headers = { apikey: creds.key, Authorization: `Bearer ${creds.key}` }
  const sel = 'select=company_name,overall_score,ghost_rate,response_rate,avg_wait_days,avg_rounds,report_count,waste_score,industry,raw_summary'
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
    const s = Math.max(0, Math.min(100, Math.round(row.overall_score)))
    return {
      overall_score: s,
      ghost_rate: row.ghost_rate ?? null,
      response_rate: row.response_rate ?? null,
      avg_wait_days: row.avg_wait_days ?? null,
      avg_rounds: row.avg_rounds ?? null,
      report_count: row.report_count ?? 0,
      risk_level: s >= 70 ? 'safe' : s >= 40 ? 'warn' : 'danger',
      industry: row.industry || null,
      waste: row.waste_score ?? null,
      summary: row.raw_summary || null,
    }
  } catch {
    return null
  }
}

// Build-time leaderboard read — mirrors the api/reports.js `action:'leaderboard'` mapping exactly.
async function leaderboardFromDb(): Promise<LeaderboardRow[]> {
  const creds = sbCreds()
  if (!creds) return []
  const headers = { apikey: creds.key, Authorization: `Bearer ${creds.key}` }
  try {
    const r = await fetch(
      `${creds.url}/rest/v1/company_scores?select=company_name,overall_score,ghost_rate,response_rate,avg_wait_days,waste_score,report_count,data_quality,verification_status,industry&order=report_count.desc&limit=150`,
      { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    )
    if (!r.ok) return []
    const rows = await r.json()
    const ov = (s: number) => s || 0
    return (Array.isArray(rows) ? rows : []).map((c) => ({
      name: c.company_name,
      industry: c.industry || '',
      verified: c.verification_status === 'verified',
      score: {
        overall_score: ov(c.overall_score),
        ghost_rate: c.ghost_rate || 0,
        response_rate: c.response_rate || 0,
        avg_wait_days: c.avg_wait_days || 0,
        report_count: c.report_count || 0,
        risk_level: ov(c.overall_score) >= 70 ? 'safe' : ov(c.overall_score) >= 40 ? 'warn' : 'danger',
        waste: c.waste_score || 0,
      },
    }))
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

// 0–100 score → letter grade. Matches the scale used on the companies leaderboard.
export function grade(score: number): string {
  if (score >= 80) return 'A'
  if (score >= 65) return 'B'
  if (score >= 50) return 'C'
  if (score >= 35) return 'D'
  return 'F'
}

export const riskColor = (risk?: string): string =>
  risk === 'safe' ? '#10b981' : risk === 'danger' ? '#ef4444' : '#f59e0b'

export const riskLabel = (risk?: string): string =>
  risk === 'safe' ? 'SAFE' : risk === 'danger' ? 'DANGER' : 'CAUTION'

export const pct = (v: number | null | undefined) =>
  v == null ? null : Math.round(v * 100)

// Fetch a single company's real score via the working serverless endpoint. Cached 1h, deduped
// across generateMetadata + render within a request. Returns null when no data / on failure.
export async function getScore(nameOrSlug: string): Promise<GrowthScore | null> {
  const name = nameOrSlug.includes('-') ? nameOrSlug.replace(/-/g, ' ') : nameOrSlug
  // Build-time: read the cached score straight from Supabase — never self-fetch the live site.
  if (IS_BUILD) return scoreFromDb(name)
  try {
    const r = await fetch(REPORTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!r.ok) return null
    const d = await r.json()
    const s = d?.score
    if (!s || s.overall_score == null) return null
    return {
      overall_score: s.overall_score,
      ghost_rate: s.ghost_rate ?? null,
      response_rate: s.response_rate ?? null,
      avg_wait_days: s.avg_wait_days ?? null,
      avg_rounds: s.avg_rounds ?? null,
      report_count: s.report_count ?? 0,
      risk_level: s.risk_level ?? 'warn',
      industry: s.industry ?? null,
      waste: s.waste ?? null,
      summary: s.summary ?? null,
    }
  } catch {
    return null
  }
}

// Fetch the public leaderboard (real aggregated company data). Cached 1h.
export async function getLeaderboard(): Promise<LeaderboardRow[]> {
  // Build-time: read the leaderboard straight from Supabase — never self-fetch the live site.
  if (IS_BUILD) return leaderboardFromDb()
  try {
    const r = await fetch(REPORTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'leaderboard' }),
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!r.ok) return []
    const d = await r.json()
    return Array.isArray(d?.companies) ? d.companies : []
  } catch {
    return []
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
