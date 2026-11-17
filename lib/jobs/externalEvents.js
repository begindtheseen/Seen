// Hiring events from OUTSIDE Seen's listings — the two external sources behind each start guide's "Hiring events"
// strip, beside the events employers' own postings announce (lib/jobs/hiringEvents.js):
//   • state workforce job fairs: the public calendars state workforce agencies and American Job Centers publish
//     (WordPress "The Events Calendar" JSON, or a stable server-rendered page) — read by lib/server/externalEvents.js;
//   • registered-apprenticeship application windows: a curated file checked on each program's own page
//     (lib/jobs/data/apprenticeshipWindows.json) plus the New York State Department of Labor's announcements page.
//
// Pure and import-light (the Pacific clock and the posting reader's role words), so the browser strip, the server
// read, the cron and node --test all read the same rules. Nothing here invents a date: every row carries the date
// its source printed and the `src` page it was read from; the clock only decides which rows are still ahead.
//
// Row shape (what the API serves and the strip renders — the same fields as a posting event, plus `external`):
//   { id, title, company, location, lat, lng, url, roles,
//     event: { kind, label, next, dates, recurring: null, time, where, virtual, walkIn, rsvp, onTheSpot, inviteOnly },
//     external: { type: 'fair'|'apprenticeship', source, sourceName, state, src, general, many,
//                 opens, closes, yearRound, rule, how, trade, checked } }

import { pacificDate } from '../time/pacific.js'
import { eventRoles } from './hiringEvents.js'

export const USER_AGENT = 'SeenJobsBot/1.0 (+https://seenjobs.io/methods)'

