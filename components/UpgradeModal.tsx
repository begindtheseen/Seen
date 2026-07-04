'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { aiHeaders } from '@/lib/aiHeaders'
import { FREE_DAILY_CREDITS, PRO_TRIAL_DAYS, ONE_TIME_SKUS } from '@/lib/creditRules'

const OPT_WORD = FREE_DAILY_CREDITS === 1 ? 'optimization' : 'optimizations'

// One-time SKUs — copy generated from the same constants the server fulfills with.
const SPRINT = ONE_TIME_SKUS.sprint       // $14.99 · 30 credits + 7 days Pro
const CREDITS20 = ONE_TIME_SKUS.credits20 // $4.99 · 20 credits
const skuPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`

interface UpgradeModalProps {
  reason: 'credits' | 'pro' | 'generic'
  onClose: () => void
  featureName?: string // e.g. "Human Voice", "HumanProof"
}

const MONTHLY_PRICE = '$9.99'
const YEARLY_PRICE = '$6.99'           // per-month, billed annually
const MONTHLY_NUM = 9.99
const YEARLY_NUM = 6.99
const YEARLY_TOTAL = +(YEARLY_NUM * 12).toFixed(2)       // 83.88
const ANNUAL_SAVINGS = +(MONTHLY_NUM * 12 - YEARLY_TOTAL).toFixed(2) // ~35.99

const PRO_BULLETS = [
  { icon: '∞', label: 'Unlimited AI credits', sub: 'No daily cap, optimize every application' },
  { icon: '📊', label: 'AI company insights', sub: 'Ghost risk, culture, hiring trends' },
  { icon: '🗣', label: 'Human Voice', sub: 'Rewrites that sound like you, not a bot' },
  { icon: '⚡', label: 'Priority support', sub: 'Real humans, fast replies' },
]

// Contextual headline + subcopy keyed off the trigger. Honest, benefit-led — no
// "trick the ATS / beat the detector" framing.
function copyFor(reason: UpgradeModalProps['reason'], featureName?: string) {
  if (reason === 'credits') {
    return {
      headline: "You're out of credits for today.",
      sub: `Free gives you ${FREE_DAILY_CREDITS} AI ${OPT_WORD} a day. Pro removes the cap — tune every application while the role's still open.`,
    }
  }
  if (reason === 'pro') {
    if (featureName === 'HumanProof') {
      return {
        headline: 'Your application is optimized. Now make it sound real.',
        sub: 'Unlock HumanProof to remove generic AI tone, add truthful work context, and make your application interview-ready.',
      }
    }
    return {
      headline: `${featureName || 'This feature'} is a Pro feature`,
      sub: `Upgrade to unlock ${featureName || 'this'} — plus unlimited optimization, ghost-risk alerts, and deep company intel.`,
    }
  }
  return {
    headline: 'Stop guessing. Start getting responses.',
    sub: 'Unlimited résumé optimization, ghost-risk alerts before you apply, and deep company intel — for less than one week of coffee.',
  }
}

