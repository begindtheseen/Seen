'use client'

/**
 * "Hiring events" on a start guide, soonest first, under the guide's listings. Three kinds of row:
 *  - an event an open listing in this field announces (a hiring event, a job fair, walk-in interviews…) — opens the
 *    listing (its page shows the event's date, hours, place and how to come);
 *  - a state workforce job fair (a state agency's or American Job Center's own calendar): a fair open to every field
 *    shows on every field guide once a place is set and it is within the distance (a virtual one, for its state); a
 *    fair for one field or one employer only where the guide's own words claim it. "Details" opens the agency's page;
 *    "I'm going" puts it on the tracker (company = the host, role = the fair's name);
 *  - a registered-apprenticeship application window ("Applications open · closes Dec 12"), on the guide whose trade
 *    it is, with "Apply by <date>" to the program's own page.
 * Data: GET /api/jobs?action=hiring_events (lib/server/hiringEvents.js + lib/server/externalEvents.js — re-read every
 * 10 minutes, past dates dropped on the Pacific clock), plus any event a listing on the page announces in its text.
 * Which rows belong is lib/start/listingFilters.js eventBelongs (the guide's positions and exclusions, the chosen
 * position chip), near the chosen place (or the guide's `defaultLoc`, when it has one).
 *
 * Shown only when there is at least one event — an empty list of events is not information. Three at first, the rest
 * one tap away. Every action here is quiet (a text link or a ghost button): the page's one filled button is elsewhere.
 */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { Job, PostingEvent } from '@/lib/types'
import { JobCache } from '@/lib/stores/JobCache'
import { eventBelongs } from '@/lib/start/listingFilters.js'
import { eventDateLabel, howToCome } from '@/lib/jobs/hiringEvents.js'
import { externalBelongs, fairLabel, windowDateLabel, windowLabel, windowState } from '@/lib/jobs/externalEvents.js'
import GoingButton from '@/components/jobs/GoingButton'
import Icon from '@/components/ui/Icon'
import st from './guide.module.css'
import ex from './GuideEvents.module.css'

type External = {
  type: 'fair' | 'apprenticeship'
  sourceName: string
  state: string
  src: string
  general?: boolean
  many?: boolean
  opens?: string | null
  closes?: string | null
  yearRound?: boolean
  how?: string | null
}
type EventRow = { id: string; title: string; company: string; location: string; roles?: string; url?: string | null; event: PostingEvent; external?: External }
type Answer = { events: EventRow[]; external: EventRow[] }
const memo = new Map<string, Answer>()
const FIRST = 3

