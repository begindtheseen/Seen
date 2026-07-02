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
  try {
    const name = nameOrSlug.includes('-') ? nameOrSlug.replace(/-/g, ' ') : nameOrSlug
    const r = await fetch(REPORTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
      next: { revalidate: 3600 },
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
  try {
    const r = await fetch(REPORTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'leaderboard' }),
      next: { revalidate: 3600 },
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
