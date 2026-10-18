'use client'

// Company search in the SAME box as job search (owner request 2026-10-17). As the seeker types,
// matching companies appear under the box; picking one searches that company's jobs (the API ranks
// them first — lib/server/jobPriority.js queryNamesCompany). When the search names a company, a
// small card above the results shows its grade (only if it has enough reviews) and links to it.
//
// Data: POST /api/reports { action: 'resolve', query } — the same company resolver the rest of the
// site uses (aliases + company_scores), up to 5 candidates, already grade-gated server-side.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { queryNamesCompany } from '@/lib/server/jobPriority.js'

export type CompanyCandidate = { name: string; overall_score?: number | null; gradeable?: boolean }

const slugOf = (name: string) => encodeURIComponent(name.toLowerCase().replace(/\s+/g, '-'))
const letter = (s: number) => (s >= 80 ? 'A' : s >= 65 ? 'B' : s >= 50 ? 'C' : s >= 35 ? 'D' : 'F')
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())

/** Debounced company lookup for the text in the search box. Results for a query are cached. */
export function useCompanySuggestions(query: string) {
  const [list, setList] = useState<CompanyCandidate[]>([])
  const cache = useRef(new Map<string, CompanyCandidate[]>())
  useEffect(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) { setList([]); return }
    const hit = cache.current.get(q)
    if (hit) { setList(hit); return }
    let alive = true
    const t = setTimeout(async () => {
      try {
        const r = await fetch('/api/reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'resolve', query: q }),
        })
        const d = r.ok ? await r.json() as { candidates?: CompanyCandidate[] } : {}
        const out = (d.candidates || []).filter((c) => c && c.name).slice(0, 4)
        cache.current.set(q, out)
        if (alive) setList(out)
      } catch { /* suggestions are optional */ }
    }, 180)
    return () => { alive = false; clearTimeout(t) }
  }, [query])
  return list
}

function GradeBit({ c }: { c: CompanyCandidate }) {
  const graded = c.gradeable !== false && typeof c.overall_score === 'number'
  return (
    <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: graded ? 'var(--sub)' : 'var(--muted)', flexShrink: 0 }}>
      {graded ? `Grade ${letter(c.overall_score as number)}` : 'Not graded yet'}
    </span>
  )
}

/** Dropdown under the job-search box. `onPick` runs the job search for that company. */
export function CompanySuggestList({ items, onPick }: { items: CompanyCandidate[]; onPick: (name: string) => void }) {
  if (!items.length) return null
  return (
    <div role="listbox" aria-label="Companies" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 8, marginTop: 2, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,.4)' }}>
      <div style={{ padding: '.35rem .8rem .2rem', fontFamily: 'var(--mono)', fontSize: '.5rem', textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--dim)' }}>Companies</div>
      {items.map((c) => (
        <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.4rem .8rem' }}>
          <button
            type="button"
            role="option"
            aria-selected={false}
            onMouseDown={(e) => { e.preventDefault(); onPick(c.name) }}
            style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--body)', fontSize: '.78rem', color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            🏢 {titleCase(c.name)} <span style={{ color: 'var(--muted)', fontSize: '.66rem' }}>· jobs</span>
          </button>
          <GradeBit c={c} />
          <Link href={`/company/${slugOf(c.name)}`} onMouseDown={(e) => e.preventDefault()} style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--indigo)', textDecoration: 'none', flexShrink: 0 }}>Profile →</Link>
        </div>
      ))}
    </div>
  )
}

/** Card above the results when the search names a company. */
export function CompanyResultCard({ items, searched }: { items: CompanyCandidate[]; searched: string }) {
  const c = items.find((x) => queryNamesCompany(x.name, searched))
  if (!c) return null
  return (
    <Link href={`/company/${slugOf(c.name)}`} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.7rem .9rem', margin: '.75rem 0', background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 12, textDecoration: 'none' }}>
      <span aria-hidden style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--raised)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--display)', fontWeight: 800, color: 'var(--sub)', flexShrink: 0 }}>{c.name.charAt(0).toUpperCase()}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontFamily: 'var(--display)', fontWeight: 700, fontSize: '.92rem', color: 'var(--white)' }}>{titleCase(c.name)}</span>
        <GradeBit c={c} />
      </span>
      <span style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--indigo)', flexShrink: 0 }}>Company profile →</span>
    </Link>
  )
}
