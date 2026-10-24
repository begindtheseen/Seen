// Duplicate OPEN applications in the tracker (the "Clear dupes" button, app/tracker). Pure, so the
// button can be shown only when there is something to clear and the rule is pinned by a test.
//
// A duplicate = another ACTIVE application at the same company for the same role (case- and
// whitespace-insensitive). A finished application at the same company (rejected last spring,
// applied again now) is history, not a duplicate. The OLDEST copy is kept — it carries the original
// applied date and event history; the newer copies are the accidental re-adds (audit 3 L3; keeping
// the newest threw the original's date and events away).

import type { Application } from '../types.ts'

const key = (a: Pick<Application, 'company' | 'role'>) => `${(a.company || '').toLowerCase().trim()}|${(a.role || '').toLowerCase().trim()}`

export function splitOpenDuplicates<T extends Pick<Application, 'company' | 'role' | 'status' | 'appliedAt'>>(apps: readonly T[]): { kept: T[]; removed: T[] } {
  const seen = new Set<string>()
  const removed: T[] = []
  const kept = [...apps].sort((a, b) => (a.appliedAt || 0) - (b.appliedAt || 0)).filter(a => {
    if (a.status !== 'active') return true
    const k = key(a)
    if (seen.has(k)) { removed.push(a); return false }
    seen.add(k)
    return true
  })
  return { kept, removed }
}
