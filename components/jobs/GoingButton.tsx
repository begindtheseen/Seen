'use client'

// "I'm going" on a hiring event (lib/tracker/eventPlan.js): one tap puts the event on the person's tracker with its
// date, hours and place, so the tracker asks "How did it go?" after it — and, for a signed-in account, the daily email
// job sends a reminder the day before and the same question the day after (api/outcome-followups.js). A guest's card
// is kept on this device (the guest tracker), with no email. Secondary button: the listing's one filled button stays
// Apply. Once the event is on the tracker the button becomes a plain line with a link to the card.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { HiringEvent, Job, PostingEvent } from '@/lib/types'
import { useAuth } from '@/lib/auth'
import { AppStore } from '@/lib/stores/AppStore'
import { isoFrom } from '@/lib/interviewTime'
import { eventStartClock, planEvent, roleFromEventTitle } from '@/lib/tracker/eventPlan.js'
import Button from '@/components/ui/Button'
import s from './HiringEventNote.module.css'

export default function GoingButton({ job, ev }: { job: Pick<Job, 'id' | 'title' | 'company' | 'location'>; ev: PostingEvent }) {
  const { isLoggedIn, ready } = useAuth()
  const [appId, setAppId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const hit = AppStore.loadSync().find(a => a.jobId && String(a.jobId) === String(job.id))
    setAppId(hit ? hit.id : null)
  }, [job.id])

  async function go() {
    setSaving(true); setFailed(false)
    const now = Date.now()
    const at = isoFrom(ev.next, eventStartClock(ev.time))
    try {
      const r = await AppStore.add({
        company: job.company,
        role: roleFromEventTitle(job.title, job.company, ev.label),
        location: job.location || '',
        jobId: String(job.id),
        platform: 'Hiring event',
        appliedAt: now,
        events: [
          { id: `ev_${now}`, type: 'application_submitted', date: now, source: 'user', confidence: 'low' },
          planEvent(ev, at, job.id, now + 1) as HiringEvent,
        ],
      }, isLoggedIn)
      if (r.ok) setAppId(r.id); else setFailed(true)
    } catch { setFailed(true) }
    setSaving(false)
  }

  if (!ready) return null
  if (appId) {
    return (
      <p className={s.going} role="status" data-testid="going-added">
        On your tracker. {isLoggedIn ? 'We’ll remind you the day before and ask how it went.' : 'Saved on this device; sign in to get a reminder email.'}{' '}
        <Link href={`/tracker?app=${encodeURIComponent(appId)}`} prefetch={false} className={s.goingLink}>View it</Link>
      </p>
    )
  }
  return (
    <div className={s.goingRow}>
      <Button size="sm" variant="secondary" icon="calendar" onClick={() => void go()} loading={saving} data-testid="going-button">I’m going</Button>
      {failed && <span className={s.fine}>That didn’t save. Try again.</span>}
    </div>
  )
}
