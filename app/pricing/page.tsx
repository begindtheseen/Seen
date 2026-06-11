'use client'

import { useState } from 'react'

const FREE_FEATURES = [
  'Company ghost rates & scores',
  'Community feed — live reports',
  'Job listings filtered by trust',
  'Basic job tracker (10 apps)',
  'Report your own experience',
]
const PRO_LOCKED = [
  'Ghost risk alerts',
  'AI company analysis',
  'Unlimited job tracker',
  'Priority support',
]
const PRO_FEATURES = [
  'Everything in Free',
  'Ghost risk alerts — notified when a company\'s behavior changes',
  'AI company analysis — is this worth applying to right now?',
  'Unlimited job tracker',
  'Which companies respond fastest in your field',
  'PDF export your reports',
  'Priority support',
]

const TRUST = [
  { icon: '⚡', label: 'Instant access', desc: 'Pro activates the moment you pay' },
  { icon: '↩', label: 'Cancel anytime', desc: 'No contracts. No auto-traps.' },
  { icon: '🔐', label: 'No recruiter data', desc: 'We never sell your info to employers' },
  { icon: '💳', label: 'Stripe secure', desc: 'We never see your card' },
]

const COMPARISON = [
  ['Company scores & ghost rates', true, true],
  ['Community feed', true, true],
  ['Job listings', true, true],
  ['Report an experience', true, true],
  ['Job tracker', '10 apps', 'Unlimited'],
  ['Ghost risk alerts', false, true],
  ['AI company analysis', false, true],
  ['Fastest-responding companies', false, true],
  ['PDF report export', false, true],
  ['Priority support', false, true],
] as const

const FAQ = [
  { q: 'Is this actually free?', a: 'Yes. Free forever means free forever — no trial period, no credit card. The core transparency tools are always free.' },
  { q: 'Can I cancel Pro?', a: 'Yes, anytime. No contracts. If you cancel, you keep Pro until the end of the billing period.' },
  { q: 'Do you share my data with employers?', a: 'Never. We work for job seekers, not recruiters. Your reports are anonymous and your email is never sold.' },
  { q: 'What\'s the ghost risk alert?', a: 'When a company\'s ghost rate changes significantly — say 3 new ghost reports in a week — Pro users get notified before they apply.' },
  { q: 'When does Pro activate?', a: 'Instantly after payment. No waiting.' },
]

