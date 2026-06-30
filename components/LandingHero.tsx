'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { RecentSearchesStore } from '@/lib/stores/RecentSearches'

const JOB_KEYWORDS = ['engineer', 'developer', 'manager', 'analyst', 'designer', 'nurse', 'coordinator', 'specialist', 'director', 'associate', 'assistant', 'recruiter', 'sales', 'marketing', 'accountant', 'therapist', 'technician']

export default function LandingHero() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [location, setLocation] = useState('')

  // Preserve the original routing logic: company queries → /company/<slug>,
  // job-style queries → /jobs?q=&loc=
  const doSearch = useCallback(() => {
    const q = query.trim()
    const l = location.trim()
    if (!q) return
    const isJobSearch = JOB_KEYWORDS.some(k => q.toLowerCase().includes(k)) || (q.split(' ').length > 1 && !!l)
    if (isJobSearch) {
      router.push(`/jobs?q=${encodeURIComponent(q)}&loc=${encodeURIComponent(l)}`)
    } else {
      RecentSearchesStore.push(q, l)
      router.push(`/company/${encodeURIComponent(q.toLowerCase().replace(/\s+/g, '-'))}`)
    }
  }, [query, location, router])

  return (
    <section className="lp2-hero">
      <div className="lp2-wrap">
        <div className="lp2-rise" style={{ animationDelay: '0ms' }}>
          <span className="lp2-eyebrow">
            <span className="lp2-eyebrow-dot" />
            Real hiring outcomes from real applicants
          </span>
        </div>

        <h1 className="lp2-h1 lp2-rise" style={{ animationDelay: '70ms' }}>
          See who actually responds<br />
          <span className="grad">before you apply.</span>
        </h1>

        <p className="lp2-sub lp2-rise" style={{ animationDelay: '140ms' }}>
          Check ghost rates, response times, and real applicant outcomes before wasting another application.
        </p>

        <div className="lp2-cta-row lp2-rise" style={{ animationDelay: '210ms' }}>
          <button className="lp2-btn lp2-btn-primary" onClick={() => router.push('/companies')}>
            Check a company
          </button>
          <button className="lp2-btn lp2-btn-ghost" onClick={() => router.push('/companies')}>
            Browse ghost rates
          </button>
        </div>

        {/* Search card — wired to the original doSearch routing */}
        <div className="lp2-search lp2-rise" style={{ animationDelay: '280ms' }}>
          <div className="lp2-field lp2-field-company">
            <SearchIcon />
            <input
              className="lp2-input"
              type="text"
              placeholder="Company or job title"
              autoComplete="off"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doSearch()}
              aria-label="Company or job title"
            />
          </div>
          <div className="lp2-field lp2-field-loc">
            <PinIcon />
            <input
              className="lp2-input"
              type="text"
              placeholder="City or zip"
              autoComplete="off"
              value={location}
              onChange={e => setLocation(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doSearch()}
              aria-label="City or zip"
            />
          </div>
          <button className="lp2-search-btn" onClick={doSearch}>Check company</button>
        </div>

        {/* Trust stats — three only */}
        <div className="lp2-trust lp2-rise" style={{ animationDelay: '350ms' }}>
          <div className="lp2-trust-item">
            <span className="lp2-trust-n">47K+</span>
            <span className="lp2-trust-l">companies tracked</span>
          </div>
          <div className="lp2-trust-div" />
          <div className="lp2-trust-item">
            <span className="lp2-trust-n">124K+</span>
            <span className="lp2-trust-l">real outcomes</span>
          </div>
          <div className="lp2-trust-div" />
          <div className="lp2-trust-item">
            <span className="lp2-trust-n">Free</span>
            <span className="lp2-trust-l">company checks</span>
          </div>
        </div>
      </div>
    </section>
  )
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </svg>
  )
}

function PinIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}