// ── Text helpers ─────────────────────────────────────────────────────────────────────────────────────────────────
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' }
/** HTML entities decoded in ONE pass (a chained replace that decodes &amp; first double-unescapes). */
export function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m
    }
    return Object.prototype.hasOwnProperty.call(NAMED, e.toLowerCase()) ? NAMED[e.toLowerCase()] : m
  })
}
/** Plain text of an HTML fragment: each tag becomes a space, then entities are decoded once. */
export function plainText(html) {
  return decodeEntities(String(html || '').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
}
const STATE_BY_NAME = new Map(Object.entries(STATES).map(([ab, n]) => [n.toLowerCase(), ab]))
/** "TX" · "Texas" · "texas" → "TX"; anything else → ''. */
export function stateCode(s) {
  const t = String(s || '').trim()
  if (/^[A-Za-z]{2}$/.test(t) && STATES[t.toUpperCase()]) return t.toUpperCase()
  return STATE_BY_NAME.get(t.toLowerCase()) || ''
}

const pad = (n) => String(n).padStart(2, '0')
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`
const validDay = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && new Date(Date.UTC(y, m - 1, d)).getUTCMonth() === m - 1
const addDays = (day, n) => {
  const [y, m, d] = day.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

/** "November 18, 2026" · "Nov. 18, 2026" → "2026-11-18"; "11/18/2026" · "11/18/26" → same; else ''. A date with no year is not read. */
export function readDate(text) {
  const s = String(text || '')
  const m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i)
  if (m) {
    const y = Number(m[3]), mo = MONTHS[m[1].toLowerCase()], d = Number(m[2])
    return validDay(y, mo, d) ? iso(y, mo, d) : ''
  }
  const n = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/)
  if (n) {
    const y = n[3].length === 2 ? 2000 + Number(n[3]) : Number(n[3]), mo = Number(n[1]), d = Number(n[2])
    return validDay(y, mo, d) ? iso(y, mo, d) : ''
  }
  return ''
}

/** "10:00" + "14:00" → "10 AM–2 PM"; "10:30","12:00" → "10:30 AM–12 PM" (the format eventStartClock reads). */
export function clockRange(start, end) {
  const fmt = (hhmm) => {
    const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/)
    if (!m) return null
    const h = Number(m[1]), min = Number(m[2])
    if (h > 23 || min > 59) return null
    const ap = h < 12 ? 'AM' : 'PM'
    const h12 = h % 12 === 0 ? 12 : h % 12
    return { text: min ? `${h12}:${pad(min)}` : `${h12}`, ap }
  }
  const a = fmt(start), b = fmt(end)
  if (!a || !b) return null
  if (a.text === b.text && a.ap === b.ap) return null
  return `${a.text} ${a.ap}–${b.text} ${b.ap}`
}

/** "4 p.m. - 6 p.m." · "10 a.m.-12 p.m." · "9am – 2pm" → "4 PM–6 PM" style; null when no range is written. */
export function readClockRange(text) {
  const m = String(text || '').match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*(?:-|–|—|to)\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/i)
  if (!m) return null
  const ap = (s) => (s ? (/^p/i.test(s) ? 'PM' : 'AM') : null)
  const endAp = ap(m[6])
  let startAp = ap(m[3])
  if (!startAp) startAp = endAp === 'PM' && Number(m[1]) > Number(m[4]) && Number(m[1]) !== 12 ? 'AM' : endAp
  const to24 = (h, a) => (a === 'PM' && h !== 12 ? h + 12 : a === 'AM' && h === 12 ? 0 : h)
  return clockRange(`${to24(Number(m[1]), startAp)}:${m[2] || '00'}`, `${to24(Number(m[4]), endAp)}:${m[5] || '00'}`)
}

// ── What a fair is ───────────────────────────────────────────────────────────────────────────────────────────────
// A calendar entry is a hiring event when its title says so. A workshop ABOUT fairs ("Navigating a Job Fair", "Job
// Fair Prep Class") and a resource fair with no jobs are not.
const FAIR_RE = /\b(?:job|career|hiring|employment|recruit(?:ment|ing))\s+(?:fairs?|expos?)\b|\bjob\s+expo\b|\bmulti[- ]?employer\b|\bhiring\s+fair\s+days?\b/i
const EVENT_RE = /\b(?:hiring|recruit(?:ment|ing)|interview)\s+(?:events?|days?)\b|\bwalk[- ]in\s+(?:interviews?|recruit\w*|hiring)\b|\bopen\s+interviews?\b|\bemployer of the day\b|\bonsite employer\b|\bhiring\b.*\bevent\b/i
const PREP_RE = /\b(?:navigating|prep(?:are|aring|aration)?|how to|workshop|webinar|class|orientation|tips|getting ready|success at|before the|committee|board meeting|meeting)\b/i
const RESOURCE_ONLY_RE = /\bresource\s+fair\b/i
// A title that names a field or a single kind of employer is not a general fair: it belongs only where the guide's
// own vocabulary claims it (lib/start/listingFilters.js eventBelongs).
const SECTOR_RE = /\b(?:health\s?care|health|hospital|medical|nurs\w*|clinic\w*|childcare|child care|early (?:childhood|learning)|education|school|schools|teach\w*|universit\w*|college|correction\w*|jail|prison|sheriff|police|law enforcement|public safety|fire|federal|government|state jobs|city of|county of|municipal|manufactur\w*|construction|trades?|transportation|transit|drivers?|cdl|truck\w*|warehouse|logistics|retail|hospitality|restaurant|hotel|tech|technology|cyber\w*|energy|oil|utility|utilities|banking|finance|insurance|military spouse|defense)\b/i
const IT_RE = /\bIT\b/ // case-sensitive: "IT Job Fair", never the word "it"
const MANY_RE = /\b(?:multi[- ]?(?:employer|industry)|community|regional|annual|citywide|countywide|statewide|expo|mega|employers)\b/i

/**
 * What a calendar title is: null (not a hiring event), or `{ general, many }` — `general` for a fair open to every
 * field (shown on every field guide near its place), `many` when the title itself says many employers take part.
 */
export function classifyFair(title, { listIsFairs = false } = {}) {
  const t = String(title || '').replace(/\s+/g, ' ').trim()
  if (!t || PREP_RE.test(t)) return null
  const fair = FAIR_RE.test(t)
  if (!fair && RESOURCE_ONLY_RE.test(t)) return null
  if (!fair && !EVENT_RE.test(t) && !listIsFairs) return null
  // "Job Fair with Housing Authority of City of Austin", "HIRING EVENT: Fortrex" — one employer's event.
  // A hiring event with no fair word is one employer's unless the title says many take part ("Multi-Employer Hiring
  // Event", "Statewide Hiring Event").
  const many = MANY_RE.test(t)
  const oneEmployer = /\bwith\b|^\s*(?:hiring|recruit\w*)\s+event\s*[:|–-]/i.test(t) || (!fair && !many)
  const general = !oneEmployer && !SECTOR_RE.test(t) && !IT_RE.test(t)
  return { general, many: general && many }
}

/** The quiet line under a fair's title: "Job fair · many employers · Virginia Works" / "Hiring event · Idaho Department of Labor". */
export function fairLabel(row) {
  const x = row?.external || {}
  if (x.general) return ['Job fair', x.many ? 'many employers' : null, x.sourceName].filter(Boolean).join(' · ')
  const kind = /fair|expo/i.test(row?.title || '') ? 'Job fair' : 'Hiring event'
  return [kind, x.sourceName].filter(Boolean).join(' · ')
}

/** A short stable id from text (FNV-1a, base 36) — the table's primary key part. */
export function stableKey(text) {
  let h = 0x811c9dc5
  for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(36)
}

/** The row every fair source builds. `date`/`last` are ISO days; `place` is "City, ST" (or '' for virtual). */
export function fairRow({ source, sourceName, state, title, date, last, time = null, place = '', where = null, virtual = false, src, roles = '', rsvp = false, listIsFairs = false, lat = null, lng = null }) {
  const cls = classifyFair(title, { listIsFairs })
  if (!cls || !date) return null
  const dates = [date]
  if (last && last > date) for (let d = addDays(date, 1); d <= last && dates.length < 7; d = addDays(d, 1)) dates.push(d)
  const label = /expo/i.test(title) ? 'Career expo' : /fair/i.test(title) ? 'Job fair' : 'Hiring event'
  return {
    id: `ext:${source}:${stableKey(`${title}|${date}|${place}`)}`,
    title: String(title).replace(/\s+/g, ' ').trim().slice(0, 160),
    company: sourceName,
    location: place || (virtual ? `Virtual · ${STATES[state] || state}` : STATES[state] || state),
    lat, lng,
    url: src,
    roles: String(roles || '').slice(0, 160),
    event: { kind: 'external_fair', label, next: date, dates, recurring: null, time, where: where ? String(where).slice(0, 160) : null, virtual: !!virtual, walkIn: false, rsvp: !!rsvp, onTheSpot: false, inviteOnly: false },
    external: { type: 'fair', source, sourceName, state, src, general: cls.general, many: cls.many },
  }
}

// ── Source parsers (each tested on a saved real answer: lib/jobs/fixtures/externalEvents/) ───────────────────────

/** WordPress "The Events Calendar" REST answer (/wp-json/tribe/events/v1/events) → fair rows. */
export function parseTribeEvents(json, { source, sourceName, state }) {
  const out = []
  for (const e of (json && Array.isArray(json.events) ? json.events : [])) {
    const title = plainText(e.title)
    const start = String(e.start_date || '')
    const end = String(e.end_date || '')
    const date = /^\d{4}-\d{2}-\d{2}/.test(start) ? start.slice(0, 10) : ''
    const last = /^\d{4}-\d{2}-\d{2}/.test(end) ? end.slice(0, 10) : ''
    const v = e.venue && !Array.isArray(e.venue) ? e.venue : {}
    const city = plainText(v.city)
    const st = stateCode(v.stateprovince || v.state)
    const venueName = plainText(v.venue)
    const virtual = /\b(?:virtual|online|zoom|teams)\b/i.test(`${title} ${venueName}`) || (!city && !v.address)
    // A venue in another state is still the agency's event; a venue abroad is not one for Seen.
    if (v.country && !/united states|usa|^us$|^u\.s\.?$/i.test(plainText(v.country)) && plainText(v.country)) continue
    const place = city && (st || state) ? `${city}, ${st || state}` : ''
    const addr = plainText(v.address)
    const where = addr && city ? `${venueName && !addr.includes(venueName) ? `${venueName}, ` : ''}${addr}, ${city}, ${st || state}${v.zip ? ` ${plainText(v.zip)}` : ''}` : (venueName && !virtual ? venueName : null)
    const time = e.all_day ? null : (date && last === date ? clockRange(start.slice(11, 16), end.slice(11, 16)) : null)
    const desc = plainText(e.description)
    const row = fairRow({
      source, sourceName, state: st || state, title, date, last, time, place, where, virtual,
      src: typeof e.url === 'string' && /^https:\/\//.test(e.url) ? e.url : null,
      roles: eventRoles({ description: desc }), rsvp: /\b(?:register|registration|rsvp)\b/i.test(desc),
      lat: Number.isFinite(Number(v.geo_lat)) && v.geo_lat !== '' ? Number(v.geo_lat) : null,
      lng: Number.isFinite(Number(v.geo_lng)) && v.geo_lng !== '' ? Number(v.geo_lng) : null,
    })
    if (row && row.url) out.push(row)
  }
  return out
}

/** California EDD "Job Fairs and Workshops" page: one card per event with data-date / data-location / data-name. */
export function parseEddEvents(html, { source, sourceName, state = 'CA', base = 'https://edd.ca.gov' }) {
  const out = []
  for (const m of String(html || '').matchAll(/<li\s+class="card card-default event-card"([\s\S]*?)>([\s\S]*?)<\/li>/g)) {
    const attrs = m[1]
    const attr = (k) => decodeEntities((attrs.match(new RegExp(`data-${k}="([^"]*)"`)) || [])[1] || '').trim()
    const title = attr('name')
    const dm = attr('date').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/)
    if (!dm) continue
    const date = validDay(Number(dm[3]), Number(dm[1]), Number(dm[2])) ? iso(Number(dm[3]), Number(dm[1]), Number(dm[2])) : ''
    const href = (m[2].match(/href="(\/en\/jobs_and_training\/Job_Fairs_and_Workshops\/[^"]+)"/i) || [])[1]
    const slug = attr('location')
    const virtual = /virtual/i.test(attr('type')) || slug === 'statewide'
    const city = slug && slug !== 'statewide' ? slug.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : ''
    const times = [...m[2].matchAll(/<time datetime="\d{1,2}\/\d{1,2}\/\d{4} (\d{1,2}:\d{2})"/g)].map((t) => t[1])
    const row = fairRow({ source, sourceName, state, title, date, time: times.length >= 2 ? clockRange(times[0], times[1]) : null, place: city && !virtual ? `${city}, ${state}` : '', virtual, src: href ? `${base}${href}` : null, rsvp: /regist/i.test(attr('full-text')) })
    if (row && row.url) out.push(row)
  }
  return out
}

