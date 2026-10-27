'use client'
// One line above the results saying how Seen read the search, when it did not take it word for word:
// "Showing results for cashier (you typed cashir) · Search for “cashir” instead", "Near Anaheim, CA (you typed
// “Anahiem ca”)", "Part-time listings first". Audit 2026-10-27: a misspelt role or place silently emptied the page.
import type { InterpretedSearch } from '@/lib/hooks/useJobSearch'
import s from './SearchInterpretation.module.css'

export default function SearchInterpretation({ interp, onExact }: { interp: InterpretedSearch | null; onExact: () => void }) {
  if (!interp) return null
  const parts: React.ReactNode[] = []
  if (interp.corrections && interp.corrections.length && interp.query) {
    const typed = interp.query_typed || interp.corrections.map(c => c.from).join(' ')
    parts.push(
      <span key="q">
        Showing results for <strong>{interp.query}</strong> <span className={s.typed}>(you typed “{typed}”)</span>{' '}
        {/* mousedown keeps the search box's focus, so closing the phone keyboard cannot shift the page between press
            and release and swallow the tap; the handler then lets the keyboard go */}
        <button type="button" className={s.link} data-testid="search-exact"
          onMouseDown={e => e.preventDefault()}
          onClick={() => { (document.activeElement as HTMLElement | null)?.blur?.(); onExact() }}>Search for “{typed}” instead</button>
      </span>,
    )
  }
  if (interp.location && interp.location_corrected && interp.location_typed) {
    parts.push(<span key="l">Near <strong>{interp.location}</strong> <span className={s.typed}>(you typed “{interp.location_typed}”)</span></span>)
  } else if (interp.location && interp.location_zip) {
    parts.push(<span key="z">Near <strong>{interp.location}</strong> <span className={s.typed}>({interp.location_zip})</span></span>)
  } else if (interp.location && interp.location_from_query) {
    parts.push(<span key="lq">Near <strong>{interp.location}</strong> <span className={s.typed}>(from your search)</span></span>)
  }
  if (interp.browse) {
    const where = interp.remote ? 'Remote listings' : interp.location ? <>Listings near <strong>{interp.location}</strong></> : 'Recent listings'
    parts.push(<span key="b">{where}{interp.modifiers && interp.modifiers.length ? <>, <strong>{interp.modifiers.join(' · ')}</strong> first</> : null}</span>)
  } else if (interp.modifiers && interp.modifiers.length) {
    parts.push(<span key="m"><strong>{interp.modifiers.join(' · ')}</strong> listings first</span>)
  }
  if (!parts.length) return null
  return (
    <div className={s.line} role="status" data-testid="search-interpretation">
      {parts.map((p, i) => <span key={i} className={s.part}>{p}</span>)}
    </div>
  )
}
