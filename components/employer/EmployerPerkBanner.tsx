'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth'

// Renewal nudge (Wave 3). A scoped employer whose Featured placement or Verified badge is lapsing (or
// has lapsed) sees a quiet banner with a one-click re-buy through the EXISTING one-time checkout — so
// paid reach/commitment doesn't silently disappear. Self-fetches /api/employer-perks (claim-scoped);
// renders nothing when there's nothing to renew. No auto-charge: renewal is a deliberate re-purchase.

type PerkState = { state: 'none' | 'active' | 'expiring' | 'expired'; until: string | null; daysLeft: number | null }
type Status = { featured: PerkState; verified: PerkState; anyRenewable: boolean }

function line(label: 'Featured placement' | 'Transparency Verified badge', s: PerkState): string | null {
  if (s.state === 'expired') return `Your ${label} has lapsed`
  if (s.state === 'expiring') return `Your ${label} expires in ${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'}`
  return null
}

export function EmployerPerkBanner() {
  const { token } = useAuth()
  const [status, setStatus] = useState<Status | null>(null)

  const load = useCallback(async () => {
    const t = await token()
    if (!t) return
    try {
      const r = await fetch('/api/employer-perks', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        body: JSON.stringify({ action: 'status' }),
      })
      const d = await r.json().catch(() => null)
      if (r.ok && d?.status) setStatus(d.status as Status)
    } catch { /* banner just won't show */ }
  }, [token])

  useEffect(() => { load() }, [load])

  if (!status || !status.anyRenewable) return null
  const messages = [line('Featured placement', status.featured), line('Transparency Verified badge', status.verified)].filter(Boolean) as string[]
  if (!messages.length) return null

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '.8rem', flexWrap: 'wrap', marginBottom: '1.4rem', padding: '.8rem 1rem', background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.3)', borderRadius: 10 }}>
      <span aria-hidden style={{ fontSize: '1rem', flexShrink: 0 }}>⏳</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontFamily: 'var(--display)', fontSize: '.82rem', fontWeight: 700, color: 'var(--white)' }}>{messages.join(' · ')}</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', color: 'var(--muted)', marginTop: '.1rem' }}>Renew to keep your reach and badge live — one-time, no auto-charge.</div>
      </div>
      <Link href="/employers#promote" style={{ flexShrink: 0, background: 'linear-gradient(135deg,#1d4ed8,#7c3aed)', border: 'none', borderRadius: 8, padding: '.5rem 1.1rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.74rem', color: '#fff', textDecoration: 'none' }}>Renew →</Link>
    </div>
  )
}
