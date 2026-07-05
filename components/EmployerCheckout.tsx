'use client'

import { useState, useEffect } from 'react'
import { EMPLOYER_SKUS } from '@/lib/server/employerSkus'

// Renders on the Stripe return page (/employers?purchased=<sku>&session_id=cs_...). Confirms the
// purchase without a login (shares idempotency with the webhook) and shows a success banner.
export function EmployerPurchaseConfirm() {
  const [state, setState] = useState<'idle' | 'ok' | 'pending'>('idle')
  const [name, setName] = useState('')
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const sku = p.get('purchased')
    const sid = p.get('session_id')
    if (!sku || !sid) return
    setName(EMPLOYER_SKUS[sku as keyof typeof EMPLOYER_SKUS]?.name || 'your purchase')
    setState('pending')
    fetch('/api/stripe?action=employer_confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'employer_confirm', session_id: sid }),
    }).then(r => r.json()).then(() => setState('ok')).catch(() => setState('ok'))
  }, [])
  if (state === 'idle') return null
  return (
    <div style={{ background: 'linear-gradient(135deg,rgba(16,185,129,.12),rgba(16,185,129,.03))', border: '1px solid rgba(16,185,129,.35)', borderRadius: 14, padding: '1.25rem 1.5rem', marginBottom: '2rem', textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--display)', fontSize: '1.05rem', fontWeight: 800, color: 'var(--white)', marginBottom: '.3rem' }}>
        {state === 'pending' ? 'Confirming your purchase…' : `🎉 You're in — ${name} is booked.`}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--sub)', lineHeight: 1.6 }}>
        We&apos;ve got your payment and emailed a receipt. Our team will set it up and follow up at the email you used — usually within one business day.
      </div>
    </div>
  )
}

// Real, no-login Stripe checkout for the two employer one-time products (Operation 50%, E4).
// Collects company + email (+ optional listing URL), starts a Checkout session, and redirects to
// Stripe. Copy/prices render from EMPLOYER_SKUS so they can never drift from what's charged.

type SkuKey = keyof typeof EMPLOYER_SKUS

const PRODUCTS: { sku: SkuKey; tagline: string; points: string[] }[] = [
  { sku: 'featured30', tagline: 'Get seen first', points: ['30 days of priority placement for one listing', 'Shown above standard results in matching searches', 'Buys reach — never changes your transparency score'] },
  { sku: 'verified90', tagline: 'Prove you respond', points: ['90-day Transparency Verified enrollment', 'Publicly commit to responding to every applicant', 'Reviewed against real outcome data — money never buys a score'] },
]

export function EmployerCheckout() {
  const [open, setOpen] = useState<SkuKey | null>(null)
  const [company, setCompany] = useState('')
  const [email, setEmail] = useState('')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function go(sku: SkuKey) {
    if (!company.trim() || !email.includes('@')) { setErr('Enter your company and a valid email.'); return }
    setBusy(true); setErr('')
    try {
      const res = await fetch('/api/stripe?action=employer_checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'employer_checkout', employer_sku: sku, company: company.trim(), email: email.trim(), target_url: target.trim() }),
      })
      const d = await res.json()
      if (d.url) { window.location.href = d.url; return }
      setErr(d.error || 'Could not start checkout — try again.')
    } catch { setErr('Network error — try again.') }
    setBusy(false)
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: '1.25rem', marginBottom: '2.5rem' }}>
      {PRODUCTS.map(({ sku, tagline, points }) => {
        const def = EMPLOYER_SKUS[sku]
        const price = `$${(def.amount_cents / 100).toFixed(0)}`
        const isOpen = open === sku
        return (
          <div key={sku} style={{ background: 'var(--card)', border: `1.5px solid ${isOpen ? 'var(--blue)' : 'var(--line)'}`, borderRadius: 16, padding: '1.75rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--blue)', marginBottom: '.5rem' }}>{tagline}</div>
            <div style={{ fontFamily: 'var(--display)', fontSize: '1.1rem', fontWeight: 800, color: 'var(--white)', marginBottom: '.25rem' }}>{def.name}</div>
            <div style={{ fontFamily: 'var(--display)', fontSize: '1.9rem', fontWeight: 800, color: 'var(--white)' }}>{price}<span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--muted)', fontWeight: 400 }}> one-time · {def.days} days</span></div>
            <div style={{ margin: '1rem 0 1.25rem' }}>
              {points.map(p => (
                <div key={p} style={{ display: 'flex', gap: '.5rem', marginBottom: '.5rem', fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--sub)', lineHeight: 1.5 }}>
                  <span style={{ color: 'var(--green)', flexShrink: 0 }}>✓</span> {p}
                </div>
              ))}
            </div>

            {isOpen ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                <input value={company} onChange={e => setCompany(e.target.value)} placeholder="Company name" style={inp} />
                <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Work email (receipt + contact)" style={inp} />
                <input value={target} onChange={e => setTarget(e.target.value)} placeholder="Listing URL (optional)" style={inp} />
                {err && <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--red)' }}>{err}</div>}
                <button onClick={() => go(sku)} disabled={busy} style={{ ...btn, opacity: busy ? .6 : 1 }}>{busy ? 'Starting…' : `Continue to payment — ${price} →`}</button>
                <button onClick={() => { setOpen(null); setErr('') }} style={{ background: 'none', border: 'none', color: 'var(--dim)', fontFamily: 'var(--mono)', fontSize: '.55rem', cursor: 'pointer', padding: '.2rem' }}>Cancel</button>
              </div>
            ) : (
              <button onClick={() => { setOpen(sku); setErr('') }} style={btn}>Get started →</button>
            )}
          </div>
        )
      })}
    </div>
  )
}

const inp: React.CSSProperties = {
  background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 8, padding: '.55rem .7rem',
  fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--white)', outline: 'none', width: '100%', boxSizing: 'border-box',
}
const btn: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'center', background: 'linear-gradient(135deg,#1d4ed8,#7c3aed)',
  border: 'none', borderRadius: 8, padding: '.7rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.8rem',
  color: '#fff', cursor: 'pointer',
}
