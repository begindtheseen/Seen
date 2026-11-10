// The job manager (audit §3.3, long jobs). Some admin actions can only do a bounded amount per
// request (the function time limit) and answer `complete: false` with `remaining` and a `cursor`.
// One press must still be the WHOLE job, so the manager — mounted once at the shell root, not in a
// panel — calls the action again and again:
//   · ONE running instance per action+args: a second press returns the running job (the UI focuses it);
//   · a round lost in transit (502/503/504, timeout, dropped connection, empty body) is retried, at
//     most 2 in a row (the logic proven in components/admin/drain.ts);
//   · it stops when the server says complete, when a round does nothing (no progress), at the round /
//     time caps (paused, resumable), on a real error, or after the current round when Cancel is pressed;
//   · totals (changed, remaining, skipped) are summed across rounds, so the screen can say
//     "8,400 of 20,982" with a determinate bar whenever `remaining` is known;
//   · `{action, args, cursor, totals}` is kept in sessionStorage: a reload offers
//     "Resume clearing stale listings — 12,582 left" instead of losing the job;
//   · the final summary stays until the owner dismisses it.
//
// Framework-free (React reads it through useAdminJob in ./hooks.tsx); unit-tested in core.test.mjs.
import type { AdminJobState, AdminSkipped } from '../contract.ts'
import type { AdminApi, ApiResult } from './api.ts'

export type JobSpec = {
  action: string
  args?: Record<string, unknown>
  /** Present-tense line while running: "Clearing stale listings". */
  label: string
  /** Past tense for the summary: "Cleared". */
  past: string
  /** What is counted: "stale listings". */
  noun: string
  /** A round the caller already ran (e.g. the first round of an Undo): its totals and where to go on. */
  initial?: { changed: number; remaining: number | null; cursor?: string }
}

/** The contract's job state plus what the core needs to resume and to summarise. Extra fields are optional. */
export type Job = AdminJobState & {
  key: string
  args: Record<string, unknown>
  past: string
  noun: string
  skipped: AdminSkipped[]
  /** Why it stopped, when it did not simply finish. */
  stopped?: 'cancel' | 'cap' | 'no_progress' | 'reload' | 'error'
  /** It can be resumed from `cursor` (paused at a cap, stopped by a reload). */
  resumable?: boolean
  /** A reload interrupted it once: a round in flight then may have been done but not counted. */
  reloaded?: boolean
  /** The server's own sentence from the last round ("Scanned 61,000 listings so far — keep going."). */
  last_message?: string
  lost_rounds: number
  ended_at?: string
}

export const JOB_LIMITS = { maxRounds: 120, budgetMs: 15 * 60_000, maxLostInARow: 2, roundTimeoutMs: 75_000 }
export const JOBS_STORAGE_KEY = 'seen_admin_jobs_v1'

const TRANSIENT = new Set(['timeout', 'network', 'upstream'])
const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

export function jobKey(action: string, args?: Record<string, unknown>): string {
  const a = args || {}
  const sorted = Object.keys(a).sort().reduce<Record<string, unknown>>((o, k) => { o[k] = a[k]; return o }, {})
  return `${action}|${JSON.stringify(sorted)}`
}

/** Total work when it is known: what is done plus what the server says is left. */
export function jobTotal(j: Pick<Job, 'changed' | 'remaining'>): number | null {
  return typeof j.remaining === 'number' ? j.changed + j.remaining : null
}

/** "8,400 of 20,982" / "8,400 so far". */
export function jobProgressText(j: Pick<Job, 'changed' | 'remaining'>): string {
  const total = jobTotal(j)
  return total != null ? `${fmt(j.changed)} of ${fmt(total)}` : `${fmt(j.changed)} so far`
}

function skippedText(skipped: AdminSkipped[]): string {
  return skipped.filter((s) => s.count > 0).map((s) => `${fmt(s.count)} skipped (${s.reason.replace(/_/g, ' ')})`).join(' · ')
}

/** The one-line summary for a finished, stopped or failed job. */
export function jobSummary(j: Job, lastMessage = ''): string {
  const did = `${j.past} ${fmt(j.changed)} ${j.noun}`
  const skip = skippedText(j.skipped)
  const left = typeof j.remaining === 'number' && j.remaining > 0 ? `${fmt(j.remaining)} left` : ''
  const tail = [skip, left].filter(Boolean).join(' · ')
  const rounds = j.rounds === 1 ? '1 round' : `${j.rounds} rounds`
  switch (j.status) {
    case 'done':
      return `${did} in ${rounds}.${tail ? ` ${tail}.` : ''}${j.reloaded ? ' A round that was running when the page reloaded may have done more than is counted here.' : ''}`
    case 'cancelled':
      if (j.stopped === 'cap') return `Paused after ${rounds}: ${did.toLowerCase()}${left ? `, ${left}` : ''}. Resume to continue.`
      if (j.stopped === 'reload') return `Stopped when the page reloaded: ${did.toLowerCase()}${left ? `, ${left}` : ''}.`
      return `Cancelled: ${did.toLowerCase()}${left ? `, ${left}` : ''}.`
    case 'error':
      if (j.stopped === 'no_progress') return `Stopped: the last round changed nothing and did not move on, although the server reports ${left || 'more work'}. ${did} before that.`
      return `${lastMessage || 'The job failed.'}${j.changed ? ` ${did} before it stopped.` : ' Nothing was changed.'}`
    default:
      return `${j.label}… ${jobProgressText(j)}`
  }
}

