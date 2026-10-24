// How the tracker list and the dashboard's "Active pipeline" order applications (audit 3, M11: 21
// newest-first cards put the three due check-ins 6,800 px down; the dashboard showed the 4 newest
// Day-0 cards while the Day-31 card was off-list). Pure; pinned by applicationOrder.test.mjs.
//
// "Needs attention" = a check-in is due on it, then a quiet active card (open ≥ 30 California days
// with no check due — the dashboard's reference window), then the other open cards oldest first
// (they have waited longest), then finished cards newest first.

import type { Application } from '../types.ts'
import { daysSince } from './checkSchedule.ts'

export type SortMode = 'attention' | 'newest' | 'oldest'
export const SORT_MODES: ReadonlyArray<{ value: SortMode; label: string }> = [
  { value: 'attention', label: 'Needs attention first' },
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
]

/** Quiet = open this long with nothing heard — the fallback window when a company has no wait data. */
export const QUIET_DAYS = 30

/** Lower = needs attention sooner. 0 due check · 1 quiet · 2 open · 3 finished. */
export function attentionRank(app: Pick<Application, 'status' | 'appliedAt'>, dueIds: ReadonlySet<string>, id: string, now = Date.now()): number {
  if (dueIds.has(id)) return 0
  if (app.status !== 'active') return 3
  return daysSince(app.appliedAt, now) >= QUIET_DAYS ? 1 : 2
}

export function sortApplications<T extends Pick<Application, 'id' | 'status' | 'appliedAt' | 'updatedAt'>>(apps: readonly T[], mode: SortMode, dueIds: ReadonlySet<string>, now = Date.now()): T[] {
  const list = [...apps]
  if (mode === 'newest') return list.sort((a, b) => (b.appliedAt - a.appliedAt) || (b.updatedAt - a.updatedAt))
  if (mode === 'oldest') return list.sort((a, b) => (a.appliedAt - b.appliedAt) || (a.updatedAt - b.updatedAt))
  return list.sort((a, b) => {
    const ra = attentionRank(a, dueIds, a.id, now), rb = attentionRank(b, dueIds, b.id, now)
    if (ra !== rb) return ra - rb
    // Within "needs attention" and "open": the one that has waited longest first; finished: newest first.
    return ra <= 2 ? (a.appliedAt - b.appliedAt) : (b.appliedAt - a.appliedAt)
  })
}

/** Case-insensitive text filter over company, role, location, platform and stage. */
export function filterApplications<T extends Pick<Application, 'company' | 'role' | 'location' | 'platform' | 'stage' | 'status'>>(apps: readonly T[], text: string): T[] {
  const q = text.trim().toLowerCase()
  if (!q) return [...apps]
  return apps.filter(a => [a.company, a.role, a.location, a.platform, a.stage, a.status].some(v => String(v || '').toLowerCase().includes(q)))
}

export const PAGE_SIZE = 10
