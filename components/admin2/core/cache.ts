// The admin's ONE data layer (audit §3.4). A tiny cache of query results keyed by string:
//   · stale-while-revalidate: a refetch keeps the old data on screen (`fetching` drives a hairline);
//   · an error KEEPS the last good data and records the error beside it ("couldn't refresh — Retry");
//   · the newest request wins (an older, slower answer never overwrites a newer one);
//   · invalidation happens ONLY through an action's `touched` keys (`invalidate`), by prefix:
//       touched 'held'         → 'held', 'held?sort=new', 'held:…'
//       touched 'company:acme' → 'company:acme', 'company:acme:reports'
//       touched 'company:'     → every 'company:*'
//     nothing else is re-read — never the whole dashboard;
//   · keyset lists: `loadMore` appends the next page; a refresh merges the first page IN PLACE
//     (rows updated where they are, rows that left removed, NEW rows held back as `pending` so the
//     list never re-orders under the owner's finger — the screen says "3 new — show").
//
// Framework-free (React binds to it in ./hooks.tsx) and unit-tested in core.test.mjs.
import type { AdminErr } from '../contract.ts'
import type { ApiResult } from './api.ts'

export type ListPage<Row> = { rows: Row[]; next?: string | null; total?: number | null; as_of?: string }

export type Entry<T = unknown> = {
  data?: T
  error?: AdminErr
  /** 'idle' = never asked; 'loading' = first load in flight (nothing to show yet). */
  status: 'idle' | 'loading' | 'ok' | 'error'
  fetching: boolean
  loadingMore: boolean
  updatedAt: number
  /** The data must be re-read before it is trusted again (an action touched it). */
  stale: boolean
  /** List refresh: rows the server has that the screen has not shown yet. */
  pending?: unknown[]
  /** Bumped on every data write — a rollback only restores entries nobody re-read meanwhile. */
  version: number
}

export type Fetcher<T> = (ctx: { after?: string | null; signal?: AbortSignal }) => Promise<ApiResult<T> | ApiResult<ListPage<unknown>>>

const EMPTY: Entry = Object.freeze({ status: 'idle', fetching: false, loadingMore: false, updatedAt: 0, stale: true, version: 0 }) as Entry

type Registered = { fetcher: Fetcher<unknown>; list: boolean; idOf: (row: unknown) => string }

/** Does query key `key` fall under the touched key `t`? */
export function keyMatches(key: string, t: string): boolean {
  if (!t) return false
  if (key === t) return true
  if (t.endsWith(':')) return key.startsWith(t)
  return key.startsWith(t + ':') || key.startsWith(t + '?') || key.startsWith(t + '|')
}

const defaultIdOf = (row: unknown): string => {
  const r = row as Record<string, unknown> | null
  return r && r.id != null ? String(r.id) : JSON.stringify(row)
}

/**
 * Merge a freshly read FIRST PAGE into the rows on screen without moving anything under the finger.
 * Returns the rows to show and the new rows held back. `complete` = the fresh page is the whole list.
 */
export function mergeListRefresh<Row>(current: Row[], fresh: Row[], opts: { idOf?: (r: Row) => string; complete?: boolean } = {}): { rows: Row[]; pending: Row[] } {
  const idOf = (opts.idOf || defaultIdOf) as (r: Row) => string
  if (!current.length) return { rows: fresh.slice(), pending: [] }
  const freshById = new Map(fresh.map((r) => [idOf(r), r]))
  const currentIds = new Set(current.map(idOf))
  // The window the fresh page covers: up to the last row on screen that the fresh page still has.
  let lastMatch = -1
  current.forEach((r, i) => { if (freshById.has(idOf(r))) lastMatch = i })
  // Nothing on screen survived (everything was decided): the list is simply the fresh page.
  if (lastMatch < 0) return { rows: fresh.slice(), pending: [] }
  const rows: Row[] = []
  const beyond: Row[] = []
  current.forEach((r, i) => {
    const hit = freshById.get(idOf(r))
    if (hit) rows.push(hit)                                    // updated in place
    else if (!opts.complete && i > lastMatch) beyond.push(r)  // past the fresh page: may be on page 2 now
    // else: inside the window and gone → it left the list (decided, deleted)
  })
  // Unseen rows AFTER the last surviving row are the list moving up to fill the gap (page 2 sliding
  // into page 1): they go below what is on screen, never above. Unseen rows before it are genuinely
  // new and wait as `pending` ("3 new — show").
  let lastFresh = -1
  fresh.forEach((r, i) => { if (currentIds.has(idOf(r))) lastFresh = i })
  const pending: Row[] = []
  fresh.forEach((r, i) => {
    if (currentIds.has(idOf(r))) return
    if (i > lastFresh) rows.push(r)
    else pending.push(r)
  })
  const have = new Set(rows.map(idOf))
  for (const r of beyond) if (!have.has(idOf(r))) rows.push(r)
  return { rows, pending }
}

