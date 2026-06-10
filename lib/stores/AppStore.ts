'use client'

import { _sync } from '../sync'
import { supabase } from '../supabase'
import type { Application, HiringEvent, AppStatus } from '../types'

const KEY = 'seen_applications_v1'

function isLoggedIn(): boolean {
  // Checked at call time — sync check via cached session is not available client-side
  // Callers that need async auth check should use supabase.auth.getSession()
  return false // will be overridden by AuthContext usage
}

function mapRow(a: Record<string, unknown>): Application {
  return {
    id: String(a.id),
    jobId: a.job_id as string | undefined,
    company: a.company_name as string,
    role: a.role as string,
    location: a.city as string | undefined,
    platform: a.platform as string | undefined,
    jobUrl: a.job_url as string | undefined,
    stage: (a.stage as string) || 'Applied',
    status: ((a.status as string) || 'active') as AppStatus,
    score: a.score as number | undefined,
    waste: a.waste_score as number | undefined,
    employerStage: a.employer_stage as string | undefined,
    appliedAt: a.created_at ? new Date(a.created_at as string).getTime() : Date.now(),
    updatedAt: a.updated_at ? new Date(a.updated_at as string).getTime() : Date.now(),
    events: (a.events as HiringEvent[]) || [
      {
        id: 'ev_init',
        type: 'application_submitted',
        date: a.created_at ? new Date(a.created_at as string).getTime() : Date.now(),
        source: 'user',
        confidence: 'low',
      },
    ],
  }
}

export const AppStore = {
  loadSync(): Application[] {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
  },

  async load(loggedIn: boolean): Promise<Application[]> {
    if (loggedIn) {
      const result = await _sync('load') as { applications?: Record<string, unknown>[] } | null
      if (result?.applications) {
        const mapped = result.applications.map(mapRow)
        const dbIds = new Set(mapped.map(a => String(a.id)))
        const unsynced = this.loadSync().filter(a => a.id.startsWith('app_') && !dbIds.has(a.id))
        if (unsynced.length) unsynced.forEach(a => _sync('add_application', { application: a }))
        const merged = [...mapped, ...unsynced]
        localStorage.setItem(KEY, JSON.stringify(merged))
        return merged
      }
    }
    return this.loadSync()
  },

  async syncFromDb(loggedIn: boolean): Promise<void> {
    await this.load(loggedIn)
  },

  addEvent(appId: string, event: Partial<HiringEvent>): HiringEvent | undefined {
    const apps = this.loadSync()
    const idx = apps.findIndex(a => a.id === appId)
    if (idx === -1) return undefined
    const evt: HiringEvent = {
      ...event,
      id: event.id || ('ev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5)),
      type: event.type || 'application_submitted',
      date: event.date || Date.now(),
      source: event.source || 'user',
      confidence: event.confidence ?? 'low',
    }
    apps[idx].events = [...(apps[idx].events || []), evt]
    apps[idx].updatedAt = Date.now()
    localStorage.setItem(KEY, JSON.stringify(apps))
    return evt
  },

  async add(app: Partial<Application>, loggedIn: boolean): Promise<{ ok: boolean }> {
    const now = Date.now()
    const initialEvent: HiringEvent = {
      id: 'ev_' + now,
      type: 'application_submitted',
      date: (app.appliedAt || now),
      source: 'user',
      confidence: 'low',
    }
    const entry: Application = {
      company: '',
      role: '',
      stage: 'Applied',
      status: 'active',
      appliedAt: now,
      updatedAt: now,
      events: [initialEvent],
      ...app,
      id: app.id || ('app_' + now),
    }
    const apps = this.loadSync()
    const isDupe = apps.find(a =>
      a.id === entry.id ||
      (entry.jobId && a.jobId === entry.jobId) ||
      (!entry.jobId && a.company?.toLowerCase() === entry.company?.toLowerCase() &&
        a.role?.toLowerCase() === entry.role?.toLowerCase() && a.status === 'active')
    )
    if (!isDupe) {
      apps.unshift(entry)
      localStorage.setItem(KEY, JSON.stringify(apps))
    }
    if (loggedIn && entry.id.startsWith('app_')) {
      const result = await _sync('add_application', { application: entry }) as { id?: string } | null
      if (result?.id) {
        const stored = this.loadSync()
        const idx = stored.findIndex(a => a.id === entry.id)
        if (idx !== -1) {
          stored[idx] = { ...stored[idx], id: result.id }
          localStorage.setItem(KEY, JSON.stringify(stored))
        }
      }
    }
    return { ok: true }
  },

  async update(id: string, changes: Partial<Application>, loggedIn: boolean): Promise<void> {
    const apps = this.loadSync()
    const idx = apps.findIndex(a => a.id === id)
    if (idx !== -1) {
      const prev = apps[idx]
      const updated = { ...prev, ...changes, updatedAt: Date.now() }
      const events = [...(updated.events || [])]
      const now = Date.now()

      const stageEventMap: Record<string, string | null> = {
        'Applied':      null,
        'Phone Screen': 'response_received',
        'Interview':    'interview_received',
        'Final Round':  'interview_received',
        'Offer':        'offer_received',
        'Rejected':     'rejected',
        'Ghosted':      'ghosted',
        'Withdrew':     'withdrawn',
      }
      const statusEventMap: Record<string, string> = {
        hired:    'offer_received',
        rejected: 'rejected',
        ghosted:  'ghosted',
      }

      let eventType: string | null = null
      if (changes.stage && changes.stage !== prev.stage) eventType = stageEventMap[changes.stage] || null
      if (!eventType && changes.status && changes.status !== prev.status) eventType = statusEventMap[changes.status] || null

      if (eventType && !events.find(e => e.type === eventType)) {
        const daysFromApply = (now - (updated.appliedAt || now)) / 86400000
        const isImpossible = ['offer_received', 'rejected'].includes(eventType) && daysFromApply < 2
        events.push({
          id: 'ev_' + now + '_' + Math.random().toString(36).slice(2, 5),
          type: eventType,
          date: now,
          source: 'user',
          confidence: isImpossible ? 0 : 'low',
          trust_weight: isImpossible ? 0 : 1,
          anomaly_flags: isImpossible ? ['impossible_timeline'] : [],
        })
      }

      updated.events = events
      apps[idx] = updated
      localStorage.setItem(KEY, JSON.stringify(apps))
    }
    if (loggedIn) _sync('update_application', { id, changes })
  },

  async remove(id: string, loggedIn: boolean): Promise<void> {
    localStorage.setItem(KEY, JSON.stringify(this.loadSync().filter(a => a.id !== id)))
    if (loggedIn) _sync('remove_application', { id })
  },

  async clear(): Promise<void> {
    localStorage.removeItem(KEY)
  },
}
