'use client'

// "Remembers where you came from" navigation (owner, 2026-11-01: "be more like Indeed").
//
// Two small tools every page shares:
//
// 1. URL-backed places. An open job, an open application card, a tab — anything a person thinks of
//    as "where I was" — lives in ONE query parameter (Indeed's ?vjk=). Opening one with `pushParam`
//    adds a history entry, so the phone's Back closes it instead of leaving the page; leaving for
//    another page and pressing Back lands on the same URL, and the page reopens it from the param.
//    `replaceParam` changes the param without a new entry (a tab switch, a filter).
//    Next.js 15 patches history.pushState/replaceState, so its router (and useSearchParams) stays in
//    step with these calls.
//
// 2. Scroll memory. A list that renders after its data arrives (search results, the tracker) is
//    empty when the browser tries to restore the scroll on Back, so the position is lost. Each page
//    saves its own position per URL in sessionStorage and puts it back once its rows are on screen.
//
// Everything is per tab (sessionStorage) and wrapped in try/catch: a private window or blocked
// storage only loses the memory, never the page.

import { useEffect, useState, useCallback, useRef } from 'react'

const EVT = 'seen:urlchange'

// A history.back() we started has not landed yet (it is async). Anything that would push a new entry
// meanwhile (a popup opening as the drawer closes) waits for it, or the Back would undo the push.
let pendingBack = false
let pendingTimer: ReturnType<typeof setTimeout> | null = null
const afterBack: Array<() => void> = []
function flushBack() {
  pendingBack = false
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null }
  while (afterBack.length) { try { afterBack.shift()!() } catch { /* ignore */ } }
}
if (typeof window !== 'undefined') window.addEventListener('popstate', flushBack)
function goBack() {
  pendingBack = true
  if (pendingTimer) clearTimeout(pendingTimer)
  pendingTimer = setTimeout(flushBack, 600) // a Back that never fires (no entry) must not strand the queue
  window.history.back()
}
/** Run fn now, or right after a Back this module started has landed. */
export function afterPendingBack(fn: () => void) {
  if (pendingBack) afterBack.push(fn)
  else fn()
}

function emit() {
  try { window.dispatchEvent(new Event(EVT)) } catch { /* ignore */ }
}

/** The current value of one query parameter ('' when absent). */
export function readParam(name: string): string {
  if (typeof window === 'undefined') return ''
  try { return new URLSearchParams(window.location.search).get(name) || '' } catch { return '' }
}

function urlWith(name: string, value: string | null): string {
  const u = new URL(window.location.href)
  if (value) u.searchParams.set(name, value)
  else u.searchParams.delete(name)
  const qs = u.searchParams.toString()
  return `${u.pathname}${qs ? `?${qs}` : ''}${u.hash}`
}

function same(next: string): boolean {
  return next === `${window.location.pathname}${window.location.search}${window.location.hash}`
}

// Our own history markers (`__seen_<param>`), carried across replaces. Next's internal keys are NOT
// passed back in: its patched push/replace copies them itself and only syncs its router when the
// state we hand it lacks them (a state carrying `__NA` is treated as Next's own call and skipped).
function ourState(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  try {
    const cur = window.history.state as Record<string, unknown> | null
    if (cur) for (const k of Object.keys(cur)) if (k.startsWith('__seen_')) out[k] = cur[k]
  } catch { /* ignore */ }
  return { ...out, ...extra }
}

/** Open a place: set the param with a NEW history entry (Back undoes it). */
export function pushParam(name: string, value: string) {
  if (typeof window === 'undefined') return
  const next = urlWith(name, value)
  if (same(next)) return
  saveScroll() // the entry we are leaving keeps its position
  // The new entry says it was opened from this page, so closing it can simply go Back.
  try { pushEntry({ [`__seen_${name}`]: 1 }, next) } catch { /* ignore */ }
  emit()
}

/** Change or clear the param in place (no new history entry). */
export function replaceParam(name: string, value: string | null) {
  if (typeof window === 'undefined') return
  const next = urlWith(name, value)
  if (same(next)) return
  try { window.history.replaceState(ourState(), '', next) } catch { /* ignore */ }
  emit()
}

/**
 * Replace the page's query string with `qs` (no leading "?", '' for none) while keeping any open
 * place (?job=, ?app=) and our history markers — a search or filter change must not close the job
 * that is open over the list, nor turn its "Back closes it" entry into one that leaves the page.
 */