export class QueryCache {
  private entries = new Map<string, Entry>()
  private subs = new Map<string, Set<() => void>>()
  private anySubs = new Set<() => void>()
  private registered = new Map<string, Registered>()
  private seqs = new Map<string, number>()
  private now: () => number

  constructor(opts: { now?: () => number } = {}) { this.now = opts.now || Date.now }

  /** The entry for `key` (a stable empty entry when it was never read — safe for useSyncExternalStore). */
  get<T = unknown>(key: string): Entry<T> {
    return (this.entries.get(key) || EMPTY) as Entry<T>
  }

  keys(): string[] { return [...this.entries.keys()] }

  subscribe(key: string, fn: () => void): () => void {
    let s = this.subs.get(key)
    if (!s) { s = new Set(); this.subs.set(key, s) }
    s.add(fn)
    return () => { s!.delete(fn) }
  }

  /** Every change to any key (the shell's Review badge reads 'overview' through this). */
  subscribeAll(fn: () => void): () => void { this.anySubs.add(fn); return () => { this.anySubs.delete(fn) } }

  hasSubscribers(key: string): boolean { return (this.subs.get(key)?.size || 0) > 0 }

  private set(key: string, patch: Partial<Entry>, bumpVersion = false) {
    const cur = this.get(key)
    const next: Entry = { ...cur, ...patch }
    if (bumpVersion) next.version = cur.version + 1
    this.entries.set(key, next)
    this.subs.get(key)?.forEach((f) => { try { f() } catch { /* ignore */ } })
    this.anySubs.forEach((f) => { try { f() } catch { /* ignore */ } })
  }

  /** Remember how to re-read `key` (the latest fetcher wins). */
  register<T>(key: string, fetcher: Fetcher<T>, opts: { list?: boolean; idOf?: (row: unknown) => string } = {}) {
    this.registered.set(key, { fetcher: fetcher as Fetcher<unknown>, list: !!opts.list, idOf: opts.idOf || defaultIdOf })
  }

  /**
   * Read (or re-read) a key; the newest request wins. `reveal`: the owner asked for this read (his own
   * action's `touched`, a Refresh press), so new list rows are shown at once instead of held back as
   * "N new" — what he caused is never hidden; what changed on its own never jumps in under his finger.
   */
  async fetch(key: string, opts: { reveal?: boolean } = {}): Promise<void> {
    const reg = this.registered.get(key)
    if (!reg) return
    const seq = (this.seqs.get(key) || 0) + 1
    this.seqs.set(key, seq)
    const cur = this.get(key)
    this.set(key, { fetching: true, status: cur.status === 'idle' || (cur.status === 'error' && cur.data === undefined) ? 'loading' : cur.status })
    let res: ApiResult<unknown>
    try { res = await reg.fetcher({}) as ApiResult<unknown> }
    catch (e) { res = { ok: false, code: 'client', error: `Something on this screen failed: ${(e as Error).message || 'unknown error'}.`, retryable: true } }
    if (this.seqs.get(key) !== seq) return // a newer read was started; it decides
    const before = this.get(key)
    if (!res.ok) {
      this.set(key, { fetching: false, error: res, status: before.data === undefined ? 'error' : 'ok' })
      return
    }
    if (reg.list && before.data !== undefined) {
      const page = res as unknown as ListPage<unknown>
      const shown = (before.data as ListPage<unknown>).rows || []
      const merged = mergeListRefresh(shown, page.rows || [], { idOf: reg.idOf, complete: !page.next })
      const prevPending = before.pending || []
      const shownIds = new Set(merged.rows.map(reg.idOf))
      const pending = [...merged.pending, ...prevPending.filter((r) => !shownIds.has(reg.idOf(r)) && !merged.pending.some((p) => reg.idOf(p) === reg.idOf(r)))]
      const keepNext = (before.data as ListPage<unknown>).next !== undefined && shown.length > (page.rows || []).length
        ? (before.data as ListPage<unknown>).next : page.next
      this.set(key, {
        data: { ...page, rows: merged.rows, next: keepNext } as unknown,
        pending, error: undefined, status: 'ok', fetching: false, stale: false, updatedAt: this.now(),
      }, true)
      if (opts.reveal && pending.length) this.showPending(key)
      return
    }
    this.set(key, { data: res as unknown, pending: [], error: undefined, status: 'ok', fetching: false, stale: false, updatedAt: this.now() }, true)
  }

