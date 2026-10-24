// A tracked application pre-filled from a job listing — the ONE mapping behind "✓ Yes, I applied"
// (components/ApplyCheckpoint), the /apply hand-off page and any "track this listing" button.
// The desktop audit (2026-10-23, item 10) saw a tracked card read "Cashier · via Direct" with no
// location for the listing "Cosmetics Cashier · Walmart · Glendale, Maricopa County": the card must
// carry the listing's FULL title, its location, its id and its link. Pure; pinned by
// listingApplication.test.mjs and, server-side, api/user-sync.addApplication.test.mjs.

import type { Application } from '../types.ts'
import { displayCompanyName } from '../companyNames.js'

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

/** The application a listing becomes when the user says they applied. */
export function applicationFromListing(job: ListingLike, opts: { platform?: string } = {}): NewApplication {
  const jobUrl = clean(job.apply_url, 2000) || undefined
  const jobId = job.id == null || job.id === '' ? undefined : String(job.id).slice(0, 80)
  return {
    // The employer as a person names it — "PLS Financial Services", never the board slug
    // "plscareers" the listing may be stored under (lib/companyNames.js).
    company: displayCompanyName(clean(job.company)) || clean(job.company),
    role: clean(job.title),           // the full title — never shortened or re-mapped to a family
    location: clean(job.location),    // '' when the listing has none; the card hides an empty one
    platform: opts.platform || platformFromUrl(jobUrl),
    ...(jobId ? { jobId } : {}),
    ...(jobUrl ? { jobUrl } : {}),
    stage: 'Applied',
    status: 'active',
  }
}