async function readEvents(loc: string, r: string): Promise<Answer | null> {
  const key = `${loc}|${loc ? r : ''}`
  if (memo.has(key)) return memo.get(key) || null
  try {
    const qs = new URLSearchParams({ action: 'hiring_events' })
    if (loc) { qs.set('loc', loc); qs.set('r', r) }
    const res = await fetch(`/api/jobs?${qs}`, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return null
    const data = await res.json()
    const answer: Answer = {
      events: (Array.isArray(data?.events) ? data.events : []) as EventRow[],
      external: (Array.isArray(data?.external) ? data.external : []) as EventRow[],
    }
    memo.set(key, answer)
    return answer
  } catch { return null }
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
const place = (e: EventRow) => (e.event.where || e.location || '').replace(/,\s*(United States|USA|US)$/i, '')
const httpsOnly = (u?: string | null) => (u && /^https?:\/\//i.test(u) ? u : null)
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const shortDay = (d: string) => { const [, m, dd] = d.split('-').map(Number); return `${MON[m - 1]} ${dd}` }

export default function GuideEvents({ config, pos, loc, r, listingRows }: {
  config: Record<string, unknown> & { positions: Array<{ id: string; match?: string }> }
  pos: string
  loc: string
  r: string
  listingRows: Job[]
}) {
  const [answer, setAnswer] = useState<Answer>({ events: [], external: [] })
  const [all, setAll] = useState(false)
  // The place general fairs are measured from: the one typed, else the guide's own default (when it has one).
  const where = loc || (typeof config.defaultLoc === 'string' ? config.defaultLoc : '')

  useEffect(() => {
    let live = true
    readEvents(where, r).then((a) => { if (live && a) setAnswer(a) })
    return () => { live = false }
  }, [where, r])
  useEffect(() => { setAll(false) }, [pos, loc, r])

  const events = useMemo(() => {
    const day = today()
    const fromRows: EventRow[] = listingRows
      .filter((j) => j.hiring_event)
      .map((j) => ({ id: String(j.id), title: j.title, company: j.company, location: j.location, event: j.hiring_event as PostingEvent }))
    const external = answer.external.filter((e) => externalBelongs(config, e, pos, where, day))
    const seen = new Set<string>()
    return [...answer.events, ...fromRows, ...external]
      .filter((e) => e.event && e.event.next >= day && (e.external || eventBelongs(config, e, pos)))
      .filter((e) => { const k = `${e.company}|${e.title}|${e.event.next}`.toLowerCase(); if (seen.has(k) || seen.has(e.id)) return false; seen.add(k); seen.add(e.id); return true })
      .sort((a, b) => (a.event.next < b.event.next ? -1 : a.event.next > b.event.next ? 1 : 0))
  }, [answer, listingRows, config, pos, where])

  if (!events.length) return null
  const list = all ? events : events.slice(0, FIRST)
  const day = today()
  return (
    <div className={st.events} data-testid="guide-events">
      <h3 className={st.eventsH}>Hiring events</h3>
      <ul className={st.eventRows}>
        {list.map((e) => {
          const x = e.external
          if (x && x.type === 'apprenticeship') {
            const s = windowState(e, day)
            const href = httpsOnly(x.src || e.url)
            return (
              <li key={e.id} className={st.row} data-testid="guide-window">
                <div className={ex.extRow}>
                  <span className={`${st.eventDate} tnum`}>{windowDateLabel(e, day)}</span>
                  <span className={st.rowMain}>
                    <span className={ex.extTitle}>{e.title}</span>
                    <span className={ex.extMeta}>{[windowLabel(e, day), e.location].filter(Boolean).join(' · ')}</span>
                    {href && (
                      <span className={ex.actions}>
                        <a href={href} target="_blank" rel="noopener noreferrer" className={ex.extLink}>
                          {s.status === 'open' && s.closes ? `Apply by ${shortDay(s.closes)}` : 'How to apply'}
                          <Icon name="arrow-up-right" size={14} />
                        </a>
                      </span>
                    )}
                  </span>
                </div>
              </li>
            )
          }
          if (x && x.type === 'fair') {
            const href = httpsOnly(x.src || e.url)
            return (
              <li key={e.id} className={st.row} data-testid="guide-fair">
                <div className={ex.extRow}>
                  <span className={`${st.eventDate} tnum`}>{eventDateLabel(e.event)}</span>
                  <span className={st.rowMain}>
                    <span className={ex.extTitle}>{e.title}</span>
                    <span className={ex.extMeta}>{fairLabel(e)}</span>
                    <span className={ex.extMeta}>{[place(e), e.event.time, howToCome(e.event)].filter(Boolean).join(' · ')}</span>
                    <span className={ex.actions}>
                      {href && (
                        <a href={href} target="_blank" rel="noopener noreferrer" className={ex.extLink}>
                          Details<Icon name="arrow-up-right" size={14} />
                        </a>
                      )}
                      <GoingButton job={{ id: null, title: e.title, company: e.company, location: e.location }} ev={e.event} role={e.title || 'Job fair'} variant="ghost" />
                    </span>
                  </span>
                </div>
              </li>
            )
          }
          return (
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
          )
        })}
      </ul>
      {events.length > FIRST && (
        <button type="button" className={st.textBtn} onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? 'Show fewer' : `Show all ${events.length} events`}
        </button>
      )}
    </div>
  )
}
