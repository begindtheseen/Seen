// "I'm going": a hiring event someone plans to attend, kept on their tracker. ONE definition, read by the listing's
// "I'm going" button (components/jobs/GoingButton.tsx), the tracker card (components/tracker/EventPlan.tsx) and the
// daily email job (api/outcome-followups.js). Pure; no imports, so the browser, the server and node --test read it.
//
// The plan is an `interview_scheduled` event on the application (the tracker's interview date — the same field the
// prep panel and the dashboard already read) with `data.kind: 'hiring_event'` and the event's label, hours and place
// as the posting gave them. The answer to "How did it go?" is an `event_check_answered` event. Nothing new in the
// database: both ride in `applications.events` like every other check-in.

export const EVENT_KIND = 'hiring_event'
export const EVENT_ANSWERED = 'event_check_answered'
/** The daily email job's ledger keys (outcome_email_log.milestone_day) — outside the 7/14/30 check-in days. */
export const EVENT_EVE_DAY = 9001
export const EVENT_AFTER_DAY = 9002
/** Days after the event the "How did it go?" stays asked by email (the card keeps asking until answered). */
export const AFTER_WINDOW_DAYS = 3

/** What each answer does to the card: the stage it moves to, or the status. */
export const EVENT_ANSWERS = Object.freeze({
  offer: { label: 'Got an offer', changes: { stage: 'Offer' } },
  interviewed: { label: 'Interviewed — waiting', changes: { stage: 'Interview' } },
  nothing: { label: 'Went — nothing yet', changes: {} },
  didnt_go: { label: 'Didn’t go', changes: { status: 'withdrawn' } },
})

/** "11 AM–5 PM" → "11:00"; "2–4 PM" → "14:00"; "10:30 AM–5 PM" → "10:30"; "" when there are no hours. */
export function eventStartClock(time) {
  const m = String(time || '').match(/^(\d{1,2})(?::(\d{2}))?(?:\s*([AP]M))?–\d{1,2}(?::\d{2})?\s*([AP]M)/)
  if (!m) return ''
  let h = Number(m[1])
  const min = m[2] ? Number(m[2]) : 0
  let ap = m[3]
  if (!ap) {
    // "2–4 PM": the start shares the end's half of the day unless that would put it after the end ("11–2 PM").
    const endH = Number((String(time).match(/–(\d{1,2})/) || [])[1])
    ap = m[4] === 'PM' && h > endH && h !== 12 ? 'AM' : m[4]
  }
  if (ap === 'PM' && h !== 12) h += 12
  if (ap === 'AM' && h === 12) h = 0
  if (h > 23 || min > 59) return ''
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/** The interview_scheduled event a "Going" tap writes. `at` is the event's start (lib/interviewTime.ts isoFrom). */
export function planEvent(ev, at, listingId, now = Date.now()) {
  return {
    id: `ev_${now}_go`,
    type: 'interview_scheduled',
    date: now,
    source: 'user',
    confidence: 'high',
    data: {
      at,
      kind: EVENT_KIND,
      label: String(ev?.label || 'Hiring event').slice(0, 40),
      time: ev?.time ? String(ev.time).slice(0, 40) : null,
      where: ev?.where ? String(ev.where).slice(0, 160) : null,
      virtual: ev?.virtual === true,
      listing_id: listingId ? String(listingId).slice(0, 80) : null,
    },
  }
}

/** The hiring event an application plans (the latest "Going" plan that a later date has not replaced), or null. */
export function plannedEvent(app) {
  const evs = Array.isArray(app?.events) ? app.events : []
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i]
    if (e?.type !== 'interview_scheduled' || typeof e.data?.at !== 'string') continue
    if ((e.anomaly_flags || []).includes('superseded')) continue
    if (e.data.kind !== EVENT_KIND) return null // the person set a different interview date since
    return { at: e.data.at, label: e.data.label || 'Hiring event', time: e.data.time || null, where: e.data.where || null, virtual: e.data.virtual === true }
  }
  return null
}