  /** Keyset paging: append the next page after the rows on screen. */
  async loadMore(key: string): Promise<void> {
    const reg = this.registered.get(key)
    const cur = this.get<ListPage<unknown>>(key)
    if (!reg || !reg.list || !cur.data?.next || cur.loadingMore) return
    const seq = this.seqs.get(key) || 0
    this.set(key, { loadingMore: true })
    let res: ApiResult<unknown>
    try { res = await reg.fetcher({ after: cur.data.next }) as ApiResult<unknown> }
    catch (e) { res = { ok: false, code: 'client', error: `Something on this screen failed: ${(e as Error).message || 'unknown error'}.`, retryable: true } }
    if ((this.seqs.get(key) || 0) !== seq) { this.set(key, { loadingMore: false }); return }
    const now = this.get<ListPage<unknown>>(key)
    if (!res.ok) { this.set(key, { loadingMore: false, error: res }); return }
    const page = res as unknown as ListPage<unknown>
    const have = new Set((now.data?.rows || []).map(reg.idOf))
    const rows = [...(now.data?.rows || []), ...(page.rows || []).filter((r) => !have.has(reg.idOf(r)))]
    this.set(key, { data: { ...now.data, rows, next: page.next ?? null, total: page.total ?? now.data?.total } as unknown, loadingMore: false, error: undefined }, true)
  }

  /** Put the held-back new rows on screen (at the top, where the server put them). */
  showPending(key: string) {
    const reg = this.registered.get(key)
    const cur = this.get<ListPage<unknown>>(key)
    if (!reg || !cur.data || !cur.pending?.length) return
    const ids = new Set(cur.pending.map(reg.idOf))
    this.set(key, { data: { ...cur.data, rows: [...cur.pending, ...cur.data.rows.filter((r) => !ids.has(reg.idOf(r)))] }, pending: [] }, true)
  }

  /**
   * An action's `touched` keys: mark every matching entry stale and re-read the ones on screen.
   * Returns the keys it re-read (the tests pin that nothing else is).
   */
  invalidate(touched: readonly string[] | undefined): string[] {
    if (!touched?.length) return []
    const hit = new Set<string>()
    for (const key of new Set([...this.entries.keys(), ...this.registered.keys()])) {
      if (touched.some((t) => keyMatches(key, t))) hit.add(key)
    }
    const refetched: string[] = []
    for (const key of hit) {
      this.set(key, { stale: true })
      if (this.hasSubscribers(key) && this.registered.has(key)) { refetched.push(key); void this.fetch(key, { reveal: true }) }
    }
    return refetched
  }

  /** Replace a key's data directly (an action's returned rows). */
  setData<T>(key: string, updater: (cur: T | undefined) => T) {
    const cur = this.get<T>(key)
    this.set(key, { data: updater(cur.data) as unknown, status: 'ok' }, true)
  }

  /**
   * Start an optimistic change. `patch` edits every entry whose key matches; `rollback` puts back the
   * entries it changed — but only those nobody has re-read since (a fresh read is the truth).
   */
  begin() {
    const saved = new Map<string, { data: unknown; pending?: unknown[]; version: number }>()
    const tx = {
      patch: <T>(match: string | ((key: string) => boolean), fn: (cur: T) => T) => {
        const test = typeof match === 'string' ? (k: string) => keyMatches(k, match) : match
        for (const [key, entry] of this.entries) {
          if (!test(key) || entry.data === undefined) continue
          if (!saved.has(key)) saved.set(key, { data: entry.data, pending: entry.pending, version: 0 })
          this.set(key, { data: fn(entry.data as T) as unknown }, true)
          saved.get(key)!.version = this.get(key).version
        }
      },
      /** Remove rows by id from every matching list entry. */
      removeRows: (match: string, ids: readonly string[]) => {
        const drop = new Set(ids.map(String))
        tx.patch<ListPage<unknown>>(match, (cur) => {
          const reg = [...this.registered.entries()].find(([k]) => keyMatches(k, match))?.[1]
          const idOf = reg?.idOf || defaultIdOf
          return cur && Array.isArray(cur.rows) ? { ...cur, rows: cur.rows.filter((r) => !drop.has(idOf(r))) } : cur
        })
      },
      rollback: () => {
        for (const [key, s] of saved) {
          const now = this.get(key)
          if (now.version !== s.version) continue // re-read or changed again since: leave the newer truth
          this.set(key, { data: s.data, pending: s.pending }, true)
        }
        saved.clear()
      },
      changedKeys: () => [...saved.keys()],
    }
    return tx
  }

  /** Sign-out: nothing from the last session stays on screen. */
  clear() {
    this.entries.clear()
    this.seqs.clear()
    for (const s of this.subs.values()) s.forEach((f) => { try { f() } catch { /* ignore */ } })
    this.anySubs.forEach((f) => { try { f() } catch { /* ignore */ } })
  }
}

export type CacheTx = ReturnType<QueryCache['begin']>
