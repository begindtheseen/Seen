'use client'

import { _sync } from '../sync'
import type { SavedJob } from '../types'

const KEY = 'seen_saved_v1'

export const SavedJobsStore = {
  loadSync(): SavedJob[] {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
  },

  isSaved(jobId: string | number): boolean {
    return this.loadSync().some(s => String(s.job_id) === String(jobId))
  },

  save(job: { id: string | number; co?: string; title?: string; city?: string; score?: number }, loggedIn: boolean): { ok: boolean } {
    const sid = String(job.id)
    const saved = this.loadSync()
    if (!saved.find(s => String(s.job_id) === sid)) {
      saved.unshift({
        job_id: sid,
        company: job.co || '',
        role: job.title || '',
        location: job.city,
        score: job.score,
        saved_at: new Date().toISOString(),
      })
      localStorage.setItem(KEY, JSON.stringify(saved))
    }
    if (loggedIn) _sync('save_job', { job })
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
        localStorage.setItem(KEY, JSON.stringify(result.saved_jobs))
        return result.saved_jobs
      }
    }
    return this.loadSync()
  },

  async syncFromDb(loggedIn: boolean): Promise<void> {
    await this.load(loggedIn)
  },
}
