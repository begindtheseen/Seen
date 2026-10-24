'use client'

// Where a "Start free trial" click continues after sign-up, so the intent is never lost (conversion
// audit 2026-10-24: a guest who tapped the trial button signed up, confirmed, landed on /dashboard and
// had to find /pricing again — about ten steps from intent to Stripe).
//
//   guest      → sign-up with intent=trial and next=/trial?plan=… (lib/signupIntent.js trialSignupHref)
//   signed in  → the trial checkout starts at once (the same POST /api/stripe?action=checkout the pricing
//                page sends: 7-day no-card trial, api/stripe.js); the button stays as the manual path
//   already Pro → says so and links to the membership view on /pricing
// The plan comes from the button that was tapped (?plan=monthly|yearly). Prices from lib/pricing.ts.

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth'
import { aiHeaders } from '@/lib/aiHeaders'
import { PRO_TRIAL_DAYS } from '@/lib/creditRules'
import { PRO_MONTHLY, PRO_YEARLY_TOTAL, usd } from '@/lib/pricing'
import { trialSignupHref } from '@/lib/signupIntent.js'
import s from '@/components/track/track.module.css'

function TrialInner() {
  const router = useRouter()
  const params = useSearchParams()
  const plan: 'monthly' | 'yearly' = params.get('plan') === 'yearly' ? 'yearly' : 'monthly'
  const { isLoggedIn, isEmployer, ready } = useAuth()
  const [state, setState] = useState<'checking' | 'starting' | 'ready' | 'pro'>('checking')
  const [error, setError] = useState('')
  const started = useRef(false)

  async function start() {
    if (started.current) return
    started.current = true
    setState('starting'); setError('')
    try {
      const r = await fetch('/api/stripe?action=checkout', { method: 'POST', headers: await aiHeaders(), body: JSON.stringify({ plan }) })
      const d = await r.json().catch(() => ({})) as { url?: string; error?: string }
      if (d.url) { window.location.href = d.url; return } // the ref stays set: this page is leaving
      setError(r.status === 503 ? 'Payments are not switched on yet. Every feature is unlocked during early launch, so there is nothing to do.' : (d.error || 'The trial could not start. Try again, or email hello@seenjobs.io.'))
    } catch {
      setError('Network error. Check your connection and try again.')
    }
    started.current = false
    setState('ready')
  }

  useEffect(() => {
    if (!ready) return
    if (!isLoggedIn) { router.replace(trialSignupHref(plan)); return }
    if (isEmployer) { router.replace('/employers/dashboard'); return }
    let alive = true
    ;(async () => {
      // Already Pro (a trial or a plan): never open a second checkout.
      try {
        const r = await fetch('/api/user-sync', { method: 'POST', headers: await aiHeaders(), body: JSON.stringify({ action: 'get_credits' }) })
        const d = await r.json().catch(() => null) as { pro?: boolean } | null
        if (!alive) return
        if (d?.pro) { setState('pro'); return }
      } catch { /* unknown: offer the trial, the server still decides */ }
      if (alive) void start()
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, isLoggedIn, isEmployer, plan])

  const price = plan === 'yearly' ? `${usd(PRO_YEARLY_TOTAL)}/year` : `${usd(PRO_MONTHLY)}/month`

  return (
    <div className="page-full">
      <div style={{ maxWidth: 520, margin: '0 auto', padding: '3rem 16px 4rem', boxSizing: 'border-box', width: '100%' }}>
        <section className={s.card} style={{ marginTop: 0 }} data-testid="trial-page">
          {state === 'pro' ? (
            <>
              <h1 className={s.title} style={{ fontSize: '1.35rem' }}>You already have Seen Pro</h1>
              <p className={s.sub}>Your plan and its renewal date are on the pricing page.</p>
              <Link href="/pricing" className={s.primary}>See my membership</Link>
            </>
          ) : (
            <>
              <h1 className={s.title} style={{ fontSize: '1.35rem' }}>Start your {PRO_TRIAL_DAYS}-day free trial</h1>
              <p className={s.sub}>
                {state === 'starting' || state === 'checking' ? 'Opening the secure checkout…' : 'No card needed. Stripe asks only for your email.'}
              </p>
              <button type="button" className={s.primary} onClick={() => void start()} disabled={state === 'starting' || state === 'checking'} data-testid="trial-start">
                {state === 'starting' || state === 'checking' ? 'Opening…' : `Start your ${PRO_TRIAL_DAYS}-day trial · no card`}
              </button>
              {error && <p className={s.err} role="alert">{error}</p>}
              <p className={s.small}>
                Free for {PRO_TRIAL_DAYS} days. If you add a payment method, it renews at {price} after the trial. Without one, access simply ends. Cancel anytime. <Link href="/terms#billing" style={{ color: 'var(--green)' }}>Subscription Terms</Link>
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

export default function TrialPage() {
  return (
    <Suspense fallback={null}>
      <TrialInner />
    </Suspense>
  )
}
