'use client'

/**
 * Live entry listings on a "getting in" guide: one search Seen already runs (POST /api/jobs with the guide's query
 * and no location — api/jobs.js treats an empty location as nationwide), shown as up to 12 plain rows. Only rows the
 * search counts as a match for the query (`related`) and that have a Seen listing page (a uuid id) are shown; a
 * page that would need filler says so instead. Nothing here is ever invented: no rows → the honest empty line.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Job } from '@/lib/types'
import { JobCache } from '@/lib/stores/JobCache'
import { jobsSearchHref } from '@/lib/searchRoute'
import { guideListingRows } from '@/lib/start/listingRows.js'
import st from './guide.module.css'

const DEADLINE_MS = 15000

type Row = Record<string, unknown>
type State = { status: 'loading' } | { status: 'done'; rows: Job[] } | { status: 'error' }

// API row → the Job shape the listing page reads from the session cache (same fields useJobSearch maps).
function toJob(r: Row): Job {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    id: String(r.id),
    title: String(r.title || ''),
    company: String(r.company || ''),
    location: String(r.location || ''),
    score: num(r.score),
    waste: num(r.waste_score ?? r.waste),
    level: String(r.level || ''),
    type: String(r.type || 'Full-time'),
    source: String(r.source || 'Job board'),
    description: String(r.description || ''),
    salary: r.salary ? String(r.salary) : null,
    apply_url: r.apply_url ? String(r.apply_url) : (r.url ? String(r.url) : null),
    posted_at: r.posted_at ? String(r.posted_at) : null,
    employer_posted: r.employer_posted === true,
    trains_beginners: r.trains_beginners === true,
  }
}

export default function LiveListings({ query, seeAllQuery, label }: { query: string; seeAllQuery: string; label: string }) {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let alive = true
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), DEADLINE_MS)
    fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, location: '', radius: '25' }),
      signal: ctrl.signal,
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => { if (alive) setState({ status: 'done', rows: (guideListingRows(data) as Row[]).map(toJob) }) })
      .catch(() => { if (alive) setState({ status: 'error' }) })
      .finally(() => clearTimeout(timer))
    return () => { alive = false; clearTimeout(timer); ctrl.abort() }
  }, [query])

  const seeAll = (
    <Link href={jobsSearchHref(seeAllQuery)} prefetch={false} className={st.seeAll}>See all in job search →</Link>
  )

  if (state.status === 'loading') {
    return (
      <div role="status" aria-label={`Loading ${label}`}>
        <ul className={st.rows} aria-hidden>
          {[0, 1, 2].map((i) => (
            <li key={i} className={st.skRow}>
              <div className={`sk ${st.skLine}`} />
              <div className={`sk ${st.skLine2}`} />
            </li>
          ))}
        </ul>
      </div>
    )
  }

  if (state.status === 'error' || state.rows.length === 0) {
    return (
      <div data-testid="guide-listings-empty">
        <p className={st.empty}>No live listings right now — new ones are read from employers&rsquo; boards every few hours.</p>
        {seeAll}
      </div>
    )
  }

  return (
    <div data-testid="guide-listings">
      <ul className={st.rows} aria-label={label}>
        {state.rows.map((j) => (
          <li key={j.id} className={st.row}>
            <Link href={`/jobs/${encodeURIComponent(j.id)}`} prefetch={false} className={st.rowLink} onClick={() => JobCache.set(j)}>
              <span className={st.rowTitle}>{j.title}</span>
              <span className={st.rowMeta}>
                {j.company && <span>{j.company}</span>}
                {j.location && <span>{j.location}</span>}
                {j.trains_beginners && <span className={st.tag}>Paid training</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {seeAll}
    </div>
  )
}
