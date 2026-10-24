// The "I applied" moment, as pure functions (tests: lib/trackCapture.test.mjs):
//
//  1. WHEN they applied. The check-in clock (tracker day 7/14/30, the outcome emails) runs from the
//     application's real date, so "Track it" asks Today / 1–3 days ago / About a week ago / 2+ weeks
//     ago / a picked date and turns the answer into `appliedAt` on the California calendar
//     (lib/time/pacific.js, owner decision 2026-10-21).
//  2. WHICH emails that application will actually get. api/outcome-followups.js runs once a day
//     (vercel.json "0 15 * * *"), only looks at rows created more than 7 days ago, and sends the
//     highest milestone (7, 14, 30) the application's age has reached that has not been sent yet.
//     `checkinEmailPlan` replays exactly that, so the copy never promises a day-7 email to someone
//     who applied three weeks ago.
//  3. The guest's application riding along with the sign-up (user_metadata.pending_applications), so
//     it is created on the account's first sign-in even on another device or in a mail app's browser,
//     and never twice (`pendingToCreate`: same client id, or same company + role + applied day).

import { appliedAtFromDay, todayPacific } from './stores/applicationEdit.ts'
import { formatPacific, pacificDate, pacificDayStart } from './time/pacific.js'
import type { Application } from './types.ts'

const DAY_MS = 86400e3

export type AppliedChoice = 'today' | 'days' | 'week' | 'weeks' | 'date'

/** The choices, in the order they are shown, and how many California days back each one means. */
export const APPLIED_CHOICES: ReadonlyArray<{ value: AppliedChoice; label: string; daysAgo: number | null }> = [
  { value: 'today', label: 'Today', daysAgo: 0 },
  { value: 'days', label: '1–3 days ago', daysAgo: 2 },
  { value: 'week', label: 'About a week ago', daysAgo: 7 },
  { value: 'weeks', label: '2+ weeks ago', daysAgo: 14 },
  { value: 'date', label: 'Pick a date', daysAgo: null },
]

/** Earliest pickable date: a year back (older applications are not "waiting to hear" any more). */
export function earliestAppliedDay(now = Date.now()): string {
  return pacificDate(pacificDayStart(new Date(now), -365))
}

/**
 * The stored `appliedAt` for a choice. Today keeps the real clock time; another day is noon PT of
 * that California day (lib/stores/applicationEdit.ts appliedAtFromDay). null when the choice or the
 * picked date is not usable (no date, a future date, more than a year back).
 */
export function appliedAtFromChoice(choice: AppliedChoice | string | null | undefined, pickedDay: string | null = null, now = Date.now()): number | null {
  const c = APPLIED_CHOICES.find(x => x.value === choice)
  if (!c) return null
  if (c.value === 'date') {
    const day = String(pickedDay || '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
    if (day > todayPacific(now) || day < earliestAppliedDay(now)) return null
    return appliedAtFromDay(day, now)
  }
  const day = pacificDate(pacificDayStart(new Date(now), -(c.daysAgo || 0)))
  return appliedAtFromDay(day, now)
}

// ── The outcome emails, as api/outcome-followups.js sends them ────────────────────────────────────
const MILESTONES = [7, 14, 30] as const
/** lib/server/outcomeEmails.js milestoneForAge — kept in step by a test that runs both. */
export function milestoneForAge(age: number | null): 7 | 14 | 30 | null {
  if (age == null) return null
  if (age >= 30) return 30
  if (age >= 14) return 14
  if (age >= 7) return 7
  return null
}
/** The cron's run at or after `t`: daily at 15:00 UTC. */
export function nextCronRun(t: number): number {
  const d = new Date(t)
  const run = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 15, 0, 0)
  return run >= t ? run : run + DAY_MS
}

export interface CheckinEmail { day: 7 | 14 | 30; at: number }

/**
 * The check-in emails an application tracked at `trackedAt` (its row's created_at) that was sent at
 * `appliedAt` will get, if it stays unanswered: the same eligibility the cron uses (row older than 7
 * days, the highest milestone the age has reached, each milestone at most once).
 */
