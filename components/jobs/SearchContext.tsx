'use client'

// ONE quiet line above a titled search's results, from what the server read (api/jobs.js searchContext):
//   "Also showing related titles: floorhand and derrickhand. 31 of the 56 matches state an hourly
//    rate: $20–$35/hr."
// The titles are family titles a shown match carries (never a guess); the pay is the employer-STATED pay on the shown
// matches, 10th–90th percentile in one unit — "state pay", never "pay". When shown listings announce a dated hiring
// event (lib/jobs/hiringEvents.js), one more sentence says how many and when the soonest is. Nothing renders when there
// is nothing to say.
import type { SearchContextInfo } from '@/lib/hooks/useJobSearch'
import type { Job } from '@/lib/types'
import { eventDateLabel } from '@/lib/jobs/hiringEvents.js'
import s from './SearchHelp.module.css'

// "Floorhand" → "floorhand" in a sentence; an acronym stays ("CDL Driver" → "CDL driver")
const inSentence = (t: string) => t.split(' ').map(w => (w.length > 1 && w === w.toUpperCase() ? w : w.toLowerCase())).join(' ')
export function joinWords(list: string[]): string {
  if (list.length <= 1) return list.join('')
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

/** The sentence for the context, or '' (exported for the test and the page's own status line if wanted). */
export function contextSentence(ctx: SearchContextInfo | null): { also: string; pay: string } {
  if (!ctx) return { also: '', pay: '' }
  const also = ctx.alsoSearched.length ? `Also showing related titles: ${joinWords(ctx.alsoSearched.map(inSentence))}.` : ''
  const p = ctx.pay
  const pay = p ? `${p.stated} of the ${p.total} match${p.total === 1 ? '' : 'es'} state ${p.unit === 'hr' ? 'an hourly rate' : 'a yearly salary'}: ` : ''
  return { also, pay }
}

/** "2 of these listings announce a hiring event; the soonest is Thu, Nov 19." — or ''. */
export function eventsSentence(jobs: Array<Pick<Job, 'hiring_event'>>): string {
  const evs = jobs.map(j => j.hiring_event).filter((e): e is NonNullable<Job['hiring_event']> => !!e)
  if (!evs.length) return ''
  const soonest = evs.reduce((a, b) => (b.next < a.next ? b : a))
  const when = eventDateLabel(soonest)
  return evs.length === 1
    ? `One of these listings announces a ${soonest.label.toLowerCase()} on ${when}.`
    : `${evs.length} of these listings announce a hiring event; the soonest is ${when}.`
}

export default function SearchContext({ context, jobs = [] }: { context: SearchContextInfo | null; jobs?: Array<Pick<Job, 'hiring_event'>> }) {
  const { also, pay } = contextSentence(context)
  const events = eventsSentence(jobs)
  if (!also && !pay && !events) return null
  return (
    <p className={s.line} data-testid="search-context">
      {also}
      {also && pay ? ' ' : ''}
      {pay && context?.pay && <>{pay}<b className="tnum">{context.pay.text}</b>.</>}
      {(also || pay) && events ? ' ' : ''}
      {events}
    </p>
  )
}
