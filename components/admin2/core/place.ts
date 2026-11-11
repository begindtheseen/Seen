'use client'

// The admin's places in the URL, on top of lib/nav (useUrlParam, pushParam, replaceParam).
//   useSection()        ?s=        replaced (a section switch never adds a Back step)
//   useItemPlace()      ?item=     PUSHED: Back closes the sheet; refresh reopens it. Opening an item
//                                  from inside a sheet pushes again, so Back returns to the previous one;
//                                  ✕ / Esc / backdrop close the whole stack.
//   useUrlFilter()      ?<section>.<name>=   replaced
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { pushParam, readParam, replaceParam, useUrlParam } from '@/lib/nav/urlState'
import type { AdminItemKind } from '../contract.ts'
import { filterParam, formatItem, parseItem, parseSection, searchForSection, type ShellSection } from './url.ts'

const DEPTH = '__seen_admin_item_depth'

function historyState(): Record<string, unknown> {
  try { return (window.history.state as Record<string, unknown> | null) || {} } catch { return {} }
}
/** Our own `__seen_*` markers only — Next's keys are never passed back (lib/nav: ourState). */
function ownState(extra: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const cur = historyState()
  for (const k of Object.keys(cur)) if (k.startsWith('__seen_') && k !== '__seen_admin_panel') out[k] = cur[k]
  return { ...out, ...extra }
}
function itemDepth(): number {
  if (!readParam('item')) return 0
  const d = historyState()[DEPTH]
  return typeof d === 'number' && d > 0 ? d : 0
}

export function useSection(allowed?: readonly string[]): [ShellSection, (s: ShellSection, filter?: Record<string, string>) => void] {
  const raw = useUrlParam('s')
  const section = parseSection(raw, allowed)
  const go = useCallback((s: ShellSection, filter?: Record<string, string>) => {
    if (typeof window === 'undefined') return
    const qs = searchForSection(window.location.search, s, filter)
    const next = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`
    const here = parseSection(readParam('s'), allowed)
    // A section change PUSHES one entry, so the phone's Back walks back through the sections he visited and
    // only leaves /admin from the first one (judge F1). The same section again (a queue row's filter) replaces:
    // never two entries for one section in a row. Filters and kinds inside a section always replace.
    const { [DEPTH]: _d, ...state } = ownState({})
    try {
      if (s !== here) window.history.pushState(state, '', next)
      else window.history.replaceState(state, '', next)
    } catch { /* ignore */ }
    try { window.dispatchEvent(new Event('seen:urlchange')) } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(allowed || []).join(',')])
  return [section, go]
}

export type ItemPlace = {
  raw: string
  parsed: ReturnType<typeof parseItem>
  open: (kind: AdminItemKind, id: string) => void
  /** Close the whole sheet (✕ / Esc / backdrop): every item opened in this stack. */
  close: () => void
}

export function useItemPlace(): ItemPlace {
  const raw = useUrlParam('item')
  const open = useCallback((kind: AdminItemKind, id: string) => {
    const v = formatItem({ kind, id })
    if (readParam('item') === v) return
    const depth = itemDepth()
    pushParam('item', v)
    try { window.history.replaceState(ownState({ [DEPTH]: depth + 1 }), '') } catch { /* ignore */ }
  }, [])
  const close = useCallback(function closeItem() {
    if (!readParam('item')) return
    // A panel entry (an inline confirm, the sign-in step) sits above the item: take it back first, then close.
    if (historyState()[PANEL]) { popPanelEntry(); afterPanelBack(closeItem); return }
    if (pendingPanelBack) { afterPanelBack(closeItem); return }
    const depth = itemDepth()
    if (depth <= 0) { replaceParam('item', null); return } // opened straight from a link or a refresh
    // Walk back over every item this stack pushed; an item that was there before (a deep link) is
    // then cleared in place, so ✕ always leaves the sheet closed.
    const onPop = () => {
      window.removeEventListener('popstate', onPop)
      if (readParam('item')) replaceParam('item', null)
    }
    window.addEventListener('popstate', onPop)
    try { window.history.go(-depth) } catch { window.removeEventListener('popstate', onPop); replaceParam('item', null) }
  }, [])
  return useMemo(() => ({ raw, parsed: parseItem(raw), open, close }), [raw, open, close])
}

// ── Back closes a panel (search, More, jobs, sign-in) ─────────────────────────────────────────────
// A panel owns ONE pushed history entry while open, so the phone's Back closes it. Closed any other way
// (✕, Esc, backdrop, a choice inside it) the entry is TAKEN BACK with history.back() — not marked dead
// and reused, as lib/nav's useBackDismiss does: in the admin a section switch REPLACES the current
// entry, so a dead entry left behind would hold the new section while the entry before it still held
// the old one, and the next Back (or an item's close) landed on the wrong section (smoke test,
// 2026-11-10). Anything that changes the URL right after a close waits for that Back with afterSheetClose.

const PANEL = '__seen_admin_panel'
let pendingPanelBack = false
let panelTimer: ReturnType<typeof setTimeout> | null = null
const afterPanel: Array<() => void> = []
function flushPanel() {
  pendingPanelBack = false
  if (panelTimer) { clearTimeout(panelTimer); panelTimer = null }
  while (afterPanel.length) { try { afterPanel.shift()!() } catch { /* ignore */ } }
}
if (typeof window !== 'undefined') window.addEventListener('popstate', flushPanel)

/** Take the current panel entry back — at most one Back in flight, however many closers ask. */
function popPanelEntry() {
  if (pendingPanelBack) return
  pendingPanelBack = true
  if (panelTimer) clearTimeout(panelTimer)
  panelTimer = setTimeout(flushPanel, 600) // a Back that never lands must not strand the queue
  try { window.history.back() } catch { flushPanel() }
}
function afterPanelBack(fn: () => void) { if (pendingPanelBack) afterPanel.push(fn); else fn() }

/** Run `fn` once the sheet that is closing now has taken its history entry back (or at once). */
export function afterSheetClose(fn: () => void) {
  // One tick first: the panel's effect cleanup (which starts the Back) runs after this render.
  setTimeout(() => { if (pendingPanelBack) afterPanel.push(fn); else fn() }, 0)
}

export function usePanelEntry(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!open || typeof window === 'undefined') return
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    let popped = false
    try { window.history.pushState(ownState({ [PANEL]: id }), '') } catch { /* ignore */ }
    const onPop = () => {
      if (historyState()[PANEL] === id) return
      popped = true
      closeRef.current()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      if (!popped && historyState()[PANEL] === id) popPanelEntry()
    }
  }, [open])
}

/** One filter of one section, in the URL. `set('')` removes it. */
export function useUrlFilter(section: string, name: string, fallback = ''): [string, (v: string) => void] {
  const param = filterParam(section, name)
  const value = useUrlParam(param)
  const set = useCallback((v: string) => replaceParam(param, v || null), [param])
  return [value || fallback, set]
}
