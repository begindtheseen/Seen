// External hiring events, server side: the sources the refresh cron fetches (api/cron-hiring-events.js), and the
// cheap read behind GET /api/jobs?action=hiring_events (api/jobs.js handleHiringEvents).
//
// Sources (researched and verified 2026-11-17 — each answered a plain request with Seen's honest User-Agent and had
// real upcoming dated events; robots.txt allows the path for `*`):
//   • state workforce agencies / American Job Center boards that publish "The Events Calendar" JSON
//     (/wp-json/tribe/events/v1/events) — Virginia Works, the Idaho Department of Labor, Texas Workforce Solutions
//     boards (Greater Dallas, Capital Area, Tarrant County, North Texas), Arapahoe/Douglas Works! (CO), CareerSource
//     Northeast Florida and Citrus Levy Marion (FL), RochesterWorks! (NY), the Greater Raritan WDB (NJ), Golden Sierra and the San Diego Workforce Partnership (CA), Southwest Minnesota PIC;
//   • state pages: California EDD "Job Fairs and Workshops", Maryland Labor "Upcoming Recruitments and Job Fairs",
//     WorkForce West Virginia "Job Fairs", CareerForce Minnesota events (Job Fair or Networking Event);
//   • the New York State Department of Labor's apprenticeship announcements (union recruitment windows).
// Curated apprenticeship windows (lib/jobs/data/apprenticeshipWindows.json) are checked in and never fetched here.
//
// The read: ONE indexed table read (`external_hiring_events`, migration 20261117120000) cached per instance for 10
// minutes, plus the curated windows. Until the table exists — or while the cron has never filled it — the read falls
// back to the checked-in snapshot (lib/jobs/data/externalEventsSnapshot.json). A missing table (PostgREST 404 /
// PGRST205 / 42P01) is "no rows", silently. Every answer is re-filtered on the Pacific clock (upcomingExternal).

import { readFileSync } from 'node:fs'
import {
  USER_AGENT, parseTribeEvents, parseEddEvents, parseMarylandFairs, parseWestVirginiaFairs, parseCareerForceEvents,
  parseNyAnnouncements, parseNyAnnouncement, nyTradeOf, NY_REGION_CITY, windowRow, upcomingExternal, stableKey,
} from '../jobs/externalEvents.js'
import { geocodePlace } from '../geo/usPlaces.js'
import { placeSearch, withinRadius } from '../geo/radius.js'
import { pacificDate } from '../time/pacific.js'

export const TABLE = 'external_hiring_events'
const CACHE_MS = 10 * 60_000
const READ_MS = 6000

/** The words a long calendar is searched for (title or text): every hiring-event title carries one. */
const TRIBE_SEARCH = ['fair', 'hiring', 'recruit', 'expo', 'interview']
const tribe = (id, host, name, state) => ({ id, kind: 'tribe', host, name, state })
/** Every source the cron fetches. `state`: the agency's state (a venue without one is placed there). */
export const SOURCES = Object.freeze([
  tribe('va-virginiaworks', 'virginiaworks.gov', 'Virginia Works', 'VA'),
  tribe('id-labor', 'www.labor.idaho.gov', 'Idaho Department of Labor', 'ID'),
  tribe('tx-wfs-dallas', 'www.wfsdallas.com', 'Workforce Solutions Greater Dallas', 'TX'),
  tribe('tx-wfs-capital', 'www.wfscapitalarea.com', 'Workforce Solutions Capital Area', 'TX'),
  tribe('tx-wfs-tarrant', 'www.workforcesolutions.net', 'Workforce Solutions for Tarrant County', 'TX'),
  tribe('tx-wfs-northtexas', 'ntxworksolutions.org', 'Workforce Solutions North Texas', 'TX'),
  tribe('co-adworks', 'www.adworks.org', 'Arapahoe/Douglas Works!', 'CO'),
  tribe('fl-cs-nefl', 'www.careersourcenortheastflorida.com', 'CareerSource Northeast Florida', 'FL'),
  tribe('fl-cs-clm', 'careersourceclm.com', 'CareerSource Citrus Levy Marion', 'FL'),
  tribe('ny-rochesterworks', 'www.rochesterworks.org', 'RochesterWorks!', 'NY'),
  tribe('nj-greater-raritan', 'thegrwdb.org', 'Greater Raritan Workforce Development Board', 'NJ'),
  tribe('ca-golden-sierra', 'www.goldensierra.com', 'Golden Sierra Job Training Agency', 'CA'),
  tribe('ca-sdwp', 'www.workforce.org', 'San Diego Workforce Partnership', 'CA'),
  tribe('mn-swmnpic', 'www.swmnpic.org', 'Southwest Minnesota PIC', 'MN'),
  { id: 'ca-edd', kind: 'edd', host: 'edd.ca.gov', path: '/en/Jobs_and_Training/Job_Fairs_and_Workshops', name: 'California EDD', state: 'CA' },
  { id: 'md-labor', kind: 'md', host: 'labor.md.gov', path: '/employment/jobfairs.shtml', name: 'Maryland Department of Labor', state: 'MD' },
  { id: 'wv-workforce', kind: 'wv', host: 'workforcewv.org', path: '/job-seeker/find-a-job/job-fairs/', name: 'WorkForce West Virginia', state: 'WV' },
  { id: 'mn-careerforce', kind: 'mn', host: 'careerforce.mn.gov', path: '/education-and-training/events?fy%5B784%5D=784', name: 'CareerForce Minnesota', state: 'MN' },
  { id: 'ny-dol-apprenticeship', kind: 'nydol', host: 'dol.ny.gov', path: '/apprenticeship/apprenticeship-announcements', name: 'New York State Department of Labor', state: 'NY' },
])

