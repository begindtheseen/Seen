// Upcoming hiring events across Seen's open listings — the read behind each start guide's "Hiring events" strip
// (GET /api/jobs?action=hiring_events). Every event is one an employer's own posting announces with a date
// (lib/jobs/hiringEvents.js reads it); nothing is listed that the posting does not say.
//
// How it stays current: the listings are refreshed by the ingest crons every hour, this read is cached per
// instance for 10 minutes (and 10 minutes at the CDN), and an event drops off once its last date has passed
// (on the Pacific clock) — a stale cache never shows yesterday's event, because every answer is re-filtered by date.
//
// Load rules for a request path on `jobs` (CLAUDE.md, 2026-11-12): one title read ORing 11 patterns (under the ~15
// at which the planner leaves the trigram index), light columns only, then the postings by id (100 at a time), all
// through the instance-wide limiter (`queuedRead`) with a timeout. An event announced only in a posting's body is
// found when that listing appears in a search (the row's own `hiring_event`), not by this read — a body scan of
// `jobs` times out (measured 2026-11-15: every `description=ilike` read answered 500).

import { upcomingHiringEvent, eventRoles } from '../jobs/hiringEvents.js'
import { queuedRead } from './areaSearch.js'
import { placeSearch, withinRadius } from '../geo/radius.js'
import { readExternalEvents, externalNear } from './externalEvents.js'

export const EVENT_TITLE_PATTERNS = Object.freeze([
  'hiring event', 'recruiting event', 'job fair', 'hiring fair', 'career fair', 'open house', 'walk-in interview',
  'walk in interview', 'open interview', 'hiring day', 'interview day',
])
const CACHE_MS = 10 * 60_000
const READ_MS = 6000
const LIGHT = 'id,title,company,location,created_at,lat,lng,apply_url,source'
let cache = null // { at, rows }

async function readJson(url, headers) {
  const r = await queuedRead(() => fetch(url, { headers, signal: AbortSignal.timeout(READ_MS) }))
  if (!r.ok) throw new Error(`jobs read ${r.status}`)
  return r.json()
}

/** Every open listing whose posting announces an event that has not happened yet, soonest first (cached 10 min). */
export async function readUpcomingEvents({ supabaseUrl, serviceKey, now = new Date() } = {}) {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    const or = EVENT_TITLE_PATTERNS.map((p) => `title.ilike.*${p}*`).join(',')
    const stamp = encodeURIComponent(new Date().toISOString())
    const light = await readJson(`${supabaseUrl}/rest/v1/jobs?select=${LIGHT}&availability_status=eq.active&expires_at=gt.${stamp}&or=(${encodeURIComponent(or)})&order=created_at.desc&limit=400`, headers)
    const full = []
    for (let i = 0; i < light.length; i += 100) {
      const ids = light.slice(i, i + 100).map((r) => r.id).filter(Boolean)
      if (!ids.length) continue
      const texts = await readJson(`${supabaseUrl}/rest/v1/jobs?select=id,description&id=in.(${ids.join(',')})`, headers)
      const byId = new Map(texts.map((t) => [t.id, t.description]))
      for (const r of light.slice(i, i + 100)) full.push({ ...r, description: byId.get(r.id) || '' })
    }
    cache = { at: Date.now(), rows: full }
  }
  return eventsFrom(cache.rows, now)
}

/** The rows with an upcoming event, each `{ id, title, company, location, url, lat, lng, event }`, soonest first;
 *  the same event posted more than once (same employer, title and date) is listed once. */
export function eventsFrom(rows, now = new Date()) {
  const seen = new Set()
  const out = []
  for (const r of rows || []) {
    const event = upcomingHiringEvent(r, now)
    if (!event) continue
    const key = `${String(r.company || '').toLowerCase()}|${String(r.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${event.next}`
    if (seen.has(key)) continue
    seen.add(key)
    const { description, ...rest } = r // the posting text never leaves the server
    void description
    // `roles`: what the event hires for, in the posting's words (a generic title like "Open House" needs it to find its field).
    out.push({ id: rest.id, title: rest.title, company: rest.company, location: rest.location, url: rest.apply_url || null, lat: rest.lat ?? null, lng: rest.lng ?? null, roles: eventRoles(r), event })
  }
  return out.sort((a, b) => (a.event.next < b.event.next ? -1 : a.event.next > b.event.next ? 1 : 0))
}

/** Keep the events within `radius` miles of a typed place (the listing's own coordinates or location text). An
 *  unknown place keeps nothing rather than everything; no place keeps all. */
export function eventsNear(events, location, radius) {
  const loc = String(location || '').trim()
  if (!loc) return events
  const center = placeSearch(loc)
  if (!center || center.lat == null || center.lng == null) return []
  const miles = Math.min(250, Math.max(5, Number(radius) || 50))
  return events.filter((e) => withinRadius({ location: e.location, lat: e.lat, lng: e.lng }, center, miles).in)
}

/**
 * The whole answer behind GET /api/jobs?action=hiring_events: the events open listings announce (`events`) and the
 * external ones — state workforce job fairs and apprenticeship windows (`external`, lib/server/externalEvents.js) —
 * each near the typed place when there is one. Either half failing leaves the other standing; both failing throws.
 */
export async function readHiringEventsAnswer({ supabaseUrl, serviceKey, location = '', radius, now = new Date() } = {}) {
  const [posted, ext] = await Promise.allSettled([
    readUpcomingEvents({ supabaseUrl, serviceKey, now }),
    readExternalEvents({ supabaseUrl, serviceKey, now }),
  ])
  if (posted.status === 'rejected' && ext.status === 'rejected') throw posted.reason
  const events = posted.status === 'fulfilled' ? eventsNear(posted.value, location, radius).slice(0, 200) : []
  const external = ext.status === 'fulfilled' ? externalNear(ext.value.rows, location, radius).slice(0, 300) : []
  return { events, external, external_from: ext.status === 'fulfilled' ? ext.value.from : 'unavailable', partial: posted.status === 'rejected' || ext.status === 'rejected' }
}

/** Tests only: forget the cache. */
export function _resetHiringEventsCache() { cache = null }
