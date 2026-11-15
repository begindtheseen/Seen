// Hiring events — the dated, in-person (or virtual) events an employer's own posting announces: "Hiring Event –
// Thursday, November 19, 2026, 11 AM – 5 PM", "Walk-In Interviews | Thursday, Nov 19th from 2PM - 4PM", "Career
// Fair … November 18th and 19th, 2026", "Open Interviews - Thursdays 10am-4:30pm". ONE reader, used by:
//   • the search row's `hiring_event` (api/jobs.js) — a quiet chip on the card and the event's details in the drawer;
//   • the hiring-events read (lib/server/hiringEvents.js) behind each start guide's "Hiring events" strip.
// Pure; no imports beyond the Pacific clock, so the browser and node --test read it as is.
//
// Rules, each from a real posting that would otherwise read wrong (lib/jobs/fixtures/hiringEvents.json — postings
// read from Seen's corpus 2026-11-15):
//   • an event is shown only with a DATE (or a weekly day: "every Thursday", "Thursdays") — "join our talent
//     community" is not an event;
//   • a booth follow-up form ("Thank you for visiting our booth at the … Career Fair") is not an upcoming event, nor a
//     "Job Fair Application" form;
//   • a duty line is not an event ("hiring event logistics", "Attends yearly Career Fair(s) to search for…"): in the
//     posting body the event needs an invitation in its sentence (join us, hosting, attend, walk-ins welcome, RSVP…)
//     or an "Event Details / Date:" block;
//   • "Walk-in" alone is a service ("Urgent Care Walk-In", "Walk-in Crisis Center", "Walk-In Retail Associate") —
//     only "walk-in interviews" is an event;
//   • a date with a weekday that does not fall on that weekday is a stale template line ("Hiring Event - Saturday,
//     October 21" in a title whose body says "Saturday, November 21st") and is dropped when it disagrees;
//   • a year left out is the one that puts the date nearest after the posting went up (never more than 8 months on);
//   • only an address with a ZIP is printed as the place; otherwise the listing's own location is the place.

import { pacificDate } from '../time/pacific.js'

const KINDS = [
  { kind: 'walk_in', label: 'Walk-in interviews', re: /\bwalk[- ]?in interviews?\b/i },
  { kind: 'open_interviews', label: 'Open interviews', re: /\bopen interviews?\b/i },
  { kind: 'career_fair', label: 'Career fair', re: /\bcareer fairs?\b/i },
  { kind: 'job_fair', label: 'Job fair', re: /\b(?:job|hiring) fairs?\b/i },
  { kind: 'open_house', label: 'Open house', re: /\bopen house\b/i },
  { kind: 'hiring_day', label: 'Hiring day', re: /\b(?:hiring|interview) day\b/i },
  { kind: 'hiring_event', label: 'Hiring event', re: /\b(?:hiring|recruiting) event\b/i },
]
const ANY_KIND_RE = /\b(?:walk[- ]?in interviews?|open interviews?|career fairs?|(?:job|hiring) fairs?|open house|(?:hiring|interview) day|(?:hiring|recruiting) event)\b/gi

