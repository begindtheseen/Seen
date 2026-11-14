'use client'

// When a place search comes back thin (fewer than 10 matches in the radius), where the matches are instead — from the
// rows the server already read (api/jobs.js searchContext → lib/jobs/searchContext.js elsewhereClusters):
//   "No floorhand jobs within 100 mi of Boise, ID. 16 near Midland, TX · 5 near Williston, ND"
// Each place is a text link: onPick(place) re-runs the search there. A count with "+" is a floor (the read it came
// from was capped). Renders nothing for a search with matches enough, or no place.
import type { SearchContextInfo } from '@/lib/hooks/useJobSearch'
import Icon from '@/components/ui/Icon'
import s from './SearchHelp.module.css'

export function thinSentence(ctx: SearchContextInfo): string {
  const n = ctx.matchesInRadius
  const what = ctx.query.trim()
  const r = Number(ctx.radius)
  const within = Number.isFinite(r) && r > 0 ? `within ${r} mi of ${ctx.location}` : `near ${ctx.location}`
  return n === 0 ? `No ${what} jobs ${within}.` : `Only ${n} ${what} job${n === 1 ? '' : 's'} ${within}.`
}

export default function WhereJobsAre({ context, onPick }: {
  context: SearchContextInfo | null
  /** Re-runs the search in that place ("Midland, TX"). */
  onPick: (place: string) => void
}) {
  if (!context || !context.location || !context.elsewhere.length) return null
  const plus = context.elsewherePartial ? '+' : ''
  return (
    <div className={s.where} role="note" data-testid="where-jobs-are">
      <Icon name="map-pin" size={14} />
      <span>{thinSentence(context)}</span>
      <span className={s.places}>
        {context.elsewhere.map((c, i) => (
          <span key={c.place} className={s.placeItem}>
            {i > 0 && <span aria-hidden="true" className={s.sep}>·</span>}
            <button type="button" className={s.pick} onClick={() => onPick(c.place)} title={`Search near ${c.place}`}>
              <span className="tnum">{c.count.toLocaleString('en-US')}{plus}</span>&nbsp;near {c.place}
            </button>
          </span>
        ))}
      </span>
    </div>
  )
}
