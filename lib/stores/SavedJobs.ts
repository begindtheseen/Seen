'use client'

import { _sync } from '../sync'
import type { Job, SavedJob } from '../types'

const KEY = 'seen_saved_v1'

export const SavedJobsStore = {
  loadSync(): SavedJob[] {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
  },

  isSaved(jobId: string | number): boolean {
    return this.loadSync().some(s => String(s.job_id) === String(jobId))
  },

  // The full listing captured at save time — this is what lets a saved listing
  // reopen to the EXACT thing the user saved, regardless of session cache or DB expiry.
  getSnapshot(jobId: string | number): Job | null {
    const rec = this.loadSync().find(s => String(s.job_id) === String(jobId))
    return (rec?.snapshot as Job | undefined) ?? null
  },

  save(job: Job, loggedIn: boolean): { ok: boolean } {
    const sid = String(job.id)
    const saved = this.loadSync()
    if (!saved.find(s => String(s.job_id) === sid)) {
      saved.unshift({
        job_id: sid,
        company: job.company || '',
        role: job.title || '',
        location: job.location,
        score: job.score,
        apply_url: job.apply_url ?? null,
        snapshot: job,
        saved_at: new Date().toISOString(),
      })
      localStorage.setItem(KEY, JSON.stringify(saved))
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
    const sid = String(jobId)
    localStorage.setItem(KEY, JSON.stringify(this.loadSync().filter(s => String(s.job_id) !== sid)))
    if (loggedIn) _sync('unsave_job', { jobId: sid })
  },

  async load(loggedIn: boolean): Promise<SavedJob[]> {
    if (loggedIn) {
      const result = await _sync('load') as { saved_jobs?: SavedJob[] } | null
      if (result?.saved_jobs) {
        // Merge up any guest-era saves before adopting the DB list — overwriting local
        // with DB used to silently discard everything saved before signing in. Safe from
        // cross-user bleed: sign-out clears this key, so local content is this device's
        // current guest data. save_job upserts on (user_id, job_id), so re-sends are no-ops.
        const dbIds = new Set(result.saved_jobs.map(s => String(s.job_id)))
        const guestOnly = this.loadSync().filter(s => s.job_id && !dbIds.has(String(s.job_id)))
        for (const s of guestOnly) {
          _sync('save_job', {
            job: {
              id: String(s.job_id), co: s.company, title: s.role, city: s.location,
              score: s.score, apply_url: s.apply_url ?? null, snapshot: s.snapshot ?? null,
            },
          }).catch(() => {})
        }
        const merged = [...result.saved_jobs, ...guestOnly]
        localStorage.setItem(KEY, JSON.stringify(merged))
        return merged
      }
    }
    return this.loadSync()
  },

  async syncFromDb(loggedIn: boolean): Promise<void> {
    await this.load(loggedIn)
  },
}
