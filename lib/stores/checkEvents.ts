// Check-in answers and snoozes as DATA ON THE APPLICATION (audit 3, 2026-10-24, H3: "Got a response"
// wrote nothing to the account, so a second device re-asked and the dashboard's response rate ignored
// it). Every answer becomes a `check_answered` event and every "Later" a `check_snoozed` event in
// `events[]` — synced through update_application like a stage change — and the due check is derived
// from those events (server truth). The device ledger (EventStore, localStorage) is only an offline
// cache that is reconciled on load. Pure; pinned by checkEvents.test.mjs.

import { CHECK_SCHEDULE, type CheckType } from '../constants.ts'
import type { Application, DueCheck, HiringEvent } from '../types.ts'
import { checksInPlay, daysSince, FINAL_CHECK_DAY } from './checkSchedule.ts'

export const CHECK_ANSWERED = 'check_answered'
export const CHECK_SNOOZED = 'check_snoozed'
export const STAGE_CORRECTED = 'stage_corrected'

export { FINAL_CHECK_DAY }

const CHECK_TYPES = new Set<string>(CHECK_SCHEDULE.map(c => c.type))
export const isCheckType = (t: string): t is CheckType => CHECK_TYPES.has(t)

let idCounter = 0
/** CSPRNG-backed id (CodeQL: no Math.random in ids); a counter when no crypto is present. */
export function eventId(prefix = 'ev'): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c?.getRandomValues) {
    const b = new Uint32Array(2); c.getRandomValues(b)
    return `${prefix}_${Date.now()}_${b[0].toString(36)}${b[1].toString(36)}`.slice(0, 40)
  }
  return `${prefix}_${Date.now()}_${(++idCounter).toString(36)}`
}

/** The marker written when a check-in is answered (any answer, including "Not yet"). */
export function checkAnsweredEvent(checkType: CheckType, answer: Record<string, unknown>, daysElapsed: number, now = Date.now()): HiringEvent {
  const day = CHECK_SCHEDULE.find(c => c.type === checkType)?.day ?? 0
  return {
    id: eventId('chk'),
    type: CHECK_ANSWERED,
    date: now,
    source: 'user',
    confidence: 'medium',
    trust_weight: 1,
    data: { check: checkType, day, days_elapsed: daysElapsed, ...answer },
  }
}

/** The marker written for "Later": asked again at `until`. */
export function checkSnoozedEvent(checkType: CheckType, until: number, now = Date.now()): HiringEvent {
  const day = CHECK_SCHEDULE.find(c => c.type === checkType)?.day ?? 0
  return { id: eventId('snz'), type: CHECK_SNOOZED, date: now, source: 'user', confidence: 'high', trust_weight: 1, data: { check: checkType, day, until } }
}

/** A backwards stage move: the move is recorded and the events it contradicts are superseded, never deleted. */
export function stageCorrectedEvent(from: string, to: string, superseded: string[], now = Date.now()): HiringEvent {
  return { id: eventId('cor'), type: STAGE_CORRECTED, date: now, source: 'user', confidence: 'high', trust_weight: 1, data: { from, to, superseded } }
}

export const isSuperseded = (e: Pick<HiringEvent, 'anomaly_flags'>): boolean => (e.anomaly_flags || []).includes('superseded')

/** The check types this application's events say were answered. */
export function answeredFromEvents(events: readonly HiringEvent[] | undefined): Set<CheckType> {
  const out = new Set<CheckType>()
  for (const e of events || []) {
    if (e.type !== CHECK_ANSWERED) continue
    const c = String(e.data?.check || '')
    if (isCheckType(c)) out.add(c)
  }
  return out
}

/** The instant (ms) a snoozed check is asked again, or null when it is not snoozed at `now`. */
export function snoozedUntilFromEvents(events: readonly HiringEvent[] | undefined, checkType: CheckType, now = Date.now()): number | null {
  let until: number | null = null
  for (const e of events || []) {
    if (e.type !== CHECK_SNOOZED || String(e.data?.check || '') !== checkType) continue
    const u = Number(e.data?.until)
    if (Number.isFinite(u) && (until == null || u > until)) until = u
  }
  return until != null && until > now ? until : null
}

/**
 * The ONE check this application is asked now, or null. `answered` / `snoozedUntil` are the
 * union of what the events say and the device cache (the caller merges them).
 *
 * - Earliest unanswered check whose day has come, in schedule order (response → interview → outcome).
 * - From day 30 ONLY the final-outcome question is asked: a 31-day-old card no longer gets
 *   "Did they respond?" (audit M7 — "DAY 399 CHECK-IN — Did they respond?").
 * - A snoozed check holds the application; a later check never jumps the queue.
 */
const STAGE_ANSWERS: Record<string, string[]> = {
  'Phone Screen': ['response_check', 'interview_check'],
  'Interview': ['response_check', 'interview_check'],
  'Final Round': ['response_check', 'interview_check'],
  'Offer': ['response_check', 'interview_check'],
}

export function pickDueCheck(app: Application, answered: ReadonlySet<string>, snoozedUntil: (type: CheckType) => number | null, now = Date.now()): DueCheck | null {
  if (app.status !== 'active') return null
  const days = daysSince(app.appliedAt, now)
  // A card already at a screen or interview has answered "did they respond?" and "any interview?" by its
  // stage — asking them anyway put "Day 7 · Did they respond?" under an Interview Prep panel (round-2 test).
  const implied = STAGE_ANSWERS[app.stage] || []
  const chk = checksInPlay(app.appliedAt, now).find(c => days >= c.day && !answered.has(c.type) && !implied.includes(c.type))
  if (!chk) return null
  const until = snoozedUntil(chk.type)
  if (until != null && until > now) return null
  return { app, checkType: chk.type, day: chk.day, daysElapsed: days, label: chk.label, q: chk.q, overdue: days - chk.day }
}

/** "Day 7 check-in" or "Day 7 check-in · day 31" — the milestone, never the age of the card (audit M7). */
export function checkLabel(check: Pick<DueCheck, 'day' | 'daysElapsed'>): string {
  return check.daysElapsed > check.day ? `Day ${check.day} check-in · day ${check.daysElapsed}` : `Day ${check.day} check-in`
}
