// The listings block on a start guide (/start/<field>): position chips, a place + distance, and a level, tailored to
// the field by the guide's own `listings` config (lib/start/<field>.js). Pure — the client component
// (components/start/ListingFinder.tsx) only fetches and renders; every rule a reader can see is here and tested
// (lib/start/listingFilters.test.mjs):
//   • a position → the searches sent to POST /api/jobs ({ query, location, radius }; an empty location is nationwide);
//   • which rows of the answers belong to that position (title pattern), to the field (title or employer pattern),
//     to a company guide's employer, and to the chosen level;
//   • how several answers become one list (interleaved by search, or round-robin by position so "All trades" is not
//     twelve electricians), each listing once, two per employer before any employer gets a third;
//   • the filter state in the URL (?pos=&loc=&r=&lvl=) and the honest count / empty lines.
// Config patterns are regex SOURCE strings (the config crosses from the server page to the client component, and a
// RegExp does not serialise); they are compiled here, case-insensitive.

import { guideListingRows, GUIDE_MAX_ROWS } from './listingRows.js'
import { searchPath } from '../jobs/searchUrl.js'

export const LEVELS = ['any', 'entry', 'experienced']
export const PER_COMPANY = 2
/** /jobs offers distances up to 100 mi: a wider guide search opens job search at its widest. */
const JOBS_MAX_RADIUS = '100'

const re = (src) => (src ? new RegExp(src, 'i') : null)
const cache = new Map()
/** Compiled pattern, memoised by source. */
function rx(src) {
  if (!src) return null
  if (!cache.has(src)) cache.set(src, re(src))
  return cache.get(src)
}

// ── Level ────────────────────────────────────────────────────────────────────────────────────────────────────────
// A title that says it wants experience: a rung above entry (derrickhand, driller, motorhand), a II/III/IV grade,
// journeyman / master / licensed, or a lead / supervisor role. An instructor or trainer is never an entry job.
const EXPERIENCED_RE = /\b(experienced|exp|senior|sr|lead|leadman|supervisor|superintendent|foreman|foremen|pusher|toolpusher|manager|ii|iii|iv|journey(?:man|men|worker|workers)?|journey-level|master|licensed|derrick\w*|driller|motorhand|motor hand|instructor|trainer)\b/i
// A title that says it takes beginners.
const ENTRY_RE = /\b(trainee|trainees|entry|entry-level|helper|helpers|apprentice|apprentices|apprenticeship|green\s?hat|no experience|beginner|intern|internship|pre-apprentice|pre-apprenticeship)\b/i
// "Floorhand I" — the first rung written as a capital I (case-sensitive, standing alone; "I/II/III" also carries II).
const RUNG_ONE_RE = /(?:^|[\s(\-–—,/])I(?=$|[\s)\-–—,/])/

/**
 * Which level a listing reads as. `mode` is the field's rule for a title that says neither:
 *  - 'entryUnlessMarked' (oilfield): field-hand jobs train on the job, so a plain "Floorhand" is the entry rung;
 *  - 'entryNeedsMarker' (trades): a plain "Electrician" is a trained trade job; entry needs apprentice / helper /
 *    trainee / entry / a rung-one title, the listing's own "Entry level", or a paid-training flag.
 * A title that asks for experience is experienced whatever else it says.
 * @returns {'entry' | 'experienced'}
 */
export function levelOf(row, mode = 'entryNeedsMarker') {
  const title = String((row && row.title) || '')
  const lvl = String((row && row.level) || '')
  if (EXPERIENCED_RE.test(title) || /senior|mid/i.test(lvl)) return 'experienced'
  if (/entry/i.test(lvl) || (row && row.trains_beginners === true) || ENTRY_RE.test(title) || RUNG_ONE_RE.test(title)) return 'entry'
  return mode === 'entryUnlessMarked' ? 'entry' : 'experienced'
}

export function passesLevel(row, level, mode) {
  return !level || level === 'any' || levelOf(row, mode) === level
}

