// Server-only data for a company page's first paint, beside the stored score the layout reads itself
// (lib/growth.ts getScoreState): the report rows that score is built from, and the company's open job posts.
// One request reads each of them once — generateMetadata and the layout share the results through React's
// per-request cache().
//
// Request-path rules (CLAUDE.md 2026-11-12): no description / report_text column is selected; one exact
// company-name filter per read (no OR of patterns); counts come from keyset pages over id
// (lib/server/openDataRead.ts pattern); every read has a timeout, and the page renders without a read
// that is slow rather than waiting on it (the client components below still fetch on their own).
//
// The rows and the listings are cached across requests for a few minutes (Next data cache via
// unstable_cache). A failed read THROWS inside the cached function, so a failure is never cached.

import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { slugToName, type GrowthScore } from '@/lib/growth'
import { SCORABLE_REPORTS_FILTER } from '@/lib/server/reportCounts.js'
import { NONTERMINAL_OUTCOMES } from '@/api/_utils/companyIntel.js'
import { ilikeExact } from '@/lib/server/pgrest.js'
import { listingSignals, readCompanyListingRows } from '@/lib/server/listingSignals.js'

type Creds = { url: string; key: string }
function creds(): Creds | null {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  return url && key ? { url, key } : null
}

const PAGE = 1000
const MAX_PAGES = 5
const READ_TIMEOUT_MS = 6000
/** How long the server render waits for the rows / the listings before painting without them. */
const ROWS_DEADLINE_MS = 3000
const LISTING_DEADLINE_MS = 3000

export type AnswerRow = {
  id: string
  outcome: string | null
  platform: string | null
  trust_reason: string | null
  needs_review: boolean | null
  ghost_stage: string | null
  role: string | null
  wait_days: number | null
  rounds: number | null
}

/** The grade's own corpus: scorable rows with a decided outcome — what fusion counts as first_party_report_count. */
async function readRowsUncached(name: string): Promise<AnswerRow[]> {
  const c = creds()
  if (!c) throw new Error('company rows: no credentials')
  const nonterminal = encodeURIComponent(`(${[...NONTERMINAL_OUTCOMES].map((o) => `"${o}"`).join(',')})`)
  const base = `reports?select=id,outcome,platform,trust_reason,needs_review,ghost_stage,role,wait_days,rounds`
    + `&company_name=ilike.${ilikeExact(name.toLowerCase().trim())}&${SCORABLE_REPORTS_FILTER}&outcome=not.in.${nonterminal}`
  const out: AnswerRow[] = []
  let last: string | null = null
  for (let i = 0; i < MAX_PAGES; i++) {
    const r: Response = await fetch(`${c.url}/rest/v1/${base}&order=id.asc&limit=${PAGE}${last ? `&id=gt.${encodeURIComponent(last)}` : ''}`, {
      headers: { apikey: c.key, Authorization: `Bearer ${c.key}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    })
    if (!r.ok) throw new Error(`company rows ${r.status}`)
    const rows: unknown = await r.json()
    if (!Array.isArray(rows)) throw new Error('company rows: not an array')
    out.push(...rows)
    if (rows.length < PAGE) return out
    last = String(rows[rows.length - 1].id)
  }
  throw new Error('company rows: too many pages')
}

const cachedRows = unstable_cache(async (name: string) => readRowsUncached(name), ['company-answer-rows-v1'], { revalidate: 600, tags: ['company-answers'] })

async function readListingUncached(name: string) {
  const c = creds()
  if (!c) throw new Error('company listings: no credentials')
  const rows = await readCompanyListingRows({ url: c.url, key: c.key, company: name })
  return listingSignals(rows)
}
const cachedListing = unstable_cache(async (name: string) => readListingUncached(name), ['company-listing-signals-v1'], { revalidate: 1800, tags: ['company-listings'] })

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, () => { clearTimeout(t); resolve(null) })
  })
}

/** The grade's rows for a STORED company name; null when unreadable or slower than the deadline. */
export const readAnswerRows = cache(async (name: string): Promise<AnswerRow[] | null> =>
  name ? withDeadline(cachedRows(name.toLowerCase().trim()), ROWS_DEADLINE_MS) : null)

/** Listing signals for the company's own open posts; null when unreadable or slower than the deadline. */
export const readListing = cache(async (name: string): Promise<ReturnType<typeof listingSignals> | null> =>
  name ? withDeadline(cachedListing(name.toLowerCase().trim()), LISTING_DEADLINE_MS) : null)

/** The name the reads use: the stored company_scores name when a row exists, else the slug decoded. */
export function readName(slug: string, s: GrowthScore | null): string {
  return (s?.company_name || slugToName(slug)).toLowerCase().trim()
}
