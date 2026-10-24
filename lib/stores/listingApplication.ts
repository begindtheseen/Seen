// A tracked application pre-filled from a job listing — the ONE mapping behind "✓ Yes, I applied"
// (components/ApplyCheckpoint), the /apply hand-off page and any "track this listing" button.
// The desktop audit (2026-10-23, item 10) saw a tracked card read "Cashier · via Direct" with no
// location for the listing "Cosmetics Cashier · Walmart · Glendale, Maricopa County": the card must
// carry the listing's FULL title, its location, its id and its link. Pure; pinned by
// listingApplication.test.mjs and, server-side, api/user-sync.addApplication.test.mjs.

import type { Application } from '../types.ts'
// (location/url cleaning below — audit 3 L4: raw "Mesa, Maricopa County" and tracking params on the card)

export interface ListingLike {
  id?: string | number | null
  title?: string | null
  company?: string | null
  location?: string | null
  apply_url?: string | null
}

export type NewApplication = Pick<Application, 'company' | 'role' | 'location' | 'platform' | 'jobId' | 'jobUrl' | 'stage' | 'status'>

// Where the application was sent, read from the apply link's host. Anything else is the employer's
// own site: "Direct". (The tracker's Edit form offers the same names — lib/stores/applicationEdit.)
const HOST_PLATFORMS: Array<[RegExp, string]> = [
  [/(^|\.)linkedin\.com$/i, 'LinkedIn'],
  [/(^|\.)indeed\.com$/i, 'Indeed'],
  [/(^|\.)seenjobs\.io$/i, 'Seen'],
]

export function platformFromUrl(url: string | null | undefined): string {
  const raw = String(url || '').trim()
  if (!raw) return 'Direct'
  try {
    const host = new URL(raw.startsWith('/') ? 'https://seenjobs.io' + raw : raw).hostname
    for (const [re, name] of HOST_PLATFORMS) if (re.test(host)) return name
  } catch { /* not a URL — the employer's own site as far as we know */ }
  return 'Direct'
}

const clean = (v: unknown, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

// Aggregators (Adzuna) write the area as "Mesa, Maricopa County": the county is not where the job is.
// A segment that IS the county/parish/borough name is dropped; a location that is only that stays.
const COUNTY_RE = /\s(county|parish|borough)$/i
export function stripCounty(location: unknown): string {
  const raw = clean(location, 200)
  if (!raw) return ''
  const parts = raw.split(',').map(p => p.trim()).filter(Boolean)
  const kept = parts.filter(p => !COUNTY_RE.test(p))
  return (kept.length ? kept : parts).join(', ')
}

// Click-tracking parameters carried by job-board links (utm_*, click ids). Dropped through the URL
// parser (CodeQL: no regex guard on a URL), never from the path or the rest of the query. A string
// that is not an http(s) URL is kept as it is.
const TRACKING_PARAMS = new Set(['fbclid', 'gclid', 'dclid', 'msclkid', 'yclid', 'mc_cid', 'mc_eid', 'igshid', '_hsenc', '_hsmi', 'trk', 'trkcampaign', 'refid', 'ref_src'])
export function cleanApplyUrl(url: unknown): string {
  const raw = clean(url, 2000)
  if (!raw) return ''
  let u: URL
  try { u = new URL(raw) } catch { return raw }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return raw
  for (const k of [...u.searchParams.keys()]) {
    if (k.toLowerCase().startsWith('utm_') || TRACKING_PARAMS.has(k.toLowerCase())) u.searchParams.delete(k)
  }
  return u.href
}

/** The application a listing becomes when the user says they applied. */
export function applicationFromListing(job: ListingLike, opts: { platform?: string } = {}): NewApplication {
  const jobUrl = cleanApplyUrl(job.apply_url) || undefined
  const jobId = job.id == null || job.id === '' ? undefined : String(job.id).slice(0, 80)
  return {
    company: clean(job.company),
    role: clean(job.title),           // the full title — never shortened or re-mapped to a family
    location: stripCounty(job.location), // "Mesa, Maricopa County" → "Mesa"; '' when the listing has none
    platform: opts.platform || platformFromUrl(jobUrl),
    ...(jobId ? { jobId } : {}),
    ...(jobUrl ? { jobUrl } : {}),
    stage: 'Applied',
    status: 'active',
  }
}
