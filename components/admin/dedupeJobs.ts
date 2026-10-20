// Admin "Remove dupes": one press removes EVERY duplicate listing. The server deletes until its time
// budget and reports `complete: false` with the true `remaining`; this repeats the call until done.
// Rules for what is a duplicate and what is never deleted: lib/server/jobDedupe.js.
// Unit-tested offline: components/admin/dedupeJobs.test.mjs.

import { drainAdminAction, num } from './drain.ts'

export type DedupeResult = {
  ok: boolean
  deleted: number
  /** Duplicates still in the table after the run (null = the last round did not say). */
  remaining: number | null
  /** Duplicate copies kept on purpose: employer-posted or held by a user (saved / applied). */
  protectedCount: number | null
  complete: boolean
  rounds: number
  lostRounds: number
  error?: string
}

export async function dedupeJobsUntilDone(token: string, opts: {
  fetchImpl?: typeof fetch
  maxRounds?: number
  budgetMs?: number
  now?: () => number
  onProgress?: (p: { rounds: number; deleted: number; remaining: number | null }) => void
} = {}): Promise<DedupeResult> {
  const out: DedupeResult = { ok: true, deleted: 0, remaining: null, protectedCount: null, complete: false, rounds: 0, lostRounds: 0 }
  let rounds = 0
  const r = await drainAdminAction(token, 'dedupe_jobs', {
    ...opts,
    onRound: (d) => {
      rounds += 1
      out.deleted += num(d.deleted)
      out.remaining = typeof d.remaining === 'number' ? d.remaining : null
      out.protectedCount = typeof d.protected === 'number' ? d.protected : null
      opts.onProgress?.({ rounds, deleted: out.deleted, remaining: out.remaining })
      return num(d.deleted)
    },
  })
  return { ...out, ok: r.ok, complete: r.complete, rounds: r.rounds, lostRounds: r.lostRounds, ...(r.error ? { error: r.error } : {}) }
}

export function dedupeMessage(r: DedupeResult): string {
  if (!r.ok) return `✗ remove failed: ${(r.error || 'unknown error').slice(0, 100)}`
  const parts = [r.deleted === 0 && r.complete ? 'No duplicates to remove' : `Removed ${r.deleted.toLocaleString()} duplicate listing${r.deleted === 1 ? '' : 's'}`]
  if (r.protectedCount) parts.push(`${r.protectedCount.toLocaleString()} kept (employer-posted or saved/applied by a user)`)
  if (!r.complete) parts.push(r.remaining != null ? `${r.remaining.toLocaleString()} still left — press again` : 'not finished — press again')
  if (r.lostRounds) parts.push(`${r.lostRounds} round${r.lostRounds === 1 ? '' : 's'} timed out and retried (work saved)`)
  if (r.error) parts.push(`stopped: ${r.error.slice(0, 60)}`)
  return (r.complete ? '✓ ' : '… ') + parts.join(' · ')
}
