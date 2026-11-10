// THE action pipeline (audit §3.3). One press of any admin button goes through `createActionRunner`:
//   1. a second tap on the SAME target while the first is in flight is refused (no double approve);
//   2. the optimistic patch (if any) is applied to the cache at once and rolled back on failure;
//   3. the server's contract answer becomes the target's state: its `message`, counts, skipped
//      reasons, Undo (when the server offers one) and Retry (when the error is retryable);
//   4. only the keys the server says it `touched` are re-read — never the whole dashboard;
//   5. a 401 is handled inside the api (sign-in sheet, then the SAME call is replayed);
//   6. nothing here reloads the page or navigates.
//
// Framework-free (the React hook is useAdminAction in ./hooks.tsx); unit-tested in core.test.mjs.
import type { AdminErr, AdminOk } from '../contract.ts'
import { isUnknownOutcome, type AdminApi, type ApiResult } from './api.ts'
import type { CacheTx, QueryCache } from './cache.ts'
import type { JobManager } from './jobs.ts'

export type ActionStatus = 'idle' | 'running' | 'done' | 'error'

export type ActionState = {
  status: ActionStatus
  target: string
  args?: Record<string, unknown>
  result?: AdminOk
  error?: AdminErr
  /** True while the Undo call itself runs. */
  undoing?: boolean
  /** The Undo already ran (its own result replaces `result`). */
  undone?: boolean
  /** The Undo continues as a job in the job manager (shell chip + Jobs sheet; resumable after a reload). */
  jobId?: string
  /** No answer yet (timeout / empty / unreadable): the pipeline is asking again with the same request_id. */
  checking?: boolean
  /** The request_id of this line's Undo press, reused when the Undo is asked again ("Check again"). */
  undoRid?: string
}

/** The longest an action or an Undo waits for one answer: a bulk Undo can take ~25–40 s on the server. */
export const LONG_TIMEOUT_MS = 75_000

/** The server's undo sentence without its own prefix: the line's word already says "Undone". Pure. */
export function undoSentence(message: string): string {
  return message.replace(/^\s*(?:undid it|undone)\s*[:—-]\s*/i, '').replace(/^./, (c) => c.toUpperCase())
}

export type ActionOptions = {
  /** Applied at once; rolled back if the server says no. */
  optimistic?: (tx: CacheTx, args: Record<string, unknown>) => void
  /** Rows the server returned for in-place replacement. */
  onRows?: (rows: Record<string, unknown>[], cache: QueryCache, args: Record<string, unknown>) => void
  /** Keys to re-read when a call FAILS after doing part of the work (`changed > 0` on an error). */
  partialTouched?: string[]
  /** false = this action's results are not pinned to the result dock (default: every result is). */
  dock?: boolean
  /** Called after every finished call (ok or not), e.g. to clear a selection on success. */
  onSettled?: (res: ApiResult, args: Record<string, unknown>) => void
  timeoutMs?: number
}

export type RunResult = ApiResult | (AdminErr & { code: 'busy' })

/** A large undo answers in rounds; this caps one press. */
export const UNDO_MAX_ROUNDS = 50

export type UndoBus = { emit: (auditId: string) => void; subscribe: (fn: (auditId: string) => void) => () => void }
export function createUndoBus(): UndoBus {
  const subs = new Set<(id: string) => void>()
  return { emit: (id) => subs.forEach((f) => { try { f(id) } catch { /* ignore */ } }), subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn) } } }
}

/** One id per press, reused on Retry and on the sign-in replay, so the server never does it twice. */
export function newRequestId(): string {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID() } catch { /* fall through */ }
  const b = new Uint8Array(16)
  try { globalThis.crypto.getRandomValues(b) } catch { for (let i = 0; i < 16; i++) b[i] = (Date.now() + i * 7919) & 255 }
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/** How long to wait before each "did it go through?" re-ask after an unknown outcome. */
export const CHECK_DELAYS_MS = [1500, 3000, 6000, 12000]

const auditIdOf = (u: { args?: Record<string, unknown> } | undefined): string | null =>
  u && u.args && (typeof u.args.audit_id === 'string' || typeof u.args.audit_id === 'number') ? String(u.args.audit_id) : null

export const IDLE = (target: string): ActionState => ({ status: 'idle', target })

