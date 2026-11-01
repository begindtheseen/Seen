'use client'

// Where the person came from, inside Seen, in this tab (owner 2026-11-01: "smart modern navigation
// where it remembers where you came from").
//
// `components/shell/NavMemory` writes a short trail of the pages visited in this tab (full URL with
// its query, so a search or an open card comes back with it). A "← Back" button then:
//   - goes Back (the browser restores the page as it was) when the previous page is a Seen page, and
//     names it ("Back to results", "Back to Saved");
//   - otherwise — opened from an email, Google, a new tab — goes to a sensible page instead of
//     leaving Seen, which `history.length > 1` / `document.referrer` could not tell apart.

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

const TRAIL_KEY = 'seen_nav_trail_v1'
const LAST_JOBS_KEY = 'seen_last_jobs_v1'
const TRAIL_MAX = 20

export type TrailEntry = { url: string; at: number }

export function readTrail(): TrailEntry[] {
  try { const t = JSON.parse(sessionStorage.getItem(TRAIL_KEY) || '[]'); return Array.isArray(t) ? t : [] } catch { return [] }
}
function writeTrail(t: TrailEntry[]) {
  try { sessionStorage.setItem(TRAIL_KEY, JSON.stringify(t.slice(-TRAIL_MAX))) } catch { /* ignore */ }
}
const pathOf = (url: string) => url.split(/[?#]/)[0]

/**
 * Record a page arrival. Arriving on the page just before the current one is a Back: the current
 * entry is dropped instead of a new one added, so the trail mirrors the history stack.
 */
export function recordArrival(url: string) {
  const t = readTrail()
  const last = t[t.length - 1]
  if (last && pathOf(last.url) === pathOf(url)) { last.url = url; writeTrail(t); return }
  const prev = t[t.length - 2]
  if (prev && pathOf(prev.url) === pathOf(url)) { t.pop(); prev.url = url; writeTrail(t); return }
  t.push({ url, at: Date.now() })
  writeTrail(t)
}

/** Keep the current entry's URL current (a search, filter or open card changed the query). */
export function updateCurrent(url: string) {
  const t = readTrail()
  const last = t[t.length - 1]
  if (last && pathOf(last.url) === pathOf(url)) { last.url = url; writeTrail(t) }
  if (pathOf(url) === '/jobs' && /[?&]q=/.test(url)) {
    try { sessionStorage.setItem(LAST_JOBS_KEY, url.replace(/([?&])job=[^&#]*&?/, '$1').replace(/[?&]$/, '')) } catch { /* ignore */ }
  }
}

/** The person's last job search in this tab (/jobs?q=…), for the Jobs tab — Indeed brings it back. */
export function lastJobsHref(): string {
  try {
    const v = sessionStorage.getItem(LAST_JOBS_KEY) || ''
    return v.startsWith('/jobs?') ? v : '/jobs'
  } catch { return '/jobs' }
}

/** The previous Seen page in this tab, or null when this page was the first one opened. */
export function previousPage(): string | null {
  const t = readTrail()
  return t.length >= 2 ? t[t.length - 2].url : null
}

/** A short name for a Seen page, for "Back to …". */
export function pageLabel(url: string): string {
  const p = pathOf(url)
  if (p === '/jobs') return /[?&]q=/.test(url) ? 'results' : 'jobs'
  if (p.startsWith('/jobs/')) return 'the listing'
  if (p === '/saved') return 'Saved'
  if (p === '/tracker') return 'your tracker'
  if (p === '/dashboard') return 'Dashboard'
  if (p === '/companies') return 'Companies'
  if (p.startsWith('/company/')) {
    try { return decodeURIComponent(p.slice('/company/'.length)).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) } catch { return 'the company' }
  }
  if (p === '/feed') return 'the feed'
  if (p === '/resume' || p.startsWith('/resume/')) return 'Résumé'
  if (p === '/agencies') return 'Agencies'
  if (p === '/') return 'Home'
  return 'the last page'
}

/**
 * A Back action for an in-page "← Back" button. `fallback` is where to go when there is no Seen page
 * behind this one; `fallbackLabel` names it.
 */
export function useBack(fallback: string, fallbackLabel: string) {
  const router = useRouter()
  const [prev, setPrev] = useState<string | null>(null)
  useEffect(() => { setPrev(previousPage()) }, [])
  const go = useCallback(() => {
    if (previousPage()) router.back()
    else router.push(fallback)
  }, [router, fallback])
  return { go, label: prev ? `Back to ${pageLabel(prev)}` : `Back to ${fallbackLabel}`, inApp: !!prev }
}
