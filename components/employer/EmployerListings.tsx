'use client'

import { useEffect, useRef, useState } from 'react'
import { useEmployerCompany } from './EmployerCompanyContext'
import { useAuth } from '@/lib/auth'
import { httpHref } from '@/lib/safeHref.js'
import Icon from '@/components/ui/Icon'

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
  const { ready, isEmployer, employerCompany, claimsReady } = useAuth()
  // A logged-in employer with an APPROVED claim is SCOPED to their own company: auto-load THEIR
  // listings and lock the input, so the portal can never surface (or offer to close) another
  // company's postings. Logged-out / unclaimed visitors keep the open company lookup.
  const scoped = !!(ready && claimsReady && isEmployer && employerCompany)

  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [checked, setChecked] = useState('')
  const [listings, setListings] = useState<Listing[] | null>(null)
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [err, setErr] = useState('')

  async function runLookup(raw: string) {
    const q = raw.trim()
    if (!q) return
    setCompany(q) // carry the company to the portal's surface links (EmployerSurfaces)
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
  const look = () => runLookup(name)

  const autoRan = useRef(false)
  useEffect(() => {
    if (scoped && employerCompany && !autoRan.current) {
      autoRan.current = true
      setName(employerCompany)
      runLookup(employerCompany)
    }
  }, [scoped, employerCompany]) // eslint-disable-line react-hooks/exhaustive-deps

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
      <div style={{ ...mono('var(--fs-meta)', 'var(--text-3)'), textTransform: 'uppercase', letterSpacing: '.16em', marginBottom: '.5rem' }}>Your listings</div>
      <h2 style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-xl)', fontWeight: 800, color: 'var(--white)', margin: '0 0 .5rem', letterSpacing: '-.02em' }}>Filled the role? Close the listing in one click.</h2>
      <p style={{ color: 'var(--sub)', fontSize: 'var(--fs-ui)', lineHeight: 1.7, margin: '0 0 1.5rem', maxWidth: 560 }}>
        A filled role that stays listed collects applications you&apos;ll never answer — and every one of those becomes a ghost report against your score. Find your live listings and close the ones that are done. We confirm against your own posting before anything is removed.
      </p>

      {scoped ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginBottom: listings || loading ? '1.6rem' : 0 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '.5rem', background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 9, padding: '.5rem 1rem' }}>
            <span style={{ ...mono('var(--fs-meta)', 'var(--dim)'), textTransform: 'uppercase', letterSpacing: '.14em' }}>Your company</span>
            <span style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: 'var(--fs-ui)', color: 'var(--white)' }}>{employerCompany}</span>
          </div>
          {loading && <span style={mono('var(--fs-meta)', 'var(--dim)')}>Loading…</span>}
        </div>
      ) : (
        <div style={{ display: 'flex', marginBottom: listings || loading ? '1.5rem' : 0 }}>
          <input autoComplete="off"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') look() }}
            placeholder="Company name as it appears on the listing"
            aria-label="Your company name, as it appears on the listing"
            style={{ flex: 1, minWidth: 0, background: 'var(--raised)', border: '1px solid var(--border-2)', borderRight: 'none', borderRadius: '10px 0 0 10px', padding: '.75rem 1rem', fontFamily: 'var(--body)', fontSize: 'var(--fs-ui)', color: 'var(--text-1)', outline: 'none' }}
          />
          <button onClick={look} disabled={loading || !name.trim()} style={{ flexShrink: 0, minHeight: 44, background: 'var(--surface-2)', border: '1px solid var(--border-2)', borderRadius: '0 10px 10px 0', padding: '.75rem 1rem', fontFamily: 'var(--body)', fontWeight: 600, fontSize: 'var(--fs-sm)', color: 'var(--text-1)', cursor: loading || !name.trim() ? 'default' : 'pointer', opacity: loading || !name.trim() ? .6 : 1 }}>
            {loading ? 'Looking…' : 'Show my listings →'}
          </button>
        </div>
      )}
      {err && <div style={mono('var(--fs-meta)', 'var(--red)')}>{err}</div>}

      {listings !== null && !loading && (
        listings.length > 0 ? (
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: '.5rem' }}>
            {listings.map(l => {
              const st = rows[l.id] || {}
              const done = st.closed || st.queued
              return (
                <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', padding: '.75rem 0', borderBottom: '1px solid var(--line)' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-ui)', fontWeight: 700, color: 'var(--white)' }}>{l.title}</div>
                    <div style={{ ...mono('var(--fs-meta)', 'var(--dim)'), marginTop: 2 }}>
                      {[l.location, l.created_at ? `posted ${new Date(l.created_at).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' })}` : '', l.availability_status].filter(Boolean).join(' · ')}
                      {l.apply_url && <> · <a href={httpHref(l.apply_url) ?? undefined} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--dim)' }}>view</a></>}
                    </div>
                  </div>
                  {done ? (
                    <div style={{ maxWidth: 320, display: 'flex', gap: '.5rem', alignItems: 'flex-start', ...mono('var(--fs-meta)', st.closed ? 'var(--green)' : 'var(--amber)'), lineHeight: 1.55 }}>
                      <span style={{ flexShrink: 0, marginTop: 2 }}><Icon name={st.closed ? 'circle-check' : 'hourglass'} size={14} /></span>
                      <span>
                        {st.closed
                          ? (st.already ? 'Already removed from Seen.' : 'Removed from Seen — your posting confirmed this role is closed.')
                          : 'Your posting still looks live at the source, so we’ve flagged it for our team to verify and remove.'}
                      </span>
                    </div>
                  ) : (
                    <button onClick={() => close(l.id)} disabled={st.busy} style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 8, padding: '.5rem 1rem', ...mono('var(--fs-meta)', 'var(--white)'), cursor: st.busy ? 'default' : 'pointer', opacity: st.busy ? .6 : 1 }}>
                      {st.busy ? 'Checking your posting…' : 'Mark filled / close'}
                    </button>
                  )}
                  {st.error && <div style={mono('var(--fs-meta)', 'var(--red)')}>{st.error}</div>}
                </div>
              )
            })}
            <p style={{ ...mono('var(--fs-meta)', 'var(--muted)'), lineHeight: 1.6, margin: '1rem 0 0' }}>
              Closing is verified against your own posting URL — if it still shows the role open, nothing is removed until our team checks. Closing a listing never changes your transparency score.
            </p>
          </div>
        ) : (
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: '1.5rem' }}>
            <div style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--white)', marginBottom: '.25rem' }}>No live listings found for &ldquo;{checked}&rdquo;.</div>
            <p style={{ color: 'var(--sub)', fontSize: 'var(--fs-sm)', lineHeight: 1.65, margin: 0, maxWidth: 520 }}>
              Try the exact company name as it appears on your job listing. If a stale listing of yours is still showing in search, email <a href="mailto:hello@seenjobs.io" style={{ color: 'var(--sub)' }}>hello@seenjobs.io</a> and we&apos;ll remove it.
            </p>
          </div>
        )
      )}
    </div>
  )
}