export function checkinEmailPlan(appliedAt: number, trackedAt = Date.now()): CheckinEmail[] {
  const out: CheckinEmail[] = []
  const sent = new Set<number>()
  let t = nextCronRun(trackedAt + 7 * DAY_MS + 1)
  const stop = Math.max(appliedAt + 31 * DAY_MS, t + DAY_MS)
  for (; t <= stop; t += DAY_MS) {
    const day = milestoneForAge(Math.floor((t - appliedAt) / DAY_MS))
    if (day && !sent.has(day)) { sent.add(day); out.push({ day, at: t }) }
    if (sent.has(30)) break
  }
  return out
}

/** "Oct 31" on the California calendar. */
export const shortDay = (t: number): string => formatPacific(t, { month: 'short', day: 'numeric' })

/** "Oct 31", "Oct 31 and Nov 14", "Oct 31, Nov 7 and Nov 23". */
export function joinDays(plan: CheckinEmail[]): string {
  const days = plan.map(p => shortDay(p.at))
  if (days.length <= 1) return days[0] || ''
  return `${days.slice(0, -1).join(', ')} and ${days[days.length - 1]}`
}

// ── The guest's application, carried by the sign-up ───────────────────────────────────────────────
export interface PendingApplication { id: string; company: string; role: string; applied_at: string }

export const PENDING_APPS_MAX = 5
const CLIENT_ID = /^app_\d{10,16}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const clean = (v: unknown, max: number) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max)

/** A well-formed pending application, or null. */
export function cleanPending(v: unknown): PendingApplication | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const id = String(o.id || '')
  const company = clean(o.company, 120)
  const role = clean(o.role, 120)
  const t = Date.parse(String(o.applied_at || ''))
  if (!CLIENT_ID.test(id) || !company || !role || !Number.isFinite(t)) return null
  return { id, company, role, applied_at: new Date(t).toISOString() }
}

/** What a sign-up carries: this device's guest applications (never an account row), newest first. */
export function pendingFromGuestApps(apps: Array<Partial<Application>>, max = PENDING_APPS_MAX): PendingApplication[] {
  const out: PendingApplication[] = []
  const list = [...(Array.isArray(apps) ? apps : [])].sort((a, b) => (b.appliedAt || 0) - (a.appliedAt || 0))
  for (const a of list) {
    if (!a || UUID.test(String(a.id || '')) || (a.status && a.status !== 'active')) continue
    const p = cleanPending({ id: a.id, company: a.company, role: a.role, applied_at: a.appliedAt ? new Date(a.appliedAt).toISOString() : '' })
    if (p && !out.some(x => x.id === p.id)) out.push(p)
    if (out.length >= max) break
  }
  return out
}

const key = (company: string, role: string, at: number) => `${company.trim().toLowerCase()}|${role.trim().toLowerCase()}|${pacificDate(new Date(at))}`

/**
 * The pending applications the account does not have yet. A match is the same client id, or the same
 * company + role applied on the same California day (the account's rows do not carry the client id).
 */
export function pendingToCreate(pending: unknown, existing: Array<Partial<Application>>): PendingApplication[] {
  const list = (Array.isArray(pending) ? pending : []).map(cleanPending).filter((p): p is PendingApplication => !!p)
  const have = Array.isArray(existing) ? existing : []
  const ids = new Set(have.map(a => String(a.id || '')))
  const keys = new Set(have.filter(a => a.company && a.role && a.appliedAt).map(a => key(a.company!, a.role!, a.appliedAt!)))
  const out: PendingApplication[] = []
  for (const p of list) {
    const k = key(p.company, p.role, Date.parse(p.applied_at))
    if (ids.has(p.id) || keys.has(k) || out.some(o => o.id === p.id || key(o.company, o.role, Date.parse(o.applied_at)) === k)) continue
    out.push(p)
  }
  return out
}

/** The tracker record a pending application becomes (AppStore.add). */
export function applicationFromPending(p: PendingApplication): Partial<Application> {
  const appliedAt = Date.parse(p.applied_at)
  return { id: p.id, company: p.company, role: p.role, platform: 'Seen', stage: 'Applied', status: 'active', appliedAt }
}
