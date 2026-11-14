'use client'

// ONE quiet line above a titled search's results, from what the server read (api/jobs.js searchContext):
//   "Also showing floorhand and derrickhand — other titles for the same job. 31 of the 56 matches state an hourly
//    rate: $20–$35/hr."
// The titles are family titles a shown match carries (never a guess); the pay is the employer-STATED pay on the shown
// matches, 10th–90th percentile in one unit — "state pay", never "pay". Nothing renders when there is nothing to say.
import type { SearchContextInfo } from '@/lib/hooks/useJobSearch'
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
  const also = ctx.alsoSearched.length ? `Also showing ${joinWords(ctx.alsoSearched.map(inSentence))} — other titles for the same job.` : ''
  const p = ctx.pay
  const pay = p ? `${p.stated} of the ${p.total} match${p.total === 1 ? '' : 'es'} state ${p.unit === 'hr' ? 'an hourly rate' : 'a yearly salary'}: ` : ''
  return { also, pay }
}

export default function SearchContext({ context }: { context: SearchContextInfo | null }) {
  if (!context) return null
  const { also, pay } = contextSentence(context)
  if (!also && !pay) return null
  return (
    <p className={s.line} data-testid="search-context">
      {also}
      {also && pay ? ' ' : ''}
      {pay && context.pay && <>{pay}<b className="tnum">{context.pay.text}</b>.</>}
    </p>
  )
}
