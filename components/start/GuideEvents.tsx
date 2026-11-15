'use client'

/**
 * "Hiring events" on a start guide: the dated events open listings in this field announce (a hiring event, a job
 * fair, walk-in interviews…), soonest first, under the guide's listings. Data: GET /api/jobs?action=hiring_events
 * (lib/server/hiringEvents.js — the hourly-refreshed listings, re-read every 10 minutes, past dates dropped), plus
 * any event a listing on the page announces in its own text. Which events belong is lib/start/listingFilters.js
 * eventBelongs (the guide's positions and exclusions, the chosen position chip), near the chosen place.
 *
 * Shown only when there is at least one event — an empty list of events is not information. Three at first, the rest
 * one tap away. Each row opens the listing (its page shows the event's date, hours, place and how to come).
 */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { Job, PostingEvent } from '@/lib/types'
import { JobCache } from '@/lib/stores/JobCache'
import { eventBelongs } from '@/lib/start/listingFilters.js'
import { eventDateLabel } from '@/lib/jobs/hiringEvents.js'
import { howToCome } from '@/components/jobs/HiringEventNote'
import st from './guide.module.css'

type EventRow = { id: string; title: string; company: string; location: string; roles?: string; event: PostingEvent }
const memo = new Map<string, EventRow[]>()
const FIRST = 3

async function readEvents(loc: string, r: string): Promise<EventRow[] | null> {
  const key = `${loc}|${loc ? r : ''}`
  if (memo.has(key)) return memo.get(key) || []
  try {
    const qs = new URLSearchParams({ action: 'hiring_events' })
    if (loc) { qs.set('loc', loc); qs.set('r', r) }
    const res = await fetch(`/api/jobs?${qs}`, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return null
    const data = await res.json()
    const rows = (Array.isArray(data?.events) ? data.events : []) as EventRow[]
    memo.set(key, rows)
    return rows
  } catch { return null }
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
const place = (e: EventRow) => (e.event.where || e.location || '').replace(/,\s*(United States|USA|US)$/i, '')

export default function GuideEvents({ config, pos, loc, r, listingRows }: {
  config: Record<string, unknown> & { positions: Array<{ id: string; match?: string }> }
  pos: string
  loc: string
  r: string
  listingRows: Job[]
}) {
  const [fromApi, setFromApi] = useState<EventRow[]>([])
  const [all, setAll] = useState(false)

  useEffect(() => {
    let live = true
    readEvents(loc, r).then((rows) => { if (live && rows) setFromApi(rows) })
    return () => { live = false }
  }, [loc, r])
  useEffect(() => { setAll(false) }, [pos, loc, r])

  const events = useMemo(() => {
    const day = today()
    const fromRows: EventRow[] = listingRows
      .filter((j) => j.hiring_event)
      .map((j) => ({ id: String(j.id), title: j.title, company: j.company, location: j.location, event: j.hiring_event as PostingEvent }))
    const seen = new Set<string>()
    return [...fromApi, ...fromRows]
      .filter((e) => e.event && e.event.next >= day && eventBelongs(config, e, pos))
      .filter((e) => { const k = `${e.company}|${e.title}|${e.event.next}`.toLowerCase(); if (seen.has(k) || seen.has(e.id)) return false; seen.add(k); seen.add(e.id); return true })
      .sort((a, b) => (a.event.next < b.event.next ? -1 : a.event.next > b.event.next ? 1 : 0))
  }, [fromApi, listingRows, config, pos])

  if (!events.length) return null
  const list = all ? events : events.slice(0, FIRST)
  return (
    <div className={st.events} data-testid="guide-events">
      <h3 className={st.eventsH}>Hiring events</h3>
      <ul className={st.eventRows}>
        {list.map((e) => (
          <li key={e.id} className={st.row}>
            <Link href={`/jobs/${encodeURIComponent(e.id)}`} prefetch={false} className={st.rowLink}
              onClick={() => JobCache.set({ id: e.id, title: e.title, company: e.company, location: e.location, hiring_event: e.event } as Job)}>
              <span className={`${st.eventDate} tnum`}>{eventDateLabel(e.event)}</span>
              <span className={st.rowMain}>
                <span className={st.rowTitle}>{e.event.label} · {e.company}</span>
                <span className={st.rowMeta}>{[place(e), e.event.time, howToCome(e.event)].filter(Boolean).join(' · ')}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {events.length > FIRST && (
        <button type="button" className={st.textBtn} onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? 'Show fewer' : `Show all ${events.length} events`}
        </button>
      )}
    </div>
  )
}
