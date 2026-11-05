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
