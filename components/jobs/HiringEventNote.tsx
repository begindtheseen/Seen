'use client'

// A hiring event the posting announces (lib/jobs/hiringEvents.js): its date, hours, place and how to come, shown in a
// listing's drawer and on its page, above "Before you apply". Read from the search row's `hiring_event`; a listing
// opened from a link (no search row) reads it from its own title and text. Nothing when the posting announces no
// event or its dates have passed. Ink text on the quiet card surface — the date is information, not a call to action.
import type { PostingEvent, Job } from '@/lib/types'
import { eventDateLabel, listingHiringEvent } from '@/lib/jobs/hiringEvents.js'
import Icon from '@/components/ui/Icon'
import s from './HiringEventNote.module.css'

export function eventOf(job: Pick<Job, 'title' | 'description' | 'posted_at' | 'hiring_event'>): PostingEvent | null {
  if (job.hiring_event !== undefined) return job.hiring_event || null
  return listingHiringEvent({ title: job.title, description: job.description || '', created_at: job.posted_at }) as PostingEvent | null
}

/** "Walk-ins welcome · RSVP" — how to come, from the posting's own words. */
export function howToCome(ev: PostingEvent): string {
  return [
    ev.virtual ? 'Virtual' : null,
    ev.inviteOnly ? 'By invitation' : null,
    ev.walkIn && !ev.inviteOnly ? 'Walk-ins welcome' : null,
    ev.rsvp ? 'RSVP in the posting' : null,
    ev.onTheSpot ? 'Interviews on the spot' : null,
  ].filter(Boolean).join(' · ')
}

export default function HiringEventNote({ job }: { job: Pick<Job, 'title' | 'description' | 'posted_at' | 'hiring_event'> }) {
  const ev = eventOf(job)
  if (!ev) return null
  const how = howToCome(ev)
  return (
    <section className={s.card} aria-label={ev.label} data-testid="hiring-event-note">
      <p className={s.head}><Icon name="calendar" size={16} /> <b>{ev.label}</b> · {eventDateLabel(ev)}{ev.time ? ` · ${ev.time}` : ''}</p>
      {ev.where && <p className={s.line}><Icon name="map-pin" size={14} /> {ev.where}</p>}
      {how && <p className={s.line}>{how}</p>}
      <p className={s.fine}>From the posting. Check it for details before you go.</p>
    </section>
  )
}