export function replaceSearchKeepingPlaces(qs: string) {
  if (typeof window === 'undefined') return
  const cur = new URLSearchParams(window.location.search)
  const p = new URLSearchParams(qs)
  for (const k of PLACE_PARAMS) { const v = cur.get(k); if (v) p.set(k, v) }
  const q = p.toString()
  const next = `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash}`
  if (same(next)) return
  try { window.history.replaceState(ourState(), '', next) } catch { /* ignore */ }
}

/**
 * Close a place that was opened with pushParam: go Back when the entry before this one is the same
 * page without the param (so the history does not grow a "closed" entry and the next Back leaves the
 * page as expected); otherwise — the page was opened straight on the param, e.g. from a link — clear
 * it in place.
 */
export function closeParam(name: string, openedHere: boolean) {
  if (typeof window === 'undefined' || !readParam(name)) return
  if (openedHere) { try { goBack(); return } catch { /* fall through */ } }
  replaceParam(name, null)
}

/** The live value of one query parameter, following Back/Forward and this module's own changes. */
export function useUrlParam(name: string): string {
  const [value, setValue] = useState('')
  useEffect(() => {
    const sync = () => setValue(readParam(name))
    sync()
    window.addEventListener('popstate', sync)
    window.addEventListener(EVT, sync)
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener(EVT, sync) }
  }, [name])
  return value
}

/**
 * A URL-backed place with an "opened here" memory: open() pushes, close() goes Back when this page
 * pushed the entry, else clears the param. Returns the current value ('' = closed).
 */
export function useUrlPlace(name: string) {
  const value = useUrlParam(name)
  const open = useCallback((v: string) => {
    if (!v) return
    if (readParam(name)) replaceParam(name, v) // switching item: no extra Back step
    else pushParam(name, v)
  }, [name])
  const close = useCallback(() => {
    let openedHere = false
    try { openedHere = !!(window.history.state && (window.history.state as Record<string, unknown>)[`__seen_${name}`]) } catch { /* ignore */ }
    closeParam(name, openedHere)
  }, [name])
  return { value, open, close }
}

// ── Scroll memory ──────────────────────────────────────────────────────────────────────────────

const SCROLL_KEY = 'seen_scroll_v1'
const SCROLL_MAX = 30

function scrollKey(): string {
  // The place params (an open item) do not change where the list behind it was scrolled.
  try {
    const u = new URL(window.location.href)
    for (const p of PLACE_PARAMS) u.searchParams.delete(p)
    const qs = u.searchParams.toString()
    return `${u.pathname}${qs ? `?${qs}` : ''}`
  } catch { return window.location.pathname }
}

/** Params that name an open item over a list — ignored by scroll memory. */
export const PLACE_PARAMS = ['job', 'app', 'co']

function readScrolls(): Record<string, { y: number; t: number }> {
  try { return JSON.parse(sessionStorage.getItem(SCROLL_KEY) || '{}') || {} } catch { return {} }
}

/** Remember the current scroll position for the current URL. */
export function saveScroll() {
  if (typeof window === 'undefined') return
  try {
    const all = readScrolls()
    all[scrollKey()] = { y: Math.round(window.scrollY), t: Date.now() }
    const keys = Object.keys(all)
    if (keys.length > SCROLL_MAX) {
      keys.sort((a, b) => all[a].t - all[b].t).slice(0, keys.length - SCROLL_MAX).forEach(k => { delete all[k] })
    }
    sessionStorage.setItem(SCROLL_KEY, JSON.stringify(all))
  } catch { /* ignore */ }
}

/** The saved position for the current URL, or null. */
export function savedScroll(): number | null {
  if (typeof window === 'undefined') return null
  const hit = readScrolls()[scrollKey()]
  return hit && Number.isFinite(hit.y) ? hit.y : null
}

/**
 * Keep this page's scroll position in memory while it is open (on scroll, on leaving, and before an
 * internal link is followed) and put it back once `ready` turns true (the rows are rendered).
 * Restores once per mount; a page the person scrolled before the data arrived is left alone.
 */
