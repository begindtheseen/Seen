'use client'

// "Matched to your résumé" — a compact rail of local, same-role-family listings. Replaces the
// 340px swipe deck that opened the signed-in /jobs page with a Dallas hotel-sales job for a
// Phoenix sales associate (live audit 2026-10-23). The page shows it with ≥1 real in-radius match
// (the second audit's persona had exactly one Phoenix match and saw nothing) and hides it the
// moment a search is typed; rows are short so the search stays at the top of a 390px phone.

import type { Job } from '@/lib/types'
import ListingScoreRing from '@/components/jobs/ListingScoreRing'
import { displayCompanyName } from '@/lib/companyDisplay'
import { displayPay } from '@/lib/jobs/pay.js'

export default function ResumeMatches({ jobs, loading, skills, city, citySource, onOpen }: {
  jobs: Job[]
  loading: boolean
  skills: string[]
  city: string | null
  /** Where the city came from — the profile, or the résumé's own contact line. */
  citySource?: 'profile' | 'resume' | null
  onOpen: (job: Job) => void
}) {
  const rows = jobs.slice(0, 5)
  return (
    <section aria-label="Matched to your résumé" style={{ marginBottom: '1.35rem', paddingBottom: '1.1rem', borderBottom: '1px solid var(--line)' }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--green)', marginBottom: '.6rem', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ width: 20, height: 1.5, background: 'linear-gradient(90deg, var(--green), #8b5cf6)', display: 'inline-block', flexShrink: 0 }} />
        Matched to your résumé
        {city && (
          <span style={{ color: 'var(--dim)', letterSpacing: 'normal', textTransform: 'none', fontSize: '.6rem' }}>· near {city}{citySource === 'resume' ? ' (from your résumé)' : ''}, same role family{skills.length ? ` · ${skills.slice(0, 2).join(', ')}` : ''}</span>
        )}
      </div>
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
          {[0, 1].map(i => <div key={i} style={{ height: 46, background: 'var(--raised)', borderRadius: 10, animation: `pulse 1.4s ${i * 0.15}s ease infinite` }} />)}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
          {rows.map(job => {
            return (
              <button
                key={job.id}
                type="button"
                onClick={() => onOpen(job)}
                style={{ display: 'flex', alignItems: 'center', gap: '.7rem', width: '100%', minWidth: 0, textAlign: 'left', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '.55rem .75rem', cursor: 'pointer', color: 'inherit' }}
              >
                <ListingScoreRing score={job.score} size={34} caption={false} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--display)', fontSize: '.84rem', fontWeight: 700, color: 'var(--white)', letterSpacing: '-.015em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.title}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayCompanyName(job.company)}{job.location ? ` · ${job.location}` : ''}{displayPay(job) ? ` · ${displayPay(job)}` : ''}</div>
                </div>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--green)', flexShrink: 0 }}>Open →</span>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
