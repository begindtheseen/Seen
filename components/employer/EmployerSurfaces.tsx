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
// no more redirect hop through the retired standalone pages. Rendered as one sentence with three
// links, not three identical cards (DESIGN.md §5).
const SURFACES: { tab?: string; title: string }[] = [
  { title: 'your dashboard' },
  { tab: 'analytics', title: 'posting analytics' },
  { tab: 'updates', title: 'posting updates' },
]
const surfaceLink: React.CSSProperties = { color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }

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
      <div style={{ ...mono('var(--fs-meta)', 'var(--text-3)'), textTransform: 'uppercase', letterSpacing: '.16em', marginBottom: '.5rem' }}>Your tools</div>
      <h2 style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-xl)', fontWeight: 800, color: 'var(--white)', margin: '0 0 .5rem', letterSpacing: '-.02em' }}>Your dashboard, analytics &amp; notifications.</h2>

      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <input
          value={company}
          onChange={e => setCompany(e.target.value)}
          placeholder="Your company name"
          aria-label="Your company name"
          autoComplete="off"
          style={{ flex: 1, minWidth: 220, background: 'var(--raised)', border: '1px solid var(--border-2)', borderRadius: 10, padding: '.75rem 1rem', fontFamily: 'var(--body)', fontSize: 'var(--fs-ui)', color: 'var(--text-1)', outline: 'none' }}
        />
      </div>

      <p style={{ color: 'var(--sub)', fontSize: 'var(--fs-body)', lineHeight: 1.7, margin: 0, maxWidth: 560 }}>
        Open <Link href={hrefFor(SURFACES[0].tab)} style={surfaceLink}>{SURFACES[0].title}</Link> for every live posting Seen has
        indexed next to the outcomes candidates reported, <Link href={hrefFor(SURFACES[1].tab)} style={surfaceLink}>{SURFACES[1].title}</Link> for
        where applicants come from and your response and ghost rates by role, and <Link href={hrefFor(SURFACES[2].tab)} style={surfaceLink}>{SURFACES[2].title}</Link> for
        new applicants and postings about to go stale — computed live the moment you open it.
      </p>

      <p style={{ ...mono('var(--fs-meta)', 'var(--muted)'), lineHeight: 1.6, margin: '1rem 0 0' }}>
        {q
          ? <>Carrying <span style={{ color: 'var(--sub)' }}>{q}</span> through to your dashboard. The reputation view is public; posting, disputes, and applicant updates unlock once your company claim is approved.</>
          : <>Enter your company above, or open the dashboard and set it there. The reputation view is public; managing listings and updates needs an approved company claim.</>}
      </p>
    </div>
  )
}
