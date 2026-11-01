'use client'

// The ONE way a full-screen overlay (modal, sheet, drawer) is put on screen.
//
// 1. Portal to <body>. `position: fixed` is only relative to the viewport when no ancestor has a
//    transform, filter, backdrop-filter or will-change — and this app wraps pages in animated and
//    blurred containers (.page-full, .rise-in, glass cards). Inside one of those a "fixed" overlay
//    is placed relative to that container instead, so it opened off-screen (admin "Manage
//    accounts", employer listing editor). Rendering at <body> makes the viewport its only parent.
// 2. Lock the page behind it, so the background stays put and the modal stays in view.
// 3. No backdrop-filter on overlays: a live blur over this app's glass cards + animations flickers in
//    Safari. Dim with an opaque-enough color instead, and freeze the page's animations while open.
//    Ref-counted: a modal opened from another modal keeps the lock until the last one closes.

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useBackDismiss } from '@/lib/nav/urlState'

let lockCount = 0
let saved: { htmlOverflow: string; bodyOverflow: string; bodyPaddingRight: string } | null = null

function lockScroll() {
  if (typeof document === 'undefined') return
  if (lockCount++ > 0) return
  const html = document.documentElement
  const body = document.body
  // Keep the layout from jumping when the desktop scrollbar disappears.
  const scrollbar = window.innerWidth - html.clientWidth
  saved = { htmlOverflow: html.style.overflow, bodyOverflow: body.style.overflow, bodyPaddingRight: body.style.paddingRight }
  html.style.overflow = 'hidden'
  body.style.overflow = 'hidden'
  // Freeze the page's own animations behind the overlay (globals.css body.modal-open). Nothing
  // behind a modal needs to move, and every animating frame under a full-screen overlay made Safari
  // recomposite the stacked glass blurs — the background flickered constantly.
  body.classList.add('modal-open')
  // globals.css reserves the gutter (`html{scrollbar-gutter:stable}`), so the layout does not move
  // when the scrollbar goes; padding on top of the reserved gutter would shift the page left.
  const gutterKept = (getComputedStyle(html) as CSSStyleDeclaration & { scrollbarGutter?: string }).scrollbarGutter?.includes('stable')
  if (scrollbar > 0 && !gutterKept) body.style.paddingRight = `${scrollbar}px`
}

function unlockScroll() {
  if (typeof document === 'undefined' || lockCount === 0) return
  if (--lockCount > 0) return
  const html = document.documentElement
  const body = document.body
  body.classList.remove('modal-open')
  if (saved) {
    html.style.overflow = saved.htmlOverflow
    body.style.overflow = saved.bodyOverflow
    body.style.paddingRight = saved.bodyPaddingRight
  }
  saved = null
}

/** Lock page scroll while `active` is true (for overlays that already portal themselves). */
export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return
    lockScroll()
    return unlockScroll
  }, [active])
}

const noop = () => {}

/**
 * Render an overlay at <body> and lock the page behind it while mounted. `onBack`: the phone's Back
 * (and the browser's) closes this overlay instead of leaving the page — pass the overlay's own close.
 * Leave it out for a step that must be answered, or an overlay whose open state lives in the URL.
 */
export default function ModalPortal({ children, lockScroll: lock = true, onBack }: { children: ReactNode; lockScroll?: boolean; onBack?: () => void }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  useScrollLock(mounted && lock)
  useBackDismiss(mounted && !!onBack, onBack || noop)
  if (!mounted) return null
  return createPortal(children, document.body)
}
