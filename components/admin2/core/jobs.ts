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
import type { AdminJobState, AdminSkipped, AdminUndo } from '../contract.ts'
import type { AdminApi, ApiResult } from './api.ts'
import type { UndoBus } from './action.ts'
import { counted } from './words.ts'

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
  /** The whole job's size when known up front ("58 company scores"). Later rounds' `remaining` keep it current. */
  total?: number
  /** A second unit the server counts per round, summed and said beside the first: { field: 'merged', noun: 'companies' }. */
  detail?: { field: string; noun: string }
  /** The server's `job_status` kind for this job (defaults from JOB_STATUS_KIND by action). */
  statusKind?: string
}

/** Which `job_status { kind }` reads the truth for a job action after a reload (SHAPES.md). No kind → "not known". */
export const JOB_STATUS_KIND: Record<string, string> = {
  purge_stale_jobs: 'clear_stale', auto_merge: 'auto_merge', recompute_queue_drain: 'recompute',
  dedupe_reports: 'report_dupes', job_dupes_remove: 'job_dupes', job_dupes_scan: 'job_dupes', dedupe_jobs: 'job_dupes',
}
/** A second unit some job actions count per round (summed across rounds and said in both units). */
export const JOB_DETAIL: Record<string, { field: string; noun: string }> = { auto_merge: { field: 'merged', noun: 'companies' } }

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
  /** The job's size: from JobSpec.total, then changed + the server's remaining. One number everywhere. */
  total?: number | null
  /**
   * The server's Undo for the whole job: the last round's `undo`, kept only while every round carried the
   * same `request_id` (one press = one batch). A finished job offers it exactly like a single action.
   */
  undo?: AdminUndo
  /** The request_id every round answered with (null once two rounds disagreed — then no Undo is offered). */
  request_id?: string | null
  /** The Undo was started (as its own job). */
  undone?: boolean
  /** The id every round of THIS run sends (with `round`), so a lost answer's retry is replayed, never re-run. */
  rid?: string
  /** Rounds the server answered (the next call is round `round_no + 1`; a retry of a lost round repeats it). */
  round_no?: number
  detail?: { field: string; noun: string }
  detail_total?: number
  status_kind?: string
  /** This job IS an Undo of that audit id (finishing it clears every line still offering that Undo). */
  undo_of?: string
  /** After a reload: the server is being asked what was really done before anything is said. */
  checking?: boolean
  lost_rounds: number
  ended_at?: string
}

export const JOB_LIMITS = { maxRounds: 120, budgetMs: 15 * 60_000, maxLostInARow: 2, roundTimeoutMs: 75_000 }
export const JOBS_STORAGE_KEY = 'seen_admin_jobs_v1'

