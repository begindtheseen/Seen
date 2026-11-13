// The two "getting in" guides (/start/oilfield, /start/trades): the one list the sitemap, llms.txt and the footer
// read, plus the small helpers both pages render with. Pure; no imports, so any surface (server page, client
// footer, node --test) can use it.

/** @type {ReadonlyArray<{ path: string, label: string, footerLabel: string, llms: string }>} */
export const START_GUIDES = [
  { path: '/start/oilfield', label: 'Getting into oilfield work', footerLabel: 'Oilfield work guide', llms: 'entry jobs, what drillers and service companies ask for, starting pay from their own postings, every figure sourced' },
  { path: '/start/trades', label: 'Getting into the trades', footerLabel: 'Trades guide', llms: 'paid apprenticeships, the aptitude test, employers that train, free programs, every figure sourced' },
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-11-13" → "Nov 13, 2026"; "2023-03" (a source dated by month only) → "Mar 2023". Read from the string
 *  itself: no time zone can move the day. */
export function formatSourceDate(iso) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(iso || ''))
  if (!m) return ''
  return m[3] ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : `${MONTHS[Number(m[2]) - 1]} ${m[1]}`
}

/**
 * Number a guide's sources in the order a reader meets them: `entries` is every `{ src }` on the page in render
 * order (the data module's `pageEntries()`). Returns `nums` (key → 1-based number) and `ordered` ([key, source]
 * pairs in that order) for the list at the bottom. A declared source no entry cites is left out of the list.
 */
export function numberSources(sources, entries) {
  const nums = {}
  const ordered = []
  for (const e of entries) {
    for (const k of (e && e.src) || []) {
      if (nums[k] || !sources[k]) continue
      ordered.push([k, sources[k]])
      nums[k] = ordered.length
    }
  }
  return { nums, ordered }
}

/** The host a source link points to, for the plain-text list ("bls.gov"). */
export function sourceHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}