const FOLLOW_UP_RE = /\b(?:thank you|thanks) for (?:visiting|stopping by|meeting)|\bvisiting (?:with us|our booth)|\bstopping by (?:our|the)\b[^.]{0,60}\bbooth\b/i
const FORM_TITLE_RE = /\b(?:job|career) fair application\b|\btalent community\b/i
const INVITE_RE = /\b(?:join us|join our|come (?:to|meet|see|out|by)|attend(?:ing)? (?:our|the|this)|we(?:'|’)?re (?:hosting|holding|excited to (?:be )?host)|we (?:are|will be) (?:hosting|holding)|(?:will be|is) hosting|hosting (?:an?|our)|invit(?:e|ed|ing|ation)|stop by|walk[- ]ins? (?:are )?welcome|no appointment|rsvp|register|you pick the time|event details|date\s*:|when\s*\?|📅)/i
const DUTY_RE = /\b(?:logistics|coordinat\w*|plan(?:ning|s)?|organiz\w*|represent\w*|attends?|staffing|recruit(?:s|ing)? (?:at|for)|support\w*)\b/i

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const WEEKDAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }
const WD = '(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?'
const MON = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const ORD = '(?:st|nd|rd|th)?'
// "Thursday, November 19, 2026" · "Nov. 19th" · "NOVEMBER 17TH AND 18TH" · "November 10th and November 11th, 2026"
const MONTH_DATE_RE = new RegExp(`(?:\\b(${WD})\\.?,?\\s+)?\\b(${MON})\\.?\\s+(\\d{1,2})${ORD}\\b((?:\\s*(?:,|&|and|or|-|–|—)\\s*(?:${WD}\\.?,?\\s+)?\\d{1,2}${ORD}\\b(?!\\s*(?::|am|pm|a\\.m|p\\.m)))*)(?:,?\\s*(\\d{4})\\b)?`, 'gi')
// "11/17/2026" · "11/12 & 11/17" · "Wednesday 11/11" — month/day with a weekday, a year, "event"/"date" near it, or in the title
const NUM_DATE_RE = new RegExp(`(?:\\b(${WD})\\.?,?\\s+)?\\b(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2,4}))?\\b(?!\\s*(?:shift|schedule|coverage|on call))`, 'gi')
const RECUR_RE = new RegExp(`\\b(?:every\\s+(${WD})|(${WD.replace('(?:day)?', '')}days))\\b`, 'i')
const TIME_RE = /\b(\d{1,2}(?::\d{2})?|\d{3,4})\s*(a\.?m\.?|p\.?m\.?)?\s*(?:-|–|—|to|until)\s*(\d{1,2}(?::\d{2})?|\d{3,4})\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/i
const ADDRESS_RE = /(?<![:\d])\b\d{2,6}\s+(?!(?:[AaPp]\.?[Mm])\b)(?:[NSEW]\.?\s+)?[A-Za-z0-9][\w.'’-]*(?:\s+(?![AaPp][Mm]\b)[A-Za-z0-9][\w.'’-]*){0,5}\s+(?:Rd|Road|St|Street|Ave|Avenue|Av|Blvd|Boulevard|Dr|Drive|Pkwy|Pkway|Parkway|Pike|Ln|Lane|Way|Hwy|Highway|Ct|Court|Pl|Place|Cir|Circle|Mall|Plaza|Sq|Square|Ter|Terrace|Trl|Trail)\b\.?(?:[^\n]{0,70}?\b[A-Z]{2},?\s+\d{5}\b)/
const VIRTUAL_RE = /\b(?:virtual(?:ly)?|zoom|microsoft teams|online event|from the comfort of your own)\b/i
const WALK_IN_RE = /\bwalk[- ]ins? (?:are )?welcome\b|\bno appointment (?:needed|necessary|required)\b|\bno need to schedule\b|\bjoin us at any time\b|\banytime between\b/i
const RSVP_RE = /\brsvp\b|\bregister (?:here|now|today|for|in advance)\b|\bregistration (?:is )?required\b/i
const SPOT_RE = /\bon[- ]the[- ]spot (?:interviews?|(?:job )?offers?|hires?|hiring)\b|\bhiring on the spot\b/i
const INVITE_ONLY_RE = /\binvit(?:ation|e)[- ]only\b/i

