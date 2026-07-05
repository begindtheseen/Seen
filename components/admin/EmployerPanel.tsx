'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardHeader, relTime } from './primitives'

// Employer revenue management (Engine E4). Lists paid employer purchases and lets a full admin
// FULFILL each one — granting the time-boxed perk (Featured 30d / Transparency Verified 90d) after
// review. Money grants reach/badge here, never a score. Also shows active perks + total revenue.

type Purchase = { id: number; company: string | null; email: string | null; employer_sku: string; amount_cents: number; status: string; created_at: string; fulfilled_at: string | null }
type Perk = { company: string; featured_until: string | null; verified_until: string | null }

const SKU_LABEL: Record<string, string> = { featured30: 'Featured Listing', verified90: 'Transparency Verified' }

export function EmployerPanel({ token }: { token: string }) {
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [perks, setPerks] = useState<Perk[]>([])
  const [totalCents, setTotalCents] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin-stats', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token }, body: JSON.stringify({ action: 'list_employer_purchases' }) })
      const d = await res.json()
      setPurchases(Array.isArray(d.purchases) ? d.purchases : [])
      setPerks(Array.isArray(d.perks) ? d.perks : [])
      setTotalCents(d.total_cents || 0)
    } catch { setErr('Could not load purchases') } finally { setLoading(false) }
  }, [token])

  useEffect(() => { load() }, [load])

  async function fulfill(id: number) {
    if (!confirm('Grant this employer their perk? Featured = 30-day placement boost; Transparency Verified = 90-day badge. This never changes any transparency score.')) return
    setBusy(id); setErr('')
    try {
      const res = await fetch('/api/admin-stats', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token }, body: JSON.stringify({ action: 'fulfill_employer_purchase', purchase_id: id }) })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || 'Failed')
      await load()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }

  const activePerks = perks.filter(p => {
    const now = Date.now()
    return (p.featured_until && Date.parse(p.featured_until) > now) || (p.verified_until && Date.parse(p.verified_until) > now)
  })
  const unfulfilled = purchases.filter(p => p.status === 'paid').length

  return (
    <Card style={{ marginBottom: '1.25rem', border: '1px solid rgba(247,201,72,.22)' }}>
      <CardHeader
        title="Employer revenue"
        action={<span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: totalCents > 0 ? '#f7c948' : 'var(--dim)' }}>${(totalCents / 100).toLocaleString(undefined, { minimumFractionDigits: 0 })} total{unfulfilled > 0 ? ` · ${unfulfilled} to fulfill` : ''}</span>}
      />
      {err && <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--red)', marginBottom: '.6rem' }}>{err}</div>}

      {loading ? (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)' }}>Loading…</div>
      ) : purchases.length === 0 ? (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', lineHeight: 1.6 }}>
          No employer purchases yet. When a company buys Featured or Transparency Verified on <span style={{ color: 'var(--white)' }}>/employers</span>, it lands here to fulfill.
        </div>
      ) : (
        <div>
          {purchases.map(p => {
            const paid = p.status === 'paid'
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '.7rem', padding: '.55rem 0', borderTop: '1px solid var(--line2)' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '.64rem', color: 'var(--white)', textTransform: 'capitalize' }}>{p.company || 'Unknown company'}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)', marginTop: '.1rem' }}>
                    {SKU_LABEL[p.employer_sku] || p.employer_sku} · ${(p.amount_cents / 100).toFixed(0)} · {p.email || '—'} · {relTime(p.created_at)}
                  </div>
                </div>
                {paid ? (
                  <button onClick={() => fulfill(p.id)} disabled={busy === p.id} style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', padding: '.32rem .7rem', borderRadius: 6, border: '1px solid rgba(247,201,72,.4)', background: 'rgba(247,201,72,.12)', color: '#f7c948', cursor: 'pointer', flexShrink: 0 }}>{busy === p.id ? '…' : 'Fulfill →'}</button>
                ) : (
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--green)', flexShrink: 0 }}>✓ {p.status}</span>
                )}
              </div>
            )
          })}

          {activePerks.length > 0 && (
            <div style={{ marginTop: '.9rem', paddingTop: '.7rem', borderTop: '1px solid var(--line2)' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--dim)', marginBottom: '.4rem' }}>Active perks</div>
              {activePerks.map(p => {
                const now = Date.now()
                const feat = p.featured_until && Date.parse(p.featured_until) > now
                const ver = p.verified_until && Date.parse(p.verified_until) > now
                return (
                  <div key={p.company} style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', color: 'var(--sub)', marginBottom: '.2rem', textTransform: 'capitalize' }}>
                    {p.company} — {feat ? <span style={{ color: '#f7c948' }}>Featured</span> : null}{feat && ver ? ' · ' : ''}{ver ? <span style={{ color: 'var(--blue)' }}>Verified</span> : null}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