export function useScrollMemory(ready: boolean) {
  const [restored, setRestored] = useState(false)
  // Nothing is saved until the restore has had its chance: the router's scroll-to-top on arrival
  // would otherwise overwrite the position we came back for with 0.
  const armed = useRef(false)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null
    const save = () => { if (armed.current) saveScroll() }
    const onScroll = () => { if (t) return; t = setTimeout(() => { t = null; save() }, 200) }
    // A link click saves before the route changes (the next page's scroll would overwrite it).
    const onClick = (e: MouseEvent) => { if ((e.target as Element | null)?.closest?.('a[href]')) save() }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('pagehide', save)
    document.addEventListener('click', onClick, true)
    return () => {
      if (t) clearTimeout(t)
      save() // an in-app route change unmounts the page: keep where it was
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('pagehide', save)
      document.removeEventListener('click', onClick, true)
    }
  }, [])
  useEffect(() => {
    if (!ready || restored) return
    setRestored(true)
    const y = savedScroll()
    if (y == null || y < 40 || window.scrollY > 40) { armed.current = true; return }
    // Two frames: the rows have laid out.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior })
      armed.current = true
    }))
  }, [ready, restored])
}

// ── Back closes the popup ───────────────────────────────────────────────────────────────────────
//
// A popup owns one history entry while open (same URL, marker `__seen_overlay`), so the phone's Back
// closes it. Closed any other way (✕, scrim, Esc, a button — possibly one that also navigates), the
// entry is not taken back with history.back(): that races a navigation started in the same tap and
// could undo it. It is marked DEAD in place instead, and Back steps over dead entries:
//   · arriving on a dead entry (or a popup entry whose popup is gone) goes one further step back;
//   · leaving a dead entry for the same URL (nothing visible changed) goes one further step back;
//   · the next popup or place opened on a dead entry reuses it instead of stacking another.
// So one Back press is always one visible step.

const liveOverlays = new Set<string>()
let onDeadHref = ''

function stateOf(): Record<string, unknown> | null {
  try { return window.history.state as Record<string, unknown> | null } catch { return null }
}
function hereHref() { return `${window.location.pathname}${window.location.search}${window.location.hash}` }

/** The current entry is a dead popup entry, or a popup entry whose popup is gone. */
export function isStaleOverlayEntry(): boolean {
  const st = stateOf()
  if (!st) return false
  if (st.__seen_dead) return true
  const id = st.__seen_overlay
  return typeof id === 'string' && !liveOverlays.has(id)
}

function markDead() {
  try {
    const { __seen_overlay: _o, ...rest } = ourState()
    window.history.replaceState({ ...rest, __seen_dead: 1 }, '')
    onDeadHref = hereHref()
  } catch { /* ignore */ }
}

let installed = false
/** Install (once) the listener that steps Back over closed popups' entries. NavMemory calls it on load. */
export function installBackOverClosedPopups() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('popstate', () => {
    const leftDead = onDeadHref
    onDeadHref = ''
    if (isStaleOverlayEntry()) { try { window.history.back() } catch { /* ignore */ } return }
    if (leftDead && leftDead === hereHref()) {
      try { window.history.back() } catch { /* ignore */ }
    }
  })
}

/** Add an entry for a popup/place — or reuse the current one when it is dead. */
function pushEntry(data: Record<string, unknown>, url?: string) {
  const stale = isStaleOverlayEntry()
  onDeadHref = ''
  // Markers that describe THIS entry's popup stay with it; place markers ride along.
  const { __seen_dead: _d, __seen_overlay: _o, ...rest } = ourState()
  if (stale) window.history.replaceState({ ...rest, ...data }, '', url)
  else window.history.pushState({ ...rest, ...data }, '', url)
}

/**
 * While `open`, the phone's Back (and the browser's) closes this popup instead of leaving the page.
 */
export function useBackDismiss(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!open || typeof window === 'undefined') return
    installBackOverClosedPopups()
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
    let pushed = false
    let popped = false
    let cancelled = false
    const isOurs = () => stateOf()?.__seen_overlay === id
    afterPendingBack(() => {
      if (cancelled) return
      try { pushEntry({ __seen_overlay: id }); pushed = true; liveOverlays.add(id) } catch { /* ignore */ }
    })
    const onPop = () => {
      if (!pushed || popped || isOurs()) return
      popped = true
      closeRef.current()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      cancelled = true
      liveOverlays.delete(id)
      window.removeEventListener('popstate', onPop)
      if (pushed && !popped && isOurs()) markDead()
    }
  }, [open])
}
