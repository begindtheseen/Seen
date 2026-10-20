// Admin "Clear stale": one click drains the WHOLE stale backlog.
//
// Each POST purge_stale_jobs runs as many sweep batches as fit inside admin-stats' 15s function
// limit (~3–5k rows on prod) and reports `complete:false` while rows remain. The old client made
// ONE call and said "more queued for the next run" — but the scheduled cron only deletes stale
// rows unseen 14d+, so the rest never drained (prod 2026-10-17: two clicks deleted 7,000 and
// 14,700 stale rows stayed, and the alert never cleared). This loops the call until the server
// says complete, then reports the true totals and what is left.
//
// The loop itself (retries, budget, no-progress stop) is drainAdminAction in ./drain.ts, shared with
// "Remove dupes". Unit-tested offline: components/admin/clearStale.test.mjs.

import { drainAdminAction, DRAIN_LIMITS, num } from './drain.ts'

export type ClearStaleResult = {
  ok: boolean
  /** Rows removed from the stale set: deleted + kept as 'expired' for a user's saved/applied link. */
  cleared: number
  deleted: number
  retained: number
  /** Active rows unseen 7d+ that this run aged out (then deleted in the same run). */
  staled: number
  complete: boolean
  /** Clearable stale rows still in the table after the run (null = count unavailable). */
  remaining: number | null
  /** 'expired' rows kept for users' saved/applied links — never deleted by design. */
  kept: number | null
  rounds: number
  /** Rounds lost to a gateway timeout / dropped connection and retried. Batches the server finished
   *  before the cut-off ARE saved; they are just not in `cleared` (the next round's `remaining` is). */
  lostRounds: number
  error?: string
}

export const CLEAR_STALE_LIMITS = { maxRounds: DRAIN_LIMITS.maxRounds, budgetMs: DRAIN_LIMITS.budgetMs }

export async function clearStaleUntilDone(token: string, opts: {
  fetchImpl?: typeof fetch
  maxRounds?: number
  budgetMs?: number
  now?: () => number
  onProgress?: (p: { rounds: number; cleared: number; remaining: number | null }) => void
} = {}): Promise<ClearStaleResult> {
  const out: ClearStaleResult = { ok: true, cleared: 0, deleted: 0, retained: 0, staled: 0, complete: false, remaining: null, kept: null, rounds: 0, lostRounds: 0 }
  let rounds = 0
  const r = await drainAdminAction(token, 'purge_stale_jobs', {
    ...opts,
    onRound: (d) => {
      rounds += 1
      out.deleted += num(d.deleted)
      out.retained += num(d.retained)
      out.staled += num(d.staled)
      out.cleared = out.deleted + out.retained
      out.remaining = typeof d.remaining === 'number' ? d.remaining : null
      out.kept = typeof d.kept === 'number' ? d.kept : null
      opts.onProgress?.({ rounds, cleared: out.cleared, remaining: out.remaining })
      return num(d.deleted) + num(d.retained) + num(d.staled)
    },
  })
  return { ...out, ok: r.ok, complete: r.complete, rounds: r.rounds, lostRounds: r.lostRounds, ...(r.error ? { error: r.error } : {}) }
}

/** One line for the toast, from what actually happened. */
export function clearStaleMessage(r: ClearStaleResult): string {
  if (!r.ok) return `clear failed: ${(r.error || 'unknown error').slice(0, 100)}`
  const parts = [`cleared ${r.cleared.toLocaleString()} stale`]
  if (r.kept) parts.push(`${r.kept.toLocaleString()} kept for saved/applied links`)
  if (!r.complete) parts.push(r.remaining != null ? `${r.remaining.toLocaleString()} still left — click again` : 'not finished — click again')
  if (r.lostRounds) parts.push(`${r.lostRounds} round${r.lostRounds === 1 ? '' : 's'} timed out and retried (work saved)`)
  if (r.error) parts.push(`stopped: ${r.error.slice(0, 60)}`)
  return parts.join(' · ')
}
