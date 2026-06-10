'use client'

import { CHECK_SCHEDULE } from '../constants'
import type { DueCheck } from '../types'

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
      id: evt.id || ('hev_' + now + '_' + Math.random().toString(36).slice(2, 6)),
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
      localStorage.setItem(KEY, JSON.stringify(all))
    }
    if (e.type === 'outcome_check' && (e.data?.outcome as string) && e.data?.outcome !== 'active') {
      this._submitAsReport(e)
    }
    return e
  },

  forApp(appId: string): StoredEvent[] {
    return this.get().filter(e => e.appId === appId)
  },

  forCompany(company: string): StoredEvent[] {
    const k = (company || '').toLowerCase()
    return this.get().filter(e => (e.company || '').toLowerCase() === k)
  },

  hasCheck(appId: string, checkType: string): boolean {
    return this.get().some(e => e.appId === appId && e.type === checkType)
  },

  dueChecks(apps: import('../types').Application[]): DueCheck[] {
    const due: DueCheck[] = []
    const snoozed = this._getSnoozed()

    for (const app of apps.filter(a => a.status === 'active' || a.status === 'ghosted')) {
      const days = Math.floor((Date.now() - app.appliedAt) / 86400000)
      for (const chk of CHECK_SCHEDULE) {
        if (days < chk.day) continue
        if (this.hasCheck(app.id, chk.type)) continue
        const snoozeKey = app.id + ':' + chk.type
        if (snoozed[snoozeKey] && Date.now() < snoozed[snoozeKey]) continue
        due.push({
          app,
          checkType: chk.type,
          day: chk.day,
          daysElapsed: days,
          label: chk.label,
          q: chk.q,
          overdue: days - chk.day,
        })
      }
    }
    return due.sort((a, b) => b.overdue - a.overdue)
  },

  snooze(appId: string, checkType: string, hours = 24): void {
    const s = this._getSnoozed()
    s[appId + ':' + checkType] = Date.now() + hours * 3600000
    try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(s)) } catch {}
  },

  _getSnoozed(): Record<string, number> {
    try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) || '{}') } catch { return {} }
  },

  toReports(company: string): Array<{ outcome: string; rounds: number; wait_days: number; unpaid_work: string; _source: string }> {
    const all = this.forCompany(company)
    const outcomes = all.filter(e => e.type === 'outcome_check' && e.data)
    const roundsMap: Record<string, Record<string, unknown>> = {}
    all.filter(e => e.type === 'rounds_detail').forEach(e => { if (e.appId) roundsMap[e.appId] = (e.data || {}) as Record<string, unknown> })
    const outcomeMap: Record<string, string> = { offer: 'hired', rejected: 'human', ghosted: 'ghosted', withdrew: 'human' }
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
      const outcomeMap: Record<string, string> = { offer: 'hired', rejected: 'human', ghosted: 'ghosted', withdrew: 'human', active: '' }
      const outcome = outcomeMap[d.outcome as string]
      if (!outcome) return

      await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