const pad = (n) => String(n).padStart(2, '0')
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`
const weekdayOf = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay()
const validDay = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && new Date(Date.UTC(y, m - 1, d)).getUTCMonth() === m - 1
const wdNum = (w) => (w ? WEEKDAYS[String(w).slice(0, 3).toLowerCase()] : undefined)
const monNum = (m) => MONTHS[String(m).slice(0, 3).toLowerCase()]
const dayMs = 864e5

/** The year that puts month/day nearest after the anchor date (no earlier than 45 days before, no later than 8 months on). */
function inferYear(m, d, anchor, weekday) {
  const a = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate())
  let pick = null
  for (const y of [anchor.getUTCFullYear() - 1, anchor.getUTCFullYear(), anchor.getUTCFullYear() + 1]) {
    if (!validDay(y, m, d)) continue
    const t = Date.UTC(y, m - 1, d)
    if (t < a - 45 * dayMs || t > a + 240 * dayMs) continue
    const fits = weekday === undefined || weekdayOf(y, m, d) === weekday
    if (!pick || (fits && !pick.fits)) pick = { y, fits }
  }
  return pick
}

/** Dates written in `text` (month names and month/day numbers), each `{ iso, weekdayOk }`; `numericNeedsCue` keeps
 *  a bare "11/12" only near a weekday, a year, or a word like "event"/"date". */
function datesIn(text, anchor, { numericNeedsCue = true } = {}) {
  const out = []
  let at = 0
  const push = (y, m, d, wd) => {
    const weekday = wdNum(wd)
    let year = y
    let fits
    if (year) {
      if (year < 100) year += 2000
      if (!validDay(year, m, d)) return
      fits = weekday === undefined || weekdayOf(year, m, d) === weekday
    } else {
      const p = inferYear(m, d, anchor, weekday)
      if (!p) return
      year = p.y
      fits = p.fits
    }
    out.push({ iso: iso(year, m, d), weekdayOk: fits, hasWeekday: weekday !== undefined, at })
  }
  for (const mm of text.matchAll(MONTH_DATE_RE)) {
    at = mm.index
    const m = monNum(mm[2])
    const y = mm[5] ? Number(mm[5]) : null
    // A year written after a later date in the same run ("November 10th and November 11th, 2026") reaches back.
    const tailYear = y || Number((text.slice(mm.index + mm[0].length, mm.index + mm[0].length + 48).match(new RegExp(`^\\s*(?:,|&|and|or|-|–)\\s*(?:${WD}\\.?,?\\s+)?${MON}\\.?\\s+\\d{1,2}${ORD},?\\s*(\\d{4})\\b`, 'i')) || [])[1]) || null
    push(tailYear, m, Number(mm[3]), mm[1])
    for (const extra of String(mm[4] || '').matchAll(new RegExp(`(?:(${WD})\\.?,?\\s+)?(\\d{1,2})${ORD}`, 'gi'))) push(tailYear, m, Number(extra[2]), extra[1])
  }
  for (const nm of text.matchAll(NUM_DATE_RE)) {
    const m = Number(nm[2]), d = Number(nm[3])
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) continue
    const around = text.slice(Math.max(0, nm.index - 40), nm.index + nm[0].length + 12)
    if (numericNeedsCue && !nm[1] && !nm[4] && !/\b(?:event|date|fair|interviews?|open house|hiring day)\b|&|📅/i.test(around)) continue
    at = nm.index
    push(nm[4] ? Number(nm[4]) : null, m, d, nm[1])
  }
  return out
}

function timeIn(text) {
  const t = text.match(TIME_RE)
  if (!t) return null
  const clock = (v, ap) => {
    let s = String(v)
    if (/^\d{3,4}$/.test(s)) s = `${s.slice(0, -2)}:${s.slice(-2)}`
    s = s.replace(/:00$/, '')
    return ap ? `${s} ${ap.replace(/\./g, '').toUpperCase()}` : s
  }
  const startAp = t[2] || null
  const endAp = t[4]
  const start = clock(t[1], startAp && startAp.replace(/\./g, '').toLowerCase() !== endAp.replace(/\./g, '').toLowerCase() ? startAp : null)
  return `${start}–${clock(t[3], endAp)}`
}

/** The event region of a posting: the title, and the body around its first invited event mention. Null when the
 *  posting mentions no event, or only as a duty or a booth follow-up. */
function eventRegion(title, description) {
  if (FORM_TITLE_RE.test(title)) return null
  const body = String(description || '').replace(/\s+/g, ' ')
  if (FOLLOW_UP_RE.test(`${title} ${body.slice(0, 600)}`)) return null
  const titleHas = new RegExp(ANY_KIND_RE.source, 'i').test(title)
  let start = -1
  for (const m of body.matchAll(ANY_KIND_RE)) {
    const s0 = Math.max(body.lastIndexOf('.', m.index) + 1, m.index - 200)
    const sentence = body.slice(s0, m.index + m[0].length + 200)
    if (INVITE_RE.test(sentence) || (titleHas && !DUTY_RE.test(sentence))) { start = m.index; break }
  }
  if (start < 0 && !titleHas) return null
  const region = start >= 0 ? body.slice(Math.max(0, start - 300), start + 900) : body.slice(0, 900)
  return { titleHas, region }
}

/**
 * The event a posting announces, with every date it gives (past ones included), or null.
 * @param {{ title?: string, description?: string, created_at?: string, location?: string }} job
 * @returns {null | { kind: string, label: string, dates: string[], recurring: string|null, time: string|null,
 *   where: string|null, virtual: boolean, walkIn: boolean, rsvp: boolean, onTheSpot: boolean, inviteOnly: boolean }}
 */
export function parseHiringEvent(job) {
  const title = String(job?.title || '')
  const found = eventRegion(title, job?.description)
  if (!found) return null
  const { titleHas, region } = found
  const both = `${title}\n${region}`
  const k = KINDS.find((x) => x.re.test(title)) || KINDS.find((x) => x.re.test(region))
  if (!k) return null
  const anchor = new Date(job?.created_at || Date.now())
  if (Number.isNaN(anchor.getTime())) return null
  const titleDates = titleHas ? datesIn(title, anchor, { numericNeedsCue: false }) : []
  const regionDates = datesIn(region, anchor)
  let dates = [...titleDates, ...regionDates]
  // A weekday that disagrees with its date is a stale template line — dropped when any date agrees.
  if (dates.some((d) => d.hasWeekday && d.weekdayOk)) dates = dates.filter((d) => !d.hasWeekday || d.weekdayOk)
  const uniq = [...new Set(dates.map((d) => d.iso))].sort()
  let recurring = null
  if (!uniq.length) {
    const r = both.match(RECUR_RE)
    if (r && (k.kind === 'open_interviews' || k.kind === 'walk_in' || /\bevery\b/i.test(r[0]))) {
      const w = (r[1] || r[2]).slice(0, 3).toLowerCase()
      recurring = { sun: 'Sundays', mon: 'Mondays', tue: 'Tuesdays', wed: 'Wednesdays', thu: 'Thursdays', fri: 'Fridays', sat: 'Saturdays' }[w] || null
    }
  }
  if (!uniq.length && !recurring) return null
  const addr = region.match(ADDRESS_RE)
  return {
    kind: k.kind,
    label: k.label,
    dates: uniq,
    recurring,
    // The event's hours sit next to its date ("Date: … Time: 11 AM – 5 PM"); a shift schedule elsewhere is not them.
    time: timeIn(title) || regionDates.map((d) => timeIn(region.slice(d.at, d.at + 260))).find(Boolean) || (recurring ? timeIn(region) : null),
    where: addr ? addr[0].replace(/\s+/g, ' ').replace(/[\s,]+$/, '').slice(0, 120) : null,
    virtual: VIRTUAL_RE.test(both),
    walkIn: k.kind === 'walk_in' || k.kind === 'open_interviews' || WALK_IN_RE.test(both),
    rsvp: RSVP_RE.test(both),
    onTheSpot: SPOT_RE.test(both),
    inviteOnly: INVITE_ONLY_RE.test(both),
  }
}

/**
 * The event a listing announces that has not happened yet (today counts, on the Pacific clock), with `next` — its
 * next date (or the next weekly day). Null for no event, or one whose dates have all passed.
 */
export function upcomingHiringEvent(job, now = new Date()) {
  const ev = parseHiringEvent(job)
  if (!ev) return null
  const today = pacificDate(now)
  if (ev.recurring) {
    const want = { Sundays: 0, Mondays: 1, Tuesdays: 2, Wednesdays: 3, Thursdays: 4, Fridays: 5, Saturdays: 6 }[ev.recurring]
    const [y, m, d] = today.split('-').map(Number)
    const base = Date.UTC(y, m - 1, d)
    const add = (want - new Date(base).getUTCDay() + 7) % 7
    const t = new Date(base + add * dayMs)
    return { ...ev, next: iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()) }
  }
  const future = ev.dates.filter((d) => d >= today)
  if (!future.length) return null
  // A posting's last date more than 8 months out is a misread, not an event.
  if (Date.parse(`${future[0]}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`) > 240 * dayMs) return null
  return { ...ev, dates: future, next: future[0] }
}

const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WD_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "Thu, Nov 19" · "Nov 17 & 18" · "Nov 12 & 17" · "Thursdays" — read from the ISO string itself (no time zone). */
export function eventDateLabel(ev) {
  if (!ev) return ''
  if (ev.recurring) return ev.recurring
  const ds = (ev.dates || []).slice(0, 3)
  if (!ds.length) return ''
  const parts = ds.map((s) => s.split('-').map(Number))
  if (parts.length === 1) {
    const [y, m, d] = parts[0]
    return `${WD_SHORT[weekdayOf(y, m, d)]}, ${MON_SHORT[m - 1]} ${d}`
  }
  const sameMonth = parts.every((p) => p[1] === parts[0][1])
  if (sameMonth) return `${MON_SHORT[parts[0][1] - 1]} ${parts.map((p) => p[2]).join(' & ')}`
  return parts.map((p) => `${MON_SHORT[p[1] - 1]} ${p[2]}`).join(' & ')
}

/** The search row's compact event (or null): what the card chip and the drawer need. */
export function listingHiringEvent(job, now = new Date()) {
  const ev = upcomingHiringEvent(job, now)
  if (!ev) return null
  const { kind, label, next, dates, recurring, time, where, virtual, walkIn, rsvp, onTheSpot, inviteOnly } = ev
  return { kind, label, next, dates, recurring, time, where, virtual, walkIn, rsvp, onTheSpot, inviteOnly }
}

const ROLES_RE = /\b(?:(?:we(?:'|’)?re|we are|now) hiring for|hiring for|hiring immediately|hiring|positions? (?:available|include|open)|roles? available|considering candidates for(?: the following(?: opportunities| positions)?)?|interviewing (?:and hiring )?for(?: the following positions)?|(?:who (?:are )?we(?:'|’)?re |who are we )?looking for|open (?:roles|positions)|opportunities)\s*:\s*|\b(?:(?:we(?:'|’)?re|we are|now) hiring for|considering candidates for the following(?: opportunities| positions)?|interviewing (?:and hiring )?for the following positions)\s+/i

/** The roles an event is hiring for, as the posting words them ("Fulfillment Associates", "Unarmed Security Officers
 *  & Supervisors", "Maintenance Technicians and Service Technicians") — at most 160 characters, or ''. Event titles
 *  are often generic ("Open House", "Hiring Day!"), so this is what places an event in a field. */
export function eventRoles(job) {
  const body = String(job?.description || '').replace(/\s+/g, ' ')
  const m = body.match(ROLES_RE)
  if (!m) return ''
  return body.slice(m.index + m[0].length, m.index + m[0].length + 160).replace(/\s+\S*$/, '').trim()
}
