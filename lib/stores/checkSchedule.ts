// The tracker's check-in schedule (day 7 / 14 / 30, lib/constants CHECK_SCHEDULE) as pure
// functions, so the card can say "Next check-in Oct 30 — did they respond?" and the tests can
// pin the arithmetic without a browser. EventStore.dueChecks keeps asking the questions; this
// only answers WHEN the next one is asked. Dates are shown on the California clock
// (lib/time/pacific.js) — owner decision 2026-10-21: no UTC anywhere.

import { CHECK_SCHEDULE } from '../constants.ts'
import { formatPacific, pacificDaysBetween, pacificDayStart } from '../time/pacific.js'

export const DAY_MS = 86400000

export interface NextCheck {
  type: (typeof CHECK_SCHEDULE)[number]['type']
  /** Schedule day (7, 14 or 30). */
  day: number
  /** When it becomes due: midnight PT at the start of the `day`-th California day after applying. */
  dueAt: number
  /** Already due now (the card is asking it). */
  due: boolean
  /** The question, lower-cased for inline copy ("did they respond to your application?"). */
  q: string
}

/**
 * "Day N" for an application: whole CALIFORNIA calendar days since it was sent (never negative).
 * The one day counter for tracker cards, the dashboard and the check-in schedule — an application
 * sent late in the evening is Day 1 the next morning, and "Day 7" lands on the date the card names.
 * (owner decision 2026-10-21: no UTC anywhere; lib/time/pacific.js)
 */
export function daysSince(appliedAt: number, now = Date.now()): number {
  return Math.max(0, pacificDaysBetween(appliedAt, now))
}

/** The instant a day-`day` check comes due: midnight PT at the start of that California day. */
export function checkDueAt(appliedAt: number, day: number): number {
  return pacificDayStart(new Date(appliedAt), day).getTime()
}

/** Day 30 and later: only the final-outcome question is asked — "did they respond?" is moot by then. */
export const FINAL_CHECK_DAY = 30

/** The checks still worth asking at this age, in schedule order (audit 3 M7: a 31-day-old card was
 *  asked the day-7 and day-14 questions before the outcome; a 400-day-old one "DAY 399 · Did they respond?"). */
export function checksInPlay(appliedAt: number, now = Date.now()) {
  return daysSince(appliedAt, now) >= FINAL_CHECK_DAY ? CHECK_SCHEDULE.filter(c => c.day === FINAL_CHECK_DAY) : [...CHECK_SCHEDULE]
}

/**
 * The earliest scheduled check this application has not answered, or null once all three are
 * done. `answered` = the check types already recorded for it (EventStore.hasCheck).
 */
export function nextCheck(appliedAt: number, answered: Iterable<string>, now = Date.now()): NextCheck | null {
  const done = new Set(answered)
  const chk = checksInPlay(appliedAt, now).find(c => !done.has(c.type))
  if (!chk) return null
  // Due the moment the California day count reaches `day` — the same clock the card's "Day N" uses.
  const dueAt = checkDueAt(appliedAt, chk.day)
  return { type: chk.type, day: chk.day, dueAt, due: daysSince(appliedAt, now) >= chk.day, q: chk.q.charAt(0).toLowerCase() + chk.q.slice(1) }
}

/** "Oct 30" on the Pacific calendar (adds the year only when it is not the current one). */
export function formatCheckDate(ms: number, now = Date.now()): string {
  const sameYear = formatPacific(ms, { year: 'numeric' }) === formatPacific(now, { year: 'numeric' })
  return formatPacific(ms, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * The one line an active card shows under its stage: null while a check is being asked (the card asks
 * it instead). `snoozedUntil` = when a due check that was put off with "Later" comes back — the card
 * then says so instead of going quiet (audit 3 M6: after "Later" nothing said when it would return).
 */
export function nextCheckLine(appliedAt: number, answered: Iterable<string>, now = Date.now(), snoozedUntil: number | null = null): string | null {
  const n = nextCheck(appliedAt, answered, now)
  if (!n) return null
  if (n.due) {
    if (snoozedUntil != null && snoozedUntil > now) return `We'll ask again ${formatCheckDate(snoozedUntil, now)} — ${n.q}`
    return null
  }
  return `Next check-in ${formatCheckDate(n.dueAt, now)} — ${n.q}`
}
