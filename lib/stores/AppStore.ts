'use client'

import { _sync } from '../sync'
import { markQuiet } from '../quietWindow'
import type { Application, HiringEvent, AppStatus } from '../types'

const KEY = 'seen_applications_v1'

/** What "Edit" on a card may change — the only non-stage/status fields update_application accepts. */
export const EDITABLE_KEYS = ['company', 'role', 'location', 'platform', 'appliedAt'] as const

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
    messages: Array.isArray(a.messages) ? (a.messages as Application['messages']) : undefined,
    seenApply: a.seen_apply === true || undefined,
    listingEditedAt: typeof a.listing_edited_at === 'string' ? a.listing_edited_at : undefined,
    // applied_at is the user's real apply date; created_at is only the row-insert time.
    appliedAt: (a.applied_at || a.created_at) ? new Date((a.applied_at || a.created_at) as string).getTime() : Date.now(),
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

/** What a load produced and whether it came from the account (or only from this device's store). */
export type LoadResult = {
  apps: Application[]
  /** True when the account's rows were read. False = the sync failed (or there was no session) and
   *  `apps` is only what this device last stored — a page must show that as an error, never as "0". */
  synced: boolean
}

export const AppStore = {
  loadSync(): Application[] {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
  },

  /** `load` plus the truth about where the data came from (see LoadResult). */
  async loadResult(loggedIn: boolean): Promise<LoadResult> {
    if (!loggedIn) return { apps: this.loadSync(), synced: true }
    const result = await _sync('load') as { applications?: Record<string, unknown>[] } | null
    if (!result?.applications) return { apps: this.loadSync(), synced: false }
    return { apps: await this.load(loggedIn, result), synced: true }
  },

  async load(loggedIn: boolean, prefetched?: { applications?: Record<string, unknown>[] } | null): Promise<Application[]> {
    if (loggedIn) {
      const result = prefetched ?? await _sync('load') as { applications?: Record<string, unknown>[] } | null
      if (result?.applications) {
        const mapped = result.applications.map(mapRow)
        const dbIds = new Set(mapped.map(a => String(a.id)))
        // A local app is unsynced only if it still carries a client 'app_' id AND isn't
        // already in the DB under the same job / company+role (belt-and-braces: id swap
        // can be lost if the tab closed mid-add).
        const dbKeys = new Set(mapped.map(a => `${(a.company || '').toLowerCase()}|${(a.role || '').toLowerCase()}`))
        const dbJobIds = new Set(mapped.map(a => a.jobId).filter(Boolean))
        const unsynced = this.loadSync().filter(a =>
          a.id.startsWith('app_') && !dbIds.has(a.id) &&
          !(a.jobId && dbJobIds.has(a.jobId)) &&
          !dbKeys.has(`${(a.company || '').toLowerCase()}|${(a.role || '').toLowerCase()}`)
        )
        // CRITICAL: capture the returned DB id and swap it onto the local record — the old
        // fire-and-forget version never did, so the same app was "unsynced" on every load
        // and re-inserted forever (39 duplicate DB rows per app were found in prod).
        for (const a of unsynced) {
          try {
            const r = await _sync('add_application', { application: a }) as { id?: string } | null
            if (r?.id) a.id = r.id
          } catch { /* keep local id; retried next load */ }
        }
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

  /**
   * Stage / status moves AND the card's Edit (company, role, location, platform, appliedAt —
   * EDITABLE_KEYS). An edit is a correction of the user's own record: it files no event and no
   * community report (handleUpdate in the tracker only reports on a terminal `status`).
   */
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
    // An outcome ("Got the job" / Ghosted / Rejected / withdrawn) is a weighty moment: nothing optional
    // (the micro-survey) pops for the next two minutes.
    if (changes.status && changes.status !== 'active') markQuiet()
    const syncChanges = { ...changes }
    const updatedApp = apps.find(a => a.id === id)
    if (updatedApp?.events) syncChanges.events = updatedApp.events
    // Awaited: the tracker reloads right after, and an un-awaited PATCH let the reload's SELECT win
    // the race and visibly revert a "Ghosted"/"Rejected" click.
    if (loggedIn) await _sync('update_application', { id, changes: syncChanges })
  },

  async remove(id: string, loggedIn: boolean): Promise<void> {
    markQuiet() // a delete is a weighty moment — see update()
    localStorage.setItem(KEY, JSON.stringify(this.loadSync().filter(a => a.id !== id)))
    if (loggedIn) await _sync('remove_application', { id })
  },

  async clear(loggedIn = false): Promise<void> {
    markQuiet()
    localStorage.removeItem(KEY)
    // "Clear all" must clear the account too — otherwise the DB rows resurrect
    // everything on the next load/device.
    if (loggedIn) await _sync('clear_applications').catch(() => {})
  },
}
