'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { aiHeaders } from '@/lib/aiHeaders'

interface UpgradeModalProps {
  reason: 'credits' | 'pro' | 'generic'
  onClose: () => void
  featureName?: string // e.g. "Stealth Mode"
}

const MONTHLY_PRICE = '$9.99'
const YEARLY_PRICE = '$6.99'

const PRO_BULLETS = [
  { icon: '∞', label: 'Unlimited AI credits', sub: 'No daily cap, ever' },
  { icon: '🥷', label: 'Stealth Mode', sub: 'Rewrites that bypass AI detection' },
  { icon: '📊', label: 'AI company insights', sub: 'Ghost risk, culture, hiring trends' },
  { icon: '⚡', label: 'Priority support', sub: 'Real humans, fast replies' },
]

export default function UpgradeModal({ reason, onClose, featureName }: UpgradeModalProps) {
  const router = useRouter()
  const { isLoggedIn } = useAuth()
  const [plan, setPlan] = useState<'monthly' | 'yearly'>('monthly')
  const [loading, setLoading] = useState(false)
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
      } else {
        setError(d.error || 'Checkout unavailable — try again')
        setLoading(false)
      }
    } catch {
      setError('Network error — check connection and try again')
      setLoading(false)
    }
  }

  const headline =
    reason === 'credits' ? "You've used today's AI credits"
    : reason === 'pro' ? `${featureName || 'This feature'} is Pro-only`
    : 'Unlock Seen Pro'

  const sub =
    reason === 'credits' ? 'Pro removes the cap entirely. Optimize every application, every day.'
    : reason === 'pro' ? 'Upgrade to access Stealth Mode and unlimited AI optimization.'
    : 'The unfair advantage for serious job seekers.'

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.82)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ width: '100%', maxWidth: 480, background: 'var(--surface)', borderRadius: '18px 18px 0 0', border: '1px solid rgba(99,102,241,.25)', boxShadow: '0 -40px 120px rgba(0,0,0,.7), 0 0 80px rgba(99,102,241,.2)', overflow: 'hidden' }}>

        {/* Handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '.6rem 0 .2rem' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--line2)' }} />
        </div>

        {/* Header */}
        <div style={{ padding: '1rem 1.25rem .75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontFamily: 'var(--display)', fontSize: '1.05rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.02em', marginBottom: '.25rem' }}>
              {headline}
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--sub)', lineHeight: 1.55 }}>
              {sub}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', fontSize: '1rem', padding: '.2rem', lineHeight: 1, flexShrink: 0, marginLeft: '1rem' }}>✕</button>
        </div>

        <div style={{ padding: '0 1.25rem 1.5rem' }}>

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

          {/* Plan toggle */}
          <div style={{ display: 'flex', gap: '.5rem', marginBottom: '1rem' }}>
            {(['monthly', 'yearly'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPlan(p)}
                style={{
                  flex: 1, padding: '.55rem', borderRadius: 9,
                  background: plan === p ? 'rgba(99,102,241,.2)' : 'none',
                  border: `1.5px solid ${plan === p ? 'rgba(99,102,241,.5)' : 'var(--line2)'}`,
                  color: plan === p ? '#a5b4fc' : 'var(--muted)',
                  fontFamily: 'var(--mono)', fontSize: '.62rem', fontWeight: 700,
                  cursor: 'pointer', transition: 'all .15s',
                }}
              >
                {p === 'monthly' ? `${MONTHLY_PRICE}/mo` : `${YEARLY_PRICE}/mo · yearly`}
                {p === 'yearly' && <span style={{ display: 'block', fontSize: '.52rem', color: 'var(--green)', marginTop: '.1rem' }}>Save 30%</span>}
              </button>
            ))}
          </div>

          {error && (
            <div style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 8, padding: '.55rem .85rem', marginBottom: '.85rem', fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--red)' }}>
              {error}
            </div>
          )}

          {/* CTA */}
          <button
            onClick={handleUpgrade}
            disabled={loading}
            style={{
              width: '100%', padding: '.9rem',
              background: loading ? 'var(--line)' : 'linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%)',
              border: 'none', borderRadius: 11,
              fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.9rem', color: '#fff',
              cursor: loading ? 'default' : 'pointer',
              boxShadow: loading ? 'none' : '0 0 28px rgba(99,102,241,.4)',
              transition: 'opacity .15s',
            }}
          >
            {loading ? 'Redirecting to checkout…' : `Upgrade to Pro · ${plan === 'yearly' ? YEARLY_PRICE + '/mo' : MONTHLY_PRICE + '/mo'}`}
          </button>

          {/* Auto-renewal disclosure — shown at the point of purchase (FTC / state ARL compliance). */}
          <div style={{ fontFamily: 'var(--body)', fontSize: '.66rem', color: 'var(--sub)', textAlign: 'center', lineHeight: 1.6, marginTop: '.85rem' }}>
            {plan === 'yearly'
              ? `Billed $${(parseFloat(YEARLY_PRICE.replace(/[^0-9.]/g, '')) * 12).toFixed(2)} today, then automatically each year until you cancel.`
              : `Billed ${MONTHLY_PRICE} today, then automatically each month until you cancel.`}
            {' '}Cancel anytime in Profile → Billing. See <a href="/legal" style={{ color: 'var(--blue)' }}>Subscription Terms</a>.
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: '1.5rem', marginTop: '.75rem' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)' }}>↩ Cancel anytime</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)' }}>💳 Stripe secure</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)' }}>⚡ Instant access</span>
          </div>

          {reason === 'credits' && (
            <div style={{ textAlign: 'center', marginTop: '.75rem' }}>
              <button
                onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('seen:open-survey')) }}
                style={{ background: 'none', border: 'none', fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--blue)', cursor: 'pointer', textDecoration: 'underline' }}
              >
                Earn free credits by answering a quick survey →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
