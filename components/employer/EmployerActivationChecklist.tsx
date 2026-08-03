'use client'

import Link from 'next/link'
import { useAuth } from '@/lib/auth'

// The employer activation checklist — shown on the dashboard to a signed-in employer who hasn't
// finished setting up (no approved claim yet). It replaces the old dead-end where a fresh employer
// landed on an empty "type any company" lookup with no idea what to do next. Each step reflects real
// state from the claim system; the current step gets the primary CTA.
//
// Step 1 (claim) is the gate: analytics/listings/updates only unlock once a claim is approved, so
// steps 2+ show as locked until then. A work-email claim auto-approves instantly (see
// api/employer-claims.js), so for most employers this checklist clears itself on the first step.

type StepState = 'done' | 'current' | 'locked'

function Row({ n, state, title, desc, cta }: { n: number; state: StepState; title: string; desc: string; cta?: React.ReactNode }) {
  const done = state === 'done'
  const locked = state === 'locked'
  return (
    <div style={{ display: 'flex', gap: '.85rem', alignItems: 'flex-start', padding: '.95rem 0', opacity: locked ? 0.55 : 1 }}>
      <span
        aria-hidden
        style={{
          flexShrink: 0, width: 26, height: 26, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--mono)', fontSize: '.7rem', fontWeight: 700,
          background: done ? 'rgba(16,185,129,.15)' : locked ? 'var(--raised)' : 'linear-gradient(135deg,#1d4ed8,#7c3aed)',
          color: done ? 'var(--green)' : '#fff',
          border: done ? '1px solid rgba(16,185,129,.4)' : locked ? '1px solid var(--line2)' : 'none',
        }}
      >
        {done ? '✓' : locked ? '🔒' : n}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontFamily: 'var(--display)', fontSize: '.9rem', fontWeight: 700, color: 'var(--white)' }}>{title}</div>
        <p style={{ color: 'var(--sub)', fontSize: '.74rem', lineHeight: 1.6, margin: '.15rem 0 0' }}>{desc}</p>
        {state === 'current' && cta ? <div style={{ marginTop: '.6rem' }}>{cta}</div> : null}
      </div>
    </div>
  )
}

const primaryLink: React.CSSProperties = {
  display: 'inline-block', background: 'linear-gradient(135deg,#1d4ed8,#7c3aed)', border: 'none', borderRadius: 8,
  padding: '.55rem 1.1rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.76rem', color: '#fff', textDecoration: 'none',
}
const ghostLink: React.CSSProperties = {
  display: 'inline-block', border: '1px solid var(--line2)', borderRadius: 8, padding: '.55rem 1rem',
  fontFamily: 'var(--mono)', fontSize: '.66rem', color: 'var(--white)', textDecoration: 'none',
}

export default function EmployerActivationChecklist() {
  const { employerClaim, employerCompany } = useAuth()
  const status = employerClaim?.status
  const approved = status === 'approved' && !!employerCompany
  const pending = status === 'pending'

  // Step 1 — claim. Done when approved; "current" otherwise (pending shows an in-review CTA).
  const claimState: StepState = approved ? 'done' : 'current'
  // Steps 2+ unlock only once the claim is approved.
  const gatedState: StepState = approved ? 'current' : 'locked'

  const claimCta = pending ? (
    <span style={{ fontFamily: 'var(--mono)', fontSize: '.66rem', color: 'var(--amber)' }}>
      In review — we&apos;ll email you the moment it&apos;s approved.
    </span>
  ) : (
    <Link href="/employers#claim" style={primaryLink}>Claim your company →</Link>
  )

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16, padding: '1.6rem', marginBottom: '1.6rem' }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.16em', color: 'var(--blue)', marginBottom: '.4rem' }}>Get set up</div>
      <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.15rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.02em', margin: '0 0 .3rem' }}>
        {pending ? 'Your claim is in review' : 'Two minutes to your dashboard'}
      </h2>
      <p style={{ color: 'var(--sub)', fontSize: '.78rem', lineHeight: 1.6, margin: '0 0 .6rem', maxWidth: 560 }}>
        {pending
          ? 'Once approved, your listings, analytics, and applicant updates unlock below — all scoped to your company.'
          : 'Claim your company to unlock your listings, analytics, and the outcomes candidates reported about you. If you sign up with your work email, approval is instant.'}
      </p>

      <div style={{ borderTop: '1px solid var(--line)' }}>
        <Row n={1} state={claimState} title="Claim your company" desc="Verify you represent the company. A matching work-email domain approves instantly; anything else is a quick manual review." cta={claimCta} />
        <div style={{ borderTop: '1px solid var(--line)' }} />
        <Row
          n={2} state={gatedState} title="Post your first role"
          desc="Put an open role in front of candidates already searching Seen — your listing shows on the jobs page for 60 days."
          cta={<Link href="/employers/dashboard?tab=listings" style={primaryLink}>Post a role →</Link>}
        />
        <div style={{ borderTop: '1px solid var(--line)' }} />
        <Row
          n={3} state={approved ? 'current' : 'locked'} title="Get seen & prove you respond"
          desc="Feature your roles to the top of matching searches, and enroll in Transparency Verified to publicly commit to responding."
          cta={<Link href="/employers#promote" style={ghostLink}>See placement & Verified →</Link>}
        />
      </div>
    </div>
  )
}
