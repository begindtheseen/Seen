import type { Metadata } from 'next'
import Link from 'next/link'
import { EmployerCheckout, EmployerPurchaseConfirm } from '@/components/EmployerCheckout'
import { EmployerCompanyProvider } from '@/components/employer/EmployerCompanyContext'
import { EmployerReputation } from '@/components/employer/EmployerReputation'
import { EmployerListings } from '@/components/employer/EmployerListings'
import { EmployerSurfaces } from '@/components/employer/EmployerSurfaces'

// The employer portal — a distinct, employer-first experience. The seeker Nav + Footer hide
// themselves on /employers (see components/Nav.tsx / Footer.tsx), so nothing job-seeker ever shows
// here. Everything is oriented around what an employer needs to hire: see your reputation
// (what candidates see before applying), get in front of ready-to-apply candidates, and prove you
// respond. NOTE: the portal creates NO seeker/user accounts — reputation is a read-only lookup and
// checkout writes only to the employer-namespaced tables (employer_purchases / employer_perks), so
// employer activity can never mix into seeker data.

export const metadata: Metadata = {
  title: 'Seen for Employers — Hire people who actually show up',
  description:
    'See your hiring reputation the way candidates do — your ghost rate, response rate, and Seen grade — then get in front of ready-to-apply candidates with Featured placement and the Transparency Verified badge.',
  alternates: { canonical: 'https://seenjobs.io/employers' },
  openGraph: { title: 'Seen for Employers', description: 'Hire people who actually show up. See your reputation, reach candidates, prove you respond.', url: 'https://seenjobs.io/employers', type: 'website', siteName: 'Seen' },
}

const wrap = { maxWidth: 900, margin: '0 auto', padding: '0 1.5rem', width: '100%', boxSizing: 'border-box' as const }

export default function EmployersPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'radial-gradient(ellipse at 15% -5%,rgba(29,78,216,0.12) 0%,transparent 55%),radial-gradient(ellipse at 100% 5%,rgba(124,58,237,0.09) 0%,transparent 45%)' }}>
      {/* Employer-first header — no seeker nav */}
      <header style={{ borderBottom: '1px solid var(--line)', background: 'rgba(5,7,15,.7)', backdropFilter: 'blur(12px)', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ ...wrap, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '.9rem 1.5rem' }}>
          <Link href="/employers" style={{ display: 'flex', alignItems: 'center', gap: '.55rem', textDecoration: 'none' }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--blue)', boxShadow: '0 0 8px var(--blue)' }} />
            <span style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: '1.05rem', color: 'var(--white)', letterSpacing: '-.02em' }}>Seen</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.12em' }}>for employers</span>
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <a href="#promote" style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--sub)', textDecoration: 'none' }}>Pricing</a>
            <Link href="/jobs" style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)', textDecoration: 'none' }}>Looking for a job? →</Link>
          </div>
        </div>
      </header>

      <div style={{ ...wrap, padding: '3.5rem 1.5rem 5rem' }}>
        {/* Hero */}
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.22em', color: 'var(--blue)', marginBottom: '.7rem' }}>For employers</div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: 'clamp(1.9rem,6vw,2.8rem)', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', lineHeight: 1.05, margin: '0 auto .9rem', maxWidth: 640 }}>
            Hire the people who actually show up.
          </h1>
          <p style={{ color: 'var(--sub)', fontSize: '.95rem', lineHeight: 1.75, maxWidth: 580, margin: '0 auto 2rem' }}>
            Candidates check Seen before they apply. See exactly what they see about you, get in front of the ones ready to apply, and prove you respond — so the strongest people don&apos;t self-select out.
          </p>
          <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            {['📊 Your reputation, candidate-side', '★ Featured placement', '✓ Transparency Verified'].map(b => (
              <span key={b} className="vibe v-b" style={{ padding: '.4rem .9rem' }}>{b}</span>
            ))}
          </div>
        </div>

        {/* Post-checkout confirmation (renders only on the Stripe return) */}
        <EmployerPurchaseConfirm />

        {/* The company an employer looks up in any card below is shared, so the deep-dive surface
            links (dashboard / analytics / notifications) carry it through as ?company= (#113). */}
        <EmployerCompanyProvider>
          {/* Anchor feature: your reputation the way candidates see it */}
          <EmployerReputation />

          {/* Manage your listings — close a filled role in one verified click (seen-command#94) */}
          <EmployerListings />

          {/* Jump to your dashboard, analytics & notifications — company carried through (#113) */}
          <EmployerSurfaces />
        </EmployerCompanyProvider>

        {/* Why it matters — real mechanism, honest */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: '1rem', marginBottom: '3rem' }}>
          {[
            { t: 'Candidates screen you first', d: 'Before applying, people check your ghost rate and response rate on Seen. A bad record silently kills your applicant flow — the best candidates have options.' },
            { t: 'Featured = more of the right applicants', d: 'Featured placement puts your listings above standard results for matching searches, in front of candidates already looking for what you offer.' },
            { t: 'Verified = trust that converts', d: 'The Transparency Verified badge is a public commitment to respond — reviewed against real outcome data. It tells strong candidates you’re worth their time.' },
          ].map(c => (
            <div key={c.t} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '1.4rem' }}>
              <div style={{ fontFamily: 'var(--display)', fontSize: '.95rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.4rem' }}>{c.t}</div>
              <p style={{ color: 'var(--sub)', fontSize: '.78rem', lineHeight: 1.65, margin: 0 }}>{c.d}</p>
            </div>
          ))}
        </div>

        {/* Promote — real, no-login checkout */}
        <div id="promote" style={{ scrollMarginTop: 80 }}>
          <div style={{ textAlign: 'center', marginBottom: '1.4rem' }}>
            <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.5rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.02em', margin: '0 0 .4rem' }}>Get in front of candidates</h2>
            <p style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.14em' }}>One-time · no account needed</p>
          </div>
          <EmployerCheckout />
          <p style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)', lineHeight: 1.6, marginBottom: '3rem' }}>
            Payments never change a company&apos;s transparency score. Featured buys reach; Transparency Verified is a commitment we review against real applicant outcomes.
          </p>
        </div>

        {/* Enterprise / contact */}
        <div style={{ textAlign: 'center', padding: '2rem', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16 }}>
          <div style={{ fontFamily: 'var(--display)', fontSize: '1.05rem', fontWeight: 800, color: 'var(--white)', marginBottom: '.5rem' }}>Hiring across many roles or locations?</div>
          <p style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--sub)', marginBottom: '1rem' }}>We&apos;ll set up multi-location placement, verified badges, and applicant reporting for your team.</p>
          <a href="mailto:hello@seenjobs.io?subject=Seen for Employers — Enterprise" style={{ display: 'inline-block', background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)', border: 'none', borderRadius: 8, padding: '.7rem 1.8rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.82rem', color: '#fff', textDecoration: 'none' }}>Talk to us →</a>
        </div>
      </div>

      {/* Employer-first footer (no seeker links) */}
      <footer style={{ borderTop: '1px solid var(--line)', padding: '1.4rem 1.5rem' }}>
        <div style={{ ...wrap, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.6rem' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)' }}>© 2026 Seen · for employers</span>
          <div style={{ display: 'flex', gap: '1.1rem' }}>
            <a href="#promote" style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', textDecoration: 'none' }}>Pricing</a>
            <Link href="/legal" style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', textDecoration: 'none' }}>Legal</Link>
            <a href="mailto:hello@seenjobs.io" style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', textDecoration: 'none' }}>Contact</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
