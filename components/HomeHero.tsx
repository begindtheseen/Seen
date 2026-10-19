'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { RecentSearchesStore } from '@/lib/stores/RecentSearches'
import { useIntroGate } from '@/lib/hooks/useIntroGate'
import { firstPartyReportCount } from '@/lib/server/reportCounts'
import { isGradeableScore } from '@/lib/gradeGate'
import KineticText from '@/components/motion/KineticText'
import WorkspacePreview, { type ProofScore } from '@/components/home/WorkspacePreview'
import styles from './HomeHero.module.css'

const JOB_KEYWORDS = ['engineer', 'developer', 'manager', 'analyst', 'designer', 'nurse', 'coordinator', 'specialist', 'director', 'associate', 'assistant', 'recruiter', 'sales', 'marketing', 'accountant', 'therapist', 'technician']


// Real proof, not a promise: a genuine company's real hiring behaviour rendered in the
// first screen. Seeded from Seen's own production company-score leaderboard
// (/api/reports · action:leaderboard) captured 2026-10-17, then live-refreshed from that
// same endpoint on mount so the numbers stay current wherever the API is reachable. Amazon is
// featured because it is widely recognised AND its score is backed by first-party applicant
// reports (23 at capture — verified via the company page's schema.org ratingCount, which is
// first-party only). The card labels its count from first_party_report_count — never the fused
// report_count, which adds the web-research pipeline's claimed mention count.
const FEATURED_SEED: ProofScore = {
  name: 'Amazon',
  industry: 'E-Commerce, Cloud Computing, Technology',
  overall_score: 66,
  ghost_rate: 0.276316,
  response_rate: 0.447368,
  avg_wait_days: 0,
  waste: 17,
  report_count: 23,
  first_party_report_count: 23,
}

// One-tap example companies for brand-new users — zero typing to first value.
// Checked against the LIVE production leaderboard (2026-10-17): every entry has a score and the
// grade spread shows instantly that Seen differentiates companies. NOTE: only Amazon's score is
// backed by first-party applicant reports (23); Starbucks / Nike / McDonald's scores are
// web-research ESTIMATES (their large fused counts — 11.5k / 2.2k / 12.7k — are web claims with
// zero report rows), and their company pages label them as estimates.
// Slugs are the exact stored names, so routing never depends on punctuation cleanup.
const EXAMPLES: Array<{ label: string; slug: string }> = [
  { label: 'Amazon', slug: 'amazon' },
  { label: 'Starbucks', slug: 'starbucks' },
  { label: 'Nike', slug: 'nike' },
  { label: 'McDonald’s', slug: 'mcdonalds' },
]

const slugify = (n: string) => encodeURIComponent(n.toLowerCase().trim().replace(/\s+/g, '-'))

export default function HomeHero() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [location, setLocation] = useState('')
  const [proof, setProof] = useState<ProofScore>(FEATURED_SEED)

  // Entrance choreography starts as soon as the display font is available (useIntroGate)
  // — there is no blocking intro; the hero rising IS the opening.
  const ready = useIntroGate()

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
      router.push(`/company/${slugify(q)}`)
    }
  }, [query, location, router])

  // Live-refresh the proof card from the real leaderboard when the API is reachable
  // (production). Falls back to the real captured seed when it isn't (e.g. local build).
  useEffect(() => {
    const ac = new AbortController()
    ;(async () => {
      try {
        const res = await fetch('/api/reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'leaderboard' }),
          signal: ac.signal,
        })
        if (!res.ok) return
        const data = await res.json() as { companies?: Array<{ name: string; industry?: string; score: Omit<ProofScore, 'name' | 'industry' | 'first_party_report_count'> & { first_party_report_count?: number; data_source?: string | null } }> }
        const match = (data.companies || []).find(c => c.name?.toLowerCase() === FEATURED_SEED.name.toLowerCase())
        // Grade gate: only refresh the proof card from a GRADEABLE score (≥5 real reports).
        if (match && isGradeableScore(match.score)) {
          setProof({
            name: FEATURED_SEED.name,
            industry: match.industry || FEATURED_SEED.industry,
            overall_score: match.score.overall_score,
            ghost_rate: match.score.ghost_rate,
            response_rate: match.score.response_rate,
            avg_wait_days: match.score.avg_wait_days,
            waste: match.score.waste,
            report_count: match.score.report_count,
            first_party_report_count: firstPartyReportCount(match.score),
          })
        }
      } catch { /* keep the real seed */ }
    })()
    return () => ac.abort()
  }, [])

  return (
    <>
      <section className={`${styles.hero}${ready ? ' ' + styles.heroIn : ''}`}>
        <span className={`${styles.eyebrow} ${styles.stage} ${styles.d1}`}>
          <span className={styles.pulse} />
          Real hiring outcomes from real applicants
        </span>

        {/* Kinetic headline: each word rises from behind its own clip, 42ms apart. */}
        <KineticText as="h1" className={styles.title} in={ready} delay={120}>
          See who actually <span className={styles.grad}>responds</span> before you apply.
        </KineticText>

        <p className={`${styles.lede} ${styles.stage} ${styles.d3}`}>
          Check any company&apos;s ghost rate before you spend an hour applying. Then track every
          application in one place that tells you when to follow up and when to move on.
        </p>

        <form
          className={`${styles.search} ${styles.stage} ${styles.d4}`}
          onSubmit={(e) => { e.preventDefault(); doSearch() }}
          aria-label="Check a company"
        >
          <label className={styles.field}>
            <SearchIcon />
            <input
              className={styles.input}
              type="text"
              placeholder="Company or job title"
              autoComplete="off"
              value={query}
              onChange={e => setQuery(e.target.value)}
              aria-label="Company or job title"
            />
          </label>
          <label className={styles.field}>
            <PinIcon />
            <input
              className={styles.input}
              type="text"
              placeholder="City or remote"
              autoComplete="off"
              value={location}
              onChange={e => setLocation(e.target.value)}
              aria-label="City or remote"
            />
          </label>
          <button className={`${styles.go} btn-shine`} type="submit">Check company</button>
        </form>

        {/* One tap to first value — real companies with real scores. */}
        <div className={`${styles.examples} ${styles.stage} ${styles.d5}`} aria-label="Example companies">
          <span className={styles.examplesLabel}>Try one</span>
          {EXAMPLES.map(ex => (
            <button key={ex.slug} type="button" className={styles.chip} onClick={() => router.push(`/company/${ex.slug}`)}>
              {ex.label}
            </button>
          ))}
        </div>

        <div className={`${styles.trust} ${styles.stage} ${styles.d6}`}>
          <span><b>Free</b> company checks</span>
          <span><b>No account</b> needed to look</span>
          <span><b>No grade</b> until 5+ reports</span>
        </div>
      </section>

      {/* What you get once you start tracking: the workspace, with example results — and the
          company tab running on Seen's real, live data (the proof this hero used to carry). */}
      <WorkspacePreview proof={proof} />
    </>
  )
}

function SearchIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </svg>
  )
}

function PinIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}
