'use client'

// Entrance gate for page choreography (hero stages, kinetic headline, count-ups).
// There is no blocking intro any more: the page IS the opening. The gate flips the moment
// the display face is available (cached fonts: immediately; a cold load: at most ~300ms),
// so the first words never rise in a fallback font and the hero starts on the first paint.

import { useEffect, useState } from 'react'

const FONT_WAIT = 300

export function useIntroGate(): boolean {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let done = false
    const go = () => { if (!done) { done = true; setReady(true) } }
    let fontLoad: Promise<unknown> | null = null
    try { fontLoad = document.fonts?.load('800 1em Syne') ?? null } catch { fontLoad = null }
    if (fontLoad && typeof fontLoad.then === 'function') fontLoad.then(go, go)
    const t = setTimeout(go, FONT_WAIT)
    return () => { done = true; clearTimeout(t) }
  }, [])

  return ready
}
