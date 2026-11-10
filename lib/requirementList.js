// The ONE requirement list a tool screen shows (UX audit F4/F9, 2026-11-10).
//
// The sheet showed "Why you match" (6, capped) and "The posting asks for" (8, capped) with no count, the
// same résumé line quoted twice in a row, and — in the paid result — a second "Write a bullet for …" card
// list that disagreed with the first. Every screen now builds its list here, from the verdict's own
// matched_requirements / unsupported_requirements (lib/optimizer/index.js runOptimizer): nothing is
// re-derived, and the counts on screen add up to what is shown.
//
// Rules:
//  - shown   = matched rows, most important first; a soft skill inferred from related work is listed as
//              "related" and never quoted as proof (round 5, Tasha).
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
  // an inferred match (related work) is listed — the verdict sentence names it, so leaving it out made "you do show X"
  // sit above "0 of 8" — but it is never quoted as proof (groupByProof gives it no line)
  const shown = (matched || []).filter((r) => r && r.matched).sort((a, b) => Number(!!a.inferred) - Number(!!b.inferred) || rank(a) - rank(b)).filter(once)
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
    const line = r.inferred ? '' : proofLine(r.evidence)
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

const human = (arr) => arr.length <= 1 ? (arr[0] || '') : arr.length === 2 ? `${arr[0]} and ${arr[1]}` : `${arr.slice(0, -1).join(', ')} and ${arr[arr.length - 1]}`

/**
 * What 1 credit is for, said about THIS posting and THIS résumé (owner's bar 2026-11-10: no sentence that would
 * print unchanged for another job). Built only from the verdict's rows; promises nothing the engine may not do.
 * @param {{ shown: Array<Record<string, any>>, missing: Array<Record<string, any>>, title?: string, company?: string, show?: (s: string) => string }} p
 */
export function offerSentence({ shown = [], missing = [], title = '', company = '', show = (x) => x }) {
  const job = title ? `${title}${company ? ` at ${company}` : ''}` : 'this posting'
  const top = shown.slice(0, 2).map((r) => show(r.surface))
  const gaps = missing.slice(0, 2).map((r) => show(r.surface))
  const parts = []
  if (!shown.length && missing.length) {
    return `Your résumé shows none of the ${missing.length} requirement${missing.length === 1 ? '' : 's'} Seen read in ${job}, so reordering your lines or rewriting your summary will not change that. Spend the credit only if you can first add ${human(gaps)} — and only if it's true.`
  }
  if (top.length) parts.push(`Your résumé already shows ${human(top)}; the credit checks whether those lines lead each role for ${job}, and moves them up if they don't.`)
  else parts.push(`The credit checks which of your lines should lead each role for ${job}.`)
  parts.push(`It also writes a summary from your own titles and employers, and asks for the numbers behind your lines.`)
  if (gaps.length) parts.push(`It will not add ${human(gaps)} — only you can, if it's true.`)
  return parts.join(' ')
}