// ── Config helpers ───────────────────────────────────────────────────────────────────────────────────────────────
export function positionOf(config, id) {
  return config.positions.find((p) => p.id === id) || config.positions[0]
}

/** The searches a position runs at a level (a position's `queries` is a list, or one list per level). */
export function queriesFor(position, level = 'any') {
  const q = position.queries
  if (Array.isArray(q)) return q
  return q[level] || q.any || []
}

/** The search bodies for a filter state: one per query; an empty place is a nationwide search. */
export function requestBodies(config, state) {
  const loc = String(state.loc || '').trim()
  return queriesFor(positionOf(config, state.pos), state.lvl).map((query) => ({ query, location: loc, radius: loc ? String(state.r) : '25' }))
}

/** One key per search body — the in-memory cache and the test stub both key on it. */
export function bodyKey(b) {
  return `${b.query}|${b.location}|${b.radius}`
}

// ── Rows ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const sameListing = (r) => `${String(r.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${String(r.company || '').toLowerCase().trim()}`

/** Does a row belong to the field (title or employer pattern), to the guide's employer, and not to the excluded titles? */
export function inField(config, row) {
  const title = String(row.title || '')
  const company = String(row.company || '')
  if (config.employer && !rx(config.employer).test(company)) return false
  if (config.exclude && rx(config.exclude).test(title)) return false
  if (config.gateTitle || config.gateCompany) {
    const t = config.gateTitle ? rx(config.gateTitle).test(title) : false
    const c = config.gateCompany ? rx(config.gateCompany).test(company) : false
    if (!t && !c) return false
  }
  return true
}

/** The first specific position (not the "all" chip) whose title pattern a row matches, or null. */
export function positionForRow(config, row) {
  const title = String(row.title || '')
  for (const p of config.positions) if (p.match && rx(p.match).test(title)) return p.id
  return null
}

/** Rows each employer gets up to `cap` of; the rest wait until every other row is shown (order kept otherwise). */
export function capPerCompany(rows, cap = PER_COMPANY) {
  const n = new Map()
  const first = []
  const later = []
  for (const r of rows) {
    const co = String(r.company || '').toLowerCase().trim()
    const k = (n.get(co) || 0) + 1
    n.set(co, k)
    ;(k > cap ? later : first).push(r)
  }
  return [...first, ...later]
}

/**
 * The rows a filter state shows, from the answers of its searches (same order as `requestBodies`; a failed search
 * is null). Returns `{ rows, total }`: `total` counts every listing that passed (the count line says "12 of 56").
 * Nothing is ever made up: no matching row → `rows: []`.
 */
export function pickRows(config, state, answers, max = GUIDE_MAX_ROWS) {
  const position = positionOf(config, state.pos)
  const lists = (answers || []).map((a) => guideListingRows(a, Infinity))
  const mode = config.levelMode
  // Interleave the answers (no search crowds out another), each listing once.
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
  const match = position.match ? rx(position.match) : null
  let kept = merged.filter((r) => inField(config, r) && (!match || match.test(String(r.title || ''))) && passesLevel(r, state.lvl, mode))
  if (position.mix === 'positions') {
    // Round-robin by position (in chip order): a row no specific position claims is not shown.
    const groups = new Map()
    for (const r of kept) {
      const p = positionForRow(config, r)
      if (!p) continue
      if (!groups.has(p)) groups.set(p, [])
      groups.get(p).push(r)
    }
    const order = config.positions.map((p) => groups.get(p.id)).filter(Boolean).map((g) => capPerCompany(g))
    kept = []
    for (let i = 0; order.some((g) => i < g.length); i++) for (const g of order) if (g[i]) kept.push(g[i])
  }
  if (position.prefer) {
    const pref = rx(position.prefer)
    kept = [...kept.filter((r) => pref.test(String(r.title || ''))), ...kept.filter((r) => !pref.test(String(r.title || '')))]
  }
  kept = capPerCompany(kept)
  return { rows: kept.slice(0, max), total: kept.length }
}

