'use client'

import { useState } from 'react'
import { useEmployerCompany } from './EmployerCompanyContext'

// Manage your listings — the employer portal's first real management surface
// (seen-command#94). Seen's corpus is ingest-driven and the portal is account-free, so
// "manage" is one lookup + one action: find your live listings by company name (the same
// way the reputation card works) and mark a filled/closed role in one click. The server
// verifies the claim against the listing's OWN source URL (lib/server/employerListings.js):
// confirmed-gone listings leave Seen instantly; still-live ones are queued for human
// review — an anonymous click can never remove a live listing.

type Listing = {
  id: string
  title: string
  location: string
  source: string
  availability_status: string
  created_at: string | null
  apply_url: string | null
}

type RowState = { busy?: boolean; closed?: boolean; verified?: boolean; already?: boolean; queued?: boolean; error?: string }

const mono = (size: string, color: string): React.CSSProperties => ({ fontFamily: 'var(--mono)', fontSize: size, color })

export function EmployerListings() {
  const { setCompany } = useEmployerCompany()
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [checked, setChecked] = useState('')
  const [listings, setListings] = useState<Listing[] | null>(null)
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [err, setErr] = useState('')

  async function look() {
    const q = name.trim()
    if (!q) return
    setCompany(q) // carry the looked-up company to the portal's surface links (EmployerSurfaces)
    setLoading(true); setErr(''); setListings(null); setRows({})
    try {
      const res = await fetch('/api/reports', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'employer_listings', name: q }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error || 'lookup failed')
      setChecked(q)
      setListings(Array.isArray(d?.listings) ? d.listings : [])
    } catch { setErr('Could not load your listings — try again.') } finally { setLoading(false) }
  }

  async function close(id: string) {
    setRows(r => ({ ...r, [id]: { busy: true } }))
    try {
      const res = await fetch('/api/reports', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'employer_close_listing', job_id: id, reason: 'closed' }),
      })
      const d = await res.json()
      if (!res.ok || !d?.ok) throw new Error(d?.error || 'close failed')
      setRows(r => ({ ...r, [id]: { closed: !!d.closed, verified: !!d.verified, already: !!d.already, queued: !!d.queued } }))
    } catch {
      setRows(r => ({ ...r, [id]: { error: 'Could not process that — try again.' } }))
    }
  }

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 18, padding: '2rem', marginBottom: '2.5rem' }}>
      <div style={{ ...mono('.55rem', 'var(--blue)'), textTransform: 'uppercase', letterSpacing: '.16em', marginBottom: '.5rem' }}>Your listings</div>
      <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.5rem', fontWeight: 800, color: 'var(--white)', margin: '0 0 .5rem', letterSpacing: '-.02em' }}>Filled the role? Close the listing in one click.</h2>
      <p style={{ color: 'var(--sub)', fontSize: '.85rem', lineHeight: 1.7, margin: '0 0 1.4rem', maxWidth: 560 }}>
        A filled role that stays listed collects applications you&apos;ll never answer — and every one of those becomes a ghost report against your score. Find your live listings and close the ones that are done. We confirm against your own posting before anything is removed.
      </p>

      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', marginBottom: listings || loading ? '1.6rem' : 0 }}>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') look() }}
          placeholder="Your company name (as it appears on the listing)"
          style={{ flex: 1, minWidth: 220, background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 9, padding: '.7rem .9rem', ...mono('.75rem', 'var(--white)'), outline: 'none' }}
        />
        <button onClick={look} disabled={loading || !name.trim()} style={{ background: 'linear-gradient(135deg,#1d4ed8,#7c3aed)', border: 'none', borderRadius: 9, padding: '.7rem 1.4rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.8rem', color: '#fff', cursor: 'pointer', opacity: loading ? .6 : 1 }}>
          {loading ? 'Looking…' : 'Show my listings →'}
        </button>
      </div>
      {err && <div style={mono('.6rem', 'var(--red)')}>{err}</div>}

      {listings !== null && !loading && (
        listings.length > 0 ? (
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: '.4rem' }}>
            {listings.map(l => {
              const st = rows[l.id] || {}
              const done = st.closed || st.queued
              return (
                <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', padding: '.85rem 0', borderBottom: '1px solid var(--line)' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontFamily: 'var(--display)', fontSize: '.9rem', fontWeight: 700, color: 'var(--white)' }}>{l.title}</div>
                    <div style={{ ...mono('.6rem', 'var(--dim)'), marginTop: 2 }}>
                      {[l.location, l.created_at ? `posted ${new Date(l.created_at).toLocaleDateString()}` : '', l.availability_status].filter(Boolean).join(' · ')}
                      {l.apply_url && <> · <a href={l.apply_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--dim)' }}>view</a></>}
                    </div>
                  </div>
                  {done ? (
                    <div style={{ maxWidth: 320, ...mono('.6rem', st.closed ? 'var(--green)' : 'var(--amber)'), lineHeight: 1.55 }}>
                      {st.closed
                        ? (st.already ? '✓ Already removed from Seen.' : '✓ Removed from Seen — your posting confirmed this role is closed.')
                        : '⏳ Your posting still looks live at the source, so we’ve flagged it for our team to verify and remove.'}
                    </div>
                  ) : (
                    <button onClick={() => close(l.id)} disabled={st.busy} style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 8, padding: '.5rem 1rem', ...mono('.62rem', 'var(--white)'), cursor: st.busy ? 'default' : 'pointer', opacity: st.busy ? .6 : 1 }}>
                      {st.busy ? 'Checking your posting…' : 'Mark filled / close'}
                    </button>
                  )}
                  {st.error && <div style={mono('.6rem', 'var(--red)')}>{st.error}</div>}
                </div>
              )
            })}
            <p style={{ ...mono('.55rem', 'var(--muted)'), lineHeight: 1.6, margin: '.9rem 0 0' }}>
              Closing is verified against your own posting URL — if it still shows the role open, nothing is removed until our team checks. Closing a listing never changes your transparency score.
            </p>
          </div>
        ) : (
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: '1.4rem' }}>
            <div style={{ fontFamily: 'var(--display)', fontSize: '.95rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.35rem' }}>No live listings found for &ldquo;{checked}&rdquo;.</div>
            <p style={{ color: 'var(--sub)', fontSize: '.8rem', lineHeight: 1.65, margin: 0, maxWidth: 520 }}>
              Try the exact company name as it appears on your job listing. If a stale listing of yours is still showing in search, email <a href="mailto:hello@seenjobs.io" style={{ color: 'var(--sub)' }}>hello@seenjobs.io</a> and we&apos;ll remove it.
            </p>
          </div>
        )
      )}
    </div>
  )
}
