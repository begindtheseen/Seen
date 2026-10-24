'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { EMPLOYER_SKUS } from '@/lib/server/employerSkus'

// Renders on the Stripe return page (/employers?purchased=<sku>&session_id=cs_...). Confirms the
// purchase without a login (shares idempotency with the webhook) and shows a success banner.
export function EmployerPurchaseConfirm() {
  const [state, setState] = useState<'idle' | 'ok' | 'pending'>('idle')
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'featured' | 'verified' | 'sponsor' | ''>('')
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const sku = p.get('purchased')
    const sid = p.get('session_id')
    if (!sku || !sid) return
    const def = EMPLOYER_SKUS[sku as keyof typeof EMPLOYER_SKUS]
    setName(def?.name || 'your purchase')
    setKind((def?.kind as 'featured' | 'verified' | 'sponsor') || '')
    setState('pending')
    fetch('/api/stripe?action=employer_confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'employer_confirm', session_id: sid }),
    }).then(r => r.json()).then(() => setState('ok')).catch(() => setState('ok'))
  }, [])
  if (state === 'idle') return null
  // Featured is applied automatically on payment (reach-only); Verified is reviewed by hand.
  const okCopy = kind === 'featured'
    ? 'Payment received and your featured placement is live now — your roles rise to the top of matching searches for the next 30 days. Receipt emailed.'
    : kind === 'sponsor'
      ? "We've got your payment and emailed a receipt. The Ghost Index sponsor slot is a single, exclusive placement — our team sets it up (so it's never oversold) and follows up at the email you used, usually within one business day."
      : "We've got your payment and emailed a receipt. Transparency Verified is reviewed by our team against your real outcome data — we'll set it up and follow up at the email you used, usually within one business day."
  return (
    <div style={{ background: 'linear-gradient(135deg,rgba(16,185,129,.12),rgba(16,185,129,.03))', border: '1px solid rgba(16,185,129,.35)', borderRadius: 14, padding: '1.25rem 1.5rem', marginBottom: '2rem', textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--display)', fontSize: '1.05rem', fontWeight: 800, color: 'var(--white)', marginBottom: '.3rem' }}>
        {state === 'pending' ? 'Confirming your purchase…' : `🎉 You're in — ${name} is booked.`}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--sub)', lineHeight: 1.6 }}>
        {state === 'pending' ? 'One moment while we confirm your payment…' : okCopy}
      </div>
    </div>
  )
}

// Real, no-login Stripe checkout for the two employer one-time products (Operation 50%, E4).
// Collects company + email (+ optional listing URL), starts a Checkout session, and redirects to
// Stripe. Copy/prices render from EMPLOYER_SKUS so they can never drift from what's charged.

type SkuKey = keyof typeof EMPLOYER_SKUS

const PRODUCTS: { sku: SkuKey; tagline: string; points: string[] }[] = [
  { sku: 'featured30', tagline: 'Get seen first', points: ['30 days of priority placement for all your live roles', 'Shown above standard results in matching searches', 'Live within minutes of payment — reach only, never a score'] },
  { sku: 'verified90', tagline: 'Prove you respond', points: ['90-day Transparency Verified enrollment', 'Publicly commit to responding to every applicant', 'Reviewed against real outcome data — money never buys a score'] },
  { sku: 'sponsor30', tagline: 'Own the niche', points: ['30-day exclusive sponsor slot atop the Staffing Agency Ghost Index', 'High-intent audience actively vetting who to trust', 'Labeled advertising — never part of the ranking or any score'] },
]

export function EmployerCheckout() {
  const [open, setOpen] = useState<SkuKey | null>(null)
  const [company, setCompany] = useState('')
  const [email, setEmail] = useState('')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // One Checkout Session per click: `disabled` only applies after a re-render, so a double-tap made
  // two live Stripe sessions (audit 2026-10-24 M-13). The ref closes the gap synchronously.
  const inFlight = useRef(false)
  const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())

  async function go(sku: SkuKey) {
    if (!company.trim() || !validEmail(email)) { setErr('Enter your company name and a valid work email.'); return }
    if (inFlight.current) return
    inFlight.current = true
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
    inFlight.current = false
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
              <form onSubmit={e => { e.preventDefault(); go(sku) }} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                <input value={company} onChange={e => setCompany(e.target.value)} placeholder="Company name — exactly as it appears on Seen" aria-label="Company name" autoComplete="off" required style={inp} />
                <input type="email" inputMode="email" autoComplete="off" required value={email} onChange={e => setEmail(e.target.value)} placeholder="Work email (receipt + contact)" aria-label="Work email" style={inp} />
                <input autoComplete="off" type="url" inputMode="url" value={target} onChange={e => setTarget(e.target.value)} placeholder="Listing URL (optional)" aria-label="Listing URL (optional)" style={inp} />
                {/* What the handler does with the name (api/stripe.js employer_checkout → employerFulfillment.js):
                    it is stored as typed and, for Featured, keyed into employer_perks by that exact name — the
                    checkout does not verify the company exists on Seen. Say so, and offer the check. */}
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)', lineHeight: 1.6 }}>
                  Placement is keyed to this exact name and applies to the roles Seen lists under it; the name is not checked at checkout.{' '}
                  {company.trim() ? <Link href={`/employers/dashboard?company=${encodeURIComponent(company.trim())}`} style={{ color: 'var(--sub)' }}>See what Seen has for “{company.trim()}” →</Link> : null}
                </div>
                {err && <div role="alert" style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--red)' }}>{err}</div>}
                <button type="submit" disabled={busy} style={{ ...btn, opacity: busy ? .6 : 1 }}>{busy ? 'Starting…' : `Continue to payment — ${price} →`}</button>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)', lineHeight: 1.6, textAlign: 'center' }}>
                  One-time payment via Stripe, no account. By continuing you agree to the <Link href="/terms#employer" style={{ color: 'var(--sub)' }}>employer terms</Link>; payments never change a score.
                </div>
                <button type="button" onClick={() => { setOpen(null); setErr('') }} style={{ background: 'none', border: 'none', color: 'var(--dim)', fontFamily: 'var(--mono)', fontSize: '.55rem', cursor: 'pointer', padding: '.2rem' }}>Cancel</button>
              </form>
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
