'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { aiHeaders } from '@/lib/aiHeaders'

const MONTHLY = '$9.99'
const YEARLY  = '$6.99'

const FREE_FEATURES = [
  '3 AI credits per day — parse, optimize, score',
  'Resume parse + bullet scanner',
  'Earn credits by tracking apps & surveys',
  'Company ghost rates & trust scores',
  'Job listings filtered by trust',
  'Application tracker (unlimited)',
  'Community feed — live hiring reports',
  'Report your own experience',
]

const PRO_FEATURES = [
  'Unlimited AI credits — no daily cap',
  '🥷 Stealth Mode — rewrites that bypass AI detection tools',
  'AI job insights per listing',
  'Ghost risk alerts when companies change behavior',
  'AI company deep-dive analysis',
  'Priority support',
  'Early access to every new feature',
]

const COMPARISON: [string, string | boolean, string | boolean][] = [
  ['AI credits',                '3/day',     'Unlimited'],
  ['Resume AI — parse & scan',  true,         true],
  ['Resume AI — optimize',      true,         true],
  ['🥷 Stealth Mode (AI-safe rewrite)', false,  true],
  ['AI job insights',           false,        true],
  ['Company ghost rates',       true,         true],
  ['Ghost risk alerts',         false,        true],
  ['AI company analysis',       false,        true],
  ['Job tracker',               'Unlimited',  'Unlimited'],
  ['Community feed',            true,         true],
  ['Priority support',          false,        true],
]

const FAQ = [
  { q: 'What is Stealth Mode?', a: 'Companies increasingly use AI-detection tools (GPTZero, Originality.ai) to auto-reject resumes that look AI-generated. Stealth Mode runs your optimized bullets through a second pass that varies sentence structure, avoids AI writing patterns, and keeps every keyword — so you pass ATS filters AND human review.' },
  { q: 'How do free AI credits work?', a: 'Every day you get 3 AI credits that reset at midnight. Each credit covers one AI action: parse a resume, optimize bullets for a job, or run the ATS scanner. You can earn more credits by tracking your applications and answering quick surveys about companies you\'ve worked with.' },
  { q: 'Can I cancel Pro?', a: 'Yes, anytime — no contracts. You keep Pro until the end of your billing period. We don\'t trap you.' },
  { q: 'Is my data sold to employers?', a: 'Never. We work for job seekers. Your resume content is processed in-memory to generate your optimization and immediately discarded. We never sell, share, or expose your info to recruiters or employers.' },
  { q: 'When does Pro activate?', a: 'Instantly after payment. Credits update in real-time — no waiting, no manual activation.' },
  { q: 'What if I hit the daily limit?', a: 'Free users get 3 credits/day. Track an application to earn one back. Answer a 10-second survey to earn another. Or upgrade to Pro for unlimited.' },
]

