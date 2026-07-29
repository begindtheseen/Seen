'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { RecentSearchesStore } from '@/lib/stores/RecentSearches'
import { useIntroGate } from '@/lib/hooks/useIntroGate'
import { useCountUp } from '@/lib/hooks/useCountUp'
import styles from './HomeHero.module.css'

const JOB_KEYWORDS = ['engineer', 'developer', 'manager', 'analyst', 'designer', 'nurse', 'coordinator', 'specialist', 'director', 'associate', 'assistant', 'recruiter', 'sales', 'marketing', 'accountant', 'therapist', 'technician']

interface ProofScore {
  name: string
  industry: string
  overall_score: number
  ghost_rate: number
  response_rate: number
  avg_wait_days: number
  waste: number
  report_count: number
}

// Real proof, not a promise: a genuine company's real hiring behaviour rendered in the
// first screen. Seeded from Seen's own production company-score leaderboard
// (/api/reports · action:leaderboard) captured 2026-07-19, then live-refreshed from that
// same endpoint on mount so the numbers stay current wherever the API is reachable. These
// are real applicant-reported figures — never invented. Amazon is featured because it is
// widely recognised and its profile makes the product's thesis legible at a glance.
const FEATURED_SEED: ProofScore = {
  name: 'Amazon',
  industry: 'E-Commerce, Cloud Computing, Technology',
  overall_score: 43,
  ghost_rate: 0.519231,
  response_rate: 0.346154,
  avg_wait_days: 60,
  waste: 56,
  report_count: 46,
}

// One-tap example companies for brand-new users — zero typing to first value.
// Every entry verified against the LIVE production leaderboard (2026-07-29): all have
// real applicant reports (Starbucks 11.5k · Nike 2.2k · McDonald's 12.7k · Amazon 46),
// and the grade spread (A → D) shows instantly that Seen differentiates companies.
// Slugs are the exact stored names, so routing never depends on punctuation cleanup.
const EXAMPLES: Array<{ label: string; slug: string }> = [
  { label: 'Amazon', slug: 'amazon' },
  { label: 'Starbucks', slug: 'starbucks' },
  { label: 'Nike', slug: 'nike' },
  { label: 'McDonald’s', slug: 'mcdonalds' },
]

function letterGrade(s: number): string {
  if (s >= 80) return 'A'
  if (s >= 65) return 'B'
  if (s >= 50) return 'C'
  if (s >= 35) return 'D'
  return 'F'
}
const slugify = (n: string) => encodeURIComponent(n.toLowerCase().trim().replace(/\s+/g, '-'))

