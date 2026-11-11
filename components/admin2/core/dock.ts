// The result dock (judge F2): the LAST action's result, pinned where the owner is looking — above the bottom
// bar (and the job bar) on a phone, bottom-right on a desktop — with its Undo / Retry / Check again, until he
// dismisses it or the next action replaces it. Every useAdminAction publishes here automatically; a section
// does nothing. Framework-free; the shell renders it.
import type { ActionState } from './action.ts'

export type DockEntry = {
  /** `${action}:${target}` — an update for the same key replaces the entry in place. */
  key: string
  state: ActionState
  onUndo?: () => void
  onRetry?: () => void
}

export type ResultDock = {
  get: () => DockEntry | null
  /** Show (or replace) the last result. */
  set: (e: DockEntry) => void
  /** Update the entry only if it is still the one on show (an Undo finishing for an older line must not jump back). */
  update: (e: DockEntry) => void
  dismiss: () => void
  subscribe: (fn: () => void) => () => void
}

export function createResultDock(): ResultDock {
  let entry: DockEntry | null = null
  const subs = new Set<() => void>()
  const emit = () => subs.forEach((f) => { try { f() } catch { /* ignore */ } })
  return {
    get: () => entry,
    set: (e) => { entry = e; emit() },
    update: (e) => { if (entry && entry.key === e.key) { entry = e; emit() } },
    dismiss: () => { entry = null; emit() },
    subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn) } },
  }
}
