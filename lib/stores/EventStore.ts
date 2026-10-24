'use client'

import { CHECK_SCHEDULE, type CheckType } from '../constants'
import type { Application, DueCheck } from '../types'
import { nextCheck, type NextCheck } from './checkSchedule'
import { answeredFromEvents, isCheckType, pickDueCheck, snoozedUntilFromEvents } from './checkEvents'

// The device ledger of check-in answers (seen_hevents_v1) and snoozes (seen_check_snooze). Since
// audit 3 (2026-10-24, H3) the TRUTH lives on the application: every answer is a `check_answered`
// event and every "Later" a `check_snoozed` event in app.events, synced to the account. This ledger
// is only an offline cache — what is here and not yet in app.events is pushed by the tracker on load
// (pendingLedger). Due checks are derived from the union of both, so an answer given offline still
// stops the question on this device until it reaches the account.

const KEY = 'seen_hevents_v1'
const SNOOZE_KEY = 'seen_check_snooze'

export interface StoredEvent {
  id: string
  appId?: string
  company?: string
  role?: string
  location?: string
  platform?: string
  type: string
  createdAt: number
  anomaly_flags?: string[]
  trust_weight?: number
  data?: Record<string, unknown>
}

export const EventStore = {
  get(): StoredEvent[] {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
  },

  add(evt: Partial<StoredEvent>): StoredEvent {
    const now = Date.now()
    const e: StoredEvent = {
      type: '',
      ...evt,
      id: evt.id || ('hev_' + now + '_' + (this.get().length + 1).toString(36)),
      createdAt: now,
    }
    // Anti-gaming: flag mass submissions
    const recentCount = this.get().filter(x => x.createdAt > now - 3600000).length
    if (recentCount >= 10) {
      e.anomaly_flags = [...(e.anomaly_flags || []), 'rate_exceeded']
      e.trust_weight = 0
    }
    const all = this.get()
    if (!all.find(x => x.id === e.id)) {
      all.unshift(e)
      try { localStorage.setItem(KEY, JSON.stringify(all)) } catch {}
    }
    // The tracker's handleUpdate files ONE community report per terminal outcome (quick_submit);
    // the day-30 check used to file a second copy here (down-weighted + held for review every time).
    return e
  },

  forApp(appId: string): StoredEvent[] {
    return this.get().filter(e => e.appId === appId)
  },

  forCompany(company: string): StoredEvent[] {
    const k = (company || '').toLowerCase()
    return this.get().filter(e => (e.company || '').toLowerCase() === k)
  },

  /** Answered on THIS device (the cache). The application's events are the account's answer. */
  hasCheck(appId: string, checkType: string): boolean {
    return this.get().some(e => e.appId === appId && e.type === checkType)
  },

  /** The check types answered for one application: its events (account) ∪ this device's cache. */
  answeredChecks(app: Pick<Application, 'id' | 'events'>): CheckType[] {
    const out = answeredFromEvents(app.events)
    for (const e of this.get()) if (e.appId === app.id && isCheckType(e.type)) out.add(e.type)
    return [...out]
  },

  /** When a snoozed check comes back (events ∪ this device's snooze cache), or null when not snoozed. */
  snoozedUntil(app: Pick<Application, 'id' | 'events'>, checkType: CheckType, now = Date.now()): number | null {
    const fromEvents = snoozedUntilFromEvents(app.events, checkType, now)
    const local = this._getSnoozed()[app.id + ':' + checkType]
    const fromDevice = typeof local === 'number' && local > now ? local : null
    if (fromEvents == null) return fromDevice
    if (fromDevice == null) return fromEvents
    return Math.max(fromEvents, fromDevice)
  },

  /**
   * Cached answers for this application that are not yet in its events — the tracker pushes each as
   * a `check_answered` marker on load (offline answers, and answers given before H3 shipped).
   */
  pendingLedger(app: Pick<Application, 'id' | 'events'>): StoredEvent[] {
    const onAccount = answeredFromEvents(app.events)
    return this.get().filter(e => e.appId === app.id && isCheckType(e.type) && !onAccount.has(e.type))
  },

  /**
   * When this application is next asked a check-in (7 / 14 / 30 days after applying), or null once
   * all three are answered. The card prints it as "Next check-in Oct 30 — did they respond?".
   */
  nextCheck(app: Application, now = Date.now()): NextCheck | null {
    if (app.status !== 'active') return null
    return nextCheck(app.appliedAt, this.answeredChecks(app), now)
  },

  /**
   * ONE question per application at a time (lib/stores/checkEvents pickDueCheck): the earliest
   * unanswered check in schedule order, the final-outcome question first from day 30, and a snoozed
   * check holds the application. Only OPEN applications are asked. Most overdue first.
   */
  dueChecks(apps: Application[], now = Date.now()): DueCheck[] {
    const due: DueCheck[] = []
    for (const app of apps) {
      const answered = new Set<string>(this.answeredChecks(app))
      const d = pickDueCheck(app, answered, t => this.snoozedUntil(app, t, now), now)
      if (d) due.push(d)
    }
    return due.sort((a, b) => b.overdue - a.overdue)
  },

  /** Cache a snooze on this device (the account copy is the `check_snoozed` event the tracker writes). */
  snooze(appId: string, checkType: string, hours = 24): number {
    const s = this._getSnoozed()
    const until = Date.now() + hours * 3600000
    s[appId + ':' + checkType] = until
    try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(s)) } catch {}
    return until
  },

  _getSnoozed(): Record<string, number> {
    try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) || '{}') } catch { return {} }
  },

  toReports(company: string): Array<{ outcome: string; rounds: number; wait_days: number; unpaid_work: string; _source: string }> {
    const all = this.forCompany(company)
    const outcomes = all.filter(e => e.type === 'outcome_check' && e.data)
    const roundsMap: Record<string, Record<string, unknown>> = {}
    all.filter(e => e.type === 'rounds_detail').forEach(e => { if (e.appId) roundsMap[e.appId] = (e.data || {}) as Record<string, unknown> })
    // A withdrawal is not a company response — it never becomes a report (filtered as 'waiting').
    const outcomeMap: Record<string, string> = { offer: 'hired', rejected: 'human', ghosted: 'ghosted', withdrew: 'waiting' }
    return outcomes.map(e => {
      const d = e.data || {}
      const rd = roundsMap[e.appId || ''] || {}
      return {
        outcome: outcomeMap[d.outcome as string] || 'waiting',
        rounds: (rd.rounds as number) || (d.rounds as number) || 0,
        wait_days: (d.daysToResponse as number) || 0,
        unpaid_work: (rd.unpaid_work as string) || 'na',
        _source: 'first_party',
      }
    }).filter(r => r.outcome !== 'waiting')
  },

  async _submitAsReport(evt: StoredEvent): Promise<void> {
    try {
      const { supabase } = await import('../supabase')
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const d = evt.data || {}
      const outcomeMap: Record<string, string> = { offer: 'hired', rejected: 'human', ghosted: 'ghosted', withdrew: '', active: '' }
      const outcome = outcomeMap[d.outcome as string]
      if (!outcome) return

      await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          action: 'submit',
          company: (evt.company || '').toLowerCase(),
          role: evt.role || '',
          location: evt.location || '',
          platform: evt.platform || '',
          outcome,
          ghost_stage: (d.ghostStage as string) || null,
          rounds: (d.rounds as number) || 0,
          unpaid_work: 'na',
          wait_days: (d.daysToResponse as number) || null,
          report_text: (d.notes as string) || null,
          source: 'event_loop',
        }),
      })
    } catch {}
  },
}
