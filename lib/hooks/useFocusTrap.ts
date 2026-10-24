'use client'

import { useEffect, type RefObject } from 'react'

// THE focus trap for every modal surface (phone nav drawer, CompanyScoreModal, CreditConfirmDialog,
// ApplyOptimizeModal, JobDetailDrawer, the ⌘K palette). Audit 2026-10-24: `role="dialog" aria-modal`
// was declared everywhere but Tab walked out of the drawer into the page behind it, and closing the
// palette dropped focus on <body> instead of the "Jump to…" pill that opened it.
//
// While `active`:
//   - focus moves into the container (`initialFocus` → first tabbable → the container itself);
//   - Tab / Shift+Tab cycle inside the container; focus that lands outside is pulled back;
//   - on deactivation (close or unmount) focus returns to the element that was focused when the trap
//     engaged — the opener — if it is still in the document.
// Escape stays with the caller: every dialog already closes on Escape through its own handler.

// Focus that lands here has escaped the dialog into the page. Focus inside ANOTHER overlay (a dialog
// stacked on top of this one, portaled to <body>) is not reclaimed — that dialog owns it now.
const PAGE = 'main, nav, footer, [class*="TabBar"]'
const inPage = (el: Element | null) => !!el && !!el.closest(PAGE)

const TABBABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
  'textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

function tabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(el => {
    if (el.hasAttribute('inert') || el.closest('[inert]')) return false
    if (el.getAttribute('aria-hidden') === 'true') return false
    const cs = window.getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return false
    return el.getClientRects().length > 0
  })
}

export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  opts: { initialFocus?: RefObject<HTMLElement | null>; returnFocus?: boolean } = {},
): void {
  const { initialFocus, returnFocus = true } = opts
  useEffect(() => {
    if (!active) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    let raf = 0

    const focusInto = () => {
      const root = ref.current
      if (!root) return
      if (root.contains(document.activeElement)) return
      const first = initialFocus?.current ?? tabbables(root)[0]
      if (first) { first.focus(); return }
      if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1')
      root.focus()
    }
    // A few frames later: dialogs that slide in are still `inert`/off-screen on the open render, and a
    // ModalPortal mounts its children one render after the hook's first effect (ref is null until then).
    let tries = 0
    const arm = () => {
      if (!ref.current && tries++ < 20) { raf = requestAnimationFrame(arm); return }
      focusInto()
    }
    raf = requestAnimationFrame(arm)

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const root = ref.current
      if (!root) return
      const list = tabbables(root)
      if (list.length === 0) { e.preventDefault(); root.focus(); return }
      const first = list[0]
      const last = list[list.length - 1]
      const current = document.activeElement
      if (!root.contains(current)) {
        if (!inPage(current) && current !== document.body) return // another overlay has focus
        e.preventDefault(); (e.shiftKey ? last : first).focus(); return
      }
      if (e.shiftKey && current === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && current === last) { e.preventDefault(); first.focus() }
    }
    const onFocusIn = (e: FocusEvent) => {
      const root = ref.current
      if (!root || root.contains(e.target as Node)) return
      if (!inPage(e.target as Element)) return // another overlay has focus
      focusInto()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('focusin', onFocusIn)
      if (returnFocus && opener && opener.isConnected) opener.focus()
    }
  }, [ref, active, initialFocus, returnFocus])
}
