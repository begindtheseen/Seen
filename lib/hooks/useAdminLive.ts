'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { notify, type NotifySeverity } from '@/lib/notify'

// The real-time engine for the admin dashboard (Seen Live). Polls the cheap `recent_events`
// cursor action every POLL_MS, pops a toast + prepends to the activity feed for each NEW event,
// and refreshes the heavy stats (via `reload`) only when something actually changed — so KPIs
// update on their own without a manual refresh, and notifications fire the moment things happen.
//
// The FIRST poll only primes the cursor (server_time) and does NOT toast, so opening the
// dashboard never replays a backlog of old events as fake "new" notifications.

export type LiveEvent = {
  id: string
  type: 'report' | 'application' | 'purchase' | 'flag' | 'signup'
  sev: 'blue' | 'green' | 'money' | 'amber' | 'violet'
  at: string
  title: string
  sub?: string
}

const POLL_MS = 8000
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
  const reloadRef = useRef(reload)
  reloadRef.current = reload

  const markRead = useCallback(() => setUnread(0), [])

  useEffect(() => {
    if (!token) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null

    async function poll() {
      try {
        const res = await fetch('/api/admin-stats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token as string },
          body: JSON.stringify({ action: 'recent_events', since: cursor.current }),
        })
        if (!res.ok) { if (alive) setLive(false); return }
        const data = await res.json()
        if (!alive) return
        setLive(true)
        cursor.current = data.server_time || cursor.current
        const incoming: LiveEvent[] = Array.isArray(data.events) ? data.events : []
        const fresh = incoming.filter(e => e && e.id && !seen.current.has(e.id))
        fresh.forEach(e => seen.current.add(e.id))

        if (!primed.current) { primed.current = true; return } // first poll: cursor only
        if (fresh.length) {
          // Newest-first into the feed; oldest-first for toasts so they read chronologically.
          setEvents(prev => [...fresh, ...prev].slice(0, FEED_CAP))
          setUnread(u => u + fresh.length)
          ;[...fresh].reverse().forEach(e =>
            notify({ title: e.title, sub: e.sub, severity: toNotifySev(e.sev), key: e.id, duration: e.sev === 'money' ? 8000 : 5000 }),
          )
          reloadRef.current() // refresh KPIs now that state changed
        }
      } catch { if (alive) setLive(false) }
      finally { if (alive) timer = setTimeout(poll, POLL_MS) }
    }
    poll()
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [token])

  return { events, unread, markRead, live }
}
