'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardHeader, relTime } from './primitives'

// Admin surface for the ADMIN-APPROVED CLAIMS model (migration 053).
//
// Lists employer → company claims (pending first), lets a full admin APPROVE or REJECT each one,
// and provides the owner's ADMIN GOD-VIEW: open any company's employer dashboard / analytics /
// notifications as an admin (via ?company=<name>&godview=1) without being that company. Approving a
// claim is what grants that employer login-scoped access to their company's surfaces.
//
// Auth: the same X-Admin-Token admin session the rest of this dashboard uses (api/employer-claims
// verifies it against admin_sessions with the service key). Never a Supabase user.

type Claim = {
  id: string
  user_id: string
  company_name: string
  company_display_name: string | null
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
  reviewed_at: string | null
  reviewed_by: string | null
  note: string | null
  email: string | null
  employer_name: string | null
}

const statusColor = (s: string) => (s === 'approved' ? 'var(--green)' : s === 'rejected' ? 'var(--red)' : 'var(--amber)')

// Open an employer surface as an admin, scoped to a company, in god-view.
function godviewHref(surface: 'dashboard' | 'analytics' | 'notifications', company: string) {
  return `/employers/${surface}?company=${encodeURIComponent(company)}&godview=1`
}

export function EmployerClaimsPanel({ token }: { token: string }) {
  const [claims, setClaims] = useState<Claim[]>([])
  const [counts, setCounts] = useState<{ pending: number; approved: number; rejected: number }>({ pending: 0, approved: 0, rejected: 0 })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [godviewCompany, setGodviewCompany] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/employer-claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'list' }),
      })
      const d = await res.json()
      setClaims(Array.isArray(d.claims) ? d.claims : [])
      if (d.counts) setCounts(d.counts)
    } catch { setErr('Could not load claims') } finally { setLoading(false) }
  }, [token])

  useEffect(() => { load() }, [load])

  async function decide(id: string, action: 'approve' | 'reject') {
    const company = claims.find(c => c.id === id)
    const label = company?.company_display_name || company?.company_name || 'this company'
    if (action === 'approve') {
      if (!confirm(`Approve this claim? The employer will get login-scoped access to ${label}'s dashboard, analytics, and notifications.`)) return
    }
    const note = action === 'reject' ? (prompt(`Reject the claim for ${label}? Optional reason shown to the employer:`, '') ?? undefined) : undefined
    if (action === 'reject' && note === undefined) return // cancelled the prompt
    setBusy(id); setErr('')
    try {
      const res = await fetch('/api/employer-claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action, id, note }),
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || 'Failed')
      await load()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }

  return (
    <Card style={{ marginBottom: '1.25rem', border: '1px solid rgba(59,130,246,.22)' }}>
      <CardHeader
        title="Employer account claims"
        action={<span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: counts.pending > 0 ? 'var(--amber)' : 'var(--dim)' }}>{counts.pending} pending · {counts.approved} approved</span>}
      />
      {err && <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--red)', marginBottom: '.5rem' }}>{err}</div>}

      {/* God-view any company — the owner's admin god-view entry (not limited to claims) */}
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center', padding: '.5rem 0 .75rem', borderBottom: '1px solid var(--line2)', marginBottom: '.5rem' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.1em' }}>God-view any company</span>
        <input autoComplete="off"
          value={godviewCompany}
          onChange={e => setGodviewCompany(e.target.value)}
          placeholder="Company name"
          aria-label="God-view company name"
          style={{ flex: 1, minWidth: 160, background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 7, padding: '.5rem .5rem', fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--white)', outline: 'none' }}
        />
        {(['dashboard', 'analytics', 'notifications'] as const).map(s => (
          <a
            key={s}
            href={godviewCompany.trim() ? godviewHref(s, godviewCompany.trim()) : undefined}
            target="_blank" rel="noopener noreferrer"
            aria-disabled={!godviewCompany.trim()}
            onClick={e => { if (!godviewCompany.trim()) e.preventDefault() }}
            style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', padding: '.25rem .5rem', borderRadius: 6, border: '1px solid var(--line2)', color: godviewCompany.trim() ? 'var(--blue)' : 'var(--dim)', textDecoration: 'none', cursor: godviewCompany.trim() ? 'pointer' : 'not-allowed', textTransform: 'capitalize' }}
          >{s} ↗</a>
        ))}
      </div>

      {loading ? (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--dim)' }}>Loading…</div>
      ) : claims.length === 0 ? (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--dim)', lineHeight: 1.6 }}>
          No employer claims yet. When an employer requests a company on <span style={{ color: 'var(--white)' }}>/employers</span>, it lands here to approve.
        </div>
      ) : (
        <div>
          {claims.map(c => {
            const company = c.company_display_name || c.company_name
            const pending = c.status === 'pending'
            return (
              <div key={c.id} style={{ padding: '.5rem 0', borderTop: '1px solid var(--line2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: statusColor(c.status), border: `1px solid ${statusColor(c.status)}`, borderRadius: 5, padding: '.125rem .5rem', flexShrink: 0 }}>{c.status}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--white)', textTransform: 'capitalize' }}>{company}</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--dim)', marginTop: '.125rem' }}>
                      {c.email || 'unknown employer'}{c.employer_name ? ` · ${c.employer_name}` : ''} · requested {relTime(c.created_at)}
                      {c.reviewed_by ? ` · ${c.status} by ${c.reviewed_by}` : ''}
                    </div>
                    {c.note ? <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--muted)', marginTop: '.125rem' }}>Note: {c.note}</div> : null}
                  </div>
                  {pending && (
                    <div style={{ display: 'flex', gap: '.5rem', flexShrink: 0 }}>
                      <button onClick={() => decide(c.id, 'approve')} disabled={busy === c.id} style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', padding: '.25rem .75rem', borderRadius: 6, border: '1px solid rgba(16,185,129,.4)', background: 'rgba(16,185,129,.12)', color: 'var(--green)', cursor: 'pointer' }}>{busy === c.id ? '…' : 'Approve'}</button>
                      <button onClick={() => decide(c.id, 'reject')} disabled={busy === c.id} style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', padding: '.25rem .75rem', borderRadius: 6, border: '1px solid rgba(239,68,68,.4)', background: 'rgba(239,68,68,.1)', color: 'var(--red)', cursor: 'pointer' }}>Reject</button>
                    </div>
                  )}
                </div>
                {/* God-view links for this company */}
                <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginTop: '.5rem', paddingLeft: '2rem' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.08em' }}>God-view</span>
                  {(['dashboard', 'analytics', 'notifications'] as const).map(s => (
                    <a key={s} href={godviewHref(s, company)} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--blue)', textDecoration: 'none', textTransform: 'capitalize' }}>{s} ↗</a>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