// ── URL state ────────────────────────────────────────────────────────────────────────────────────────────────────
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n)

/** The filter state a URL query string holds; anything unknown falls back to the guide's defaults. */
export function parseFilterState(search, config) {
  let p
  try { p = new URLSearchParams(String(search || '')) } catch { p = new URLSearchParams() }
  const pos = p.get('pos') || ''
  const r = p.get('r') || ''
  const lvl = p.get('lvl') || ''
  return {
    pos: config.positions.some((x) => x.id === pos) ? pos : config.positions[0].id,
    loc: clip(p.get('loc'), 80),
    r: config.radii.includes(r) ? r : config.defaultRadius,
    lvl: LEVELS.includes(lvl) ? lvl : 'any',
  }
}

/** The URL params for a state: each param's value, or null to leave it out (defaults are never written). */
export function filterParams(state, config) {
  return {
    pos: state.pos && state.pos !== config.positions[0].id ? state.pos : null,
    loc: state.loc ? String(state.loc).trim() || null : null,
    r: state.loc && state.r !== config.defaultRadius ? state.r : null,
    lvl: state.lvl && state.lvl !== 'any' ? state.lvl : null,
  }
}

/** The same params as a query string (no leading "?"). */
export function filterQueryString(state, config) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(filterParams(state, config))) if (v) p.set(k, v)
  return p.toString()
}

// ── Words ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** "within 100 mi of Midland, TX" · "in Texas" · "nationwide". */
export function whereWords(state) {
  const loc = String(state.loc || '').trim()
  if (!loc) return 'nationwide'
  return /,/.test(loc) ? `within ${state.r} mi of ${loc}` : `in ${loc}`
}

/** "entry-level floorhand jobs" — the level word (if any) and the position's noun. */
export function jobsWords(config, state) {
  const position = positionOf(config, state.pos)
  const lvl = state.lvl && state.lvl !== 'any' ? config.levelWords[state.lvl] : ''
  return `${lvl ? `${lvl} ` : ''}${position.noun} jobs`
}

/** "12 of 56 floorhand jobs within 100 mi of Midland, TX" (or "3 floorhand jobs …" when every one is shown). */
export function countLine(config, state, shown, total) {
  const lead = shown < total ? `${shown} of ${total}` : `${total}`
  const words = jobsWords(config, state)
  return `${lead} ${total === 1 ? words.replace(/ jobs$/, ' job') : words} ${whereWords(state)}`
}

/** The empty line and the one way out it offers (a wider distance, then all positions, then any level). */
export function emptyState(config, state) {
  const loc = String(state.loc || '').trim()
  const line = `No ${jobsWords(config, state)} ${whereWords(state)} right now — try ${loc ? 'a wider distance or ' : ''}another position.`
  const wider = config.radii.find((r) => Number(r) > Number(state.r))
  if (loc && /,/.test(loc) && wider) return { line, action: { label: `Search within ${wider} mi`, patch: { r: wider } } }
  if (state.pos !== config.positions[0].id) return { line, action: { label: `Show ${config.positions[0].label.toLowerCase()}`, patch: { pos: config.positions[0].id } } }
  if (state.lvl !== 'any') return { line, action: { label: 'Show any level', patch: { lvl: 'any' } } }
  if (loc) return { line, action: { label: 'Search nationwide', patch: { loc: '' } } }
  return { line, action: null }
}

/** "See all in job search" — the same search on /jobs (the first query of the position, the place, the distance). */
export function seeAllHref(config, state) {
  const position = positionOf(config, state.pos)
  const q = position.seeAll || queriesFor(position, state.lvl)[0] || ''
  const loc = String(state.loc || '').trim()
  const r = Number(state.r) > Number(JOBS_MAX_RADIUS) ? JOBS_MAX_RADIUS : String(state.r)
  return searchPath({ q, loc, radius: loc ? r : '' })
}
