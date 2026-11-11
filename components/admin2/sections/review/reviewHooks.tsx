'use client'

// Review's own small hooks, built only on the core's public pieces:
//   useClaimsApi       — the core api pointed at /api/employer-claims (claims live in that endpoint; the
//                        same token, the same 401 → sign-in → replay, the same error sentences)
//   useEndpointAction  — useAdminAction for an api other than the shell's (the same core action runner)
//   useListKeys        — desktop keys for a list: j/k move, Enter opens, a/r decide, x selects, u undoes,
//                        / searches this list. Never while typing, never while a sheet is open.
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createAdminApi, type AdminApi } from '../../core/api.ts'
import { createActionRunner, IDLE, type ActionOptions, type ActionRunner } from '../../core/action.ts'
import { useRuntime, type ActionView } from '../../core/hooks.tsx'
import { tokenStore } from '../../core/runtime.ts'

let claimsApi: AdminApi | null = null

/** The employer-claims endpoint through the core api (one instance per tab, like the shell's). */
export function useClaimsApi(): AdminApi {
  const { gate } = useRuntime()
  return useMemo(() => {
    if (!claimsApi) {
      claimsApi = createAdminApi({
        endpoint: '/api/employer-claims',
        getToken: tokenStore.get,
        reauth: () => (tokenStore.get() ? gate.wait() : Promise.resolve(false)),
      })
    }
    return claimsApi
  }, [gate])
}

/**
 * useAdminAction, for an api other than the shell's admin-stats one: the same core runner, wired to the same
 * job manager, undo bus (a line whose batch was undone elsewhere loses its Undo) and result dock (every
 * result is pinned where the owner is looking) — mirrors core/hooks.tsx useAdminAction.
 */
export function useEndpointAction(api: AdminApi, action: string, options: ActionOptions = {}): ActionView {
  const { cache, jobs, undoBus, dock } = useRuntime()
  const optsRef = useRef(options)
  optsRef.current = options
  const [, setTick] = useState(0)
  const runnerRef = useRef<ActionRunner | null>(null)
  const runner = useMemo(() => createActionRunner({
    api, cache, action,
    options: {
      optimistic: (tx, args) => optsRef.current.optimistic?.(tx, args),
      onRows: (rows, c, args) => optsRef.current.onRows?.(rows, c, args),
      onSettled: (res, args) => optsRef.current.onSettled?.(res, args),
      get partialTouched() { return optsRef.current.partialTouched },
      get timeoutMs() { return optsRef.current.timeoutMs },
    },
    onChange: (target, s) => {
      setTick((n) => n + 1)
      if (!dock || optsRef.current.dock === false) return
      const entry = { key: `${action}:${target}`, state: s, onUndo: () => { void runnerRef.current?.undo(target) }, onRetry: () => { void runnerRef.current?.retry(target) } }
      if ((s.status === 'done' || s.status === 'error') && !s.undoing && !s.undone && !s.checking) dock.set(entry)
      else if (s.status !== 'idle') dock.update(entry)
    },
    jobs,
    undoBus,
  }), [api, cache, jobs, undoBus, dock, action])
  runnerRef.current = runner
  return useMemo(() => ({
    run: (args = {}, target = '*') => runner.run(args, target),
    state: (target = '*') => runner.state(target) || IDLE(target),
    busy: (target = '*') => runner.isBusy(target),
    undo: (target = '*') => { void runner.undo(target) },
    retry: (target = '*') => { void runner.retry(target) },
    dismiss: (target = '*') => runner.dismiss(target),
  }), [runner])
}

export type ListKeyHandlers = {
  /** Keys work only while this list is the one on screen. */
  enabled: boolean
  ids: string[]
  onOpen?: (id: string) => void
  onApprove?: (id: string) => void
  onReject?: (id: string) => void
  onToggle?: (id: string) => void
  onUndo?: () => void
  searchRef?: RefObject<HTMLInputElement | null>
}

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (!!el.matches?.('input, textarea, select, [contenteditable="true"]') || el.isContentEditable)
}

/**
 * Desktop keys for one list. Returns the row under the keyboard cursor (shown with a ring). Listens in
 * the CAPTURE phase so "/" searches this list instead of opening the global search.
 */
export function useListKeys(h: ListKeyHandlers): { cursor: string | null; setCursor: (id: string | null) => void } {
  const [cursor, setCursor] = useState<string | null>(null)
  const ref = useRef(h)
  ref.current = h
  const cursorRef = useRef(cursor)
  cursorRef.current = cursor
  useEffect(() => {
    if (!h.enabled) return
    const onKey = (e: KeyboardEvent) => {
      const cur = ref.current
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
      if (typing(e.target)) {
        if (e.key === 'Escape' && cur.searchRef?.current && e.target === cur.searchRef.current) cur.searchRef.current.blur()
        return
      }
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
      const ids = cur.ids
      const at = cursorRef.current ? ids.indexOf(cursorRef.current) : -1
      const move = (i: number) => {
        const id = ids[Math.max(0, Math.min(ids.length - 1, i))]
        if (!id) return
        setCursor(id)
        requestAnimationFrame(() => {
          const el = document.querySelector(`[data-rowid="${CSS.escape(id)}"]`)
          el?.scrollIntoView({ block: 'nearest' })
        })
      }
      const target = at >= 0 ? ids[at] : null
      switch (e.key) {
        case 'j': e.preventDefault(); move(at + 1); return
        case 'k': e.preventDefault(); move(at < 0 ? 0 : at - 1); return
        case 'Enter': {
          // Enter on a focused button presses that button; only a free Enter opens the row.
          const t = e.target as HTMLElement | null
          if (t && t !== document.body && t.closest('button, a, [role=button]')) return
          if (target && cur.onOpen) { e.preventDefault(); cur.onOpen(target) }
          return
        }
        case 'a': if (target && cur.onApprove) { e.preventDefault(); cur.onApprove(target) } return
        case 'r': if (target && cur.onReject) { e.preventDefault(); cur.onReject(target) } return
        case 'x': if (target && cur.onToggle) { e.preventDefault(); cur.onToggle(target) } return
        case 'u': if (cur.onUndo) { e.preventDefault(); cur.onUndo() } return
        case '/': if (cur.searchRef?.current) { e.preventDefault(); cur.searchRef.current.focus() } return
        default:
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [h.enabled])
  // The cursor follows the list: a decided row's cursor moves to the row that took its place.
  const ids = h.ids
  const prevIds = useRef<string[]>(ids)
  useEffect(() => {
    const prev = prevIds.current
    prevIds.current = ids
    if (!cursor || ids.includes(cursor)) return
    const was = prev.indexOf(cursor)
    const next = prev.slice(was + 1).find((id) => ids.includes(id)) || ids[ids.length - 1] || null
    setCursor(next)
  }, [ids, cursor])
  return { cursor, setCursor }
}
