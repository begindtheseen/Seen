'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'

// Live, PERSISTED posting-updates feed (POST /api/employer-notifications).
//
// The existing /employers/notifications page is a server component that DERIVES a feed from a
// ?company= param. This component is the login-scoped counterpart: a signed-in employer with an
// approved claim gets a merged feed of STORED events (which carry read-state) + derived signals,
// self-scoped to their claimed company via the Supabase access token — no ?company= needed. It
// mounts ABOVE the derived feed and simply renders nothing when there's no session, so the page
// stays graceful for logged-out visitors.
//
// Auth: useAuth().token() — the same Bearer-token pattern EmployerClaimPanel uses.

type Severity = 'info' | 'warning' | 'critical'

type Item = {
  id: string // "evt:<n>" for stored, "job:..:kind" / "apps:.." for derived
  kind: string
  severity: Severity
  title: string
  detail: string
  at: string | null
  jobId: string | null
  read: boolean
  stored: boolean
  meta?: Record<string, unknown>
}

const mono = (size: string, color: string): React.CSSProperties => ({ fontFamily: 'var(--mono)', fontSize: size, color })
const wrap = { maxWidth: 820, margin: '0 auto', padding: '0 1.5rem', width: '100%', boxSizing: 'border-box' as const }

const SEV_COLOR: Record<Severity, string> = { critical: 'var(--red)', warning: 'var(--amber)', info: 'var(--blue)' }

// Deterministic absolute date (client-side; this whole component only renders after mount).
function fmtDate(iso: string | null) {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  try { return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) } catch { return '' }
}

// Pull the numeric DB id out of a stored item's id ("evt:5" → 5). Only stored items have one.
function storedDbId(item: Item): number | null {
  if (!item.stored) return null
  const m = /^evt:(\d+)$/.exec(item.id)
  return m ? parseInt(m[1], 10) : null
}

export function EmployerLiveNotifications() {
  const { ready, isLoggedIn, isEmployer, claimsReady, token } = useAuth()

  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<Item[]>([])
  const [unread, setUnread] = useState(0)
  const [company, setCompany] = useState('')
  const [pending, setPending] = useState(false)
  const [err, setErr] = useState('')
  const [marking, setMarking] = useState(false)

  const load = useCallback(async () => {
    setErr('')
    try {
      const authToken = await token()
      if (!authToken) { setLoading(false); return }
      const r = await fetch('/api/employer-notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ action: 'list' }),
      })
      if (r.status === 403) {
        const d = await r.json().catch(() => ({}))
        if (d?.reason === 'no_approved_claim') { setPending(true); setLoading(false); return }
      }
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(d?.error || 'Could not load your updates.'); setLoading(false); return }
      setPending(false)
      setItems(Array.isArray(d?.items) ? d.items : [])
      setUnread(typeof d?.unread === 'number' ? d.unread : 0)
      setCompany(d?.company || '')
    } catch {
      setErr('Could not load your updates.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (!ready || !claimsReady) return
    if (!isLoggedIn || !isEmployer) { setLoading(false); return }
    load()
  }, [ready, claimsReady, isLoggedIn, isEmployer, load])

  async function markAllRead() {
    // Only STORED items carry a numeric db id — the derived ones aren't markable.
    const ids = items.map(storedDbId).filter((n): n is number => n != null && items.find(i => storedDbId(i) === n)?.read === false)
    setMarking(true)
    try {
      const authToken = await token()
      if (!authToken) { setMarking(false); return }
      const r = await fetch('/api/employer-notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ action: 'mark_read', ...(ids.length ? { ids } : {}) }),
      })
      if (r.ok) {
        setItems(list => list.map(i => (i.stored ? { ...i, read: true } : i)))
        setUnread(0)
      }
    } catch { /* ignore */ } finally {
      setMarking(false)
    }
  }

  // Render nothing (gracefully) until we know this is a signed-in employer with data to show.
  if (!ready || !claimsReady || !isLoggedIn || !isEmployer) return null
  if (loading) return null
  if (pending) return null
  if (err) return null
  if (items.length === 0) return null

  const hasUnreadStored = items.some(i => i.stored && !i.read)

  return (
    <div style={{ ...wrap, maxWidth: 820, padding: 0, marginBottom: '2rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <span style={{ ...mono('.55rem', 'var(--blue)'), textTransform: 'uppercase', letterSpacing: '.14em' }}>Your live feed</span>
        {company && <span style={{ fontFamily: 'var(--display)', fontSize: '.9rem', fontWeight: 700, color: 'var(--white)', textTransform: 'capitalize' }}>{company}</span>}
        {unread > 0 && (
          <span style={{ ...mono('.55rem', 'var(--green)'), border: '1px solid rgba(16,185,129,.35)', borderRadius: 999, padding: '.22rem .6rem' }}>{unread} unread</span>
        )}
        {hasUnreadStored && (
          <button onClick={markAllRead} disabled={marking} style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--line2)', borderRadius: 8, padding: '.4rem .8rem', ...mono('.6rem', 'var(--sub)'), cursor: marking ? 'default' : 'pointer', opacity: marking ? .6 : 1 }}>
            {marking ? 'Marking…' : 'Mark all read'}
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gap: '.6rem' }}>
        {items.map(it => {
          const color = SEV_COLOR[it.severity] || 'var(--blue)'
          const isUnread = it.stored && !it.read
          return (
            <div
              key={it.id}
              style={{
                display: 'flex',
                gap: '.85rem',
                alignItems: 'flex-start',
                background: isUnread ? 'rgba(59,130,246,.06)' : 'var(--card)',
                border: `1px solid ${isUnread ? 'rgba(59,130,246,.3)' : 'var(--line)'}`,
                borderLeft: `3px solid ${color}`,
                borderRadius: 12,
                padding: '.9rem 1.1rem',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '.55rem', flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--display)', fontSize: '.86rem', fontWeight: 700, color: 'var(--white)' }}>{it.title}</span>
                  {isUnread && (
                    <span style={{ ...mono('.5rem', 'var(--green)'), textTransform: 'uppercase', letterSpacing: '.1em', border: '1px solid rgba(16,185,129,.35)', borderRadius: 4, padding: '.1rem .35rem' }}>New</span>
                  )}
                </div>
                <p style={{ color: 'var(--sub)', fontSize: '.77rem', lineHeight: 1.6, margin: '.3rem 0 0' }}>{it.detail}</p>
                <div style={{ display: 'flex', gap: '.7rem', marginTop: '.45rem', flexWrap: 'wrap' }}>
                  <span style={{ ...mono('.55rem', color), textTransform: 'uppercase', letterSpacing: '.08em' }}>{it.severity}</span>
                  {it.at && <span style={mono('.55rem', 'var(--dim)')}>{fmtDate(it.at)}</span>}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <p style={{ ...mono('.55rem', 'var(--muted)'), lineHeight: 1.7, margin: '1.2rem 0 0' }}>
        This is your persisted, login-scoped feed — stored updates keep their read state across visits. Below is the live-derived view for any company.
      </p>
    </div>
  )
}
