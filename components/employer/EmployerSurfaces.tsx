'use client'

import Link from 'next/link'
import { useEmployerCompany } from './EmployerCompanyContext'

// The portal's jump-off to the three deep-dive employer surfaces (seen-command#113):
//   • /employers/dashboard     — your postings + the applicant outcomes candidates reported
//   • /employers/analytics     — how your postings actually perform (sources, volume, rates)
//   • /employers/notifications — new applicants + postings going stale/expiring, computed live
//
// All three are company-scoped by NAME via ?company= (there is no employer login — see each
// surface's page header). We carry the company the employer entered/looked up elsewhere on the
// portal (shared via EmployerCompanyContext) through to every surface when it's set; when it
// isn't, we link to the bare route and let each surface show its own company-entry state. The
// input here binds to that same shared company, so setting it once carries everywhere.

const mono = (size: string, color: string): React.CSSProperties => ({ fontFamily: 'var(--mono)', fontSize: size, color })

// All three point at the ONE unified hub (/employers/dashboard), each deep-linking to its tab —
// no more redirect hop through the retired standalone pages.
const SURFACES: { tab?: string; emoji: string; title: string; desc: string }[] = [
  { emoji: '▦', title: 'Your dashboard', desc: 'Every live posting Seen has indexed for you, next to the real outcomes candidates reported after applying.' },
  { tab: 'analytics', emoji: '📈', title: 'Posting analytics', desc: 'Where your applicants come from, application volume over time, and your response and ghost rates by role.' },
  { tab: 'updates', emoji: '🔔', title: 'Posting updates', desc: 'New applicants and postings about to go stale or expire — computed live the moment you open it.' },
]

export function EmployerSurfaces() {
  const { company, setCompany } = useEmployerCompany()
  const q = company.trim()
  const hrefFor = (tab?: string) => {
    const usp = new URLSearchParams()
    if (tab) usp.set('tab', tab)
    if (q) usp.set('company', q)
    const qs = usp.toString()
    return qs ? `/employers/dashboard?${qs}` : '/employers/dashboard'
  }

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 18, padding: '2rem', marginBottom: '2.5rem' }}>
      <div style={{ ...mono('.55rem', 'var(--blue)'), textTransform: 'uppercase', letterSpacing: '.16em', marginBottom: '.5rem' }}>Your tools</div>
      <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.5rem', fontWeight: 800, color: 'var(--white)', margin: '0 0 .5rem', letterSpacing: '-.02em' }}>Your dashboard, analytics &amp; notifications.</h2>
      <p style={{ color: 'var(--sub)', fontSize: '.85rem', lineHeight: 1.7, margin: '0 0 1.4rem', maxWidth: 560 }}>
        Go beyond the headline grade: track every posting and applicant outcome, see how your listings actually perform, and stay ahead of new applicants and expiring posts. Enter your company once and we&apos;ll carry it through to each.
      </p>

      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', marginBottom: '1.6rem' }}>
        <input
          value={company}
          onChange={e => setCompany(e.target.value)}
          placeholder="Your company name"
          aria-label="Your company name"
          autoComplete="organization"
          style={{ flex: 1, minWidth: 220, background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 9, padding: '.7rem .9rem', ...mono('.75rem', 'var(--white)'), outline: 'none' }}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '1rem' }}>
        {SURFACES.map(s => (
          <Link key={s.title} href={hrefFor(s.tab)} style={{ display: 'block', background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 14, padding: '1.3rem', textDecoration: 'none' }}>
            <div style={{ fontSize: '1.2rem', marginBottom: '.5rem' }} aria-hidden>{s.emoji}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginBottom: '.3rem' }}>
              <span style={{ fontFamily: 'var(--display)', fontSize: '.95rem', fontWeight: 700, color: 'var(--white)' }}>{s.title}</span>
              <span style={{ color: 'var(--blue)' }} aria-hidden>→</span>
            </div>
            <p style={{ color: 'var(--sub)', fontSize: '.72rem', lineHeight: 1.6, margin: 0 }}>{s.desc}</p>
          </Link>
        ))}
      </div>

      <p style={{ ...mono('.55rem', 'var(--muted)'), lineHeight: 1.6, margin: '1.1rem 0 0' }}>
        {q
          ? <>Carrying <span style={{ color: 'var(--sub)' }}>{q}</span> through to your dashboard. The reputation view is public; posting, disputes, and applicant updates unlock once your company claim is approved.</>
          : <>Enter your company above, or open the dashboard and set it there. The reputation view is public; managing listings and updates needs an approved company claim.</>}
      </p>
    </div>
  )
}
