// Admin "Clear stale": one click drains the WHOLE stale backlog.
//
// Each POST purge_stale_jobs runs as many sweep batches as fit inside admin-stats' 15s function
// limit (~3–5k rows on prod) and reports `complete:false` while rows remain. The old client made
// ONE call and said "more queued for the next run" — but the scheduled cron only deletes stale
// rows unseen 14d+, so the rest never drained (prod 2026-10-17: two clicks deleted 7,000 and
// 14,700 stale rows stayed, and the alert never cleared). This loops the call until the server
// says complete, then reports the true totals and what is left.
//
// Pure (fetch injected) so the loop is unit-tested offline: components/admin/clearStale.test.mjs.

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

// A round that died in transit (Vercel/gateway timeout, a dropped connection, an HTML error page)
// is not a failed sweep: every batch the server committed before the cut-off is already saved, and
// the sweep is idempotent. Retry those; an explicit server error (500 with a reason) stays a failure.
const MAX_LOST_ROUNDS = 2
const isTransient = (status: number, body: Record<string, unknown>) =>
  status === 502 || status === 503 || status === 504 || Object.keys(body).length === 0

export const CLEAR_STALE_LIMITS = { maxRounds: 40, budgetMs: 240_000 }

export async function clearStaleUntilDone(token: string, opts: {
  fetchImpl?: typeof fetch
  maxRounds?: number
  budgetMs?: number
  now?: () => number
  onProgress?: (p: { rounds: number; cleared: number; remaining: number | null }) => void
} = {}): Promise<ClearStaleResult> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const maxRounds = opts.maxRounds ?? CLEAR_STALE_LIMITS.maxRounds
  const now = opts.now ?? Date.now
  const deadline = now() + (opts.budgetMs ?? CLEAR_STALE_LIMITS.budgetMs)
  const out: ClearStaleResult = { ok: true, cleared: 0, deleted: 0, retained: 0, staled: 0, complete: false, remaining: null, kept: null, rounds: 0, lostRounds: 0 }
  let lostInARow = 0

  while (out.rounds < maxRounds && now() < deadline) {
    let d: Record<string, unknown> = {}
    try {
      const res = await fetchImpl('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'purge_stale_jobs' }),
      })
      d = await res.json().catch(() => ({})) as Record<string, unknown>
      out.rounds += 1
      if (!res.ok || !d.ok) {
        if (isTransient(res.status, d) && lostInARow < MAX_LOST_ROUNDS) { lostInARow++; out.lostRounds++; continue }
        // Keep what earlier rounds achieved — a later failure must not erase a real result.
        return { ...out, ok: out.rounds > 1, error: String(d.detail || d.error || `HTTP ${res.status}`) }
      }
    } catch (e) {
      out.rounds += 1
      if (lostInARow < MAX_LOST_ROUNDS) { lostInARow++; out.lostRounds++; continue }
      return { ...out, ok: out.rounds > 1, error: (e as Error).message }
    }
    lostInARow = 0
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
    out.deleted += num(d.deleted)
    out.retained += num(d.retained)
    out.staled += num(d.staled)
    out.cleared = out.deleted + out.retained
    out.remaining = typeof d.remaining === 'number' ? d.remaining : null
    out.kept = typeof d.kept === 'number' ? d.kept : null
    opts.onProgress?.({ rounds: out.rounds, cleared: out.cleared, remaining: out.remaining })
    if (d.complete !== false) { out.complete = true; break }
    // A round that removed nothing yet reports more work is not making progress — stop, don't spin.
    if (num(d.deleted) + num(d.retained) + num(d.staled) === 0) break
  }
  return out
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
