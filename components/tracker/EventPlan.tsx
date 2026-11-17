'use client'

// A hiring event on a tracker card (lib/tracker/eventPlan.js — added with "I'm going" on the listing):
//   • before it and on the day: one quiet line with the date, hours and place;
//   • after it: "How did the hiring day go?", asked on the card like the day-7/14/30 check-ins (same look), until it is
//     answered. An answer moves the card (offer → Offer, interviewed → Interview, didn't go → withdrawn — the person's
//     own move, never a report against the employer) and is kept on the application as an event.
import { whenLabel } from '@/lib/interviewTime'
import { EVENT_ANSWERS, eventStage, plannedEvent } from '@/lib/tracker/eventPlan.js'
import type { Application } from '@/lib/types'
import Icon, { type IconName } from '@/components/ui/Icon'

/** "Thu, Nov 19" — the day alone when the posting's hours are shown beside it, else the day and its start time. */
const dayOf = (at: string, hasHours: boolean) => hasHours ? new Date(at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : whenLabel(at)

const ORDER: Array<{ key: keyof typeof EVENT_ANSWERS; icon: IconName; good?: boolean }> = [
  { key: 'offer', icon: 'trophy', good: true },
  { key: 'interviewed', icon: 'circle-check', good: true },
  { key: 'nothing', icon: 'hourglass' },
  { key: 'didnt_go', icon: 'undo-2' },
]

export default function EventPlan({ app, onAnswer }: { app: Application; onAnswer: (appId: string, answer: string) => void }) {
  const plan = plannedEvent(app)
  const stage = eventStage(app)
  if (!plan || !stage || stage === 'answered') return null
  const label = String(plan.label || 'Hiring event')
  if (stage === 'upcoming' || stage === 'today') {
    return (
      <div className="app-check-note" style={{ marginTop: '.5rem', display: 'flex', gap: '.5rem', alignItems: 'flex-start' }} data-testid="event-plan">
        <Icon name="calendar" size={14} />
        <span>
          {stage === 'today' ? `${label} today` : `Going: ${label} · ${dayOf(plan.at, !!plan.time)}`}
          {plan.time ? ` · ${plan.time}` : ''}{plan.where ? ` · ${plan.where}` : ''}{plan.virtual ? ' · virtual' : ''}
        </span>
      </div>
    )
  }
  return (
    <div className="app-check" onClick={e => e.stopPropagation()} data-testid="event-check">
      <div className="app-check-head">
        <span className="app-check-tag"><span className="app-check-dot" />{label} · {dayOf(plan.at, true)}</span>
      </div>
      <div className="app-check-q">How did the {label.toLowerCase()} go?</div>
      <div className="app-check-opts">
        {ORDER.map(o => (
          <button key={o.key} type="button" className={`app-check-opt${o.good ? ' hi' : ''}`} style={{ minHeight: 44 }} onClick={() => onAnswer(app.id, o.key)}>
            <Icon name={o.icon} size={15} />{EVENT_ANSWERS[o.key].label}
          </button>
        ))}
      </div>
    </div>
  )
}
