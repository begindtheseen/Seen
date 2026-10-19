'use client'

// The ONE pointer listener behind every cursor effect in the app (see app/motion.css):
//   .spot — a spotlight that follows the cursor across a card (--mx / --my)
//   .tilt — a card that leans a few degrees toward the cursor (--rx / --ry)
// One passive document listener, throttled to a frame, fine pointers only — phones never
// pay for it. It also mounts the film-grain layer. Mounted once in app/layout.tsx.

import { useEffect } from 'react'

const MAX_TILT = 5 // degrees

export default function MotionLayer() {
  useEffect(() => {
    const fine = window.matchMedia?.('(hover: hover) and (pointer: fine)')
    if (!fine?.matches) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')

    let raf = 0
    let last: PointerEvent | null = null
    let tilted: HTMLElement | null = null

    const flatten = () => {
      if (!tilted) return
      tilted.style.setProperty('--rx', '0deg')
      tilted.style.setProperty('--ry', '0deg')
      tilted.classList.remove('tilting')
      tilted = null
    }

    const apply = () => {
      raf = 0
      const e = last
      last = null
      if (!e) return
      const target = e.target as Element | null
      if (!target || typeof target.closest !== 'function') return

      const spot = target.closest<HTMLElement>('.spot')
      if (spot) {
        const r = spot.getBoundingClientRect()
        spot.style.setProperty('--mx', `${e.clientX - r.left}px`)
        spot.style.setProperty('--my', `${e.clientY - r.top}px`)
      }

      if (reduced?.matches) return
      const tilt = target.closest<HTMLElement>('.tilt')
      if (tilt !== tilted) flatten()
      if (tilt) {
        const r = tilt.getBoundingClientRect()
        const px = (e.clientX - r.left) / r.width - 0.5 // -0.5 … 0.5
        const py = (e.clientY - r.top) / r.height - 0.5
        tilt.style.setProperty('--rx', `${(-py * MAX_TILT * 2).toFixed(2)}deg`)
        tilt.style.setProperty('--ry', `${(px * MAX_TILT * 2).toFixed(2)}deg`)
        tilt.classList.add('tilting')
        tilted = tilt
      }
    }

    const onMove = (e: PointerEvent) => {
      last = e
      if (!raf) raf = requestAnimationFrame(apply)
    }
    // Leaving the tilted card (to anywhere outside it) springs it flat.
    const onOut = (e: PointerEvent) => {
      if (!tilted) return
      const to = e.relatedTarget as Node | null
      if (!to || !tilted.contains(to)) flatten()
    }

    document.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerout', onOut, { passive: true })
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerout', onOut)
      if (raf) cancelAnimationFrame(raf)
      flatten()
    }
  }, [])

  return <div className="grain" aria-hidden="true" />
}