// ── robots.txt ───────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Does robots.txt let `ua` fetch `pathAndQuery`? The group naming the agent (by product token) wins over `*`; the
 * longest matching rule wins, Allow on a tie; `*` and a trailing `$` are honoured. No group → allowed.
 */
export function robotsAllows(robotsTxt, ua, pathAndQuery) {
  const token = String(ua || '').split('/')[0].trim().toLowerCase()
  const groups = []
  let cur = null
  let lastWasAgent = false
  for (const raw of String(robotsTxt || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i)
    if (!m) continue
    const key = m[1].toLowerCase(), val = m[2].trim()
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [], delay: null }; groups.push(cur) }
      cur.agents.push(val.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (!cur) continue
    if (key === 'allow' || key === 'disallow') cur.rules.push({ allow: key === 'allow', path: val })
    if (key === 'crawl-delay') cur.delay = Number(val) || null
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && token && token.includes(a)))
  const use = mine.length ? mine : groups.filter((g) => g.agents.includes('*'))
  let best = null
  for (const g of use) for (const r of g.rules) {
    if (!r.path) continue // "Disallow:" with no path allows everything
    const anchored = r.path.endsWith('$')
    const src = r.path.replace(/\$$/, '').split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')
    if (!new RegExp(`^${src}${anchored ? '$' : ''}`).test(pathAndQuery)) continue
    const len = r.path.length
    if (!best || len > best.len || (len === best.len && r.allow)) best = { len, allow: r.allow }
  }
  return best ? best.allow : true
}
/** The crawl delay (seconds) robots.txt asks of `ua`, or 0. */
export function robotsDelay(robotsTxt, ua) {
  const m = String(robotsTxt || '').match(/crawl-delay\s*:\s*(\d+(?:\.\d+)?)/i)
  void ua
  return m ? Number(m[1]) : 0
}

// ── Fetching (the cron only) ─────────────────────────────────────────────────────────────────────────────────────
async function getText(fetchImpl, url, ms, accept = 'text/html') {
  const r = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept }, redirect: 'follow', signal: AbortSignal.timeout(ms) })
  const text = await r.text()
  return { status: r.status, ok: r.ok, text, type: String(r.headers?.get?.('content-type') || '') }
}
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))

/** Place each row: its own coordinates, else its location text (lib/geo); virtual rows keep none. */
export function placeRows(rows) {
  for (const r of rows) {
    if (r.lat != null && r.lng != null) continue
    if (!r.location || /^virtual\b/i.test(r.location) || r.event?.virtual) continue
    const p = geocodePlace(r.location)
    if (p && !p.stateOnly) { r.lat = p.lat; r.lng = p.lng }
  }
  return rows
}