/** Maryland Department of Labor "Upcoming Recruitments and Job Fairs": the JOB & RESOURCE FAIRS table. */
export function parseMarylandFairs(html, { source, sourceName, state = 'MD', src }) {
  const s = String(html || '')
  const start = s.search(/<caption>\s*JOB\s*&(?:amp;)?\s*RESOURCE FAIRS/i)
  if (start < 0) return []
  const table = s.slice(start, s.indexOf('</table>', start))
  const out = []
  for (const tr of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => plainText(c[1]))
    if (cells.length < 4) continue
    const [title, area, when, details] = cells
    const date = readDate(when)
    const virtual = /^virtual$/i.test(area)
    const zip = details.match(/^(.{0,140}?\b[A-Z]{2}\s+\d{5})\b/)
    const row = fairRow({ source, sourceName, state, title, date, time: readClockRange(when), place: virtual ? '' : `${area}, ${state}`, where: zip ? zip[1] : null, virtual, src, rsvp: /regist/i.test(details) })
    if (row) out.push(row)
  }
  return out
}

/** WorkForce West Virginia "Job Fairs": <ul class='job-fairs'> items of title, "Date: mm/dd/yyyy", "Location: City, WV". */
export function parseWestVirginiaFairs(html, { source, sourceName, state = 'WV', src }) {
  const s = String(html || '')
  const at = s.search(/<ul class=['"]job-fairs['"]>/)
  if (at < 0) return []
  const list = s.slice(at, s.indexOf('</ul>', at))
  const out = []
  for (const li of list.matchAll(/<li>([\s\S]*?)<\/li>/g)) {
    const title = plainText((li[1].match(/<h3>([\s\S]*?)<\/h3>/) || [])[1])
    const date = readDate((li[1].match(/Date:\s*([^<]*)/) || [])[1])
    const loc = plainText((li[1].match(/Location:\s*([^<]*)/) || [])[1])
    const flyer = (li[1].match(/href=['"](https:\/\/workforcewv\.org\/[^'"]+)['"]/) || [])[1] || null
    const virtual = !loc || /virtual/i.test(title)
    const row = fairRow({ source, sourceName, state, title, date, place: virtual ? '' : loc, virtual, src: flyer || src, listIsFairs: true })
    if (row) out.push(row)
  }
  return out
}

/** CareerForce Minnesota events search (type: Job Fair or Networking Event): one <article> per event. */
export function parseCareerForceEvents(html, { source, sourceName, state = 'MN', base = 'https://careerforce.mn.gov' }) {
  const out = []
  for (const a of String(html || '').matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/g)) {
    const body = a[1]
    const link = body.match(/<a href="(\/events\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/)
    if (!link) continue
    const title = plainText(link[2])
    const pills = [...body.matchAll(/cf-events-search-card-pill">([^<]*)</g)].map((p) => plainText(p[1]))
    if (!pills.some((p) => /job fair/i.test(p))) continue
    const date = readDate(plainText((body.match(/<time[^>]*>([^<]*)<\/time>/) || [])[1]))
    const text = plainText(body)
    const loc = plainText((body.match(/cf-events-search-card-address"><span class="field-content">([^<]*)</) || [])[1])
    const virtual = pills.some((p) => /online|virtual/i.test(p)) || !loc
    const row = fairRow({ source, sourceName, state, title, date, time: readClockRange(text), place: virtual ? '' : loc, virtual, src: `${base}${link[1]}` })
    if (row) out.push(row)
  }
  return out
}

// ── Apprenticeship windows ───────────────────────────────────────────────────────────────────────────────────────
// A window is { opens, closes } (either may be null when the page does not print it), a year-round intake with an
// optional next deadline, or a published monthly rule ("the first 7 days of each month", "the first Wednesday").

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const short = (day) => { const [, m, d] = day.split('-').map(Number); return `${MON_SHORT[m - 1]} ${d}` }
const weekday = (day) => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay() }

/** A monthly rule's window in the month of `day`: { opens, closes }. */
function ruleWindow(rule, y, m) {
  if (rule.every !== 'month') return null
  if (Array.isArray(rule.days)) {
    const [a, b] = rule.days
    if (!validDay(y, m, a)) return null
    return { opens: iso(y, m, a), closes: iso(y, m, Math.min(b, validDay(y, m, b) ? b : 28)) }
  }
  if (Array.isArray(rule.nthWeekday)) {
    const [n, wd] = rule.nthWeekday
    const first = weekday(iso(y, m, 1))
    const d = 1 + ((wd - first + 7) % 7) + (n - 1) * 7
    return validDay(y, m, d) ? { opens: iso(y, m, d), closes: iso(y, m, d) } : null
  }
  return null
}

/**
 * Where a window stands on `today` (Pacific): `{ status: 'open'|'upcoming'|'closed', opens, closes, next }` —
 * `next` is the day the strip sorts and filters by (the close of an open window, the opening of an upcoming one).
 */
export function windowState(w, today) {
  const x = w?.external || w || {}
  if (x.rule) {
    const [y, m] = today.split('-').map(Number)
    const here = ruleWindow(x.rule, y, m)
    if (here && today >= here.opens && today <= here.closes) return { status: 'open', ...here, next: here.closes }
    if (here && today < here.opens) return { status: 'upcoming', ...here, next: here.opens }
    const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1
    const nextW = ruleWindow(x.rule, ny, nm)
    return nextW ? { status: 'upcoming', ...nextW, next: nextW.opens } : { status: 'closed', opens: null, closes: null, next: null }
  }
  const opens = x.opens || null
  const closes = x.closes || null
  if (closes && closes < today) return { status: 'closed', opens, closes, next: null }
  if (opens && opens > today) return { status: 'upcoming', opens, closes, next: opens }
  if (closes) return { status: 'open', opens, closes, next: closes }
  if (x.yearRound || opens) return { status: 'open', opens, closes: null, next: today }
  return { status: 'closed', opens, closes, next: null }
}

/** "Applications open · closes Dec 12" · "Applications open Jan 4–29" · "Applications open year-round · next deadline Dec 8". */
export function windowLabel(row, today) {
  const x = row?.external || {}
  const s = windowState(row, today)
  if (s.status === 'closed') return ''
  if (s.status === 'open') {
    if (x.yearRound && x.closes) return `Applications open year-round · next deadline ${short(x.closes)}`
    if (s.closes && s.closes === today) return 'Applications open · closes today'
    if (s.closes) return `Applications open · closes ${short(s.closes)}`
    return x.yearRound ? 'Applications open year-round' : 'Applications open'
  }
  if (s.closes && s.closes === s.opens) return `Applications open ${WD[weekday(s.opens)]}, ${short(s.opens)} only`
  if (s.closes) {
    const [, om] = s.opens.split('-').map(Number), [, cm, cd] = s.closes.split('-').map(Number)
    return om === cm ? `Applications open ${short(s.opens)}–${cd}` : `Applications open ${short(s.opens)} – ${short(s.closes)}`
  }
  return `Applications open ${short(s.opens)}`
}

/** The date column for a window: "Closes Dec 12" · "Opens Jan 4" · "Year-round". */
export function windowDateLabel(row, today) {
  const s = windowState(row, today)
  if (s.status === 'open') return s.closes ? `Closes ${short(s.closes)}` : 'Open now'
  if (s.status === 'upcoming') return `Opens ${short(s.opens)}`
  return ''
}

// Trade → the words the guides' position patterns read (lib/start/trades.js positions: electrician, plumber, hvac,
// welder, lineworker, pipefitter, carpenter), so a window lands on the chip of its trade.
const TRADE_ROLES = {
  electrical: 'Electrician apprentice (inside wireman)',
  lineworker: 'Lineman apprentice (outside line)',
  plumbing: 'Plumber and pipefitter apprentice',
  pipefitting: 'Pipefitter and steamfitter apprentice',
  hvac: 'HVAC sheet metal and refrigeration apprentice',
  carpentry: 'Carpenter apprentice',
  welding: 'Welder apprentice',
}
const TRADE_WORD = { electrical: 'Electrical', lineworker: 'Outside line', plumbing: 'Plumbing and pipefitting', pipefitting: 'Pipefitting', hvac: 'HVAC and sheet metal', carpentry: 'Carpentry', welding: 'Welding' }

/** A curated window (lib/jobs/data/apprenticeshipWindows.json entry) → the strip's row. */
export function windowRow(w) {
  const trade = String(w.trade || '')
  return {
    id: `appr:${w.id}`,
    title: `${TRADE_WORD[trade] || 'Registered'} apprenticeship · ${w.program}`.slice(0, 160),
    company: w.program,
    location: w.place,
    lat: Number.isFinite(w.lat) ? w.lat : null,
    lng: Number.isFinite(w.lng) ? w.lng : null,
    url: w.src,
    roles: w.roles || TRADE_ROLES[trade] || '',
    event: { kind: 'apprenticeship', label: 'Applications open', next: null, dates: [], recurring: null, time: w.time || null, where: w.where || null, virtual: false, walkIn: false, rsvp: false, onTheSpot: false, inviteOnly: false },
    external: { type: 'apprenticeship', source: w.source || 'curated', sourceName: w.sourceName || w.program, state: w.state, src: w.src, opens: w.opens || null, closes: w.closes || null, yearRound: w.yearRound === true, rule: w.rule || null, how: w.how || null, trade, checked: w.checked || null },
  }
}

// ── NY State Department of Labor apprenticeship announcements (official, re-checked by the cron) ─────────────────
// Regions → the region's main city, so a radius can measure them (a recruitment listed for several regions is in
// range when any of them is).
export const NY_REGION_CITY = {
  'new york city': 'New York, NY', 'long island': 'Hauppauge, NY', 'hudson valley': 'Newburgh, NY', 'capital district': 'Albany, NY',
  'mohawk valley': 'Utica, NY', 'north country': 'Watertown, NY', 'central new york': 'Syracuse, NY', 'southern tier': 'Binghamton, NY',
  'finger lakes': 'Rochester, NY', 'western new york': 'Buffalo, NY',
}
const NY_TRADE = [
  [/electric|ibew/i, 'electrical'], [/line\s?(?:man|worker|construction)|outside line/i, 'lineworker'], [/plumb/i, 'plumbing'],
  [/steamfitt|pipefitt|pipe trades/i, 'pipefitting'], [/sheet metal|hvac|refrigeration|heating/i, 'hvac'], [/carpent|millwright/i, 'carpentry'], [/weld|boilermaker/i, 'welding'],
]
export const nyTradeOf = (title) => (NY_TRADE.find(([re]) => re.test(title)) || [null, ''])[1]

/** The announcements list page → [{ title, regions, opens, closes, href }] (a closing date in the past is kept; the clock drops it). */
export function parseNyAnnouncements(html, base = 'https://dol.ny.gov') {
  const out = []
  for (const body of String(html || '').split(/<div class="views-row">/).slice(1)) {
    if (!/class="webny-teaser/.test(body)) continue
    const link = body.match(/<div class="webny-teaser-title">\s*<a href="(\/(?:news|ap)\/[^"]+)">([\s\S]*?)<\/a>/)
    const teaser = plainText((body.match(/<div class="webny-card-teaser">([\s\S]*?)<\/div>/) || [])[1])
    if (!link || !teaser) continue
    const regions = plainText((body.match(/<div class="webny-teaser-filter-terms">([\s\S]*?)<\/div>/) || [])[1]).split(/\s*,\s*/).filter(Boolean)
    const opens = readDate((teaser.match(/Opening Date\s*([\d/]+)/i) || [])[1])
    const closes = readDate((teaser.match(/Closing Date\s*([\d/]+)/i) || [])[1])
    out.push({ title: plainText(link[2]).replace(/\s*\(CLOSED\)\s*$/i, ''), closed: /\(CLOSED\)/i.test(plainText(link[2])), regions, opens, closes, href: `${base}${link[1]}` })
  }
  return out
}

/** One announcement page → { city, how } ("Syracuse, NY"; the sentence saying where applications are). */
export function parseNyAnnouncement(html) {
  const t = plainText(String(html || '').replace(/[\s\S]*?<main\b/i, '<main'))
  const city = (t.match(/\b\d{4}\s+([A-Z][A-Za-z .'-]+, NY)\b/) || [])[1] || null
  const how = (t.match(/(Applications? (?:are|is|will be|must be)[^.]{0,220}\.)/) || [])[1] || null
  return { city, how: how ? how.replace(/\s+\./g, '.').slice(0, 240) : null }
}

/** Days an open-ended window stays listed after its last check on the program's page. */
export const STALE_WINDOW_DAYS = 90

// ── The clock ────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The external rows still ahead on the Pacific clock, each with `event.next` set (a fair's next date; a window's
 * close when open, its opening when upcoming), soonest first. Past fairs and closed windows drop off here, so a stale
 * cache or file never shows yesterday.
 */
export function upcomingExternal(rows, now = new Date()) {
  const today = pacificDate(now)
  const out = []
  for (const r of rows || []) {
    if (!r || !r.event || !r.external) continue
    if (r.external.type === 'apprenticeship') {
      const s = windowState(r, today)
      if (s.status === 'closed' || !s.next) continue
      // A window with no printed close (a monthly rule, "reopens Jan 1", year-round) is only as good as its last
      // check: it leaves the strip STALE_WINDOW_DAYS after `checked` until someone re-reads the program's page.
      const checked = r.external.checked
      if ((!s.closes || r.external.rule) && checked && addDays(checked, STALE_WINDOW_DAYS) < today) continue
      out.push({ ...r, event: { ...r.event, next: s.next, dates: [s.next] } })
    } else {
      const dates = (r.event.dates || []).filter((d) => d >= today)
      if (!dates.length) continue
      out.push({ ...r, event: { ...r.event, dates, next: dates[0] } })
    }
  }
  return out.sort((a, b) => (a.event.next < b.event.next ? -1 : a.event.next > b.event.next ? 1 : 0))
}
