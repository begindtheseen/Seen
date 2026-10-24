'use client'

import { _sync, _syncRaw } from '../sync'
import { markQuiet } from '../quietWindow'
import { STAGES } from '../constants'
import type { Application, HiringEvent, AppStatus } from '../types'
import { eventId, isSuperseded, stageCorrectedEvent } from './checkEvents'

const KEY = 'seen_applications_v1'

/** What "Edit" on a card may change — the only non-stage/status fields update_application accepts. */
export const EDITABLE_KEYS = ['company', 'role', 'location', 'platform', 'appliedAt'] as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** An account row's id. A client "app_<ms>" id means the add has not reached the account yet. */
export const isDbId = (id: string): boolean => UUID.test(String(id || ''))

export type SyncState = 'synced' | 'saving' | 'unsynced'
export type UpdateStatus = 'ok' | 'local' | 'stale' | 'gone' | 'failed'
export interface UpdateResult {
  /** ok = on the account · local = kept on this device (signed out, or an add still pending) · stale = another
   *  write got there first (server row returned, local copy replaced) · gone = deleted elsewhere · failed = not saved. */
  status: UpdateStatus
  /** Anti-gaming flags on what was just recorded (e.g. impossible_timeline) — the card shows a hint. */
  anomalies: string[]
  server?: Application
}
export interface UpdateOptions {
  /** Extra events appended as they are (check-in answers, snoozes — lib/stores/checkEvents). */
  markers?: HiringEvent[]
  /** Record this hiring event when no live copy exists ("Got a response" → response_received). */
  ensureEvent?: string
}

// The stage a hiring event implies — a backwards stage move supersedes the events above the new stage.
const STAGE_EVENT: Record<string, string | null> = {
  'Applied': null, 'Viewed': null, 'Phone Screen': 'response_received', 'Interview': 'interview_received',
  'Final Round': 'interview_received', 'Offer': 'offer_received', 'Rejected': 'rejected', 'Ghosted': 'ghosted', 'Withdrew': 'withdrawn',
}
const EVENT_LEVEL: Record<string, number> = { response_received: 2, interview_received: 3, offer_received: 5 }
const STATUS_EVENT: Record<string, string> = { hired: 'offer_received', rejected: 'rejected', ghosted: 'ghosted' }
const stageLevel = (s: string) => STAGES.indexOf(s as typeof STAGES[number])

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
    // The account row's updated_at — the compare-and-set token the next update sends back.
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

/** Everything a pending (never-confirmed) change may have touched: stage, status and the Edit fields. */
const pendingChanges = (a: Application): Partial<Application> => ({
  stage: a.stage, status: a.status, company: a.company, role: a.role, location: a.location, platform: a.platform, appliedAt: a.appliedAt,
})

const save = (apps: Application[]) => { try { localStorage.setItem(KEY, JSON.stringify(apps)) } catch { /* storage unavailable */ } }
const tokenOf = (body: unknown): number | null => {
  const t = (body as { updated_at?: unknown } | null)?.updated_at
  const ms = typeof t === 'string' ? Date.parse(t) : NaN
  return Number.isFinite(ms) ? ms : null
}

// One write at a time per application: the second of two quick stage taps waits for the first, so it
// sends the token the first one just received instead of a stale one (and the writes land in order).
const queues = new Map<string, Promise<unknown>>()