function PricingPageInner() {
  const router = useRouter()
  const params = useSearchParams()
  const { isLoggedIn } = useAuth()
  const [yearly, setYearly] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [upgraded, setUpgraded] = useState(false)

  useEffect(() => {
    if (params.get('upgraded') === '1') setUpgraded(true)
  }, [params])

  async function handleUpgrade() {
    if (!isLoggedIn) {
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
        body: JSON.stringify({ plan: yearly ? 'yearly' : 'monthly' }),
      })
      const d = await r.json()
      if (d.url) {
        window.location.href = d.url
      } else {
        setError(d.error || 'Checkout failed — please try again or email hello@seenjobs.io')
        setLoading(false)
      }
    } catch {
      setError('Network error — please try again')
      setLoading(false)
    }
  }

  const checkStyle = (val: string | boolean): React.ReactNode => {
    if (val === true) return <span style={{ color: 'var(--green)', fontSize: '1rem' }}>✓</span>
    if (val === false) return <span style={{ color: 'var(--line2)' }}>—</span>
    return <span style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--white)' }}>{val}</span>
  }

  if (upgraded) {
    return (
      <div className="page-full" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '80vh' }}>
        <div style={{ textAlign: 'center', maxWidth: 420, padding: '2rem' }}>
          <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>🎉</div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: '1.8rem', fontWeight: 800, color: 'var(--white)', marginBottom: '.5rem' }}>You're Pro.</h1>
          <p style={{ color: 'var(--sub)', fontFamily: 'var(--mono)', fontSize: '.78rem', lineHeight: 1.7, marginBottom: '1.75rem' }}>
            Unlimited AI credits and Stealth Mode are live on your account right now.
            No setup needed.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
            <button
              onClick={() => router.push('/resume')}
              style={{ padding: '.85rem', background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', border: 'none', borderRadius: 10, fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.88rem', color: '#fff', cursor: 'pointer', boxShadow: '0 0 28px rgba(99,102,241,.4)' }}
            >
              Try Resume AI →
            </button>
            <button
              onClick={() => router.push('/jobs')}
              style={{ padding: '.75rem', background: 'none', border: '1px solid var(--line2)', borderRadius: 10, fontFamily: 'var(--mono)', fontSize: '.72rem', color: 'var(--sub)', cursor: 'pointer' }}
            >
              Find jobs to apply
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page-full">
      <div style={{ maxWidth: 880, margin: '0 auto', padding: '4rem 1.5rem 5rem' }}>

        {/* Hero */}
        <div style={{ textAlign: 'center', marginBottom: '2.75rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.22em', color: '#818cf8', marginBottom: '.6rem' }}>
            Transparent pricing
          </div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: 'clamp(1.8rem,5vw,2.6rem)', fontWeight: 900, color: 'var(--white)', letterSpacing: '-.04em', marginBottom: '.5rem', lineHeight: 1.1 }}>
            The system is rigged.<br />
            <span style={{ color: '#818cf8' }}>We help you game it.</span>
          </h1>
          <p style={{ color: 'var(--sub)', fontSize: '.85rem', lineHeight: 1.7, maxWidth: 480, margin: '0 auto 1.75rem' }}>
            Companies use AI to reject your resume. ATS filters keyword-match before a human sees it.
            Seen Pro gives you the tools that work the other way around.
          </p>

          {/* Billing toggle */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '.75rem', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '.4rem .85rem' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', color: yearly ? 'var(--muted)' : 'var(--white)' }}>Monthly</span>
            <button
              onClick={() => setYearly(!yearly)}
              style={{ width: 38, height: 20, borderRadius: 10, background: yearly ? '#4f46e5' : 'var(--line2)', border: 'none', cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0 }}
            >
              <span style={{ position: 'absolute', top: 2, left: yearly ? 20 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .2s' }} />
            </button>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', color: yearly ? 'var(--white)' : 'var(--muted)' }}>
              Yearly <span style={{ color: 'var(--green)' }}>save 30%</span>
            </span>
          </div>
        </div>

        {/* Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: '1.25rem', marginBottom: '3.5rem' }}>

          {/* Free */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16, padding: '1.75rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--dim)', marginBottom: '.6rem' }}>Free</div>
            <div style={{ fontFamily: 'var(--display)', fontSize: '2.2rem', fontWeight: 900, color: 'var(--white)', marginBottom: '.1rem' }}>$0</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--muted)', marginBottom: '1.5rem' }}>forever — no card required</div>
            <div style={{ marginBottom: '1.5rem' }}>
              {FREE_FEATURES.map(f => (
                <div key={f} style={{ display: 'flex', gap: '.5rem', marginBottom: '.45rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--sub)', lineHeight: 1.45 }}>
                  <span style={{ color: 'var(--dim)', flexShrink: 0 }}>✓</span>{f}
                </div>
              ))}
            </div>
            <button
              onClick={() => router.push(isLoggedIn ? '/resume' : '/login')}
              style={{ width: '100%', background: 'none', border: '1px solid var(--line2)', borderRadius: 9, padding: '.75rem', fontFamily: 'var(--display)', fontWeight: 700, fontSize: '.82rem', color: 'var(--sub)', cursor: 'pointer' }}
            >
              {isLoggedIn ? 'Go to Resume AI' : 'Get started free'}
            </button>
          </div>

          {/* Pro */}
          <div style={{ background: 'linear-gradient(150deg,rgba(79,70,229,.12) 0%,rgba(124,58,237,.08) 100%)', border: '1.5px solid rgba(99,102,241,.45)', borderRadius: 16, padding: '1.75rem', position: 'relative' }}>
            <div style={{ position: 'absolute', top: -13, left: '50%', transform: 'translateX(-50%)', background: 'linear-gradient(90deg,#4f46e5,#7c3aed)', color: '#fff', fontFamily: 'var(--mono)', fontSize: '.56rem', fontWeight: 700, letterSpacing: '.08em', padding: '.25rem .9rem', borderRadius: 100, whiteSpace: 'nowrap' }}>
              MOST POPULAR
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', textTransform: 'uppercase', letterSpacing: '.14em', color: '#a5b4fc', marginBottom: '.6rem' }}>Pro</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '.35rem', marginBottom: '.1rem' }}>
              <div style={{ fontFamily: 'var(--display)', fontSize: '2.2rem', fontWeight: 900, color: 'var(--white)' }}>
                {yearly ? YEARLY : MONTHLY}
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--muted)' }}>/mo</div>
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--muted)', marginBottom: '1.5rem' }}>
              {yearly ? `billed ${parseFloat(YEARLY) * 12 % 1 === 0 ? `$${parseFloat(YEARLY) * 12}` : `$${(parseFloat(YEARLY) * 12).toFixed(2)}`}/year` : 'billed monthly'}
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              {PRO_FEATURES.map(f => (
                <div key={f} style={{ display: 'flex', gap: '.5rem', marginBottom: '.45rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'rgba(165,180,252,.85)', lineHeight: 1.45 }}>
                  <span style={{ color: '#818cf8', flexShrink: 0 }}>✓</span>{f}
                </div>
              ))}
            </div>

            {error && (
              <div style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 8, padding: '.55rem .85rem', marginBottom: '.85rem', fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--red)', lineHeight: 1.5 }}>
                {error}
              </div>
            )}

            <button
              onClick={handleUpgrade}
              disabled={loading}
              style={{
                width: '100%',
                background: loading ? 'var(--line)' : 'linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%)',
                border: 'none', borderRadius: 9, padding: '.85rem',
                fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.88rem', color: '#fff',
                cursor: loading ? 'default' : 'pointer',
                boxShadow: loading ? 'none' : '0 0 32px rgba(99,102,241,.4)',
              }}
            >
              {loading ? 'Redirecting…' : isLoggedIn ? 'Upgrade to Pro →' : 'Get Pro →'}
            </button>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '1.25rem', marginTop: '.75rem' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--dim)' }}>↩ Cancel anytime</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--dim)' }}>💳 Stripe secure</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--dim)' }}>⚡ Instant access</span>
            </div>
          </div>
        </div>

        {/* Stealth Mode callout */}
        <div style={{ background: 'linear-gradient(135deg,rgba(124,58,237,.12),rgba(79,70,229,.08))', border: '1px solid rgba(124,58,237,.3)', borderRadius: 14, padding: '1.5rem 1.75rem', marginBottom: '3rem', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '1.25rem', alignItems: 'center' }}>
          <div style={{ fontSize: '2.5rem' }}>🥷</div>
          <div>
            <div style={{ fontFamily: 'var(--display)', fontSize: '1rem', fontWeight: 800, color: 'var(--white)', marginBottom: '.25rem' }}>Stealth Mode — Pro exclusive</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--sub)', lineHeight: 1.65 }}>
              After optimizing your resume, Stealth Mode rewrites every bullet to evade AI-detection software. Same keywords,
              same meaning — but varied sentence structure, natural rhythm, no AI tells. The companies screening for AI
              won't see it coming.
            </div>
          </div>
        </div>

        {/* Comparison table */}
        <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.2rem', fontWeight: 800, color: 'var(--white)', marginBottom: '1rem' }}>Full comparison</h2>
        <div style={{ border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', marginBottom: '3rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 100px', background: 'var(--raised)', padding: '.65rem 1.25rem', gap: '1rem' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Feature</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', textAlign: 'center' }}>Free</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: '#818cf8', textAlign: 'center' }}>Pro</span>
          </div>
          {COMPARISON.map(([feature, freeVal, proVal]) => (
            <div key={feature} style={{ display: 'grid', gridTemplateColumns: '1fr 100px 100px', padding: '.65rem 1.25rem', borderTop: '1px solid var(--line)', gap: '1rem', alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--sub)' }}>{feature}</span>
              <span style={{ textAlign: 'center' }}>{checkStyle(freeVal)}</span>
              <span style={{ textAlign: 'center' }}>{checkStyle(proVal)}</span>
            </div>
          ))}
        </div>

        {/* FAQ */}
        <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.2rem', fontWeight: 800, color: 'var(--white)', marginBottom: '1rem' }}>Questions</h2>
        {FAQ.map(item => (
          <details key={item.q} style={{ marginBottom: '.6rem', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10 }}>
            <summary style={{ padding: '.85rem 1.25rem', fontFamily: 'var(--display)', fontSize: '.82rem', fontWeight: 700, color: 'var(--white)', cursor: 'pointer', listStyle: 'none' }}>
              {item.q}
            </summary>
            <div style={{ padding: '0 1.25rem .85rem', fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--sub)', lineHeight: 1.75 }}>
              {item.a}
            </div>
          </details>
        ))}

        {/* Bottom CTA */}
        <div style={{ textAlign: 'center', marginTop: '3rem' }}>
          <button
            onClick={handleUpgrade}
            disabled={loading}
            style={{ padding: '.95rem 3rem', background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', border: 'none', borderRadius: 12, fontFamily: 'var(--display)', fontWeight: 800, fontSize: '1rem', color: '#fff', cursor: 'pointer', boxShadow: '0 0 40px rgba(99,102,241,.4)' }}
          >
            {loading ? 'Redirecting…' : `Get Pro · ${yearly ? YEARLY : MONTHLY}/mo →`}
          </button>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', marginTop: '.75rem' }}>
            Cancel anytime · Stripe secure · Instant activation
          </div>
        </div>

      </div>
    </div>
  )
}

export default function PricingPage() {
  return (
    <Suspense>
      <PricingPageInner />
    </Suspense>
  )
}