export function createActionRunner(deps: {
  api: AdminApi
  cache: QueryCache
  action: string
  options?: ActionOptions
  /** Called whenever any target's state changes. */
  onChange?: (target: string, state: ActionState) => void
  /** When given, an Undo that answers `complete:false` continues as a visible, resumable job. */
  jobs?: JobManager
  /** "This audit id was undone" — clears every result line still offering Undo for it (F8). */
  undoBus?: UndoBus
  /** Waits between "is it done?" checks (injected in tests). */
  sleep?: (ms: number) => Promise<void>
  checkDelaysMs?: number[]
}) {
  const { api, cache, action } = deps
  const opts = deps.options || {}
  const inflight = new Set<string>()
  const states = new Map<string, ActionState>()

  const setState = (target: string, s: ActionState) => {
    states.set(target, s)
    deps.onChange?.(target, s)
  }
  const sleep = deps.sleep || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const delays = deps.checkDelaysMs || CHECK_DELAYS_MS

  // Undone somewhere else (the activity log, another line): this line no longer offers that Undo.
  deps.undoBus?.subscribe((id) => {
    for (const [target, s] of states) {
      if (s.result?.undo && auditIdOf(s.result.undo) === id) setState(target, { ...s, result: { ...s.result, undo: undefined }, undone: true })
    }
  })

  /** After an unknown outcome: ask again with the SAME request_id until the server says done or not done. */
  async function check(args: Record<string, unknown>, target: string, first: ApiResult): Promise<ApiResult> {
    let res = first
    for (const ms of delays) {
      if (res.ok || !isUnknownOutcome(res as AdminErr)) return res
      setState(target, { status: 'running', target, args, checking: true })
      await sleep(ms)
      try { res = await api(action, args, { timeoutMs: opts.timeoutMs }) }
      catch { /* keep the unknown */ }
    }
    if (res.ok || !isUnknownOutcome(res as AdminErr)) return res
    return { ok: false, code: 'unknown_outcome', retryable: true,
      error: 'Still no answer, so it is not known whether this went through. "Check again" asks the server once more — it will never do it twice.' }
  }

  function finish(res: ApiResult, target: string, args: Record<string, unknown>, tx: CacheTx | null) {
    if (res.ok) {
      cache.invalidate(res.touched)
      if (res.rows?.length && opts.onRows) opts.onRows(res.rows as Record<string, unknown>[], cache, args)
      setState(target, { status: 'done', target, args, result: res })
    } else {
      tx?.rollback()
      if ((res.changed || 0) > 0 && opts.partialTouched?.length) cache.invalidate(opts.partialTouched)
      setState(target, { status: 'error', target, args, error: res })
    }
    try { opts.onSettled?.(res, args) } catch { /* a settle hook must not break the pipeline */ }
  }

  async function run(args: Record<string, unknown> = {}, target = '*'): Promise<RunResult> {
    if (inflight.has(target)) {
      return { ok: false, code: 'busy', error: 'Already working on this — wait for it to finish.', retryable: false }
    }
    inflight.add(target)
    // Every write carries a request_id (one per press; Retry and the sign-in replay reuse it).
    if (typeof args.request_id !== 'string' || !args.request_id) args = { ...args, request_id: newRequestId() }
    setState(target, { status: 'running', target, args })
    let tx: CacheTx | null = null
    if (opts.optimistic) {
      tx = cache.begin()
      try { opts.optimistic(tx, args) } catch { tx.rollback(); tx = null }
    }
    let res: ApiResult
    try {
      res = await api(action, args, { timeoutMs: opts.timeoutMs })
      if (!res.ok && isUnknownOutcome(res)) res = await check(args, target, res)
    }
    catch (e) { res = { ok: false, code: 'client', error: `Something on this screen failed: ${(e as Error).message || 'unknown error'}.`, retryable: true } }
    finally { inflight.delete(target) }
    finish(res, target, args, tx)
    if (res.ok && action === 'undo' && args.audit_id != null) deps.undoBus?.emit(String(args.audit_id))
    return res
  }

  /** Run the server's Undo for this target's last result. Undo is itself an action (it touches keys). */
  async function undo(target = '*'): Promise<RunResult | null> {
    const s = states.get(target)
    const u = s?.result?.undo
    if (!s || !u || s.undoing) return null
    if (inflight.has(target)) return { ok: false, code: 'busy', error: 'Already working on this — wait for it to finish.', retryable: false }
    inflight.add(target)
    // One request_id per Undo press, reused when the same Undo is asked again; the long timeout (a bulk Undo takes
    // ~25 s on the server), and an unknown answer is CHECKED — never "Undo failed" because the client gave up.
    const undoRid = s.undoRid || newRequestId()
    const undoArgs = { ...u.args, request_id: undoRid, round: 1 }
    setState(target, { ...s, undoing: true, undoRid, error: undefined })
    let res: ApiResult
    let total = 0
    let rounds = 0
    const touched = new Set<string>()
    try {
      // A large undo runs in rounds (`complete:false` + `remaining`): call again with the same args until done.
      for (;;) {
        res = await api(u.action, { ...undoArgs, round: rounds + 1 }, { timeoutMs: opts.timeoutMs ?? LONG_TIMEOUT_MS })
        if (!res.ok && isUnknownOutcome(res)) {
          const roundArgs = { ...undoArgs, round: rounds + 1 }
          let probe: ApiResult = res
          for (const ms of delays) {
            if (probe.ok || !isUnknownOutcome(probe as AdminErr)) break
            setState(target, { ...s, undoing: true, undoRid, checking: true })
            await sleep(ms)
            try { probe = await api(u.action, roundArgs, { timeoutMs: opts.timeoutMs ?? LONG_TIMEOUT_MS }) } catch { /* keep unknown */ }
          }
          res = probe.ok || !isUnknownOutcome(probe as AdminErr) ? probe
            : { ok: false, code: 'unknown_outcome', retryable: true, error: 'Still no answer, so it is not known whether the Undo went through. "Check again" asks once more — it will never undo twice.' }
        }
        rounds += 1
        if (!res.ok) break
        total += res.changed || 0
        res.touched.forEach((t) => touched.add(t))
        if (res.complete !== false || !res.changed || rounds >= UNDO_MAX_ROUNDS) break
        if (deps.jobs) break // the job manager takes it from here (below)
      }
    }
    catch (e) { res = { ok: false, code: 'client', error: `Something on this screen failed: ${(e as Error).message || 'unknown error'}.`, retryable: true } }
    finally { inflight.delete(target) }
    if (res!.ok && res.complete === false && res.changed && deps.jobs) {
      // A big Undo: continue as a job — "Restoring 400 of 1,200" in the shell, leave the section freely,
      // resume after a reload. The server resumes from any later call with the same args (+ cursor).
      cache.invalidate([...touched])
      const r = res as AdminOk & { restored?: number; total?: number }
      const done = typeof r.restored === 'number' ? r.restored : total
      const jobId = deps.jobs.start({
        action: u.action, args: u.args, label: 'Undoing', past: 'Put back', noun: 'rows',
        initial: { changed: done, remaining: typeof r.remaining === 'number' ? r.remaining : null, cursor: r.cursor },
      })
      const of = typeof r.total === 'number' ? ` of ${r.total.toLocaleString('en-US')}` : ''
      setState(target, { status: 'done', target, args: s.args, undone: true, jobId, undoRid,
        result: { ...res, changed: done, undo: undefined, message: `Undo is running: ${done.toLocaleString('en-US')}${of} restored so far. It keeps going if you leave this screen — follow it in Jobs.` } })
      return res
    }
    if (res!.ok && auditIdOf(u)) deps.undoBus?.emit(auditIdOf(u)!)
    if (res!.ok) {
      cache.invalidate([...touched])
      const message = rounds > 1 ? `${total.toLocaleString('en-US')} rows put back.${res.complete === false ? ` ${(res.remaining ?? 0).toLocaleString('en-US')} still to undo — press Undo again to continue.` : ''}` : (undoSentence(res.message) || 'Undone.')
      const unfinished = res.complete === false
      setState(target, { status: 'done', target, args: s.args, result: { ...res, changed: total, message, undo: unfinished ? u : undefined }, undone: !unfinished })
    } else {
      // The original result stays (its Undo button too); the line says why the Undo failed.
      setState(target, { ...s, undoing: false, checking: false, undoRid, error: res })
    }
    return res
  }

  async function retry(target = '*'): Promise<RunResult | null> {
    const s = states.get(target)
    if (!s || s.status !== 'error') return null
    return run(s.args || {}, target)
  }

  function dismiss(target = '*') { setState(target, IDLE(target)) }

  return {
    run, undo, retry, dismiss,
    state: (target = '*'): ActionState => states.get(target) || IDLE(target),
    isBusy: (target = '*') => inflight.has(target),
  }
}

export type ActionRunner = ReturnType<typeof createActionRunner>
