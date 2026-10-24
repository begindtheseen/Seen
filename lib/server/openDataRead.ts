// Server-only reader for the open dataset (/data, its CSV/JSON, /lists/*, /llms.txt, /llms-full.txt).
//
// One snapshot, cached for an hour across instances (Next data cache via unstable_cache), so the
// files and pages built from it in the same hour carry the same numbers and Supabase is read once:
//   1. every company_scores row that could be gradeable (≥1 first-party report, or a legacy
//      'reports'-derived row), keyset-paged by id because PostgREST caps a reply at 1,000 rows
//      (lib/server/sitemapCompanies.js); the newest row per name wins, like getScore();
//   2. the per-company count of scorable, resolved report rows found in PUBLIC POSTS (Reddit threads,
//      "Public review · <host>" rows, rows imported from review sites), same classifiers as the company
//      page (lib/reportSource.ts). If that read fails the split is unknown (null), never guessed.
//
// Rows are mapped by lib/growth.ts growthScoreFromRow, the function getScore() uses. Read-only.
// A failed read THROWS inside the cache function so a failure is never cached; callers catch it.

import { unstable_cache } from 'next/cache'
import { growthScoreFromRow, GROWTH_SCORE_COLUMNS, type GrowthScore } from '@/lib/growth'
import { mentionSel } from '@/lib/server/scoreColumns.js'
import { SCORABLE_REPORTS_FILTER } from '@/lib/server/reportCounts.js'
import { NONTERMINAL_OUTCOMES } from '@/api/_utils/companyIntel.js'
import { isImportedReview, isPublicDiscussion } from '@/lib/reportSource'
import { buildDataset, type Dataset } from '@/lib/openDataset'

const PAGE = 1000
const MAX_PAGES = 60
const TIMEOUT_MS = 8000

type Creds = { url: string; key: string }
function creds(): Creds | null {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  return url && key ? { url, key } : null
}

async function getJson(c: Creds, path: string): Promise<any[]> {
  const r = await fetch(`${c.url}/rest/v1/${path}`, {
    headers: { apikey: c.key, Authorization: `Bearer ${c.key}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!r.ok) throw new Error(`open data read ${r.status}`)
  const rows = await r.json()
  if (!Array.isArray(rows)) throw new Error('open data read: not an array')
  return rows
}

/** Keyset pages over `id` (stable while rows are added; offsets are not). */
async function readAll(c: Creds, base: string): Promise<any[]> {
  const out: any[] = []
  let last: string | null = null
  for (let i = 0; i < MAX_PAGES; i++) {
    const rows = await getJson(c, `${base}&order=id.asc&limit=${PAGE}${last ? `&id=gt.${encodeURIComponent(last)}` : ''}`)
    out.push(...rows)
    if (rows.length < PAGE) return out
    last = String(rows[rows.length - 1].id)
  }
  throw new Error('open data read: too many pages')
}

async function readScores(c: Creds): Promise<GrowthScore[]> {
  const headers = { apikey: c.key, Authorization: `Bearer ${c.key}` }
  const sel = `id,${GROWTH_SCORE_COLUMNS}${await mentionSel(c.url, headers)}`
  const gate = encodeURIComponent('(first_party_report_count.gte.1,and(first_party_report_count.is.null,data_source.eq.reports))')
  const rows = await readAll(c, `company_scores?select=${sel}&or=${gate}`)
  // Newest row per stored name (getScore reads `order=created_at.desc&limit=1`).
  const newest = new Map<string, any>()
  for (const row of rows) {
    const k = String(row?.company_name ?? '').toLowerCase().trim()
    if (!k) continue
    const prev = newest.get(k)
    if (!prev || Date.parse(row.created_at ?? '') > Date.parse(prev.created_at ?? '')) newest.set(k, row)
  }
  const out: GrowthScore[] = []
  for (const row of newest.values()) {
    const s = growthScoreFromRow(row)
    if (s?.gradeable) out.push(s)
  }
  return out
}

async function readPublicCounts(c: Creds): Promise<Record<string, number> | null> {
  const nonterminal = encodeURIComponent(`(${[...NONTERMINAL_OUTCOMES].map((o) => `"${o}"`).join(',')})`)
  const source = encodeURIComponent('(platform.ilike.*reddit*,platform.ilike.public review ·*,trust_reason.eq.external_import)')
  try {
    const rows = await readAll(c, `reports?select=id,company_name,platform,trust_reason&${SCORABLE_REPORTS_FILTER}&outcome=not.in.${nonterminal}&or=${source}`)
    const counts: Record<string, number> = {}
    for (const r of rows) {
      if (!isPublicDiscussion(r.platform) && !isImportedReview(r.platform, r.trust_reason)) continue
      const k = String(r.company_name ?? '').toLowerCase().trim()
      if (k) counts[k] = (counts[k] ?? 0) + 1
    }
    return counts
  } catch {
    return null
  }
}

type Snapshot = { asOf: string; scores: GrowthScore[]; publicCounts: Record<string, number> | null }

const cachedSnapshot = unstable_cache(
  async (): Promise<Snapshot> => {
    const c = creds()
    if (!c) throw new Error('open data: Supabase credentials missing')
    const [scores, publicCounts] = await Promise.all([readScores(c), readPublicCounts(c)])
    return { asOf: new Date().toISOString(), scores, publicCounts }
  },
  ['seen-open-dataset-v1'],
  { revalidate: 3600, tags: ['open-dataset'] },
)

/** The dataset, or null when it cannot be read right now (callers render an honest "unavailable"). */
export async function getOpenDataset(): Promise<Dataset | null> {
  try {
    const snap = await cachedSnapshot()
    const counts = snap.publicCounts ? new Map(Object.entries(snap.publicCounts)) : null
    return buildDataset(snap.scores, counts, new Date(snap.asOf))
  } catch {
    return null
  }
}

/** Shared headers for the downloadable files: CDN-cached for an hour, readable from any origin. */
export const OPEN_FILE_HEADERS = {
  'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
  'Access-Control-Allow-Origin': '*',
} as const

export const UNAVAILABLE_HEADERS = {
  'Cache-Control': 'no-store',
  'Retry-After': '300',
  'Content-Type': 'text/plain; charset=utf-8',
} as const
