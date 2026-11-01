'use client'

// The tab's navigation memory (lib/nav/backTrail.ts + lib/nav/urlState.ts): records each page
// arrival with its full URL and keeps the current entry's query current. Importing urlState here
// installs, on every page, the listener that steps Back over closed popups' entries. Renders nothing.

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { recordArrival, updateCurrent } from '@/lib/nav/backTrail'
import { installBackOverClosedPopups } from '@/lib/nav/urlState'

const here = () => `${window.location.pathname}${window.location.search}`

export default function NavMemory() {
  const pathname = usePathname()

  useEffect(() => { installBackOverClosedPopups() }, [])

  // While Seen is in the background (the employer's site opened over it), entrance animations finish
  // instantly: an iPhone keeps a hidden tab's animations frozen at their first frame, so a popup that
  // opened as the tab was hidden came back as an invisible panel on a dark backdrop — "a black screen,
  // forced to refresh" (owner 2026-11-01). app/motion.css `html.tab-hidden`.
  useEffect(() => {
    const root = document.documentElement
    const sync = () => {
      if (document.visibilityState === 'hidden') { root.classList.add('tab-hidden'); return }
      requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('tab-hidden')))
    }
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) sync() }
    sync()
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('pagehide', () => root.classList.add('tab-hidden'))
    window.addEventListener('pageshow', onShow)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('pageshow', onShow)
    }
  }, [])
  useEffect(() => { recordArrival(here()) }, [pathname])

  useEffect(() => {
    const sync = () => updateCurrent(here())
    // (Stepping over dead popup entries is lib/nav/urlState's own popstate listener.)
    const onPop = () => sync()
    window.addEventListener('popstate', onPop)
    window.addEventListener('seen:urlchange', sync)
    // Searches write their URL with replaceState directly; poll the query cheaply while visible.
    const iv = setInterval(() => { if (document.visibilityState === 'visible') sync() }, 1500)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('seen:urlchange', sync)
      clearInterval(iv)
    }
  }, [])

  return null
}
