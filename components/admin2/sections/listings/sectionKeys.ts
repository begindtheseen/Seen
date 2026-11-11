'use client'

// Desktop keys for the Listings, Companies, People and System lists (audit §3.8 #9):
//   /      focus this section's search field (instead of the global search)
//   j / k  move focus to the next / previous row's open button
//   Enter  opens the focused row (it is a button — the browser does it)
//   u      undo the last thing this section did, when the server offered an Undo
// Never while typing in a field, never while a sheet is open, only on the section on screen.
import { useEffect, useRef, type RefObject } from 'react'

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.matches?.('input, textarea, select, [contenteditable="true"]') || el.isContentEditable)
}

export function useSectionKeys(opts: {
  active: boolean
  sheetOpen: boolean
  search?: RefObject<HTMLInputElement | null>
  list?: RefObject<HTMLElement | null>
  onUndo?: () => void
}) {
  const ref = useRef(opts)
  ref.current = opts
  useEffect(() => {
    if (!opts.active) return
    const onKey = (e: KeyboardEvent) => {
      const o = ref.current
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
      if (o.sheetOpen || document.querySelector('[role="dialog"][aria-modal="true"]')) return
      if (typing(e.target)) return
      if (e.key === '/' && o.search?.current) { e.preventDefault(); o.search.current.focus(); o.search.current.select(); return }
      if ((e.key === 'j' || e.key === 'k') && o.list?.current) {
        // Each row's title is wrapped in <span data-row-title> inside the Row's open button.
        const btns = [...o.list.current.querySelectorAll<HTMLElement>('[data-row-title]')]
          .map((s) => s.closest('button')).filter((b): b is HTMLButtonElement => !!b)
        if (!btns.length) return
        e.preventDefault()
        const at = btns.findIndex((b) => b === document.activeElement)
        const next = at < 0 ? 0 : Math.min(btns.length - 1, Math.max(0, at + (e.key === 'j' ? 1 : -1)))
        btns[next].focus()
        btns[next].scrollIntoView({ block: 'nearest' })
        return
      }
      if (e.key === 'u' && o.onUndo) { e.preventDefault(); o.onUndo() }
    }
    // Capture phase: the shell's own "/" (global search) runs on the bubble phase and skips a handled key.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [opts.active])
}