/** The answer given to "How did it go?", or null. */
export function eventAnswer(app) {
  const evs = Array.isArray(app?.events) ? app.events : []
  for (let i = evs.length - 1; i >= 0; i--) if (evs[i]?.type === EVENT_ANSWERED) return String(evs[i].data?.answer || '') || null
  return null
}

/** The event written when "How did it go?" is answered. */
export function eventAnsweredEvent(answer, now = Date.now()) {
  return { id: `chk_${now}_ev`, type: EVENT_ANSWERED, date: now, source: 'user', confidence: 'medium', trust_weight: 1, data: { answer } }
}

const pad = (n) => String(n).padStart(2, '0')
/** The calendar day (YYYY-MM-DD) of an instant in a time zone (default Pacific, the server's clock for Seen). */
export function dayIn(isoOrMs, timeZone = 'America/Los_Angeles') {
  const d = new Date(isoOrMs)
  if (Number.isNaN(d.getTime())) return ''
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}
const addDays = (day, n) => {
  const [y, m, d] = day.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/**
 * Where an application with a planned event stands: 'upcoming' (before the event day), 'today', 'ask' (the event day
 * has passed and "How did it go?" is unanswered), 'answered', or null (no plan, or the card is closed).
 */
export function eventStage(app, now = Date.now(), timeZone) {
  const plan = plannedEvent(app)
  if (!plan || app?.status !== 'active') return eventAnswer(app) && plan ? 'answered' : null
  if (eventAnswer(app)) return 'answered'
  const today = dayIn(now, timeZone)
  const day = dayIn(plan.at, timeZone)
  if (!today || !day) return null
  if (day > today) return 'upcoming'
  if (day === today) return 'today'
  return 'ask'
}

/**
 * The email an application is due today (Pacific): 'eve' the day before its event, 'after' from the day after for
 * AFTER_WINDOW_DAYS while "How did it go?" is unanswered, else null.
 */
export function eventEmailDue(app, now = Date.now()) {
  const plan = plannedEvent(app)
  if (!plan || app?.status !== 'active' || eventAnswer(app)) return null
  const today = dayIn(now)
  const day = dayIn(plan.at)
  if (!today || !day) return null
  if (addDays(today, 1) === day) return 'eve'
  if (day < today && addDays(day, AFTER_WINDOW_DAYS) >= today) return 'after'
  return null
}

const EVENT_WORDS_RE = /\b(?:hiring (?:event|day|fair)|recruiting event|job fair|career fair|open house|walk[- ]?in interviews?|open interviews?|interview day|virtual|in[- ]person|apply today|interview now|start next week)\b/i
const DATEISH_RE = /\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d|\b\d{1,2}\/\d{1,2}\b|\b\d{1,2}\s*(?:am|pm)\b/i

/**
 * The role for the tracker card from an event listing's title: the parts that are not the event or its date
 * ("Certified Nurse Aide Hiring Event- Thursday, November 19th" → "Certified Nurse Aide"; "Graham Packaging | Walk-In
 * Interviews | Thursday, Nov 19th" → the event's label when nothing but the employer is left).
 */
export function roleFromEventTitle(title, company, label = 'Hiring event') {
  const co = String(company || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const parts = String(title || '')
    .replace(/[📢🎉🚨⭐]/gu, ' ')
    // The event words are separators too ("PCT Certified-HIRING EVENT NOVEMBER 17TH").
    .replace(new RegExp(EVENT_WORDS_RE.source, 'gi'), ' | ')
    .split(/\s*\|\s*|\s+[–—-]\s+|\s+[–—]\s*|-\s+(?=[A-Z])/)
    .map((p) => p.replace(/[!:,]+/g, ' ').replace(/^[\s–—-]+|[\s–—-]+$/g, '').replace(/\s+/g, ' ').trim())
    .filter((p) => p && !DATEISH_RE.test(p) && p.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() !== co && p.length > 2)
  const role = (parts[0] || '').replace(new RegExp(`^${co.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i'), '').trim()
  return role && role.length >= 3 ? role.slice(0, 80) : label
}