export default function UpgradeModal({ reason, onClose, featureName }: UpgradeModalProps) {
  const router = useRouter()
  const { isLoggedIn } = useAuth()
  // Annual is the recommended default.
  const [plan, setPlan] = useState<'monthly' | 'yearly'>('yearly')
  const [loading, setLoading] = useState(false)
  const [skuLoading, setSkuLoading] = useState<string | null>(null)
  const [error, setError] = useState('')

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Prevent body scroll while open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  async function handleUpgrade() {
    if (!isLoggedIn) {
      onClose()
      router.push('/login?next=/pricing')
      return
    }
    setLoading(true)
    setError('')
    try {
      const hdrs = await aiHeaders()
      const r = await fetch('/api/stripe?action=checkout', {
        method: 'POST',
        headers: hdrs,
        body: JSON.stringify({ plan }),
      })
      const d = await r.json()
      if (d.url) {
        window.location.href = d.url
      } else if (r.status === 503) {
        // Stripe not wired up yet — early launch. Everything's already unlocked, so frame
        // this as good news rather than a failed payment.
        setError('✦ Seen Pro is launching soon — and during early launch every feature is unlocked free. Nothing to do.')
        setLoading(false)
      } else {
        setError(d.error || 'Checkout unavailable — try again')
        setLoading(false)
      }
    } catch {
      setError('Network error — check connection and try again')
      setLoading(false)
    }
  }

  // One-time purchase (mode:'payment' on the server) — same checkout endpoint, sku body.
  async function handleOneTime(sku: 'sprint' | 'credits20') {
    if (!isLoggedIn) {
      onClose()
      router.push('/login?next=/pricing')
      return
    }
    setSkuLoading(sku)
    setError('')
    try {
      const hdrs = await aiHeaders()
      const r = await fetch('/api/stripe?action=checkout', {
        method: 'POST',
        headers: hdrs,
        body: JSON.stringify({ sku }),
      })
      const d = await r.json()
      if (d.url) {
        window.location.href = d.url
      } else if (r.status === 503) {
        setError('✦ Seen Pro is launching soon — and during early launch every feature is unlocked free. Nothing to do.')
        setSkuLoading(null)
      } else {
        setError(d.error || 'Checkout unavailable — try again')
        setSkuLoading(null)
      }
    } catch {
      setError('Network error — check connection and try again')
      setSkuLoading(null)
    }
  }

  const { headline, sub } = copyFor(reason, featureName)

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.82)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ width: '100%', maxWidth: 480, background: 'var(--surface)', borderRadius: '18px 18px 0 0', border: '1px solid rgba(99,102,241,.25)', boxShadow: '0 -40px 120px rgba(0,0,0,.7), 0 0 80px rgba(99,102,241,.2)', overflow: 'hidden', maxHeight: '94dvh', overflowY: 'auto' }}>

        {/* Handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '.6rem 0 .2rem' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--line2)' }} />
        </div>

        {/* Header */}
        <div style={{ padding: '1rem 1.25rem .75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontFamily: 'var(--display)', fontSize: '1.05rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.02em', marginBottom: '.25rem', lineHeight: 1.25 }}>
              {headline}
            </div>
            <div style={{ fontFamily: 'var(--body)', fontSize: '.72rem', color: 'var(--sub)', lineHeight: 1.55 }}>
              {sub}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', fontSize: '1rem', padding: '.2rem', lineHeight: 1, flexShrink: 0, marginLeft: '1rem' }}>✕</button>
        </div>

        <div style={{ padding: '0 1.25rem', paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}>

          {/* Feature list */}
          <div style={{ background: 'rgba(99,102,241,.07)', border: '1px solid rgba(99,102,241,.18)', borderRadius: 12, padding: '.85rem 1rem', marginBottom: '1.1rem' }}>
            {PRO_BULLETS.map(b => (
              <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: '.65rem', marginBottom: '.55rem' }}>
                <div style={{ fontSize: '1rem', width: 24, textAlign: 'center', flexShrink: 0 }}>{b.icon}</div>
                <div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', fontWeight: 700, color: 'var(--white)' }}>{b.label}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)' }}>{b.sub}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Plan toggle — yearly is recommended + visually prominent */}
          <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.5rem', alignItems: 'stretch' }}>
            {(['yearly', 'monthly'] as const).map(p => {
              const active = plan === p
              const isYear = p === 'yearly'
              return (
                <button
                  key={p}
                  onClick={() => setPlan(p)}
                  style={{
                    flex: isYear ? 1.25 : 1,
                    position: 'relative',
                    padding: isYear ? '.85rem .5rem .6rem' : '.6rem .5rem',
                    borderRadius: 11,
                    background: active
                      ? (isYear ? 'linear-gradient(150deg,rgba(99,102,241,.28),rgba(124,58,237,.16))' : 'rgba(99,102,241,.2)')
                      : 'none',
                    border: `1.5px solid ${active ? 'rgba(129,140,248,.65)' : 'var(--line2)'}`,
                    color: active ? '#c4b5fd' : 'var(--muted)',
                    fontFamily: 'var(--mono)', fontWeight: 700,
                    cursor: 'pointer', transition: 'all .15s', textAlign: 'center',
                    boxShadow: active && isYear ? '0 0 22px rgba(99,102,241,.25)' : 'none',
                  }}
                >
                  {isYear && (
                    <span style={{ position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)', background: 'linear-gradient(90deg,#4f46e5,#7c3aed)', color: '#fff', fontSize: '.5rem', fontWeight: 700, letterSpacing: '.06em', padding: '.18rem .55rem', borderRadius: 100, whiteSpace: 'nowrap' }}>
                      BEST VALUE · SAVE 30%
                    </span>
                  )}
                  <div style={{ fontSize: isYear ? '.78rem' : '.7rem', color: active ? 'var(--white)' : 'var(--sub)' }}>
                    {isYear ? `${YEARLY_PRICE}/mo` : `${MONTHLY_PRICE}/mo`}
                  </div>
                  <div style={{ fontSize: '.52rem', color: isYear ? 'var(--green)' : 'var(--muted)', marginTop: '.15rem', lineHeight: 1.4 }}>
                    {isYear ? `$${YEARLY_TOTAL}/yr · save $${ANNUAL_SAVINGS}` : 'billed monthly'}
                  </div>
                </button>
              )
            })}
          </div>

          {error && (
            <div style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 8, padding: '.55rem .85rem', margin: '.75rem 0', fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--red)' }}>
              {error}
            </div>
          )}

          {/* CTA */}
          <button
            onClick={handleUpgrade}
            disabled={loading}
            style={{
              width: '100%', padding: '.9rem', marginTop: '.6rem',
              background: loading ? 'var(--line)' : 'linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%)',
              border: 'none', borderRadius: 11,
              fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.9rem', color: '#fff',
              cursor: loading ? 'default' : 'pointer',
              boxShadow: loading ? 'none' : '0 0 28px rgba(99,102,241,.4)',
              transition: 'opacity .15s',
            }}
          >
            {loading ? 'Redirecting to checkout…' : `Start ${PRO_TRIAL_DAYS}-day free trial`}
          </button>

          {/* Trial + auto-renewal disclosure — shown at the point of purchase (FTC / state ARL compliance). */}
          <div style={{ fontFamily: 'var(--body)', fontSize: '.66rem', color: 'var(--sub)', textAlign: 'center', lineHeight: 1.6, marginTop: '.85rem' }}>
            Free for {PRO_TRIAL_DAYS} days. No card required. If you add a payment method, renews at
            {plan === 'yearly' ? ` $${YEARLY_TOTAL.toFixed(2)}/yr` : ` ${MONTHLY_PRICE}/mo`} after the trial — cancel
            anytime; without one, access simply ends. See <a href="/legal" style={{ color: 'var(--blue)' }}>Subscription Terms</a>.
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: '1.5rem', marginTop: '.75rem' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)' }}>🚫 No card required</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)' }}>💳 Stripe secure</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)' }}>⚡ Instant access</span>
          </div>

          {/* One-time options — no subscription. Pay once. */}
          <div style={{ marginTop: '1rem', paddingTop: '.9rem', borderTop: '1px solid var(--line)' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.16em', color: 'var(--green)', textAlign: 'center', marginBottom: '.6rem' }}>
              No subscription. Pay once.
            </div>
            <div style={{ display: 'flex', gap: '.5rem' }}>
              <button
                onClick={() => handleOneTime('sprint')}
                disabled={skuLoading !== null || loading}
                style={{ flex: 1.25, padding: '.6rem .5rem', background: 'rgba(16,185,129,.1)', border: '1px solid rgba(16,185,129,.35)', borderRadius: 10, cursor: skuLoading ? 'default' : 'pointer', textAlign: 'center' }}
              >
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.66rem', fontWeight: 700, color: 'var(--green)' }}>
                  {skuLoading === 'sprint' ? 'Redirecting…' : `${SPRINT.name} · ${skuPrice(SPRINT.amount_cents)}`}
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)', marginTop: '.15rem' }}>
                  {SPRINT.credits} credits + {SPRINT.pro_days} days of Pro
                </div>
              </button>
              <button
                onClick={() => handleOneTime('credits20')}
                disabled={skuLoading !== null || loading}
                style={{ flex: 1, padding: '.6rem .5rem', background: 'none', border: '1px solid var(--line2)', borderRadius: 10, cursor: skuLoading ? 'default' : 'pointer', textAlign: 'center' }}
              >
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.66rem', fontWeight: 700, color: 'var(--sub)' }}>
                  {skuLoading === 'credits20' ? 'Redirecting…' : `${CREDITS20.credits} credits · ${skuPrice(CREDITS20.amount_cents)}`}
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)', marginTop: '.15rem' }}>
                  never expire
                </div>
              </button>
            </div>
          </div>

          {reason === 'credits' && (
            <div style={{ textAlign: 'center', marginTop: '.85rem' }}>
              <button
                onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('seen:open-survey')) }}
                style={{ background: 'none', border: 'none', fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--blue)', cursor: 'pointer', textDecoration: 'underline' }}
              >
                Not ready? Earn free credits with a quick survey →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
