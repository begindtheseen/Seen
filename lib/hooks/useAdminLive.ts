'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { notify, type NotifySeverity } from '@/lib/notify'

// The real-time engine for the admin dashboard (Seen Live). It is INSTANT: the server broadcasts
// a tiny "activity" ping to the Supabase Realtime channel `seen-live` the moment anything happens
// (report, employer sale, flag, …), and this hook reacts in <1s — fetching the authenticated
// details from the cheap `recent_events` cursor endpoint, popping a toast, prepending to the feed,
// and refreshing KPIs. A slow fallback poll (every FALLBACK_MS) is only a safety net for the rare
// case Realtime is unreachable, so an event is never lost.
//
// The FIRST fetch only primes the cursor and does NOT toast, so opening the dashboard never
// replays a backlog of old events as fake "new" notifications.

export type LiveEvent = {
  id: string
  type: 'report' | 'application' | 'purchase' | 'flag' | 'signup' | 'claim' | 'listing_dispute' | 'reddit_dispute'
  sev: 'blue' | 'green' | 'money' | 'amber' | 'violet'
  at: string
  title: string
  sub?: string
}

const LIVE_TOPIC = 'seen-live'
const FALLBACK_MS = 12000
const FEED_CAP = 60

const toNotifySev = (sev: LiveEvent['sev']): NotifySeverity =>
  sev === 'money' ? 'money' : sev === 'amber' ? 'warn' : sev === 'green' ? 'success' : 'info'

export function useAdminLive(token: string | null, reload: () => void) {
  const [events, setEvents] = useState<LiveEvent[]>([])
  const [unread, setUnread] = useState(0)
  const [live, setLive] = useState(false)
  const cursor = useRef<string | null>(null)
  const primed = useRef(false)
  const seen = useRef<Set<string>>(new Set())
  const inflight = useRef(false)
  const reloadRef = useRef(reload)
  reloadRef.current = reload

  const markRead = useCallback(() => setUnread(0), [])

  useEffect(() => {
    if (!token) return
    let alive = true
    let interval: ReturnType<typeof setInterval> | null = null
    let debounce: ReturnType<typeof setTimeout> | null = null

    async function poll() {
      if (!alive || inflight.current) return
      inflight.current = true
      try {
        const res = await fetch('/api/admin-stats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token as string },
          body: JSON.stringify({ action: 'recent_events', since: cursor.current }),
        })
        if (!res.ok) return
        const data = await res.json()
        if (!alive) return
        cursor.current = data.server_time || cursor.current
        const incoming: LiveEvent[] = Array.isArray(data.events) ? data.events : []
        const fresh = incoming.filter(e => e && e.id && !seen.current.has(e.id))
        fresh.forEach(e => seen.current.add(e.id))
        if (!primed.current) { primed.current = true; return }
        if (fresh.length) {
          setEvents(prev => [...fresh, ...prev].slice(0, FEED_CAP))
          setUnread(u => u + fresh.length)
          ;[...fresh].reverse().forEach(e =>
            notify({ title: e.title, sub: e.sub, severity: toNotifySev(e.sev), key: e.id, duration: e.sev === 'money' ? 8000 : 5000 }),
          )
          reloadRef.current()
        }
      } catch { /* fallback poll will retry */ }
      finally { inflight.current = false }
    }

    // Instant path: broadcast ping → immediate (debounced) fetch.
    // Wrapped in try/catch because iOS WebKit throws a SYNCHRONOUS SecurityError
    // from `new WebSocket()` when the socket is blocked (CSP, Lockdown Mode, …) —
    // an unhandled throw here unmounts the whole dashboard to the Next.js
    // "Application error" screen. Realtime is an enhancement: on failure we stay
    // on the fallback poll below and the feed still works, just slower.
    let channel: ReturnType<typeof supabase.channel> | null = null
    try {
      channel = supabase
        .channel(LIVE_TOPIC)
        .on('broadcast', { event: 'activity' }, () => {
          if (debounce) clearTimeout(debounce)
          debounce = setTimeout(() => poll(), 250)
        })
        .subscribe((status) => { if (alive) setLive(status === 'SUBSCRIBED') })
    } catch {
      channel = null // fallback poll keeps the feed alive
    }

    poll() // prime cursor now
    interval = setInterval(poll, FALLBACK_MS) // safety net only

    return () => {
      alive = false
      if (interval) clearInterval(interval)
      if (debounce) clearTimeout(debounce)
      if (channel) { try { supabase.removeChannel(channel) } catch { /* socket never opened */ } }
    }
  }, [token])

  return { events, unread, markRead, live }
}
