'use client'

// Rolling digits (split-flap / odometer). Every digit is a column of 0–9 that slides to the
// target with a spring; columns settle left to right (the `.odo-*` rules in app/motion.css).
// Rolls from 0 on mount (or when `start` flips true) and re-rolls from the current digits
// whenever `value` changes, so live-refreshed figures move instead of flashing.
// Screen readers get the plain number; prefers-reduced-motion snaps straight to it.

import { useEffect, useState, type CSSProperties } from 'react'

const ROW = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']

type Props = {
  value: number
  prefix?: string
  suffix?: string
  /** Hold at 0 until true (gate on an intro / reveal). */
  start?: boolean
  /** ms to wait after `start` before rolling. */
  delay?: number
  /** Left-pad with zeros to this many digits. */
  minDigits?: number
  className?: string
  style?: CSSProperties
}

export default function Odometer({ value, prefix, suffix, start = true, delay = 0, minDigits = 1, className = '', style }: Props) {
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!start) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced) { setArmed(true); return }
    let raf = 0
    // One frame after mount, so the columns transition from 0 instead of rendering at the target.
    const t = setTimeout(() => { raf = requestAnimationFrame(() => setArmed(true)) }, delay)
    return () => { clearTimeout(t); if (raf) cancelAnimationFrame(raf) }
  }, [start, delay])

  const n = Math.max(0, Math.round(Number.isFinite(value) ? value : 0))
  const digits = String(n).padStart(Math.max(1, minDigits), '0').split('')

  return (
    <span className={`odo${className ? ' ' + className : ''}`} style={style}>
      <span className="odo-sr">{prefix}{n}{suffix}</span>
      {prefix ? <span className="odo-s" aria-hidden="true">{prefix}</span> : null}
      {digits.map((d, c) => (
        <span key={`${digits.length}-${c}`} className="odo-d" aria-hidden="true">
          <span className="odo-r" style={{ '--n': armed ? Number(d) : 0, '--c': c } as CSSProperties}>
            {ROW.map(x => <span key={x}>{x}</span>)}
          </span>
        </span>
      ))}
      {suffix ? <span className="odo-s" aria-hidden="true">{suffix}</span> : null}
    </span>
  )
}