export default function PricingPage() {
  const [yearly, setYearly] = useState(false)
  const proPrice = yearly ? '$5.33' : '$7.99'
  const proPeriod = yearly ? '/mo · billed yearly' : '/month'

  const checkStyle = (val: boolean | string): React.ReactNode => {
    if (val === true) return <span style={{ color: 'var(--green)' }}>✓</span>
    if (val === false) return <span style={{ color: 'var(--line2)' }}>—</span>
    return <span style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--white)' }}>{val}</span>
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '4rem 2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.22em', color: 'var(--green)', marginBottom: '.6rem' }}>
            Transparent tools. Transparent pricing.
          </div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: '2.2rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', marginBottom: '.35rem' }}>
            No dark patterns. No bait-and-switch.
          </h1>
          <p style={{ color: 'var(--sub)', fontSize: '.85rem', marginBottom: '1.5rem' }}>
            Beat the ghost job market at half the price.
          </p>

          {/* Billing toggle */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '.75rem', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '.4rem .75rem' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', color: yearly ? 'var(--muted)' : 'var(--white)' }}>Monthly</span>
            <button
              onClick={() => setYearly(!yearly)}
              style={{
                width: 36, height: 20, borderRadius: 10,
                background: yearly ? 'var(--green)' : 'var(--line2)',
                border: 'none', cursor: 'pointer', position: 'relative', transition: 'background .2s',
              }}
            >
              <span style={{
                position: 'absolute', top: 2, left: yearly ? 18 : 2,
                width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .2s',
              }} />
            </button>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', color: yearly ? 'var(--white)' : 'var(--muted)' }}>
              Yearly <span style={{ color: 'var(--green)' }}>−33%</span>
            </span>
          </div>
        </div>

        {/* Pricing cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '3rem' }}>
          {/* Free */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16, padding: '2rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--dim)', marginBottom: '.65rem' }}>Free</div>
            <div style={{ fontFamily: 'var(--display)', fontSize: '2.5rem', fontWeight: 800, color: 'var(--white)', marginBottom: '.25rem' }}>$0</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--muted)', marginBottom: '1.5rem' }}>forever</div>
            <div style={{ marginBottom: '1.5rem' }}>
              {FREE_FEATURES.map(f => (
                <div key={f} style={{ display: 'flex', gap: '.5rem', marginBottom: '.5rem', fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--sub)' }}>
                  <span style={{ color: 'var(--green)', flexShrink: 0 }}>✓</span> {f}
                </div>
              ))}
              {PRO_LOCKED.map(f => (
                <div key={f} style={{ display: 'flex', gap: '.5rem', marginBottom: '.5rem', fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--muted)', opacity: 0.5 }}>
                  <span style={{ flexShrink: 0 }}>—</span> {f}
                </div>
              ))}
            </div>
            <button style={{ width: '100%', background: 'none', border: '1px solid var(--line2)', borderRadius: 8, padding: '.75rem', fontFamily: 'var(--display)', fontWeight: 700, fontSize: '.85rem', color: 'var(--sub)', cursor: 'pointer' }}>
              Get started free
            </button>
          </div>

          {/* Pro */}
          <div style={{ background: 'linear-gradient(135deg,rgba(16,185,129,0.08) 0%,rgba(59,130,246,0.08) 100%)', border: '1.5px solid var(--green)', borderRadius: 16, padding: '2rem', position: 'relative' }}>
            <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', background: 'var(--green)', color: '#000', fontFamily: 'var(--mono)', fontSize: '.58rem', fontWeight: 700, padding: '.2rem .75rem', borderRadius: 100, whiteSpace: 'nowrap' }}>
              Most popular
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--green)', marginBottom: '.65rem' }}>Pro</div>
            <div style={{ fontFamily: 'var(--display)', fontSize: '2.5rem', fontWeight: 800, color: 'var(--white)', marginBottom: '.25rem' }}>{proPrice}</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--muted)', marginBottom: '1.5rem' }}>{proPeriod}</div>
            <div style={{ marginBottom: '1.5rem' }}>
              {PRO_FEATURES.map(f => (
                <div key={f} style={{ display: 'flex', gap: '.5rem', marginBottom: '.5rem', fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--sub)' }}>
                  <span style={{ color: 'var(--green)', flexShrink: 0 }}>✓</span> {f}
                </div>
              ))}
            </div>
            <button style={{ width: '100%', background: 'linear-gradient(135deg,#059669 0%,#3b82f6 100%)', border: 'none', borderRadius: 8, padding: '.75rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.85rem', color: '#fff', cursor: 'pointer', boxShadow: '0 0 24px rgba(16,185,129,0.3)' }}>
              Join Pro waitlist →
            </button>
          </div>
        </div>

        {/* Trust row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '1px', background: 'var(--line)', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', marginBottom: '3rem' }}>
          {TRUST.map(t => (
            <div key={t.label} style={{ background: 'var(--card)', padding: '1rem', textAlign: 'center' }}>
              <div style={{ fontSize: '1.25rem', marginBottom: '.35rem' }}>{t.icon}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--white)', marginBottom: '.15rem' }}>{t.label}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)' }}>{t.desc}</div>
            </div>
          ))}
        </div>

        {/* Comparison table */}
        <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.3rem', fontWeight: 800, color: 'var(--white)', marginBottom: '1rem' }}>Feature comparison</h2>
        <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', marginBottom: '3rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', background: 'var(--raised)', padding: '.65rem 1.25rem', gap: '1rem' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Feature</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)', width: 60, textAlign: 'center' }}>Free</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--green)', width: 60, textAlign: 'center' }}>Pro</span>
          </div>
          {COMPARISON.map(([feature, freeVal, proVal]) => (
            <div key={String(feature)} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', padding: '.65rem 1.25rem', borderTop: '1px solid var(--line)', gap: '1rem', alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--sub)' }}>{feature}</span>
              <span style={{ width: 60, textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '.68rem' }}>{checkStyle(freeVal as boolean | string)}</span>
              <span style={{ width: 60, textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '.68rem' }}>{checkStyle(proVal as boolean | string)}</span>
            </div>
          ))}
        </div>

        {/* FAQ */}
        <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.3rem', fontWeight: 800, color: 'var(--white)', marginBottom: '1rem' }}>Common questions</h2>
        {FAQ.map(item => (
          <details key={item.q} style={{ marginBottom: '.65rem', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10 }}>
            <summary style={{ padding: '.85rem 1.25rem', fontFamily: 'var(--display)', fontSize: '.85rem', fontWeight: 700, color: 'var(--white)', cursor: 'pointer', listStyle: 'none' }}>
              {item.q}
            </summary>
            <div style={{ padding: '0 1.25rem .85rem', fontFamily: 'var(--body)', fontSize: '.82rem', color: 'var(--sub)', lineHeight: 1.75 }}>
              {item.a}
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}
