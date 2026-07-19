'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { normalizeClaimCompany } from '@/lib/server/employerClaims'

// Login-scoping for the SERVER-rendered employer surfaces (analytics, notifications).
//
// Those pages are React Server Components: they scope by ?company= and cannot read the employer's
// client-side Supabase session. This tiny client guard bridges that gap — when a logged-in employer
// with an APPROVED claim lands on the page for a different (or no) company, it rewrites the URL to
// their claimed company so the server re-renders scoped to them. Logged-out visitors are untouched
// (the public ?company= lookup keeps working). God-view (admin, ?godview=1) always honors the param
// so an admin can view ANY company — it never redirects, and shows a clear god-view banner instead.
//
// The client dashboard (app/employers/dashboard) scopes directly via useAuth and does not need this.

export function EmployerScopeGuard({ param, godview = false }: { param: string; godview?: boolean }) {
  const { ready, isEmployer, employerCompany, claimsReady } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  const target = employerCompany || ''
  const mismatched = !!target && normalizeClaimCompany(param) !== normalizeClaimCompany(target)

  useEffect(() => {
    // Only redirect once we truly know the employer's company, and never in god-view.
    if (godview) return
    if (!ready || !claimsReady) return
    if (isEmployer && target && mismatched) {
      router.replace(`${pathname}?company=${encodeURIComponent(target)}`)
    }
  }, [godview, ready, claimsReady, isEmployer, target, mismatched, pathname, router])

  if (godview) {
    return (
      <div style={chip('rgba(124,58,237,.35)', 'rgba(124,58,237,.08)')}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '.12em' }}>Admin god-view</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--sub)' }}>
          Viewing <span style={{ color: 'var(--white)', textTransform: 'capitalize' }}>{param || '—'}</span> as an admin — the same public data any visitor sees, scoped to this company.
        </span>
      </div>
    )
  }

  // A logged-in approved employer viewing their own company → a quiet "this is you" chip. While a
  // redirect is pending (mismatched), render nothing to avoid a flash of the wrong company's chip.
  if (ready && claimsReady && isEmployer && target && !mismatched) {
    return (
      <div style={chip('rgba(16,185,129,.3)', 'rgba(16,185,129,.06)')}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '.12em' }}>Your company</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--sub)' }}>
          Signed in — showing <span style={{ color: 'var(--white)', textTransform: 'capitalize' }}>{target}</span>. This surface is scoped to your approved company.
        </span>
      </div>
    )
  }

  return null
}

function chip(border: string, bg: string): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap',
    border: `1px solid ${border}`, background: bg, borderRadius: 10,
    padding: '.55rem .9rem', marginBottom: '1.4rem',
  }
}
