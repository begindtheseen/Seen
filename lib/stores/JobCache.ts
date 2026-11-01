'use client'

// Next.js equivalent of the old SPA's global `JOBS` array.
// The old job-detail page (openJobListing) looked up the job in-memory by id —
// it never refetched. Search results live in the /jobs page's React state, which
// a separate /jobs/[id] route can't read, so we mirror them into sessionStorage.
// Same lifetime intent as the old in-memory array: lasts for the browsing session,
// cleared when the tab closes.

import type { Job } from '../types'

const KEY = 'seen_job_cache_v1'
const MAX = 300

export const JobCache = {
  // Merges (newest last, capped) rather than replacing: a listing opened from the résumé rail or an
  // earlier search must still be found when Back reopens it (?job=<id>) after a newer search.
  setMany(jobs: Job[]): void {
    try {
      const raw = sessionStorage.getItem(KEY)
      const map: Record<string, Job> = raw ? JSON.parse(raw) as Record<string, Job> : {}
      for (const j of jobs) { const k = String(j.id); delete map[k]; map[k] = j }
      const keys = Object.keys(map)
      for (const k of keys.slice(0, Math.max(0, keys.length - MAX))) delete map[k]
      try { sessionStorage.setItem(KEY, JSON.stringify(map)) }
      catch {
        const fresh: Record<string, Job> = {}
        for (const j of jobs) fresh[String(j.id)] = j
        sessionStorage.setItem(KEY, JSON.stringify(fresh))
      }
    } catch { /* sessionStorage unavailable — detail page falls back gracefully */ }
  },

  get(id: string): Job | null {
    try {
      const raw = sessionStorage.getItem(KEY)
      if (!raw) return null
      const map = JSON.parse(raw) as Record<string, Job>
      return map[String(id)] || null
    } catch {
      return null
    }
  },

  set(job: Job): void {
    try {
      const raw = sessionStorage.getItem(KEY)
      const map = raw ? JSON.parse(raw) as Record<string, Job> : {}
      map[String(job.id)] = job
      sessionStorage.setItem(KEY, JSON.stringify(map))
    } catch {}
  },
}