const TRANSIENT = new Set(['timeout', 'network', 'upstream'])
function newRid(): string {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replace(/-/g, '') } catch { /* fall through */ }
  return `j${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}
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
  const did = `${j.past} ${counted(j.changed, j.noun)}${j.detail && typeof j.detail_total === 'number' ? ` (${counted(j.detail_total, j.detail.noun)})` : ''}`
  const skip = skippedText(j.skipped)
  const left = typeof j.remaining === 'number' && j.remaining > 0 ? `${fmt(j.remaining)} left` : ''
  const tail = [skip, left].filter(Boolean).join(' · ')
  const rounds = j.rounds === 1 ? '1 round' : `${j.rounds} rounds`
  switch (j.status) {
    case 'done':
      return `${did} in ${rounds}.${tail ? ` ${tail}.` : ''}`
    case 'cancelled':
      if (j.stopped === 'cap') return `Paused after ${rounds}: ${did.toLowerCase()}${left ? `, ${left}` : ''}. Resume to continue.`
      if (j.stopped === 'reload') {
        if (j.checking) return 'Checking what was done…'
        if (!j.changed && j.remaining == null) return 'Stopped when the page was closed or reopened. What its last round did is not known yet — Resume continues from where the server is.'
        return `Stopped when the page was closed or reopened: ${did.toLowerCase()} so far${left ? `, ${left}` : ''}.`
      }
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
  undoBus?: UndoBus
  /** The server's truth for a job a reload interrupted: what is done and what is left (null = not known). */
  statusRead?: (job: Job) => Promise<{ remaining: number | null; done: number | null; complete: boolean } | null>
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
          // Say nothing about counts until the server has been asked (F5): the last round may have finished there.
          const fixed: Job = { ...j, status: 'cancelled', stopped: 'reload', resumable: false, reloaded: true, checking: true }
          fixed.message = jobSummary(fixed)
          jobs.set(j.id, fixed)
          void readTruth(j.id)
        } else jobs.set(j.id, j)
      }
    } catch { /* unreadable: start clean */ }
  }

  async function readTruth(id: string) {
    await Promise.resolve()
    const j = jobs.get(id)
    if (!j) return
    let t: Awaited<ReturnType<NonNullable<typeof deps.statusRead>>> = null
    try { t = deps.statusRead ? await deps.statusRead(j) : null } catch { t = null }
    const cur = jobs.get(id)
    if (!cur || !cur.checking) return
    // "Done" is computed, never guessed: the saved size minus what the server says is left.
    const doneFrom = (rem: number | null) => t?.done ?? (typeof cur.total === 'number' && typeof rem === 'number' ? Math.max(cur.changed, cur.total - rem) : cur.changed)
    if (t && (t.complete || t.remaining === 0)) {
      const changed = doneFrom(0)
      const done: Job = { ...cur, checking: false, status: 'done', resumable: false, remaining: 0, changed, ended_at: new Date(now()).toISOString() }
      done.message = changed > 0 ? `Finished on the server while the page was closed. ${jobSummary(done)}` : 'Finished on the server while the page was closed — nothing is left to do.'
      jobs.set(id, done)
    } else {
      const stopped: Job = { ...cur, checking: false, resumable: true, ...(t && typeof t.remaining === 'number' ? { remaining: t.remaining, changed: doneFrom(t.remaining) } : {}) }
      stopped.message = jobSummary(stopped)
      jobs.set(id, stopped)
    }
    persist(); emit()
  }

  // Undone somewhere else (the activity log): a finished job no longer offers that Undo (F8).
  deps.undoBus?.subscribe((auditId) => {
    for (const j of jobs.values()) {
      const a = j.undo?.args?.audit_id
      if (j.undo && a != null && String(a) === auditId) jobs.set(j.id, { ...j, undo: undefined, undone: true })
    }
    persist(); emit()
  })

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
      // One request_id for the job, the round number naming each round: a retry of a lost round repeats the
      // same round number, so the server replays its recorded answer instead of doing the round twice.
      const body = { ...j.args, request_id: (j.args.request_id as string | undefined) || j.rid, round: (j.round_no || 0) + 1, ...(j.cursor ? { cursor: j.cursor } : {}) }
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
      // A running total the server reports (undo's `restored`) wins over our sum: it survives a lost round.
      const detailRound = cur.detail ? Number((res as Record<string, unknown>)[cur.detail.field]) : NaN
      const changedNow = typeof (res as { restored?: unknown }).restored === 'number' ? (res as unknown as { restored: number }).restored : cur.changed + (res.changed || 0)
      // One size for the job: the server's remaining when it says it, else what the known total leaves.
      const remainingNow = typeof res.remaining === 'number' ? res.remaining
        : res.complete === false ? (typeof cur.total === 'number' ? Math.max(0, cur.total - changedNow) : cur.remaining) : 0
      const next: Job = {
        ...cur,
        rounds: cur.rounds + 1,
        changed: changedNow,
        round_no: (cur.round_no || 0) + 1,
        ...(cur.detail && Number.isFinite(detailRound) ? { detail_total: (cur.detail_total || 0) + detailRound } : {}),
        remaining: remainingNow,
        total: typeof remainingNow === 'number' ? changedNow + remainingNow : cur.total,
        cursor: res.cursor || undefined,
        skipped,
        last_message: res.message || cur.last_message,
        ...undoAfter(cur, res),
      }
      if (res.complete !== false) {
        const done: Job = { ...next, status: 'done', resumable: false, ended_at: new Date(now()).toISOString() }
        done.message = jobSummary(done, lastMessage)
        jobs.set(id, done); persist(); emit()
        if (done.undo_of) deps.undoBus?.emit(done.undo_of)
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

  const mgr = {
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
        status: 'running', changed: spec.initial?.changed || 0,
        remaining: spec.initial ? spec.initial.remaining : (typeof spec.total === 'number' ? spec.total : null),
        total: typeof spec.total === 'number' ? spec.total : spec.initial && typeof spec.initial.remaining === 'number' ? spec.initial.changed + spec.initial.remaining : null,
        rounds: spec.initial ? 1 : 0, cursor: spec.initial?.cursor, message: `${spec.label}…`, skipped: [],
        lost_rounds: 0, started_at: new Date(now()).toISOString(),
        rid: newRid(), round_no: spec.initial ? 1 : 0,
        detail: spec.detail || JOB_DETAIL[spec.action], status_kind: spec.statusKind || JOB_STATUS_KIND[spec.action],
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
    /** Run the finished job's Undo — itself a job (a big undo answers in rounds), shown like any other. */
    undo(id: string): string | null {
      const j = jobs.get(id)
      if (!j || !j.undo || j.undone || j.status === 'running' || j.status === 'cancelling') return null
      const u = j.undo
      jobs.set(id, { ...j, undone: true, undo: undefined }); persist(); emit()
      const nid = mgr.start({ action: u.action, args: u.args, label: `Undoing — putting ${fmt(j.changed)} ${j.noun} back`, past: 'Put back', noun: j.noun, total: j.changed || undefined })
      const a = u.args?.audit_id
      if (a != null) { const nj = jobs.get(nid); if (nj) jobs.set(nid, { ...nj, undo_of: String(a) }) }
      return nid
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
  return mgr
}

/** Carry the job's Undo: the newest round's `undo`, as long as every round answered with one request_id. */
function undoAfter(cur: Job, res: ApiResult): Pick<Job, 'undo' | 'request_id'> {
  if (!res.ok) return {}
  const rid = typeof (res as { request_id?: unknown }).request_id === 'string' ? (res as unknown as { request_id: string }).request_id
    : typeof cur.args.request_id === 'string' ? cur.args.request_id : undefined
  if (cur.request_id === null) return { undo: undefined, request_id: null }
  if (cur.request_id !== undefined && rid !== undefined && rid !== cur.request_id) return { undo: undefined, request_id: null }
  return { request_id: rid ?? cur.request_id, undo: res.undo || cur.undo }
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
