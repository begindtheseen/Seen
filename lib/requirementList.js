// The ONE requirement list a tool screen shows (UX audit F4/F9, 2026-11-10).
//
// The sheet showed "Why you match" (6, capped) and "The posting asks for" (8, capped) with no count, the
// same résumé line quoted twice in a row, and — in the paid result — a second "Write a bullet for …" card
// list that disagreed with the first. Every screen now builds its list here, from the verdict's own
// matched_requirements / unsupported_requirements (lib/optimizer/index.js runOptimizer): nothing is
// re-derived, and the counts on screen add up to what is shown.
//
// Rules:
//  - shown   = matched rows with proof (a soft skill inferred from related work is counted for the score,
//              never shown as proof — round 5, Tasha), most important first.
//  - missing = rows the résumé does not show, hard / required first, then preferred.
//  - total   = shown + missing, so "You show 6 of 14" counts exactly the rows below it.
//  - rows that cite the SAME résumé line are one group: the line is quoted once, its requirements listed.

const IMPORTANCE = { required: 0, preferred: 1 }
const rank = (r) => (r.hard ? 0 : 1) * 10 + (IMPORTANCE[r.importance] ?? 2) + (r.via === 'related' ? 0.5 : 0)

/** The proof line as people read it: no bullet glyph, trimmed. */
export function proofLine(evidence) {
  return String(evidence || '').replace(/^[\s•\-*·–—]+/, '').replace(/\s+/g, ' ').trim()
}

/**
 * @param {{ matched?: Array<Record<string, any>>, missing?: Array<Record<string, any>> }} v
 * @returns {{ shown: Array<Record<string, any>>, missing: Array<Record<string, any>>, total: number }}
 */
export function requirementCounts({ matched = [], missing = [] } = {}) {
  const seen = new Set()
  const key = (r) => String(r.surface || r.requirement || '').toLowerCase().trim()
  const once = (r) => { const k = key(r); if (!k || seen.has(k)) return false; seen.add(k); return true }
  const shown = (matched || []).filter((r) => r && r.matched && !r.inferred).sort((a, b) => rank(a) - rank(b)).filter(once)
  const miss = (missing || []).filter((r) => r && !r.matched).sort((a, b) => rank(a) - rank(b)).filter(once)
  return { shown, missing: miss, total: shown.length + miss.length }
}

/**
 * Shown rows grouped by the résumé line that proves them (one quote, several requirements), in the order
 * of each group's most important requirement. A row with no quotable line is its own group.
 * @param {Array<Record<string, any>>} shown
 * @returns {Array<{ line: string, rows: Array<Record<string, any>> }>}
 */
export function groupByProof(shown = []) {
  const groups = []
  const byLine = new Map()
  for (const r of shown) {
    const line = proofLine(r.evidence)
    const k = line.toLowerCase()
    if (line && byLine.has(k)) { byLine.get(k).rows.push(r); continue }
    const g = { line, rows: [r] }
    groups.push(g)
    if (line) byLine.set(k, g)
  }
  return groups
}

/** "6 of 14 requirements" style headline — the count says what it counts. */
export function countHeadline({ shown, total }) {
  if (!total) return 'This posting states no requirements Seen could read'
  return `You show ${shown.length} of ${total} requirement${total === 1 ? '' : 's'} this posting states`
}
