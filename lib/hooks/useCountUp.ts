import { useEffect, useRef, useState } from 'react'

// Tiny requestAnimationFrame count-up. Animates 0 → `target` with an ease-out cubic
// over `duration` ms and returns the current (possibly fractional) value — callers
// format it (round, add %/d, toLocaleString, …). Re-runs when `target` changes.
//
// Honors prefers-reduced-motion: it initializes at and snaps straight to the target,
// never animating, so the reduced-motion contract ("count-up jumps to the final
// value") holds without any per-caller branching.

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function useCountUp(target: number, { duration = 900 }: { duration?: number } = {}): number {
  const [value, setValue] = useState<number>(() => (prefersReducedMotion() ? target : 0))
  const frame = useRef<number | null>(null)

  useEffect(() => {
    // Non-finite targets (NaN/Infinity) or reduced motion: show the target as-is.
    if (!Number.isFinite(target) || prefersReducedMotion()) {
      setValue(target)
      return
    }

    const start = performance.now()
    const from = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3) // ease-out cubic
      if (t < 1) {
        setValue(from + (target - from) * eased)
        frame.current = requestAnimationFrame(tick)
      } else {
        setValue(target) // land exactly on the target on the final frame
      }
    }
    frame.current = requestAnimationFrame(tick)

    return () => {
      if (frame.current != null) cancelAnimationFrame(frame.current)
    }
  }, [target, duration])

  return value
}
