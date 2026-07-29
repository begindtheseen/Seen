'use client'

// Shared scroll-reveal — the ONE reveal primitive for the whole app (replaces the
// per-page inline IntersectionObserver copies). Renders `.rv` (hidden, shifted
// down); adds `.rv-in` when the element enters the viewport. Styles live in
// app/globals.css; prefers-reduced-motion and missing-IO both reveal instantly.

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'

export default function Reveal({
  children,
  delay = 0,
  className = '',
  style,
}: {
  children: ReactNode
  /** transition-delay in ms — use for stagger within a group */
  delay?: number
  className?: string
  style?: CSSProperties
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced || !('IntersectionObserver' in window)) {
      el.classList.add('rv-in')
      return
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            el.classList.add('rv-in')
            obs.disconnect()
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -48px 0px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={`rv${className ? ' ' + className : ''}`}
      style={delay ? { ...style, transitionDelay: `${delay}ms` } : style}
    >
      {children}
    </div>
  )
}
