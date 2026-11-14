'use client'

/**
 * A start guide's rows are native <details>, closed by default. A link to one (/start/oilfield#watch-out, or to
 * anything inside a row) opens it — and every row around it — and scrolls to it, on load and on a later hash
 * change; not every browser opens a <details> for a fragment by itself. The listings above load after the page,
 * so the row is kept in view while the page settles (until the reader scrolls, taps or types, or 2.5 s pass).
 * Renders nothing.
 */
import { useEffect } from 'react'

const SETTLE_MS = 2500

export default function MenuHash() {
  useEffect(() => {
    let stop: (() => void) | null = null
    const open = () => {
      stop?.()
      let id = ''
      try { id = decodeURIComponent(window.location.hash.slice(1)) } catch { return }
      if (!id) return
      const el = document.getElementById(id)
      if (!el) return
      for (let d: Element | null = el; d; d = d.parentElement) if (d instanceof HTMLDetailsElement) d.open = true
      const pin = () => el.scrollIntoView({ block: 'start' })
      requestAnimationFrame(pin)
      // Re-pin while content above it grows (the listings arrive), until the reader takes over.
      const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => requestAnimationFrame(pin)) : null
      ro?.observe(document.body)
      const done = () => { ro?.disconnect(); clearTimeout(t); for (const e of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) window.removeEventListener(e, done); stop = null }
      const t = setTimeout(done, SETTLE_MS)
      for (const e of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) window.addEventListener(e, done, { passive: true })
      stop = done
    }
    open()
    window.addEventListener('hashchange', open)
    return () => { stop?.(); window.removeEventListener('hashchange', open) }
  }, [])
  return null
}
