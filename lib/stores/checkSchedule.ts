// The tracker's check-in schedule (day 7 / 14 / 30, lib/constants CHECK_SCHEDULE) as pure
// functions, so the card can say "Next check-in Oct 30 — did they respond?" and the tests can
// pin the arithmetic without a browser. EventStore.dueChecks keeps asking the questions; this
// only answers WHEN the next one is asked. Dates are shown on the California clock
// (lib/time/pacific.js) — owner decision 2026-10-21: no UTC anywhere.

import { CHECK_SCHEDULE } from '../constants.ts'
import { formatPacific } from '../time/pacific.js'

export const DAY_MS = 86400000

export interface NextCheck {
  type: (typeof CHECK_SCHEDULE)[number]['type']
  /** Schedule day (7, 14 or 30). */
  day: number
  /** When it becomes due: appliedAt + day. */
  dueAt: number
  /** Already due now (the card is asking it). */
  due: boolean
  /** The question, lower-cased for inline copy ("did they respond to your application?"). */
  q: string
}

/** Whole days since `appliedAt` (floored, never negative). */
export function daysSince(appliedAt: number, now = Date.now()): number {
  return Math.max(0, Math.floor((now - appliedAt) / DAY_MS))
}

/**
 * The earliest scheduled check this application has not answered, or null once all three are
 * done. `answered` = the check types already recorded for it (EventStore.hasCheck).
 */
export function nextCheck(appliedAt: number, answered: Iterable<string>, now = Date.now()): NextCheck | null {
  const done = new Set(answered)
  const chk = CHECK_SCHEDULE.find(c => !done.has(c.type))
  if (!chk) return null
  const dueAt = appliedAt + chk.day * DAY_MS
  return { type: chk.type, day: chk.day, dueAt, due: now >= dueAt, q: chk.q.charAt(0).toLowerCase() + chk.q.slice(1) }
}

/** "Oct 30" on the Pacific calendar (adds the year only when it is not the current one). */
export function formatCheckDate(ms: number, now = Date.now()): string {
  const sameYear = formatPacific(ms, { year: 'numeric' }) === formatPacific(now, { year: 'numeric' })
  return formatPacific(ms, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

/** The one line an active card shows under its stage: null while a check is due (the card asks it instead). */
export function nextCheckLine(appliedAt: number, answered: Iterable<string>, now = Date.now()): string | null {
  const n = nextCheck(appliedAt, answered, now)
  if (!n || n.due) return null
  return `Next check-in ${formatCheckDate(n.dueAt, now)} — ${n.q}`
}
