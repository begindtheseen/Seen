// "Where <company> is hiring" — aggregates the free-form `location` strings of a company's CURRENT
// job listings (api/jobs.js company_jobs → jobs.location) into per-place counts plus a Remote bucket.
// This is listing data, NOT applicant reports — callers must label it as such
// ("from N current job listings"). Pure; no I/O. Tested in lib/server/jobLocations.test.mjs.

export type JobLocationBucket = { label: string; count: number }
export type JobLocationSummary = {
  listings: number          // listings considered (every job passed in)
  withLocation: number      // listings that named at least one usable place (or remote)
  remote: number            // listings that are remote / work-from-anywhere
  places: JobLocationBucket[] // top N named places, most listings first (a listing can name several)
  otherPlaces: number       // how many further distinct places were cut by the top-N limit
}

const REMOTE_RE = /\b(remote|anywhere|work from home|wfh|telecommute|virtual)\b/i
const COUNTRY_SUFFIX_RE = /,?\s*(united states(?: of america)?|usa|u\.s\.a?\.?|us)\s*$/i
const ZIP_RE = /\b\d{5}(?:-\d{4})?\b/g
const PREFIX_RE = /^(?:hybrid|on[- ]?site|in[- ]?office)\s*(?:[-–—:]\s*|\s+in\s+)?/i
const VAGUE = new Set(['', 'n/a', 'na', 'none', 'unknown', 'various', 'tbd', 'location', 'locations'])

const titleCase = (s: string) => s.replace(/[A-Za-z][^\s-]*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())

/** Normalize one location segment to a display label, or null when it names no usable place. */
export function normalizePlace(raw: string): string | null {
  let s = String(raw ?? '').replace(ZIP_RE, ' ').replace(/\s+/g, ' ').trim()
  s = s.replace(PREFIX_RE, '').trim()
  // Drop a trailing country only when something precedes it ("Austin, TX, US" → "Austin, TX").
  const withoutCountry = s.replace(COUNTRY_SUFFIX_RE, '').replace(/[,\s]+$/, '').trim()
  if (withoutCountry) s = withoutCountry
  s = s.replace(/^[,\s]+|[,\s]+$/g, '')
  if (VAGUE.has(s.toLowerCase())) return null
  if (/^(united states(?: of america)?|usa|u\.s\.a?\.?|us)$/i.test(s)) return 'United States'
  // Re-case only all-lower / ALL-UPPER input (keep source casing like "McLean" otherwise); 2-letter
  // comma segments are state/province codes → upper-case.
  const recase = s === s.toLowerCase() || s === s.toUpperCase()
  const out = s.split(',').map((part) => {
    const p = part.trim()
    if (/^[a-z]{2}$/i.test(p)) return p.toUpperCase()
    return recase ? titleCase(p) : p
  }).filter(Boolean).join(', ')
  return out || null
}

export function aggregateJobLocations(
  jobs: Array<{ location?: string | null }> | null | undefined,
  { top = 8 }: { top?: number } = {},
): JobLocationSummary {
  const list = Array.isArray(jobs) ? jobs : []
  const counts = new Map<string, JobLocationBucket>()
  let remote = 0
  let withLocation = 0
  for (const j of list) {
    const loc = String(j?.location ?? '').trim()
    if (!loc) continue
    let named = false
    if (REMOTE_RE.test(loc)) { remote += 1; named = true }
    else {
      const seen = new Set<string>()
      for (const seg of loc.split(/\s*[;|]\s*/)) {
        const label = normalizePlace(seg)
        if (!label) continue
        const key = label.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        named = true
        const b = counts.get(key)
        if (b) b.count += 1
        else counts.set(key, { label, count: 1 })
      }
    }
    if (named) withLocation += 1
  }
  const sorted = [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  const n = Math.max(0, Math.floor(top))
  return {
    listings: list.length,
    withLocation,
    remote,
    places: sorted.slice(0, n),
    otherPlaces: Math.max(0, sorted.length - n),
  }
}