export const AppStore = {
  /** What the last load() could not reconcile: ids whose pending change lost to another device, and ids still unsynced. */
  lastLoad: { conflicts: [] as string[], failed: [] as string[] },

  loadSync(): Application[] {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
  },

  async load(loggedIn: boolean): Promise<Application[]> {
    if (loggedIn) {
      const result = await _sync('load') as { applications?: Record<string, unknown>[] } | null
      if (result?.applications) {
        const mapped = result.applications.map(mapRow)
        const dbIds = new Set(mapped.map(a => String(a.id)))
        const local = this.loadSync()
        // A local app is unsynced only if it still carries a client 'app_' id AND isn't
        // already in the DB under the same job / company+role (belt-and-braces: id swap
        // can be lost if the tab closed mid-add).
        const dbKeys = new Set(mapped.map(a => `${(a.company || '').toLowerCase()}|${(a.role || '').toLowerCase()}`))
        const dbJobIds = new Set(mapped.map(a => a.jobId).filter(Boolean))
        const unsynced = local.filter(a =>
          !isDbId(a.id) && !dbIds.has(a.id) &&
          !(a.jobId && dbJobIds.has(a.jobId)) &&
          !dbKeys.has(`${(a.company || '').toLowerCase()}|${(a.role || '').toLowerCase()}`)
        )
        const conflicts: string[] = [], failed: string[] = []
        // CRITICAL: capture the returned DB id and swap it onto the local record — the old
        // fire-and-forget version never did, so the same app was "unsynced" on every load
        // and re-inserted forever (39 duplicate DB rows per app were found in prod). The server
        // is idempotent on the client id, so a retry can never make a second row.
        for (const a of unsynced) {
          const r = await _syncRaw('add_application', { application: a })
          const id = (r.body as { id?: string } | null)?.id
          if (r.ok && id) { a.id = id; a.updatedAt = tokenOf(r.body) ?? a.updatedAt; a.unsynced = false }
          else failed.push(a.id)
        }
        // Changes made on this device that never reached the account (a 504, offline): sent now with
        // the token they were made against. If another device wrote since, the account wins (409).
        const byId = new Map(mapped.map(a => [a.id, a]))
        for (const a of local.filter(x => x.unsynced && isDbId(x.id) && dbIds.has(x.id))) {
          const r = await _syncRaw('update_application', { id: a.id, updatedAt: a.updatedAt, changes: { ...pendingChanges(a), events: a.events } })
          const row = byId.get(a.id)!
            if (r.ok && (r.body as { ok?: boolean } | null)?.ok) {
            Object.assign(row, { ...pendingChanges(a), events: a.events, updatedAt: tokenOf(r.body) ?? row.updatedAt })
          } else if (r.status === 409 || r.status === 410) {
            conflicts.push(a.id) // the account's version stands
          } else {
            Object.assign(row, { ...pendingChanges(a), events: a.events, unsynced: true }) // still pending
            failed.push(a.id)
          }
        }
        this.lastLoad = { conflicts, failed }
        const merged = [...mapped, ...unsynced]
        save(merged)
        return merged
      }
    }
    return this.loadSync()
  },

  async syncFromDb(loggedIn: boolean): Promise<void> {
    await this.load(loggedIn)
  },

  /** Where this card stands with the account. `saving` is the page's in-flight state, not stored. */
  syncState(app: Pick<Application, 'id' | 'unsynced'>, loggedIn: boolean): SyncState {
    if (!loggedIn) return 'synced' // device-only mode: nothing to sync
    return app.unsynced || !isDbId(app.id) ? 'unsynced' : 'synced'
  },

  addEvent(appId: string, event: Partial<HiringEvent>): HiringEvent | undefined {
    const apps = this.loadSync()
    const idx = apps.findIndex(a => a.id === appId)
    if (idx === -1) return undefined
    const evt: HiringEvent = {
      ...event,
      id: event.id || eventId(),
      type: event.type || 'application_submitted',
      date: event.date || Date.now(),
      source: event.source || 'user',
      confidence: event.confidence ?? 'low',
    }
    apps[idx].events = [...(apps[idx].events || []), evt]
    apps[idx].updatedAt = Date.now()
    save(apps)
    return evt
  },

  /**
   * Adds locally at once (the card appears), then sends it. `synced:false` = kept on this device with its
   * client id; the next load() (or Retry) sends it again — the server is idempotent on that id.
   */
  async add(app: Partial<Application>, loggedIn: boolean): Promise<{ ok: boolean; synced: boolean; id: string }> {
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
      save(apps)
    }
    let id = entry.id
    let synced = !loggedIn
    if (loggedIn && !isDbId(entry.id)) {
      const r = await _syncRaw('add_application', { application: entry })
      const newId = (r.body as { id?: string } | null)?.id
      if (r.ok && newId) {
        synced = true
        id = newId
        const stored = this.loadSync()
        const idx = stored.findIndex(a => a.id === entry.id)
        if (idx !== -1) {
          stored[idx] = { ...stored[idx], id: newId, updatedAt: tokenOf(r.body) ?? stored[idx].updatedAt, unsynced: false }
          save(stored)
        }
      }
    }
    return { ok: true, synced, id }
  },

  /**
   * Stage / status moves, the card's Edit (company, role, location, platform, appliedAt — EDITABLE_KEYS)
   * and check-in markers (opts). An edit is a correction of the user's own record: it files no event
   * and no community report (handleUpdate in the tracker only reports on a terminal `status`).
   * Writes are queued per application and sent with the last-seen updated_at (compare-and-set).
   */
  update(id: string, changes: Partial<Application>, loggedIn: boolean, opts: UpdateOptions = {}): Promise<UpdateResult> {
    const prev = queues.get(id) || Promise.resolve()
    const next = prev.catch(() => undefined).then(() => this._update(id, changes, loggedIn, opts))
    queues.set(id, next)
    next.catch(() => undefined).then(() => { if (queues.get(id) === next) queues.delete(id) })
    return next
  },

  async _update(id: string, changes: Partial<Application>, loggedIn: boolean, opts: UpdateOptions): Promise<UpdateResult> {
    const apps = this.loadSync()
    const idx = apps.findIndex(a => a.id === id)
    if (idx === -1) return { status: 'gone', anomalies: [] }
    const prev = apps[idx]
    const updated: Application = { ...prev, ...changes }
    let events = [...(updated.events || [])]
    const now = Date.now()
    const anomalies: string[] = []
    const live = (type: string) => events.find(e => e.type === type && !isSuperseded(e))

    const record = (type: string) => {
      if (live(type)) return
      const daysFromApply = (now - (updated.appliedAt || now)) / 86400000
      const isImpossible = ['offer_received', 'rejected'].includes(type) && daysFromApply < 2
      if (isImpossible) anomalies.push('impossible_timeline')
      events.push({
        id: eventId(),
        type,
        date: now,
        source: 'user',
        confidence: isImpossible ? 0 : 'low',
        trust_weight: isImpossible ? 0 : 1,
        anomaly_flags: isImpossible ? ['impossible_timeline'] : [],
      })
    }

    let type: string | null = null
    if (changes.stage && changes.stage !== prev.stage) {
      const from = stageLevel(prev.stage), to = stageLevel(changes.stage)
      if (to >= 0 && from > to) {
        // Backwards: the events that imply a later stage are superseded (kept, weight 0), and the
        // correction itself is recorded — never a silent rewrite of history (audit 3 L5).
        const superseded: string[] = []
        events = events.map(e => {
          if ((EVENT_LEVEL[e.type] ?? -1) > to && !isSuperseded(e)) {
            superseded.push(e.id)
            return { ...e, trust_weight: 0, anomaly_flags: [...(e.anomaly_flags || []), 'superseded'] }
          }
          return e
        })
        events.push(stageCorrectedEvent(prev.stage, changes.stage, superseded, now))
      }
      type = STAGE_EVENT[changes.stage] || null
    }
    if (!type && changes.status && changes.status !== prev.status) type = STATUS_EVENT[changes.status] || null
    if (type) record(type)
    if (opts.ensureEvent) record(opts.ensureEvent)
    if (opts.markers?.length) events.push(...opts.markers)

    updated.events = events
    // A synced record keeps the account's updated_at as its token; a device-only one just moves on.
    if (!isDbId(id)) updated.updatedAt = now
    apps[idx] = updated
    save(apps)
    // An outcome ("Got the job" / Ghosted / Rejected / withdrawn) is a weighty moment: nothing optional
    // (the micro-survey) pops for the next two minutes.
    if (changes.status && changes.status !== 'active') markQuiet()
    if (!loggedIn) return { status: 'local', anomalies }
    // Still only on this device: the pending add carries the whole record when it is retried.
    if (!isDbId(id)) return { status: 'local', anomalies }

    // Only what changed (an Edit sends no stage/status) plus the event history the change produced.
    const r = await _syncRaw('update_application', { id, updatedAt: prev.updatedAt, changes: { ...changes, events } })
    const body = r.body as { ok?: boolean; updated_at?: string; anomalies?: string[]; application?: Record<string, unknown> } | null
    const current = this.loadSync()
    const at = current.findIndex(a => a.id === id)
    if (r.ok && body?.ok) {
      if (at !== -1) { current[at] = { ...current[at], updatedAt: tokenOf(body) ?? current[at].updatedAt, unsynced: false }; save(current) }
      for (const f of body.anomalies || []) if (!anomalies.includes(f)) anomalies.push(f)
      return { status: 'ok', anomalies }
    }
    if (r.status === 409 && body?.application) {
      // Another write got there first: the account's row replaces this device's copy.
      const server = mapRow(body.application)
      if (at !== -1) { current[at] = server; save(current) }
      return { status: 'stale', anomalies, server }
    }
    if (r.status === 410) {
      if (at !== -1) { current.splice(at, 1); save(current) }
      return { status: 'gone', anomalies }
    }
    // Offline / 5xx / refused: the change stays on this device, flagged, and is retried on the next load.
    if (at !== -1) { current[at] = { ...current[at], unsynced: true }; save(current) }
    return { status: 'failed', anomalies }
  },

  /** "Retry" on a card: send what this device has (a pending add, or a pending change). */
  async retry(id: string, loggedIn: boolean): Promise<UpdateResult> {
    const a = this.loadSync().find(x => x.id === id)
    if (!a) return { status: 'gone', anomalies: [] }
    if (!loggedIn) return { status: 'local', anomalies: [] }
    if (!isDbId(a.id)) {
      const r = await _syncRaw('add_application', { application: a })
      const newId = (r.body as { id?: string } | null)?.id
      if (!(r.ok && newId)) return { status: 'failed', anomalies: [] }
      const stored = this.loadSync()
      const idx = stored.findIndex(x => x.id === a.id)
      if (idx !== -1) { stored[idx] = { ...stored[idx], id: newId, updatedAt: tokenOf(r.body) ?? stored[idx].updatedAt, unsynced: false }; save(stored) }
      return { status: 'ok', anomalies: [] }
    }
    return this.update(id, pendingChanges(a), true)
  },

  async remove(id: string, loggedIn: boolean): Promise<void> {
    markQuiet() // a delete is a weighty moment — see update()
    save(this.loadSync().filter(a => a.id !== id))
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
