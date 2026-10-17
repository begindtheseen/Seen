'use client'

// The ONE way a full-screen overlay (modal, sheet, drawer) is put on screen.
//
// 1. Portal to <body>. `position: fixed` is only relative to the viewport when no ancestor has a
//    transform, filter, backdrop-filter or will-change — and this app wraps pages in animated and
//    blurred containers (.page-full, .rise-in, glass cards). Inside one of those a "fixed" overlay
//    is placed relative to that container instead, so it opened off-screen (admin "Manage
//    accounts", employer listing editor). Rendering at <body> makes the viewport its only parent.
// 2. Lock the page behind it, so the blurred background stays put and the modal stays in view.
//    Ref-counted: a modal opened from another modal keeps the lock until the last one closes.

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

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
  if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`
}

function unlockScroll() {
  if (typeof document === 'undefined' || lockCount === 0) return
  if (--lockCount > 0) return
  const html = document.documentElement
  const body = document.body
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

/** Render an overlay at <body> and lock the page behind it while mounted. */
export default function ModalPortal({ children, lockScroll: lock = true }: { children: ReactNode; lockScroll?: boolean }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  useScrollLock(mounted && lock)
  if (!mounted) return null
  return createPortal(children, document.body)
}
