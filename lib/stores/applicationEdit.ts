// The add / edit form's contract with AppStore: what a user may type for an application, how it is
// cleaned, and how an "applied on" calendar day (California time) becomes the stored timestamp.
// Pure — shared by the tracker's add modal, its Edit modal and the tests.

import type { Application } from '../types.ts'
import { pacificDate, pacificMidnight } from '../time/pacific.js'

export interface ApplicationForm {
  company: string
  role: string
  location: string
  platform: string
  /** 'YYYY-MM-DD' on the Pacific calendar. */
  appliedOn: string
}

export const EDITABLE_FIELDS = ['company', 'role', 'location', 'platform', 'appliedAt'] as const

export const PLATFORM_OPTIONS = ['Direct', 'LinkedIn', 'Indeed', 'Seen', 'Referral', 'Other'] as const

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** Today on the Pacific calendar — the add form's default. */
export function todayPacific(now = Date.now()): string {
  return pacificDate(new Date(now))
}

/**
 * The stored `appliedAt` for a chosen day: today keeps the real clock time (so two applications
 * added today still order newest-first); any other day is noon PT of that day, which displays as
 * that day in every US time zone.
 */
export function appliedAtFromDay(day: string, now = Date.now()): number {
  if (!DAY_RE.test(day)) return now
  if (day === todayPacific(now)) return now
  return pacificMidnight(day).getTime() + 12 * 3600000
}

/** Blank form for a new application (defaults: Direct, applied today). */
export function emptyForm(now = Date.now()): ApplicationForm {
  return { company: '', role: '', location: '', platform: 'Direct', appliedOn: todayPacific(now) }
}

/** The form pre-filled from an existing application (Edit). */
export function formFromApplication(app: Pick<Application, 'company' | 'role' | 'location' | 'platform' | 'appliedAt'>): ApplicationForm {
  return {
    company: app.company || '',
    role: app.role || '',
    location: app.location || '',
    platform: app.platform || 'Direct',
    appliedOn: pacificDate(new Date(app.appliedAt)),
  }
}

export function validateForm(f: ApplicationForm, now = Date.now()): string | null {
  if (!f.company.trim()) return 'Company is required'
  if (!f.role.trim()) return 'Role is required'
  if (f.company.trim().length > 200 || f.role.trim().length > 200) return 'Keep it under 200 characters'
  if (!DAY_RE.test(f.appliedOn)) return 'Pick the day you applied'
  if (f.appliedOn > todayPacific(now)) return 'The applied-on date can’t be in the future'
  return null
}

/** New-application fields from the form (AppStore.add). */
export function toNewApplication(f: ApplicationForm, now = Date.now()): Pick<Application, 'company' | 'role' | 'location' | 'platform' | 'appliedAt' | 'stage' | 'status'> {
  return {
    company: f.company.trim(),
    role: f.role.trim(),
    location: f.location.trim(),
    platform: f.platform.trim() || 'Direct',
    appliedAt: appliedAtFromDay(f.appliedOn, now),
    stage: 'Applied',
    status: 'active',
  }
}

/**
 * Only what actually changed, for AppStore.update → update_application. Returns {} when nothing
 * did, so a no-op Save never PATCHes. A re-picked "applied on" of the same day is not a change.
 */
export function editChanges(prev: Pick<Application, 'company' | 'role' | 'location' | 'platform' | 'appliedAt'>, f: ApplicationForm, now = Date.now()): Partial<Application> {
  const out: Partial<Application> = {}
  const company = f.company.trim(), role = f.role.trim(), location = f.location.trim(), platform = f.platform.trim() || 'Direct'
  if (company !== (prev.company || '')) out.company = company
  if (role !== (prev.role || '')) out.role = role
  if (location !== (prev.location || '')) out.location = location
  if (platform !== (prev.platform || '')) out.platform = platform
  if (f.appliedOn !== pacificDate(new Date(prev.appliedAt))) out.appliedAt = appliedAtFromDay(f.appliedOn, now)
  return out
}
