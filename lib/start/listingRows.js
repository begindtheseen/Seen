// Which rows of a search answer a "getting in" guide may show (components/start/LiveListings.tsx). Pure, so the
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

const sameListing = (r) => `${String(r.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${String(r.company || '').toLowerCase().trim()}`

/**
 * Several searches → one block (the oilfield guide reads "floorhand" and "roustabout": a plain "oilfield" search
 * leads with company-name matches such as a sales job at "… Oilfield Technologies"). Each answer is filtered by
 * the same rules as `guideListingRows`; the answers are interleaved so no search crowds out the other; a listing is
 * shown once (same id, or the same title and company written twice); rows whose title names one of the guide's
 * roles (`prefer`) come first, in that interleaved order; past `perCompany` rows from one employer, the rest wait
 * until every other row is shown (one big board must not fill the block). Nothing is ever made up.
 * @param {Array<{ jobs?: unknown[], fallback?: string | null } | null | undefined>} answers
 * @param {{ max?: number, prefer?: RegExp | null, perCompany?: number }} [opts]
 */
export function mergeListingAnswers(answers, { max = GUIDE_MAX_ROWS, prefer = null, perCompany = Infinity } = {}) {
  const lists = (answers || []).map((a) => guideListingRows(a, Infinity))
  const ids = new Set()
  const keys = new Set()
  const merged = []
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      const r = l[i]
      if (!r) continue
      const id = String(r.id)
      const key = sameListing(r)
      if (ids.has(id) || keys.has(key)) continue
      ids.add(id); keys.add(key)
      merged.push(r)
    }
  }
  const ranked = prefer
    ? [...merged.filter((r) => prefer.test(String(r.title || ''))), ...merged.filter((r) => !prefer.test(String(r.title || '')))]
    : merged
  const perCo = new Map()
  const first = []
  const later = []
  for (const r of ranked) {
    const co = String(r.company || '').toLowerCase().trim()
    const n = (perCo.get(co) || 0) + 1
    perCo.set(co, n)
    ;(n > perCompany ? later : first).push(r)
  }
  return [...first, ...later].slice(0, max)
}
