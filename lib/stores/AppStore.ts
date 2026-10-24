'use client'

import { _sync, isNotFound } from '../sync'
import { markQuiet } from '../quietWindow'
import type { Application, HiringEvent, AppStatus } from '../types'

const KEY = 'seen_applications_v1'

/** Everything one `load` answers with. The dashboard reads its pro flag, recent companies and the Inbox
 *  Autopilot tile from the SAME call that brings the applications — one request at mount, not four. */
export type LoadBundle = {
  applications: Application[]
  credits: { balance: number; pro: boolean; daily_earned: number } | null
  recent_cos: Array<{ company_name?: string }>
  inbox: { ready: boolean; enabled?: boolean; received_count?: number } | null
  apps_total?: number
}
type RawLoad = { applications?: Record<string, unknown>[]; credits?: LoadBundle['credits']; recent_cos?: LoadBundle['recent_cos']; inbox?: LoadBundle['inbox']; apps_total?: number }

/** What update()/remove() report back. `not_found` = the server has no such row for this account
 *  (deleted on another device, or never this user's) — the local copy is dropped, nothing to retry. */
export type StoreResult = { ok: boolean; reason?: 'not_found' | 'not_synced' | 'patch_failed' | 'delete_failed' | 'offline' }

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

export const AppStore = {
  loadSync(): Application[] {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
  },

  async load(loggedIn: boolean): Promise<Application[]> {
    const bundle = await this.loadBundle(loggedIn)
    return bundle ? bundle.applications : this.loadSync()
  },

  /** `load` with everything it carries (see LoadBundle). null when signed out or the call failed —
   *  the caller falls back to loadSync() for the applications. */
  async loadBundle(loggedIn: boolean): Promise<LoadBundle | null> {
    if (loggedIn) {
      const result = await _sync('load') as RawLoad | null
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
        return {
          applications: merged,
          credits: result.credits ?? null,
          recent_cos: Array.isArray(result.recent_cos) ? result.recent_cos : [],
          inbox: result.inbox && typeof result.inbox.ready === 'boolean' ? result.inbox : null,
          apps_total: result.apps_total,
        }
      }
    }
    return null
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
  async update(id: string, changes: Partial<Application>, loggedIn: boolean): Promise<StoreResult> {
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
    if (!loggedIn) return { ok: true }
    const r = await _sync('update_application', { id, changes: syncChanges }) as StoreResult | null
    if (isNotFound(r)) {
      // Removed on another device (or never this account's): the local copy is stale — drop it so the
      // reload that follows shows the truth. Not an error for the person; nothing to retry.
      localStorage.setItem(KEY, JSON.stringify(this.loadSync().filter(a => a.id !== id)))
      return { ok: false, reason: 'not_found' }
    }
    return r ?? { ok: false, reason: 'offline' }
  },

  async remove(id: string, loggedIn: boolean): Promise<StoreResult> {
    markQuiet() // a delete is a weighty moment — see update()
    localStorage.setItem(KEY, JSON.stringify(this.loadSync().filter(a => a.id !== id)))
    if (!loggedIn) return { ok: true }
    const r = await _sync('remove_application', { id }) as StoreResult | null
    // 404 = already gone on the server: the local copy is gone too, which is the state the person wanted.
    if (isNotFound(r)) return { ok: true, reason: 'not_found' }
    return r ?? { ok: false, reason: 'offline' }
  },

  async clear(loggedIn = false): Promise<void> {
    markQuiet()
    localStorage.removeItem(KEY)
    // "Clear all" must clear the account too — otherwise the DB rows resurrect
    // everything on the next load/device.
    if (loggedIn) await _sync('clear_applications').catch(() => {})
  },
}
