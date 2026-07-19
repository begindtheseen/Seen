'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth'
import { useEmployerCompany } from './EmployerCompanyContext'

// The claim flow on the /employers portal (ADMIN-APPROVED CLAIMS model, migration 053).
//
// An employer does NOT get a company's data by signing up with a matching name — that would leak a
// competitor's view. Instead they REQUEST to claim a company here; an admin approves it; only then
// do their dashboard / analytics / notifications auto-scope to that company. This card renders ONE
// honest state at a time:
//   • logged-out / seeker      → a quiet "sign in as an employer to claim your company" prompt
//   • employer, no claim       → the claim request form
//   • employer, pending        → "pending admin review" (honest — no access yet)
//   • employer, approved       → "you manage <company>" + it seeds the portal's company context so
//                                 the surface links carry the company through
//   • employer, rejected       → the reason + let them request again
//
// The kill switch (NEXT_PUBLIC_EMPLOYER_SIGNUP_ENABLED, app/login) governs NEW SIGNUPS, not this —
// claiming is for accounts that already exist, so it is unaffected.

const card: React.CSSProperties = { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 18, padding: '2rem', marginBottom: '2.5rem' }
const kicker: React.CSSProperties = { fontFamily: 'var(--mono)', fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.16em', color: 'var(--blue)', marginBottom: '.5rem' }
const h2: React.CSSProperties = { fontFamily: 'var(--display)', fontSize: '1.5rem', fontWeight: 800, color: 'var(--white)', margin: '0 0 .5rem', letterSpacing: '-.02em' }
const body: React.CSSProperties = { color: 'var(--sub)', fontSize: '.85rem', lineHeight: 1.7, margin: '0 0 1.4rem', maxWidth: 560 }
const primaryBtn: React.CSSProperties = { background: 'linear-gradient(135deg,#1d4ed8,#7c3aed)', border: 'none', borderRadius: 9, padding: '.7rem 1.4rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.8rem', color: '#fff', cursor: 'pointer' }
const mono = (size: string, color: string): React.CSSProperties => ({ fontFamily: 'var(--mono)', fontSize: size, color })

export function EmployerClaimPanel() {
  const { ready, isLoggedIn, isEmployer, employerCompany, employerClaim, claimsReady, reloadClaims, token } = useAuth()
  const { setCompany } = useEmployerCompany()

  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // Once approved, seed the portal's shared company so the reputation/surface links carry it.
  useEffect(() => {
    if (isEmployer && employerCompany) setCompany(employerCompany)
  }, [isEmployer, employerCompany, setCompany])

  // Don't render anything until the session has resolved (avoids a flash of the wrong state).
  if (!ready) return null

  // ── Logged-out / seeker: a quiet invitation, never a blocker ──────────────────
  if (!isLoggedIn || !isEmployer) {
    return (
      <div style={{ ...card, marginBottom: '2.5rem' }}>
        <div style={kicker}>Manage your company</div>
        <h2 style={h2}>Own this company? Claim it.</h2>
        <p style={body}>
          Sign in with an employer account to request your company. Once an admin approves your
          claim, your dashboard, analytics, and notifications open scoped to your company
          automatically — no re-typing the name each time.
        </p>
        <Link href="/login?type=employer" style={{ ...primaryBtn, display: 'inline-block', textDecoration: 'none' }}>
          Sign in as an employer →
        </Link>
      </div>
    )
  }

  // Employer, but claims still loading.
  if (!claimsReady) {
    return (
      <div style={{ ...card, marginBottom: '2.5rem' }}>
        <div style={kicker}>Manage your company</div>
        <div style={mono('.7rem', 'var(--dim)')}>Checking your company claim…</div>
      </div>
    )
  }

  async function submit() {
    const q = name.trim()
    if (!q) return
    setBusy(true); setErr('')
    try {
      const authToken = await token()
      if (!authToken) { setErr('Your session expired — please sign in again.'); setBusy(false); return }
      const r = await fetch('/api/employer-claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ action: 'request', company: q }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(d?.error || 'Could not submit your claim — please try again.'); setBusy(false); return }
      setName('')
      await reloadClaims()
    } catch {
      setErr('Could not submit your claim — please try again.')
    } finally {
      setBusy(false)
    }
  }

  const status = employerClaim?.status
  const claimCompany = employerClaim?.company_display_name || employerClaim?.company_name || ''

  // ── Approved: you manage this company ─────────────────────────────────────────
  if (status === 'approved' && employerCompany) {
    return (
      <div style={{ ...card, border: '1px solid rgba(16,185,129,.3)', background: 'rgba(16,185,129,.05)' }}>
        <div style={{ ...kicker, color: 'var(--green)' }}>Your company</div>
        <h2 style={h2}>
          You manage <span style={{ textTransform: 'capitalize' }}>{employerCompany}</span>.
        </h2>
        <p style={body}>
          Your claim is approved. Your dashboard, analytics, and posting updates below now open
          scoped to your company automatically — the company lookup is set to you.
        </p>
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
          <Link href="/employers/dashboard" style={{ ...primaryBtn, display: 'inline-block', textDecoration: 'none' }}>Open your dashboard →</Link>
          <Link href="/employers/analytics" style={{ display: 'inline-block', border: '1px solid var(--line2)', borderRadius: 9, padding: '.7rem 1.2rem', ...mono('.7rem', 'var(--white)'), textDecoration: 'none' }}>Analytics</Link>
          <Link href="/employers/notifications" style={{ display: 'inline-block', border: '1px solid var(--line2)', borderRadius: 9, padding: '.7rem 1.2rem', ...mono('.7rem', 'var(--white)'), textDecoration: 'none' }}>Updates</Link>
        </div>
      </div>
    )
  }

  // ── Pending admin review ──────────────────────────────────────────────────────
  if (status === 'pending') {
    return (
      <div style={{ ...card, border: '1px solid rgba(245,158,11,.3)', background: 'rgba(245,158,11,.04)' }}>
        <div style={{ ...kicker, color: 'var(--amber)' }}>Claim pending</div>
        <h2 style={h2}>
          Your claim for <span style={{ textTransform: 'capitalize' }}>{claimCompany}</span> is in review.
        </h2>
        <p style={body}>
          An admin reviews every company claim before granting access — this keeps one company&apos;s
          data from ever showing to another. We&apos;ll open your scoped dashboard here the moment it&apos;s
          approved. You can still look up any company&apos;s public reputation below in the meantime.
        </p>
        <button onClick={reloadClaims} style={{ ...mono('.62rem', 'var(--sub)'), background: 'transparent', border: '1px solid var(--line2)', borderRadius: 8, padding: '.5rem 1rem', cursor: 'pointer' }}>↻ Check status</button>
      </div>
    )
  }

  // ── Rejected: show the reason, let them try again ─────────────────────────────
  const rejected = status === 'rejected'

  // ── No claim yet (or rejected) → the request form ─────────────────────────────
  return (
    <div style={card}>
      <div style={kicker}>Manage your company</div>
      <h2 style={h2}>Claim your company</h2>
      <p style={body}>
        Request the company you hire for. An admin approves each claim (so no one can see a company
        they don&apos;t represent), then your dashboard, analytics, and notifications open scoped to it
        automatically.
      </p>
      {rejected && (
        <div style={{ marginBottom: '1.2rem', padding: '.8rem 1rem', border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.05)', borderRadius: 10 }}>
          <div style={mono('.66rem', 'var(--red)')}>
            Your earlier claim for &ldquo;{claimCompany}&rdquo; wasn&apos;t approved.
            {employerClaim?.note ? <> {employerClaim.note}</> : null}
          </div>
          <div style={{ ...mono('.6rem', 'var(--dim)'), marginTop: '.3rem' }}>You can request again below.</div>
        </div>
      )}
      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          placeholder="Your company name"
          aria-label="Your company name"
          autoComplete="organization"
          style={{ flex: 1, minWidth: 220, background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 9, padding: '.7rem .9rem', ...mono('.75rem', 'var(--white)'), outline: 'none' }}
        />
        <button onClick={submit} disabled={busy || !name.trim()} style={{ ...primaryBtn, opacity: busy || !name.trim() ? .6 : 1 }}>
          {busy ? 'Submitting…' : 'Request claim →'}
        </button>
      </div>
      {err && <div style={{ ...mono('.62rem', 'var(--red)'), marginTop: '.7rem' }}>{err}</div>}
      <p style={{ ...mono('.55rem', 'var(--muted)'), lineHeight: 1.6, margin: '1rem 0 0' }}>
        Requesting sends your claim to an admin for review. You&apos;ll see the status here.
      </p>
    </div>
  )
}
