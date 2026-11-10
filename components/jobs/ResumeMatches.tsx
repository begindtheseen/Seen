'use client'

// "Matched to your résumé" — a compact rail of local listings that fit the jobs on the person's résumé
// (or ones they applied to lately). Each row carries the server's `match_reason` — the sentence that says
// why, built from their own résumé ("You were a Cashier at Fry's Food Stores (2019–2023).") — under the
// employer line (api/jobs.js handleRecommended → lib/server/jobKeys.js matchListing). Replaces the
// 340px swipe deck that opened the signed-in /jobs page with a Dallas hotel-sales job for a
// Phoenix sales associate (live audit 2026-10-23). The page shows it with ≥1 real in-radius match
// (the second audit's persona had exactly one Phoenix match and saw nothing) and hides it the
// moment a search is typed; rows are short so the search stays at the top of a 390px phone.

import type { Job } from '@/lib/types'
import { displayLocation } from '@/lib/jobs/displayLocation.js'
import ListingScoreRing from '@/components/jobs/ListingScoreRing'
import { displayCompanyName } from '@/lib/companyDisplay'
import { displayPay } from '@/lib/jobs/pay.js'

export default function ResumeMatches({ jobs, loading, skills, city, citySource, onOpen, noDirection }: {
  jobs: Job[]
  loading: boolean
  skills: string[]
  city: string | null
  /** Where the city came from — the profile, or the résumé's own contact line. */
  citySource?: 'profile' | 'resume' | null
  onOpen: (job: Job) => void
  /** The server's `no_direction` state: the person's current title could not be placed (feature-detected; the page passes it). */
  noDirection?: { title?: string | null } | null
}) {
  const rows = jobs.slice(0, 5)
  return (
    <section aria-label="Matched to your résumé" style={{ marginBottom: '1.25rem', paddingBottom: '1rem', borderBottom: '1px solid var(--line)' }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--text-3)', marginBottom: '.5rem', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ width: 20, height: 1.5, background: 'var(--text-3)', display: 'inline-block', flexShrink: 0 }} />
        Matched to your résumé
        {city && (
          <span style={{ color: 'var(--dim)', letterSpacing: 'normal', textTransform: 'none', fontSize: 'var(--fs-meta)' }}>· near {city}{citySource === 'resume' ? ' (from your résumé)' : ''}{skills.length ? ` · ${skills.slice(0, 2).join(', ')}` : ''}</span>
        )}
      </div>
      {noDirection ? (
        <p data-testid="rail-no-direction" style={{ fontFamily: 'var(--body)', fontSize: 'var(--fs-sm)', color: 'var(--text-2)', lineHeight: 1.5, margin: 0 }}>
          We couldn&apos;t place {noDirection.title ? `“${noDirection.title}”` : 'your current title'} yet — <a href="/jobs?focus=search" style={{ color: 'var(--accent)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>search by title or place</a>.
        </p>
      ) : loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
          {[0, 1].map(i => <div key={i} style={{ height: 46, background: 'var(--raised)', borderRadius: 10, animation: `pulse 1.4s ${i * 0.15}s ease infinite` }} />)}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
          {rows.map(job => {
            const reason = (job as Job & { match_reason?: string | null }).match_reason || null
            const summaryOnly = (job as Job & { summary_only?: boolean }).summary_only === true
            return (
              <button
                key={job.id}
                type="button"
                onClick={() => onOpen(job)}
                style={{ display: 'flex', alignItems: 'center', gap: '.75rem', width: '100%', minWidth: 0, textAlign: 'left', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '.5rem .75rem', cursor: 'pointer', color: 'inherit' }}
              >
                <ListingScoreRing score={job.score} size={34} caption={false} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--body)', fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--white)', letterSpacing: '-.015em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.title}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayCompanyName(job.company)}{job.location ? ` · ${displayLocation(job.location)}` : ''}{displayPay(job) ? ` · ${displayPay(job)}` : ''}</div>
                  {reason && <div data-testid="match-reason" style={{ fontFamily: 'var(--body)', fontSize: 'var(--fs-meta)', color: 'var(--text-3)', marginTop: 2, lineHeight: 1.4 }}>{reason}</div>}
                  {summaryOnly && <div data-testid="summary-only" style={{ fontFamily: 'var(--body)', fontSize: 'var(--fs-meta)', color: 'var(--text-3)', marginTop: 2, lineHeight: 1.4 }}>Summary only — open it to see the full requirements</div>}
                </div>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--accent)', flexShrink: 0 }}>Open →</span>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