export type JobStorage = { get: () => string | null; set: (v: string) => void }

export function createJobManager(deps: {
  api: AdminApi
  storage?: JobStorage
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  /** An action's touched keys after each round (the cache re-reads them). */
  invalidate?: (touched: string[]) => void
  limits?: Partial<typeof JOB_LIMITS>
}) {
  const now = deps.now || Date.now
  const sleep = deps.sleep || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const limits = { ...JOB_LIMITS, ...(deps.limits || {}) }
  const jobs = new Map<string, Job>()
  const cancelRequested = new Set<string>()
  const subs = new Set<() => void>()
  let focusListeners = new Set<(id: string) => void>()
  let seq = 0

  const emit = () => subs.forEach((f) => { try { f() } catch { /* ignore */ } })
  const persist = () => {
    if (!deps.storage) return
    try { deps.storage.set(JSON.stringify([...jobs.values()])) } catch { /* storage full or blocked: only the resume offer is lost */ }
  }
  const update = (id: string, patch: Partial<Job>) => {
    const j = jobs.get(id)
    if (!j) return
    jobs.set(id, { ...j, ...patch })
    persist()
    emit()
  }

  // A reload interrupted whatever was running: offer to resume it.
  if (deps.storage) {
    try {
      const saved = JSON.parse(deps.storage.get() || '[]') as Job[]
      for (const j of Array.isArray(saved) ? saved : []) {
        if (!j || !j.id || !j.action) continue
        if (j.status === 'running' || j.status === 'cancelling') {
          const fixed: Job = { ...j, status: 'cancelled', stopped: 'reload', resumable: true, reloaded: true }
          fixed.message = jobSummary(fixed)
          jobs.set(j.id, fixed)
        } else jobs.set(j.id, j)
      }
    } catch { /* unreadable: start clean */ }
  }

  async function loop(id: string) {
    const startedAt = now()
    let lostInARow = 0
    let roundsThisRun = 0
    let lastMessage = ''
    for (;;) {
      const j = jobs.get(id)
      if (!j) return
      if (cancelRequested.has(id)) {
        cancelRequested.delete(id)
        const done: Job = { ...j, status: 'cancelled', stopped: 'cancel', resumable: !!j.cursor || (j.remaining ?? 0) > 0, ended_at: new Date(now()).toISOString() }
        done.message = jobSummary(done)
        jobs.set(id, done); persist(); emit()
        return
      }
      if (roundsThisRun >= limits.maxRounds || now() - startedAt > limits.budgetMs) {
        const paused: Job = { ...j, status: 'cancelled', stopped: 'cap', resumable: true, ended_at: new Date(now()).toISOString() }
        paused.message = jobSummary(paused)
        jobs.set(id, paused); persist(); emit()
        return
      }
      const body = { ...j.args, ...(j.cursor ? { cursor: j.cursor } : {}) }
      const res: ApiResult = await deps.api(j.action, body, { timeoutMs: limits.roundTimeoutMs })
      roundsThisRun += 1
      const cur = jobs.get(id)!
      if (!res.ok) {
        if (TRANSIENT.has(res.code) && lostInARow < limits.maxLostInARow) {
          lostInARow += 1
          update(id, { rounds: cur.rounds + 1, lost_rounds: cur.lost_rounds + 1, message: `${cur.label}… ${jobProgressText(cur)} (a round was lost in transit — retrying)` })
          await sleep(1000 * lostInARow)
          continue
        }
        const failed: Job = {
          ...cur, rounds: cur.rounds + 1, status: 'error', stopped: 'error',
          changed: cur.changed + (res.changed || 0),
          remaining: typeof res.remaining === 'number' ? res.remaining : cur.remaining,
          resumable: !!cur.cursor || (cur.remaining ?? 0) > 0, ended_at: new Date(now()).toISOString(),
        }
        failed.message = jobSummary(failed, res.error)
        jobs.set(id, failed); persist(); emit()
        return
      }
      lostInARow = 0
      lastMessage = res.message
      if (res.touched?.length) deps.invalidate?.(res.touched)
      const skipped = mergeSkipped(cur.skipped, res.skipped)
      const next: Job = {
        ...cur,
        rounds: cur.rounds + 1,
        // A running total the server reports (undo's `restored`) wins over our sum: it survives a lost round.
        changed: typeof (res as { restored?: unknown }).restored === 'number' ? (res as unknown as { restored: number }).restored : cur.changed + (res.changed || 0),
        remaining: typeof res.remaining === 'number' ? res.remaining : (res.complete === false ? cur.remaining : 0),
        cursor: res.cursor || undefined,
        skipped,
        last_message: res.message || cur.last_message,
      }
      if (res.complete !== false) {
        const done: Job = { ...next, status: 'done', resumable: false, ended_at: new Date(now()).toISOString() }
        done.message = jobSummary(done, lastMessage)
        jobs.set(id, done); persist(); emit()
        return
      }
      // A round that moved its cursor forward is progress even with nothing changed (a scan that reads
      // before it writes). Only a round that neither changed rows nor moved the cursor is stuck.
      const moved = !!res.cursor && res.cursor !== cur.cursor
      if (!res.changed && !moved) {
        // The server says there is more but this round did nothing: stop instead of spinning.
        const stuck: Job = { ...next, status: 'error', stopped: 'no_progress', resumable: true, ended_at: new Date(now()).toISOString() }
        stuck.message = jobSummary(stuck, lastMessage)
        jobs.set(id, stuck); persist(); emit()
        return
      }
      const running: Job = { ...next, status: cancelRequested.has(id) ? 'cancelling' : 'running' }
      running.message = jobSummary(running)
      jobs.set(id, running); persist(); emit()
    }
  }

  function findRunning(key: string): Job | undefined {
    return [...jobs.values()].find((j) => j.key === key && (j.status === 'running' || j.status === 'cancelling'))
  }

  return {
    /** Start the job, or return the one already running for the same action+args (and focus it). */
    start(spec: JobSpec): string {
      const key = jobKey(spec.action, spec.args)
      const running = findRunning(key)
      if (running) { focusListeners.forEach((f) => f(running.id)); return running.id }
      // A finished or stopped job of the same kind makes way for the new run.
      for (const j of [...jobs.values()]) if (j.key === key) jobs.delete(j.id)
      const id = `job_${now().toString(36)}_${(seq++).toString(36)}`
      const job: Job = {
        id, key, action: spec.action, args: spec.args || {}, label: spec.label, past: spec.past, noun: spec.noun,
        status: 'running', changed: spec.initial?.changed || 0, remaining: spec.initial ? spec.initial.remaining : null,
        rounds: spec.initial ? 1 : 0, cursor: spec.initial?.cursor, message: `${spec.label}…`, skipped: [],
        lost_rounds: 0, started_at: new Date(now()).toISOString(),
      }
      job.message = spec.initial ? jobSummary(job) : job.message
      jobs.set(id, job); persist(); emit()
      void loop(id)
      return id
    },
    /** Stop after the current round. */
    cancel(id: string) {
      const j = jobs.get(id)
      if (!j || (j.status !== 'running' && j.status !== 'cancelling')) return
      cancelRequested.add(id)
      update(id, { status: 'cancelling', message: `Stopping after this round… ${jobProgressText(j)}` })
    },
    /** Continue a paused / reload-stopped job from its cursor, keeping its totals. */
    resume(id: string): string | null {
      const j = jobs.get(id)
      if (!j || !j.resumable || j.status === 'running' || j.status === 'cancelling') return null
      const other = findRunning(j.key)
      if (other) { focusListeners.forEach((f) => f(other.id)); return other.id }
      const resumed: Job = { ...j, status: 'running', stopped: undefined, resumable: false, ended_at: undefined }
      resumed.message = jobSummary(resumed)
      jobs.set(id, resumed); persist(); emit()
      void loop(id)
      return id
    },
    dismiss(id: string) {
      const j = jobs.get(id)
      if (!j || j.status === 'running' || j.status === 'cancelling') return
      jobs.delete(id); persist(); emit()
    },
    get: (id: string) => jobs.get(id),
    byKey: (action: string, args?: Record<string, unknown>) => {
      const key = jobKey(action, args)
      return findRunning(key) || [...jobs.values()].reverse().find((j) => j.key === key)
    },
    list: () => [...jobs.values()],
    subscribe(fn: () => void) { subs.add(fn); return () => { subs.delete(fn) } },
    onFocus(fn: (id: string) => void) { focusListeners.add(fn); return () => { focusListeners.delete(fn) } },
    /** Test helper: drop listeners. */
    _reset() { subs.clear(); focusListeners = new Set() },
  }
}

export function mergeSkipped(a: AdminSkipped[], b: AdminSkipped[] | undefined): AdminSkipped[] {
  const out = a.map((s) => ({ ...s }))
  for (const s of b || []) {
    const hit = out.find((o) => o.reason === s.reason)
    if (hit) hit.count += s.count
    else out.push({ reason: s.reason, count: s.count })
  }
  return out
}

export type JobManager = ReturnType<typeof createJobManager>
