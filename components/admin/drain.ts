// One admin press = the WHOLE job. Some admin actions (purge_stale_jobs, dedupe_jobs) can only do a
// bounded amount of work per request (the 60s function limit) and report `complete: false` while work
// remains. This calls the action again until the server says complete, the work stops moving, or the
// press's own budget runs out — and retries a round that died in transit (gateway timeout, dropped
// connection, HTML error page), because every batch the server committed before the cut-off is saved
// and both actions are idempotent. An explicit server error (a JSON body with a reason) is a failure.
//
// Pure (fetch injected) so it is unit-tested offline: clearStale.test.mjs, dedupeJobs.test.mjs.

export type DrainOutcome = {
  /** False only when nothing could have been done (the first round failed for real). */
  ok: boolean
  complete: boolean
  rounds: number
  /** Rounds lost in transit and retried. */
  lostRounds: number
  error?: string
}

export const DRAIN_LIMITS = { maxRounds: 40, budgetMs: 240_000, maxLostInARow: 2 }

const isTransient = (status: number, body: Record<string, unknown>) =>
  status === 502 || status === 503 || status === 504 || Object.keys(body).length === 0

export async function drainAdminAction(token: string, action: string, opts: {
  fetchImpl?: typeof fetch
  maxRounds?: number
  budgetMs?: number
  now?: () => number
  /** Called with each successful round's body; returns how much work that round did (0 = no progress). */
  onRound: (d: Record<string, unknown>) => number
}): Promise<DrainOutcome> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const maxRounds = opts.maxRounds ?? DRAIN_LIMITS.maxRounds
  const now = opts.now ?? Date.now
  const deadline = now() + (opts.budgetMs ?? DRAIN_LIMITS.budgetMs)
  const out: DrainOutcome = { ok: true, complete: false, rounds: 0, lostRounds: 0 }
  let lostInARow = 0

  while (out.rounds < maxRounds && now() < deadline) {
    let d: Record<string, unknown> = {}
    try {
      const res = await fetchImpl('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action }),
      })
      d = await res.json().catch(() => ({})) as Record<string, unknown>
      out.rounds += 1
      if (!res.ok || !d.ok) {
        if (isTransient(res.status, d) && lostInARow < DRAIN_LIMITS.maxLostInARow) { lostInARow++; out.lostRounds++; continue }
        // Keep what earlier rounds achieved — a later failure must not erase a real result.
        return { ...out, ok: out.rounds > 1, error: String(d.detail || d.error || `HTTP ${res.status}`) }
      }
    } catch (e) {
      out.rounds += 1
      if (lostInARow < DRAIN_LIMITS.maxLostInARow) { lostInARow++; out.lostRounds++; continue }
      return { ...out, ok: out.rounds > 1, error: (e as Error).message }
    }
    lostInARow = 0
    const work = opts.onRound(d)
    if (d.complete !== false) { out.complete = true; break }
    // A round that did nothing yet reports more work is not making progress — stop, don't spin.
    if (!work) break
  }
  return out
}

export const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
