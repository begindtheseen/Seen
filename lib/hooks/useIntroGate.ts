'use client'

// Splash→page handoff. Returns true once the intro splash has cleared (or was
// skipped), so entrance animations start exactly as the splash dissolves instead
// of playing invisibly behind it. IntroSplash sets window.__seenIntroDone and
// dispatches 'seen:intro-done' in both its show and skip paths; a safety timeout
// guarantees the page can never be held hostage if neither happens.

import { useEffect, useState } from 'react'

declare global {
  interface Window { __seenIntroDone?: boolean }
}

export function useIntroGate(): boolean {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (window.__seenIntroDone) { setReady(true); return }
    let timer: ReturnType<typeof setTimeout> | null = null
    const on = () => {
      if (timer) clearTimeout(timer)
      setReady(true)
    }
    window.addEventListener('seen:intro-done', on, { once: true })
    timer = setTimeout(on, 4200) // safety net — never block the page
    return () => {
      window.removeEventListener('seen:intro-done', on)
      if (timer) clearTimeout(timer)
    }
  }, [])

  return ready
}
