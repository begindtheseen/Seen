import { useEffect, useRef, useState } from 'react'

// Tiny requestAnimationFrame count-up. Eases the displayed value toward `target`
// with an ease-out cubic over `duration` ms and returns the current (possibly
// fractional) value — callers format it (round, add %/d, toLocaleString, …).
//
// - `start` (default true): hold until true — lets entrance choreography gate the
//   count (e.g. the hero waits for the intro splash to clear before counting).
// - `delay`: ms to wait after `start` flips before animating.
// - Re-targeting: when `target` changes mid- or post-flight (hero proof card
//   refreshing seed → live figures), it eases from the CURRENT displayed value,
//   never restarting at 0.
//
// Honors prefers-reduced-motion: it snaps straight to the target in its first
// effect, never animating, so the reduced-motion contract ("count-up jumps to
// the final value") holds without any per-caller branching. The initial render is
// 0 on BOTH server and client — reading the media query in the useState
// initializer made the client's first render differ from the server HTML under
// reduced motion (React #418 hydration mismatch on every hero figure).

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function useCountUp(
  target: number,
  { duration = 900, start = true, delay = 0 }: { duration?: number; start?: boolean; delay?: number } = {},
): number {
  const [value, setValue] = useState<number>(0)
  const current = useRef<number>(0)
  const frame = useRef<number | null>(null)

  useEffect(() => {
    if (!start) return
    // Non-finite targets (NaN/Infinity) or reduced motion: show the target as-is.
    if (!Number.isFinite(target) || prefersReducedMotion()) {
      current.current = target
      setValue(target)
      return
    }
    const from = current.current
    if (from === target) return

    let timer: ReturnType<typeof setTimeout> | null = null
    const run = () => {
      const t0 = performance.now()
      const tick = (now: number) => {
        // Clamp from below too: the first rAF timestamp can precede the setTimeout start,
        // which made ease-out go negative and flash "-1%" in the hero gauge.
        const t = Math.max(0, Math.min(1, (now - t0) / duration))
        const eased = 1 - Math.pow(1 - t, 3) // ease-out cubic
        const v = t < 1 ? from + (target - from) * eased : target
        current.current = v
        setValue(v)
        if (t < 1) frame.current = requestAnimationFrame(tick)
      }
      frame.current = requestAnimationFrame(tick)
    }
    if (delay > 0) timer = setTimeout(run, delay)
    else run()

    return () => {
      if (timer) clearTimeout(timer)
      if (frame.current != null) cancelAnimationFrame(frame.current)
    }
  }, [target, duration, start, delay])

  return value
}
