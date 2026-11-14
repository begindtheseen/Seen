// Which rows of a search answer a start guide may show (lib/start/listingFilters.js pickRows). Pure, so the
// rule is tested: only rows the search counts as a match for the query (`related`), never the "other openings"
// filler or an answer the server labelled `fallback: 'unrelated'`; only rows with a Seen listing page (a uuid id);
// each listing once; at most `max`. No row is ever made up: an empty answer stays empty.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const GUIDE_MAX_ROWS = 12

/** @param {{ jobs?: unknown[], fallback?: string | null } | null | undefined} data */
export function guideListingRows(data, max = GUIDE_MAX_ROWS) {
  if (!data || !Array.isArray(data.jobs) || data.fallback === 'unrelated') return []
  const seen = new Set()
  const out = []
  for (const r of data.jobs) {
    if (!r || typeof r !== 'object') continue
    if (r.related === false || r.in_radius === false) continue
    const id = String(r.id || '')
    if (!UUID.test(id) || seen.has(id) || !String(r.title || '').trim()) continue
    seen.add(id)
    out.push(r)
    if (out.length >= max) break
  }
  return out
}
