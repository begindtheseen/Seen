'use client'

// React bindings for the admin core. Sections use ONLY these to read and write:
//   useAdminQuery / useAdminList — cached reads (stale-while-revalidate, keyset paging, touched-only refresh)
//   useAdminAction               — every button that changes something
//   useAdminJob / useAdminJobs   — "until done" jobs that outlive the section
// See components/admin2/README.md for examples.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { AdminErr } from '../contract.ts'
import type { ApiResult } from './api.ts'
import type { Entry, ListPage } from './cache.ts'
import { createActionRunner, IDLE, type ActionOptions, type ActionState, type ActionRunner } from './action.ts'
import type { Job, JobSpec } from './jobs.ts'
import { getRuntime, type AdminRuntime } from './runtime.ts'

const RuntimeContext = createContext<AdminRuntime | null>(null)

export function AdminRuntimeProvider({ children, runtime }: { children: ReactNode; runtime?: AdminRuntime }) {
  const value = useMemo(() => runtime || getRuntime(), [runtime])
  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>
}

export function useRuntime(): AdminRuntime {
  const rt = useContext(RuntimeContext)
  if (!rt) throw new Error('useRuntime: render inside <AdminRuntimeProvider>')
  return rt
}

/** The typed api call, for adapters: `const api = useApi(); api<MyShape>('action', body)`. */
export function useApi() { return useRuntime().api }

// ── Queries ──────────────────────────────────────────────────────────────────────────────────────

export type QueryOpts = {
  /** Data younger than this is shown without a re-read when the screen mounts. Default 30 s. */
  staleMs?: number
  /** Re-read when the tab regains focus. The shell uses it for Today only. */
  refetchOnFocus?: boolean
  /** false = do not read yet (e.g. nothing typed in a search). */
  enabled?: boolean
}

export type QueryView<T> = {
  data: T | undefined
  /** Latest error. With `data` present it means "couldn't refresh" — the old data is still shown. */
  error: AdminErr | undefined
  /** First load in flight (show a Skeleton). */
  loading: boolean
  /** Any read in flight (show the hairline; data stays on screen). */
  fetching: boolean
  updatedAt: number
  refresh: () => Promise<void>
}

function useEntry<T>(key: string): Entry<T> {
  const { cache } = useRuntime()
  const sub = useCallback((fn: () => void) => cache.subscribe(key, fn), [cache, key])
  const snap = useCallback(() => cache.get<T>(key), [cache, key])
  return useSyncExternalStore(sub, snap, snap)
}

function useRegistered(key: string, fetcher: (ctx: { after?: string | null }) => Promise<ApiResult<unknown>>, list: boolean, idOf: ((row: unknown) => string) | undefined, opts: QueryOpts) {
  const { cache } = useRuntime()
  const ref = useRef(fetcher)
  ref.current = fetcher
  const idRef = useRef(idOf)
  idRef.current = idOf
  const enabled = opts.enabled !== false
  const staleMs = opts.staleMs ?? 30_000
  useEffect(() => {
    if (!enabled) return
    cache.register(key, (ctx) => ref.current(ctx), { list, idOf: idRef.current ? (r) => idRef.current!(r) : undefined })
    const e = cache.get(key)
    if (e.status === 'idle' || e.stale || Date.now() - e.updatedAt > staleMs || (e.error && e.data === undefined)) {
      if (!e.fetching) void cache.fetch(key)
    }
  }, [cache, key, list, enabled, staleMs])
  useEffect(() => {
    if (!enabled || !opts.refetchOnFocus) return
    const onFocus = () => { if (document.visibilityState === 'visible' && !cache.get(key).fetching) void cache.fetch(key) }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus) }
  }, [cache, key, enabled, opts.refetchOnFocus])
}

/**
 * A cached read. `key` names the data (include the filters: 'held?sort=new'); `fetcher` reads it,
 * normally one adapter call: `() => api<AdminOverview>('overview')`.
 */
export function useAdminQuery<T>(key: string, fetcher: () => Promise<ApiResult<T>>, opts: QueryOpts = {}): QueryView<ApiResult<T> & { ok: true }> {
  const { cache } = useRuntime()
  useRegistered(key, fetcher as () => Promise<ApiResult<unknown>>, false, undefined, opts)
  const e = useEntry<ApiResult<T> & { ok: true }>(key)
  return {
    data: e.data,
    error: e.error,
    loading: e.data === undefined && (e.status === 'loading' || e.status === 'idle') && opts.enabled !== false,
    fetching: e.fetching,
    updatedAt: e.updatedAt,
    refresh: useCallback(() => cache.fetch(key, { reveal: true }), [cache, key]),
  }
}

