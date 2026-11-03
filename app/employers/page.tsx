import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import Reveal from '@/components/Reveal'
import { EmployerNav, EmployerFooter } from '@/components/employer/EmployerNav'
import { EmployerCheckout, EmployerPurchaseConfirm } from '@/components/EmployerCheckout'
import { EmployerCompanyProvider } from '@/components/employer/EmployerCompanyContext'
import { EmployerClaimPanel } from '@/components/employer/EmployerClaimPanel'
import { EmployerReputation } from '@/components/employer/EmployerReputation'
import { EmployerListings } from '@/components/employer/EmployerListings'
import { EmployerSurfaces } from '@/components/employer/EmployerSurfaces'
import Icon, { type IconName } from '@/components/ui/Icon'
import Button from '@/components/ui/Button'

// The employer portal — a distinct, employer-first experience. The seeker Nav + Footer hide
// themselves on /employers (see components/Nav.tsx / Footer.tsx), so nothing job-seeker ever shows
// here. Everything is oriented around what an employer needs to hire: see your reputation
// (what candidates see before applying), get in front of ready-to-apply candidates, and prove you
// respond. NOTE: the portal creates NO seeker/user accounts — reputation is a read-only lookup and
// checkout writes only to the employer-namespaced tables (employer_purchases / employer_perks), so
// employer activity can never mix into seeker data.

export const metadata: Metadata = pageMetadata({
  title: 'Seen for Employers — Hire people who actually show up',
  description:
    'See your hiring reputation the way candidates do — your ghost rate, response rate, and Seen grade — then get in front of ready-to-apply candidates with Featured placement and the Transparency Verified badge.',
  path: '/employers',
  ogTitle: 'Seen for Employers',
  ogDescription: 'Hire people who actually show up. See your reputation, reach candidates, prove you respond.',
})

const wrap = { maxWidth: 900, margin: '0 auto', padding: '0 1.5rem', width: '100%', boxSizing: 'border-box' as const }

// The hero's three proof chips: an icon from the one icon set, never an emoji (DESIGN.md §2).
const CHIPS: { icon: IconName; label: string }[] = [
  { icon: 'chart-column', label: 'Your reputation, candidate-side' },
  { icon: 'star', label: 'Featured placement' },
  { icon: 'shield-check', label: 'Transparency Verified' },
]

export default function EmployersPage() {
  return (
    <div className="rise-in" style={{ minHeight: '100vh', background: 'radial-gradient(ellipse at 15% -5%, var(--accent-tint) 0%, transparent 55%)' }}>
      {/* Shared employer chrome — logo→home, organized menu, sign out, mobile drawer (EmployerNav.tsx) */}
      <EmployerNav />

      <div style={{ ...wrap, padding: '7rem 1.5rem 5rem' }}>
        {/* Hero. No "For employers" eyebrow: the nav wordmark already says it, and on a phone the two sat
            one above the other. */}
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: 'clamp(1.9rem,6vw,2.8rem)', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', lineHeight: 1.05, margin: '0 auto 1rem', maxWidth: 640 }}>
            Hire the people who actually show up.
          </h1>
          <p style={{ color: 'var(--sub)', fontSize: 'var(--fs-body)', lineHeight: 1.75, maxWidth: 580, margin: '0 auto 2rem' }}>
            Candidates check Seen before they apply. See exactly what they see about you, get in front of the ones ready to apply, and prove you respond — so the strongest people don&apos;t self-select out.
          </p>
          <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            {CHIPS.map(c => (
              <span key={c.label} className="vibe v-b" style={{ padding: '.5rem 1rem', gap: '.5rem' }}><Icon name={c.icon} size={14} />{c.label}</span>
            ))}
          </div>
        </div>

        {/* Post-checkout confirmation (renders only on the Stripe return) */}
        <EmployerPurchaseConfirm />

        {/* The company an employer looks up in any card below is shared, so the deep-dive surface
            links (dashboard / analytics / notifications) carry it through as ?company= (#113). */}
        <EmployerCompanyProvider>
          {/* Claim your company (ADMIN-APPROVED CLAIMS, migration 053): a signed-in employer
              requests a company; an admin approves every claim (no auto-approval since the 2026-11-01 audit), and
              only then do the surfaces below auto-scope. Renders a quiet sign-in
              prompt for logged-out/seeker visitors. The #claim anchor is the dashboard checklist's
              "Claim your company" target. */}
          <div id="claim" style={{ scrollMarginTop: 80 }}>
            <EmployerClaimPanel />
          </div>

          {/* Anchor feature: your reputation the way candidates see it */}
          <EmployerReputation />

          {/* Manage your listings — close a filled role in one verified click (seen-command#94) */}
          <EmployerListings />

          {/* Jump to your dashboard, analytics & notifications — company carried through (#113) */}
          <EmployerSurfaces />
        </EmployerCompanyProvider>

        {/* Why it matters — one short paragraph, not four identical cards (DESIGN.md §5: less on the screen). */}
        <Reveal>
        <p style={{ color: 'var(--sub)', fontSize: 'var(--fs-body)', lineHeight: 1.75, maxWidth: 640, margin: '0 auto 3rem', textAlign: 'center' }}>
          Candidates check your ghost rate and response rate before they apply, and the best ones have options.
          Jobs you post or import on Seen rank ahead of aggregated listings for free; Featured placement puts
          them above standard results for matching searches; the Transparency Verified badge is a public
          commitment to respond, reviewed against real outcome data.
        </p>
        </Reveal>

        {/* Promote — real, no-login checkout */}
        <div id="promote" style={{ scrollMarginTop: 80 }}>
          <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
            <h2 style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-xl)', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.02em', margin: '0 0 .5rem' }}>Get in front of candidates</h2>
            <p style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.14em' }}>One-time · no account needed</p>
          </div>
          <EmployerCheckout />
          <p style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--muted)', lineHeight: 1.6, marginBottom: '3rem' }}>
            Payments never change a company&apos;s transparency score. Featured buys reach; Transparency Verified is a commitment we review against real applicant outcomes.
          </p>
        </div>

        {/* Enterprise / contact */}
        <Reveal>
        <div style={{ textAlign: 'center', padding: '2rem', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16 }}>
          <div style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-lead)', fontWeight: 800, color: 'var(--white)', marginBottom: '.5rem' }}>Hiring across many roles or locations?</div>
          <p style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--sub)', marginBottom: '1rem' }}>We&apos;ll set up multi-location placement, verified badges, and applicant reporting for your team.</p>
          <Button href="mailto:hello@seenjobs.io?subject=Seen for Employers — Enterprise" variant="secondary" iconRight="arrow-right">Talk to us</Button>
        </div>
        </Reveal>
      </div>

      <EmployerFooter />
    </div>
  )
}