export default function HomeHero() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [location, setLocation] = useState('')
  const [proof, setProof] = useState<ProofScore>(FEATURED_SEED)

  // Entrance choreography starts the moment the intro splash dissolves (or instantly
  // on repeat visits) — never invisibly behind it. See useIntroGate/IntroSplash.
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
        const data = await res.json() as { companies?: Array<{ name: string; industry?: string; score: Omit<ProofScore, 'name' | 'industry'> }> }
        const match = (data.companies || []).find(c => c.name?.toLowerCase() === FEATURED_SEED.name.toLowerCase())
        if (match && Number.isFinite(match.score?.overall_score)) {
          setProof({
            name: FEATURED_SEED.name,
            industry: match.industry || FEATURED_SEED.industry,
            overall_score: match.score.overall_score,
            ghost_rate: match.score.ghost_rate,
            response_rate: match.score.response_rate,
            avg_wait_days: match.score.avg_wait_days,
            waste: match.score.waste,
            report_count: match.score.report_count,
          })
        }
      } catch { /* keep the real seed */ }
    })()
    return () => ac.abort()
  }, [])

  const ghostPct = Math.round(proof.ghost_rate * 100)
  const respPct = Math.round(proof.response_rate * 100)
  const grade = letterGrade(proof.overall_score)

  // Animated figures — the ring and its number share ONE eased value so they can
  // never disagree mid-flight. Colors key off the FINAL values (never the animated
  // ones) so semantics don't flicker green→red while counting.
  const ghostAnim = Math.round(useCountUp(ghostPct, { start: ready, duration: 1500, delay: 420 }))
  const respAnim = Math.round(useCountUp(respPct, { start: ready, duration: 1200, delay: 540 }))
  const waitAnim = Math.round(useCountUp(proof.avg_wait_days, { start: ready, duration: 1200, delay: 640 }))
  const wasteAnim = Math.round(useCountUp(proof.waste, { start: ready, duration: 1200, delay: 740 }))

  // Semantic colour — green responds, red ghosts, amber in between (matches the app).
  const ghostColor = proof.ghost_rate > 0.5 ? 'var(--red)' : proof.ghost_rate > 0.3 ? 'var(--amber)' : 'var(--green)'
  const respColor = proof.response_rate >= 0.5 ? 'var(--green)' : proof.response_rate >= 0.3 ? 'var(--amber)' : 'var(--red)'
  const waitColor = proof.avg_wait_days > 45 ? 'var(--red)' : proof.avg_wait_days > 21 ? 'var(--amber)' : 'var(--green)'
  const wasteColor = proof.waste > 60 ? 'var(--red)' : proof.waste > 30 ? 'var(--amber)' : 'var(--green)'
  const risk = proof.overall_score >= 70 ? 'safe' : proof.overall_score >= 40 ? 'warn' : 'danger'
  const gradeColor = risk === 'safe' ? 'var(--green)' : risk === 'warn' ? 'var(--amber)' : 'var(--red)'
  const gradeTint = risk === 'safe' ? 'rgba(16,185,129,.14)' : risk === 'warn' ? 'rgba(245,158,11,.14)' : 'rgba(239,68,68,.14)'
  const gradeBorder = risk === 'safe' ? 'rgba(16,185,129,.4)' : risk === 'warn' ? 'rgba(245,158,11,.4)' : 'rgba(239,68,68,.4)'

  return (
    <section className={`${styles.hero}${ready ? ' ' + styles.heroIn : ''}`}>
      <div className={styles.grid}>
        {/* ── Left: headline + one search ──
            On mobile the wrapper dissolves (display:contents) so the proof card can
            slot in directly after the search — real data on the FIRST screen. */}
        <div className={styles.left}>
          <span className={`${styles.eyebrow} ${styles.stage} ${styles.d1}`}>
            <span className={styles.pulse} />
            Real hiring outcomes from real applicants
          </span>

          <h1 className={`${styles.title} ${styles.stage} ${styles.d2}`}>
            See who actually <span className={styles.grad}>responds</span> before you apply.
          </h1>

          <p className={`${styles.lede} ${styles.stage} ${styles.d3}`}>
            Check a company&apos;s ghost rate, response time, and real applicant outcomes — before you
            spend another hour on an application that goes nowhere.
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
            <button className={styles.go} type="submit">Check company</button>
          </form>

          {/* One tap to first value — real companies with real report volume. */}
          <div className={`${styles.examples} ${styles.stage} ${styles.d5}`} aria-label="Example companies">
            <span className={styles.examplesLabel}>Try one</span>
            {EXAMPLES.map(ex => (
              <button
                key={ex.slug}
                type="button"
                className={styles.chip}
                onClick={() => router.push(`/company/${ex.slug}`)}
              >
                {ex.label}
              </button>
            ))}
          </div>

          <div className={`${styles.trust} ${styles.stage} ${styles.d6}`}>
            <span><b>Free</b> company checks</span>
            <span><b>No account</b> needed to look</span>
            <span><b>Real</b> applicant reports</span>
          </div>
        </div>

        {/* ── Right: the thesis, made visible (real company, real numbers) ── */}
        <aside className={`${styles.proof} ${styles.stage} ${styles.d4}`} aria-label={`${proof.name} hiring report`}>
          <div className={styles.proofHead}>
            <div className={styles.co}>
              <div className={styles.logo}>{proof.name[0]?.toUpperCase()}</div>
              <div style={{ minWidth: 0 }}>
                <h3 className={styles.coName}>{proof.name}</h3>
                <span className={styles.coMeta}>{proof.report_count.toLocaleString()} applicant reports</span>
              </div>
            </div>
            <div className={styles.grade} style={{ color: gradeColor, background: gradeTint, border: `1px solid ${gradeBorder}` }}>
              GRADE&nbsp;{grade}
            </div>
          </div>

          <div className={styles.gaugeRow}>
            {/* Ring and number share ghostAnim — they land together, always in sync. */}
            <div className={styles.gauge} style={{ background: `conic-gradient(${ghostColor} ${ghostAnim}%, var(--line2) 0)` }} aria-hidden>
              <div className={styles.gaugeNum}>
                <b>{ghostAnim}%</b>
                <small>ghosted</small>
              </div>
            </div>
            <div className={styles.stats}>
              <div className={styles.stat}>
                <span className={styles.statK}>Responds to applicants</span>
                <span className={styles.statV} style={{ color: respColor }}>{respAnim}%</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statK}>Median wait to hear back</span>
                <span className={styles.statV} style={{ color: waitColor }}>{waitAnim} days</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statK}>Wasted-effort risk</span>
                <span className={styles.statV} style={{ color: wasteColor }}>{wasteAnim}%</span>
              </div>
            </div>
          </div>

          <div className={styles.proofFoot}>
            <span>From real applicant reports</span>
            <Link href={`/company/${slugify(proof.name)}`} className={styles.reportLink}>Full report →</Link>
          </div>
        </aside>
      </div>
    </section>
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