export type ListView<Row> = QueryView<ListPage<Row>> & {
  rows: Row[]
  total: number | null | undefined
  hasMore: boolean
  loadingMore: boolean
  loadMore: () => Promise<void>
  /** New rows the server has that are not on screen yet ("3 new — show"). */
  newCount: number
  showNew: () => void
}

/** A keyset-paged list. `fetchPage({after})` reads one page: `({after}) => api<AdminList<Row>>('list_x', {after, ...filters})`. */
export function useAdminList<Row>(key: string, fetchPage: (ctx: { after?: string | null }) => Promise<ApiResult<ListPage<Row>>>, opts: QueryOpts & { idOf?: (row: Row) => string } = {}): ListView<Row> {
  const { cache } = useRuntime()
  useRegistered(key, fetchPage as (ctx: { after?: string | null }) => Promise<ApiResult<unknown>>, true, opts.idOf as ((r: unknown) => string) | undefined, opts)
  const e = useEntry<ListPage<Row>>(key)
  return {
    data: e.data,
    error: e.error,
    loading: e.data === undefined && (e.status === 'loading' || e.status === 'idle') && opts.enabled !== false,
    fetching: e.fetching,
    updatedAt: e.updatedAt,
    refresh: useCallback(() => cache.fetch(key, { reveal: true }), [cache, key]),
    rows: e.data?.rows || [],
    total: e.data?.total,
    hasMore: !!e.data?.next,
    loadingMore: e.loadingMore,
    loadMore: useCallback(() => cache.loadMore(key), [cache, key]),
    newCount: e.pending?.length || 0,
    showNew: useCallback(() => cache.showPending(key), [cache, key]),
  }
}

// ── Actions ──────────────────────────────────────────────────────────────────────────────────────

export type ActionView = {
  /** Run the action. `target` (a row id, 'bulk', …) scopes the double-tap block and the result line. */
  run: (args?: Record<string, unknown>, target?: string) => ReturnType<ActionRunner['run']>
  state: (target?: string) => ActionState
  busy: (target?: string) => boolean
  undo: (target?: string) => void
  retry: (target?: string) => void
  dismiss: (target?: string) => void
}

/** Every button that changes something. See README "How to write an action". */
export function useAdminAction(action: string, options: ActionOptions = {}): ActionView {
  const { api, cache } = useRuntime()
  const optsRef = useRef(options)
  optsRef.current = options
  const [, setTick] = useState(0)
  const runner = useMemo(() => createActionRunner({
    api, cache, action,
    options: {
      optimistic: (tx, args) => optsRef.current.optimistic?.(tx, args),
      onRows: (rows, c, args) => optsRef.current.onRows?.(rows, c, args),
      onSettled: (res, args) => optsRef.current.onSettled?.(res, args),
      get partialTouched() { return optsRef.current.partialTouched },
      get timeoutMs() { return optsRef.current.timeoutMs },
    },
    onChange: () => setTick((n) => n + 1),
  }), [api, cache, action])
  return useMemo(() => ({
    run: (args = {}, target = '*') => runner.run(args, target),
    state: (target = '*') => runner.state(target) || IDLE(target),
    busy: (target = '*') => runner.isBusy(target),
    undo: (target = '*') => { void runner.undo(target) },
    retry: (target = '*') => { void runner.retry(target) },
    dismiss: (target = '*') => runner.dismiss(target),
  }), [runner])
}

// ── Jobs ─────────────────────────────────────────────────────────────────────────────────────────

/** Every job the manager knows (running, finished, stopped) — re-renders on any change. */
export function useAdminJobs(): Job[] {
  const { jobs } = useRuntime()
  const sub = useCallback((fn: () => void) => jobs.subscribe(fn), [jobs])
  const [ver, setVer] = useState(0)
  useEffect(() => sub(() => setVer((v) => v + 1)), [sub])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => jobs.list(), [jobs, ver])
}

export type JobView = {
  job: Job | undefined
  running: boolean
  /** Start, or focus the one already running (never a second loop). */
  start: () => string
  cancel: () => void
  resume: () => void
  dismiss: () => void
}

/** An "until done" action. The job lives in the shell, so leaving the section does not stop or hide it. */
export function useAdminJob(spec: JobSpec): JobView {
  const { jobs } = useRuntime()
  useAdminJobs() // subscribe
  const specRef = useRef(spec)
  specRef.current = spec
  const job = jobs.byKey(spec.action, spec.args)
  const running = !!job && (job.status === 'running' || job.status === 'cancelling')
  return {
    job, running,
    start: () => jobs.start(specRef.current),
    cancel: () => { if (job) jobs.cancel(job.id) },
    resume: () => { if (job) jobs.resume(job.id) },
    dismiss: () => { if (job) jobs.dismiss(job.id) },
  }
}
