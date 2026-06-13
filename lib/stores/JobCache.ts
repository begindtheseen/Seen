'use client'

// Next.js equivalent of the old SPA's global `JOBS` array.
// The old job-detail page (openJobListing) looked up the job in-memory by id —
// it never refetched. Search results live in the /jobs page's React state, which
// a separate /jobs/[id] route can't read, so we mirror them into sessionStorage.
// Same lifetime intent as the old in-memory array: lasts for the browsing session,
// cleared when the tab closes.

import type { Job } from '../types'

const KEY = 'seen_job_cache_v1'

export const JobCache = {
  setMany(jobs: Job[]): void {
    try {
      const map: Record<string, Job> = {}
      for (const j of jobs) map[String(j.id)] = j
      sessionStorage.setItem(KEY, JSON.stringify(map))
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
}
