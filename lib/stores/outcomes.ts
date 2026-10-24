// What the dashboard and the tracker count as a company RESPONSE, an interview and a real outcome —
// one definition for every rate on both pages (audit 3, 2026-10-24, M2: the dashboard said
// "Response 25%" from the response_received a reverted, 504'd stage click left behind, and divided by
// a total that included withdrawn applications). Pure; pinned by outcomes.test.mjs.
//
//  - A response = the company engaged: a decision (hired / rejected), a LIVE response-or-later event
//    (a backwards stage move supersedes the events above it — lib/stores/AppStore), or a stage past
//    Viewed. A check-in "Got a response" records response_received, so it counts here too (H3).
//  - Withdrawn applications are the applicant's move, not the company's: out of every denominator.
//  - A real outcome = hired, rejected or ghosted (withdrawn is not one).

import { STAGES } from '../constants.ts'
import type { Application, HiringEvent } from '../types.ts'

const RESPONSE_EVENTS = new Set(['response_received', 'assessment_received', 'interview_received', 'interview_completed', 'offer_received'])
const INTERVIEW_EVENTS = new Set(['interview_received', 'interview_completed'])
const PHONE_SCREEN = STAGES.indexOf('Phone Screen')

type Rated = Pick<Application, 'status' | 'stage'> & { events?: HiringEvent[] }

const live = (e: HiringEvent) => !(e.anomaly_flags || []).includes('superseded')

export function responded(a: Rated): boolean {
  if (a.status === 'withdrawn') return false
  if (a.status === 'hired' || a.status === 'rejected') return true
  if ((a.events || []).some(e => live(e) && RESPONSE_EVENTS.has(e.type))) return true
  return STAGES.indexOf(a.stage as typeof STAGES[number]) >= PHONE_SCREEN
}

export function hadInterview(a: Rated): boolean {
  if (a.status === 'withdrawn') return false
  return a.status === 'hired' || (a.events || []).some(e => live(e) && INTERVIEW_EVENTS.has(e.type))
}

/** The applications every rate is computed over: everything except withdrawn. */
export function rated<T extends Rated>(apps: readonly T[]): T[] {
  return apps.filter(a => a.status !== 'withdrawn')
}

/** Whole-percent response rate over rated applications, or null when there are none. */
export function responseRate(apps: readonly Rated[]): number | null {
  const r = rated(apps)
  return r.length ? Math.round((r.filter(responded).length / r.length) * 100) : null
}

/** Hired + rejected + ghosted: the outcomes a verdict can stand on. */
export function realOutcomes(apps: readonly Pick<Application, 'status'>[]): number {
  return apps.filter(a => a.status === 'hired' || a.status === 'rejected' || a.status === 'ghosted').length
}

/** The health ring shows a number only once this many real outcomes exist (audit 3 M1). */
export const HEALTH_MIN_OUTCOMES = 2
