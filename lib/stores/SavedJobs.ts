'use client'

import { _sync } from '../sync'
import type { Job, SavedJob } from '../types'

const KEY = 'seen_saved_v1'
// Jobs saved on this device BEFORE signing in, set aside at sign-in. Device-local data never imports into
// an account by itself (CLAUDE.md "Sign-out data isolation" — the old merge in load() uploaded whatever the
// device held). The person is asked once (components/GuestSavesPrompt.tsx): Keep sends them through the
// same save_job path a tap on the heart uses; Discard / no answer leaves them here, and sign-out clears
// this key with the rest (lib/sessionLocalKeys.js).
const GUEST_KEY = 'seen_saved_guest_v1'
/** Fired when the saved list changed outside the page that shows it (a Keep), so /saved re-reads. */
export const SAVED_CHANGED_EVENT = 'seen:saved-changed'

/** A row in the device list. `guest` marks one saved while signed out. */
type Stored = SavedJob & { guest?: boolean }

const read = (key: string): Stored[] => { try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] } }
const write = (key: string, rows: Stored[]) => { try { localStorage.setItem(key, JSON.stringify(rows)) } catch { /* private mode / full */ } }
const sameId = (a: string | number, b: string | number) => String(a) === String(b)
const syncJob = (s: Stored) => _sync('save_job', {
  job: {
    id: String(s.job_id), co: s.company, title: s.role, city: s.location,
    score: s.score, apply_url: s.apply_url ?? null, snapshot: s.snapshot ?? null,
  },
})

export const SavedJobsStore = {
  loadSync(): SavedJob[] {
    return read(KEY)
  },

  isSaved(jobId: string | number): boolean {
    return this.loadSync().some(s => sameId(s.job_id, jobId))
  },

  // The full listing captured at save time — this is what lets a saved listing
  // reopen to the EXACT thing the user saved, regardless of session cache or DB expiry.
  getSnapshot(jobId: string | number): Job | null {
    const rec = this.loadSync().find(s => sameId(s.job_id, jobId))
    return (rec?.snapshot as Job | undefined) ?? null
  },

  save(job: Job, loggedIn: boolean): { ok: boolean } {
    const sid = String(job.id)
    const saved = read(KEY)
    if (!saved.find(s => sameId(s.job_id, sid))) {
      saved.unshift({
        job_id: sid,
        company: job.company || '',
        role: job.title || '',
        location: job.location,
        score: job.score,
        apply_url: job.apply_url ?? null,
        snapshot: job,
        saved_at: new Date().toISOString(),
        // Saved while signed out: this row belongs to the device, not to whoever signs in next.
        ...(loggedIn ? {} : { guest: true }),
      })
      write(KEY, saved)
    }
    if (loggedIn) {
      _sync('save_job', {
        job: {
          id: sid,
          co: job.company,
          title: job.title,
          city: job.location,
          score: job.score,
          apply_url: job.apply_url ?? null,
          snapshot: job,
        },
      })
    }
    return { ok: true }
  },

  async remove(jobId: string | number, loggedIn: boolean): Promise<void> {
    write(KEY, read(KEY).filter(s => !sameId(s.job_id, jobId)))
    // A guest save removed after sign-in (from the prompt's point of view) is gone from the offer too.
    const guest = read(GUEST_KEY)
    if (guest.some(s => sameId(s.job_id, jobId))) write(GUEST_KEY, guest.filter(s => !sameId(s.job_id, jobId)))
    if (loggedIn) _sync('unsave_job', { jobId: String(jobId) })
  },

  /** The account's list replaces the device copy. Rows saved while signed out are set aside (never uploaded,
   *  never shown as the account's) until the person answers Keep / Discard. */
  async load(loggedIn: boolean): Promise<SavedJob[]> {
    if (loggedIn) {
      const result = await _sync('load') as { saved_jobs?: SavedJob[] } | null
      if (result?.saved_jobs) {
        this.stashGuestSaves()
        write(KEY, result.saved_jobs as Stored[])
        return result.saved_jobs
      }
    }
    return this.loadSync()
  },

  async syncFromDb(loggedIn: boolean): Promise<void> {
    await this.load(loggedIn)
  },

  /** Moves rows saved while signed out from the list into the guest holding key. Returns how many it moved
   *  this time (0 = nothing new, so nothing to ask). Idempotent: a second call moves nothing. */
  stashGuestSaves(): number {
    const all = read(KEY)
    const mine = all.filter(s => s.guest)
    if (!mine.length) return 0
    const held = read(GUEST_KEY)
    const merged = [...mine.filter(m => !held.some(h => sameId(h.job_id, m.job_id))), ...held]
    write(GUEST_KEY, merged)
    write(KEY, all.filter(s => !s.guest))
    return mine.length
  },

  /** The rows waiting on Keep / Discard. */
  guestSaves(): SavedJob[] {
    return read(GUEST_KEY)
  },

  /** Keep: each held row goes to the account through the save_job path (the same one the heart uses),
   *  then joins the device list as the account's. A row the server refused stays held (and is swept at
   *  sign-out like the rest). */
  async adoptGuestSaves(): Promise<{ kept: number; failed: number }> {
    const held = read(GUEST_KEY)
    let kept = 0
    const left: Stored[] = []
    for (const s of held) {
      const r = await syncJob(s).catch(() => null)
      if (r == null) { left.push(s); continue }
      kept++
      const list = read(KEY)
      if (!list.some(x => sameId(x.job_id, s.job_id))) { const { guest: _g, ...row } = s; void _g; write(KEY, [row, ...list]) }
    }
    write(GUEST_KEY, left)
    try { window.dispatchEvent(new Event(SAVED_CHANGED_EVENT)) } catch { /* no window */ }
    return { kept, failed: left.length }
  },
}