/** Fetch one source → { rows, fetched } (throws on a network or HTTP failure). */
async function fetchSource(src, { fetchImpl, now, perSourceMs, deadline }) {
  const base = `https://${src.host}`
  const robots = await getText(fetchImpl, `${base}/robots.txt`, Math.min(5000, perSourceMs), 'text/plain').catch(() => ({ ok: false, text: '' }))
  // Only a real robots file counts (a 202 bot-check page or an HTML error page is not one).
  const robotsTxt = robots.status === 200 && /text\/plain/i.test(robots.type || 'text/plain') ? robots.text : ''
  const delay = Math.min(10, robotsDelay(robotsTxt, USER_AGENT)) * 1000
  const allowed = (pq) => robotsAllows(robotsTxt, USER_AGENT, pq)
  const today = pacificDate(now)
  const left = () => deadline - Date.now()
  const opts = { source: src.id, sourceName: src.name, state: src.state }

  if (src.kind === 'tribe') {
    // One page of everything ahead; a calendar longer than that (most are workshops) is read through the
    // calendar's own search for the words a hiring event carries, one page each.
    const seenUrls = new Set()
    const rows = []
    let fetched = 0
    const read = async (pq, first) => {
      if (!allowed(pq)) throw new Error('robots.txt disallows the events path')
      if (!first && delay) { if (left() < delay + 3000) return null; await sleep(delay) }
      const r = await getText(fetchImpl, `${base}${pq}`, Math.min(perSourceMs, Math.max(2000, left())), 'application/json')
      if (!r.ok || !/json/i.test(r.type || 'json')) throw new Error(`HTTP ${r.status}${r.ok ? ' (not JSON)' : ''}`)
      const json = JSON.parse(r.text)
      fetched += Array.isArray(json.events) ? json.events.length : 0
      for (const row of parseTribeEvents(json, opts)) if (!seenUrls.has(row.url)) { seenUrls.add(row.url); rows.push(row) }
      return json
    }
    const first = await read(`/wp-json/tribe/events/v1/events?per_page=50&start_date=${today}`, true)
    if (first && first.total_pages > 1) {
      for (const word of TRIBE_SEARCH) {
        if (left() < 3000) break
        if ((await read(`/wp-json/tribe/events/v1/events?per_page=50&start_date=${today}&search=${word}`, false)) === null) break
      }
    }
    return { rows, fetched }
  }
  const pages = src.kind === 'mn' ? [src.path, `${src.path}&page=1`] : [src.path]
  const rows = []
  let fetched = 0
  for (const [i, pq] of pages.entries()) {
    if (!allowed(pq)) throw new Error('robots.txt disallows the page')
    if (i > 0 && delay) { if (left() < delay + 3000) break; await sleep(delay) }
    const r = await getText(fetchImpl, `${base}${pq}`, Math.min(perSourceMs, Math.max(2000, left())))
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    if (src.kind === 'edd') { const got = parseEddEvents(r.text, opts); fetched += (r.text.match(/event-card"/g) || []).length; rows.push(...got) }
    if (src.kind === 'md') { const got = parseMarylandFairs(r.text, { ...opts, src: `${base}${pq}` }); fetched += got.length; rows.push(...got) }
    if (src.kind === 'wv') { const got = parseWestVirginiaFairs(r.text, { ...opts, src: `${base}${pq}` }); fetched += (r.text.match(/<h3>/g) || []).length; rows.push(...got) }
    if (src.kind === 'mn') { const got = parseCareerForceEvents(r.text, opts); fetched += (r.text.match(/<article/g) || []).length; rows.push(...got) }
    if (src.kind === 'nydol') {
      const list = parseNyAnnouncements(r.text, base)
      fetched += list.length
      // Only recruitments still open or ahead are read in full (their page names the city and how to apply).
      for (const a of list.filter((x) => x.closes && x.closes >= today && !x.closed && nyTradeOf(x.title))) {
        if (left() < 3000) break
        const detailPath = new URL(a.href).pathname
        let city = null, how = null
        if (allowed(detailPath)) {
          if (delay) await sleep(delay)
          const d = await getText(fetchImpl, a.href, Math.min(perSourceMs, Math.max(2000, left()))).catch(() => null)
          if (d && d.ok) ({ city, how } = parseNyAnnouncement(d.text))
        }
        const place = city || a.regions.map((g) => NY_REGION_CITY[g.toLowerCase()]).find(Boolean) || 'New York'
        rows.push(windowRow({
          id: `nydol-${stableKey(a.href)}`, program: a.title, trade: nyTradeOf(a.title), place, state: 'NY', opens: a.opens || null, closes: a.closes,
          how: how || `Recruitment ${a.opens ? `from ${a.opens} ` : ''}to ${a.closes}, announced by the New York State Department of Labor.`,
          src: a.href, checked: today, source: src.id, sourceName: src.name,
        }))
      }
    }
  }
  return { rows, fetched }
}

/**
 * Fetch every source (≤6 at once, each within `perSourceMs`, all within `budgetMs`) → { rows, summary }.
 * `summary[source]` = { ok, fetched, kept, ms, error? }. A failed source never stops the others.
 */
export async function refreshExternalEvents({ fetchImpl = fetch, now = new Date(), budgetMs = 50_000, perSourceMs = 15_000, sources = SOURCES } = {}) {
  const deadline = Date.now() + budgetMs
  const summary = {}
  const rows = []
  const queue = [...sources]
  const worker = async () => {
    while (queue.length) {
      const src = queue.shift()
      const t0 = Date.now()
      if (deadline - Date.now() < 2500) { summary[src.id] = { ok: false, fetched: 0, kept: 0, ms: 0, error: 'not reached (time budget)' }; continue }
      try {
        const got = await fetchSource(src, { fetchImpl, now, perSourceMs, deadline })
        const kept = upcomingExternal(placeRows(got.rows), now)
        rows.push(...kept)
        summary[src.id] = { ok: true, fetched: got.fetched, kept: kept.length, ms: Date.now() - t0 }
      } catch (e) {
        summary[src.id] = { ok: false, fetched: 0, kept: 0, ms: Date.now() - t0, error: String(e?.name === 'TimeoutError' ? 'timeout' : e?.message || e).slice(0, 160) }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker))
  // The same event listed twice (two boards share a calendar) is kept once.
  const seen = new Set()
  const unique = rows.filter((r) => { const k = `${r.title.toLowerCase()}|${r.event.next}|${(r.location || '').toLowerCase()}`; if (seen.has(k)) return false; seen.add(k); return true })
  return { rows: unique, summary }
}

/** A row → its table record (the payload is the row itself; the dates are columns for the indexed read). */
export function tableRecord(row, fetchedAt) {
  const x = row.external || {}
  const isWindow = x.type === 'apprenticeship'
  const dates = row.event?.dates || []
  return {
    id: row.id,
    kind: isWindow ? 'apprenticeship' : 'fair',
    source: x.source,
    starts_on: isWindow ? (x.opens || null) : dates[0] || null,
    ends_on: isWindow ? (x.closes || null) : dates[dates.length - 1] || null,
    state: x.state || null,
    payload: row,
    src: x.src || row.url,
    fetched_at: fetchedAt,
  }
}

// ── The read (request path) ──────────────────────────────────────────────────────────────────────────────────────
let cache = null // { at, rows, from }
let filesCache = null

function loadJson(name) {
  return JSON.parse(readFileSync(new URL(`../jobs/data/${name}`, import.meta.url), 'utf8'))
}
/** The checked-in rows: the curated windows (always) and the snapshot of the fetched sources (the fallback). */
export function fileRows() {
  if (!filesCache) {
    let windows = []
    let snapshot = []
    try { windows = placeRows((loadJson('apprenticeshipWindows.json').windows || []).map(windowRow)) } catch { windows = [] }
    try { snapshot = loadJson('externalEventsSnapshot.json').rows || [] } catch { snapshot = [] }
    filesCache = { windows, snapshot }
  }
  return filesCache
}

const missingTable = (status, body) => status === 404 || /PGRST205|42P01|does not exist|Could not find the table/i.test(body || '')

/**
 * Every external event still ahead (Pacific clock), soonest first: the table's rows (or the snapshot when the table
 * is missing, unreadable or empty) plus the curated windows. Cached per instance for 10 minutes; `from` says which.
 */
export async function readExternalEvents({ supabaseUrl, serviceKey, now = new Date(), fetchImpl = fetch } = {}) {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    const { windows, snapshot } = fileRows()
    let fetched = null
    let from = 'snapshot'
    if (supabaseUrl && serviceKey) {
      try {
        const today = pacificDate(now)
        const url = `${supabaseUrl}/rest/v1/${TABLE}?select=payload&or=${encodeURIComponent(`(ends_on.gte.${today},ends_on.is.null)`)}&order=starts_on.asc.nullsfirst&limit=2000`
        const r = await fetchImpl(url, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, signal: AbortSignal.timeout(READ_MS) })
        const body = await r.text()
        if (r.ok) {
          const list = JSON.parse(body)
          if (Array.isArray(list) && list.length) { fetched = list.map((x) => x.payload).filter(Boolean); from = 'table' }
          else from = 'snapshot (table empty)'
        } else from = missingTable(r.status, body) ? 'snapshot (no table)' : `snapshot (table ${r.status})`
      } catch { from = 'snapshot (table unreachable)' }
    }
    const ids = new Set()
    const rows = [...(fetched || snapshot), ...windows].filter((r) => r && r.id && !ids.has(r.id) && ids.add(r.id))
    cache = { at: Date.now(), rows, from }
  }
  return { rows: upcomingExternal(cache.rows, now), from: cache.from }
}

/**
 * Keep the rows within `radius` miles of a typed place. A virtual event (no place) counts for its state; a typed
 * whole state keeps that state's rows. No place keeps all (the strip shows general fairs only once a place is set).
 */
export function externalNear(rows, location, radius) {
  const loc = String(location || '').trim()
  if (!loc) return rows
  const center = placeSearch(loc)
  if (!center || center.kind === 'none' || center.kind === 'remote') return []
  const miles = Math.min(250, Math.max(5, Number(radius) || 50))
  return rows.filter((r) => {
    const st = r.external?.state
    if (center.kind === 'state') return st === center.state
    if (center.lat == null || center.lng == null) return false
    if (r.event?.virtual || (r.lat == null && /^virtual\b/i.test(r.location || ''))) return !!st && st === center.state
    return withinRadius({ location: r.location, lat: r.lat, lng: r.lng }, center, miles).in
  })
}

/** Tests only. */
export function _resetExternalEventsCache() { cache = null; filesCache = null }
