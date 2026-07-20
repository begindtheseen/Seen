'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth'

// Manage your listings — the LOGIN-SCOPED listings manager (POST /api/employer-listings).
//
// Unlike the account-free EmployerListings card (which looks a company up by name and can only
// close a filled role), this section is for a signed-in employer with an APPROVED claim. It reads
// every listing matched to their claimed company, lets them POST a new employer-owned listing, and
// open a DISPUTE (report inactive / request removal / request an edit / not our company / other) on
// any listing. Nothing is destructive from here: an admin reviews every dispute before anything
// changes (mirrors the claim-approval model, migration 053).
//
// Auth: the Supabase access token, fetched the same way EmployerClaimPanel does — useAuth().token().
// 401 = not signed in; 403 {reason:'no_approved_claim'} = claim still pending admin approval.

type Origin = 'aggregated' | 'imported' | 'employer'
type OpenDispute = { id: string; job_id: string; kind: string; status: string; created_at: string | null } | null

type Listing = {
  id: string
  title: string
  company: string
  location: string | null
  apply_url: string | null
  source: string | null
  origin: Origin
  availability_status: string
  expires_at: string | null
  created_at: string | null
  is_employer_posted: boolean
  applications: number
  openDispute: OpenDispute
}

type Summary = { total: number; active: number; employerPosted: number; applications: number; openDisputes: number }

type DisputeKind = 'inactive' | 'delete' | 'edit' | 'not_ours' | 'other'
type ProposedChanges = { title?: string; description?: string; location?: string; salary?: string; apply_url?: string }

type Dispute = {
  id: string
  job_id: string
  kind: DisputeKind
  reason: string | null
  detail: string
  proposed_changes: ProposedChanges | null
  status: 'open' | 'approved' | 'denied'
  created_at: string | null
  reviewed_at: string | null
  admin_note: string | null
}

const mono = (size: string, color: string): React.CSSProperties => ({ fontFamily: 'var(--mono)', fontSize: size, color })
const card: React.CSSProperties = { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 18, padding: '2rem', marginBottom: '2.5rem' }
const kicker: React.CSSProperties = { ...mono('.55rem', 'var(--blue)'), textTransform: 'uppercase', letterSpacing: '.16em', marginBottom: '.5rem' }
const h2: React.CSSProperties = { fontFamily: 'var(--display)', fontSize: '1.5rem', fontWeight: 800, color: 'var(--white)', margin: '0 0 .5rem', letterSpacing: '-.02em' }
const bodyText: React.CSSProperties = { color: 'var(--sub)', fontSize: '.85rem', lineHeight: 1.7, margin: '0 0 1.4rem', maxWidth: 560 }
const primaryBtn: React.CSSProperties = { background: 'linear-gradient(135deg,#1d4ed8,#7c3aed)', border: 'none', borderRadius: 9, padding: '.7rem 1.4rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.8rem', color: '#fff', cursor: 'pointer' }
const ghostBtn: React.CSSProperties = { background: 'none', border: '1px solid var(--line2)', borderRadius: 8, padding: '.5rem 1rem', ...mono('.62rem', 'var(--white)'), cursor: 'pointer' }
const inputStyle: React.CSSProperties = { flex: 1, minWidth: 200, background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 9, padding: '.7rem .9rem', ...mono('.75rem', 'var(--white)'), outline: 'none', boxSizing: 'border-box' }

// Origin badge — aggregated (gray) / imported (blue) / posted-by-you (green).
const ORIGIN_META: Record<Origin, { label: string; color: string }> = {
  aggregated: { label: 'Aggregated', color: 'var(--dim)' },
  imported: { label: 'Imported', color: 'var(--blue)' },
  employer: { label: 'Posted by you', color: 'var(--green)' },
}
function availColor(a: string) {
  if (a === 'active') return 'var(--green)'
  if (a === 'stale') return 'var(--amber)'
  if (a === 'expired' || a === 'removed') return 'var(--red)'
  return 'var(--sub)'
}
const disputeStatusColor = (s: string) => (s === 'approved' ? 'var(--green)' : s === 'denied' ? 'var(--red)' : 'var(--amber)')

const KIND_OPTIONS: { value: DisputeKind; label: string }[] = [
  { value: 'inactive', label: 'Report inactive' },
  { value: 'delete', label: 'Request removal' },
  { value: 'edit', label: 'Request an edit' },
  { value: 'not_ours', label: 'Not our company' },
  { value: 'other', label: 'Other' },
]
const KIND_LABEL: Record<string, string> = Object.fromEntries(KIND_OPTIONS.map(o => [o.value, o.label]))

function fmtDate(iso: string | null) {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  try { return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) } catch { return '' }
}

export function EmployerListingsManager() {
  const { ready, isLoggedIn, isEmployer, employerCompany, claimsReady, token } = useAuth()

  const [loading, setLoading] = useState(true)
  const [listings, setListings] = useState<Listing[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [disputes, setDisputes] = useState<Dispute[]>([])
  const [pending, setPending] = useState(false) // 403 no_approved_claim
  const [err, setErr] = useState('')
  const [company, setCompanyName] = useState('')

  const [showAdd, setShowAdd] = useState(false)
  const [disputeFor, setDisputeFor] = useState<Listing | null>(null)

  const load = useCallback(async () => {
    setErr('')
    try {
      const authToken = await token()
      if (!authToken) { setLoading(false); return }
      const post = (body: object) => fetch('/api/employer-listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(body),
      })
      const listRes = await post({ action: 'list' })
      if (listRes.status === 403) {
        const d = await listRes.json().catch(() => ({}))
        if (d?.reason === 'no_approved_claim') { setPending(true); setLoading(false); return }
      }
      const listData = await listRes.json().catch(() => ({}))
      if (!listRes.ok) { setErr(listData?.error || 'Could not load your listings — please try again.'); setLoading(false); return }
      setPending(false)
      setListings(Array.isArray(listData?.listings) ? listData.listings : [])
      setSummary((listData?.summary as Summary) || null)
      setCompanyName(listData?.company || '')

      // Disputes strip (best-effort — a failure here never blocks the listings).
      try {
        const dRes = await post({ action: 'disputes' })
        const dData = await dRes.json().catch(() => ({}))
        if (dRes.ok) setDisputes(Array.isArray(dData?.disputes) ? dData.disputes : [])
      } catch { /* ignore */ }
    } catch {
      setErr('Could not load your listings — please try again.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    // Only load once the session + claims have resolved and this is an approved employer.
    if (!ready || !claimsReady) return
    if (!isLoggedIn || !isEmployer) { setLoading(false); return }
    load()
  }, [ready, claimsReady, isLoggedIn, isEmployer, load])

  // Don't flash the wrong state while the session resolves.
  if (!ready || !claimsReady) return null

  // Logged-out / seeker — keep it graceful (the dashboard already gates the rest of the page).
  if (!isLoggedIn || !isEmployer) {
    return (
      <div style={card}>
        <div style={kicker}>Manage your listings</div>
        <h2 style={h2}>Sign in as an employer to manage your listings.</h2>
        <p style={bodyText}>
          Once you&apos;re signed in with an approved employer claim, every listing on Seen for your
          company shows here — with a one-click way to post a new role or dispute a wrong one.
        </p>
        <Link href="/login?type=employer" style={{ ...primaryBtn, display: 'inline-block', textDecoration: 'none' }}>Sign in as an employer →</Link>
      </div>
    )
  }

  // Approved claim still pending admin review (403).
  if (pending) {
    return (
      <div style={{ ...card, border: '1px solid rgba(245,158,11,.3)', background: 'rgba(245,158,11,.04)' }}>
        <div style={{ ...kicker, color: 'var(--amber)' }}>Manage your listings</div>
        <h2 style={h2}>Your company claim is pending admin approval.</h2>
        <p style={bodyText}>
          An admin reviews every company claim before granting access, so one company can never see
          another&apos;s listings. The moment your claim is approved, your listings manager opens here.
        </p>
        <Link href="/employers" style={{ ...ghostBtn, display: 'inline-block', textDecoration: 'none' }}>Go to your claim →</Link>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={card}>
        <div style={kicker}>Manage your listings</div>
        <div style={mono('.7rem', 'var(--dim)')}>Loading your listings…</div>
      </div>
    )
  }

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={kicker}>Manage your listings</div>
          <h2 style={h2}>
            Manage your listings{company ? <span style={{ color: 'var(--sub)', textTransform: 'capitalize' }}> — {company}</span> : null}
          </h2>
          <p style={{ ...bodyText, marginBottom: '1rem' }}>
            Every listing Seen has matched to your company. Post a new role, or dispute a listing
            that&apos;s inactive, wrong, or not yours. An admin reviews every dispute — nothing changes
            until it&apos;s approved.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '.5rem', flexShrink: 0 }}>
          <button onClick={() => setShowAdd(v => !v)} style={primaryBtn}>{showAdd ? 'Close' : '+ Add a listing'}</button>
          <button onClick={() => { setLoading(true); load().finally(() => setLoading(false)) }} style={ghostBtn}>↻ Refresh</button>
        </div>
      </div>

      {err && <div style={{ ...mono('.62rem', 'var(--red)'), marginBottom: '1rem' }}>{err}</div>}

      {/* Summary row */}
      {summary && (
        <div style={{ display: 'flex', gap: '1.6rem', flexWrap: 'wrap', padding: '1rem 0 1.3rem', borderBottom: '1px solid var(--line)' }}>
          <Stat value={summary.total} label="total listings" color="var(--white)" />
          <Stat value={summary.active} label="active" color="var(--green)" />
          <Stat value={summary.employerPosted} label="posted by you" color="var(--blue)" />
          <Stat value={summary.applications} label="applications" color="var(--white)" />
          <Stat value={summary.openDisputes} label="open disputes" color={summary.openDisputes > 0 ? 'var(--amber)' : 'var(--dim)'} />
        </div>
      )}

      {/* Add-a-listing form */}
      {showAdd && <AddListingForm token={token} onCreated={() => { setShowAdd(false); load() }} />}

      {/* Listings */}
      {listings.length === 0 ? (
        <div style={{ padding: '1.6rem 0 .4rem', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--display)', fontSize: '.95rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.35rem' }}>No listings matched to {company || 'your company'} yet.</div>
          <p style={{ ...mono('.6rem', 'var(--muted)'), lineHeight: 1.6, margin: 0 }}>
            When Seen indexes a listing for your company — or you post one above — it appears here.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {listings.map(l => {
            const om = ORIGIN_META[l.origin] || ORIGIN_META.aggregated
            return (
              <div key={l.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap', padding: '.95rem 0', borderBottom: '1px solid var(--line)' }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--display)', fontSize: '.9rem', fontWeight: 700, color: 'var(--white)' }}>{l.title}</span>
                    <span style={{ ...mono('.5rem', om.color), textTransform: 'uppercase', letterSpacing: '.08em', border: `1px solid ${om.color}`, borderRadius: 5, padding: '.1rem .4rem' }}>{om.label}</span>
                    <span style={{ ...mono('.5rem', availColor(l.availability_status)), textTransform: 'uppercase', letterSpacing: '.06em', background: 'var(--raised)', border: `1px solid ${availColor(l.availability_status)}`, borderRadius: 999, padding: '.1rem .45rem' }}>{l.availability_status}</span>
                  </div>
                  <div style={{ ...mono('.56rem', 'var(--dim)'), marginTop: '.3rem', display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                    {l.location && <span>{l.location}</span>}
                    {l.source && <span>· {l.source}</span>}
                    {l.created_at && <span>· posted {fmtDate(l.created_at)}</span>}
                    {l.expires_at && <span>· expires {fmtDate(l.expires_at)}</span>}
                    {l.apply_url && <>· <a href={l.apply_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue)', textDecoration: 'none' }}>Apply link ↗</a></>}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '.35rem', flexShrink: 0 }}>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontFamily: 'var(--display)', fontSize: '1.1rem', fontWeight: 800, color: l.applications ? 'var(--white)' : 'var(--muted)', lineHeight: 1 }}>{l.applications}</span>
                    <span style={{ ...mono('.5rem', 'var(--dim)'), marginLeft: '.35rem' }}>application{l.applications === 1 ? '' : 's'}</span>
                  </div>
                  {l.openDispute ? (
                    <span style={{ ...mono('.55rem', 'var(--amber)'), border: '1px solid rgba(245,158,11,.4)', background: 'rgba(245,158,11,.08)', borderRadius: 6, padding: '.25rem .55rem' }}>
                      Dispute pending{l.openDispute.kind ? ` · ${KIND_LABEL[l.openDispute.kind] || l.openDispute.kind}` : ''}
                    </span>
                  ) : (
                    <button onClick={() => setDisputeFor(l)} style={{ ...ghostBtn, padding: '.35rem .8rem', ...mono('.6rem', 'var(--sub)') }}>Dispute</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Your disputes strip */}
      {disputes.length > 0 && (
        <div style={{ marginTop: '1.6rem' }}>
          <div style={{ ...mono('.55rem', 'var(--sub)'), textTransform: 'uppercase', letterSpacing: '.12em', marginBottom: '.7rem' }}>Your disputes</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
            {disputes.map(d => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '.7rem', flexWrap: 'wrap', background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 10, padding: '.7rem .9rem' }}>
                <span style={{ ...mono('.5rem', disputeStatusColor(d.status)), textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700, border: `1px solid ${disputeStatusColor(d.status)}`, borderRadius: 5, padding: '.12rem .4rem', flexShrink: 0 }}>{d.status}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={mono('.62rem', 'var(--white)')}>{KIND_LABEL[d.kind] || d.kind}</div>
                  <div style={{ ...mono('.58rem', 'var(--sub)'), lineHeight: 1.5, marginTop: '.15rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{d.detail}</div>
                  {d.admin_note && <div style={{ ...mono('.56rem', 'var(--muted)'), marginTop: '.2rem' }}>Admin note: {d.admin_note}</div>}
                </div>
                {d.created_at && <span style={{ ...mono('.52rem', 'var(--dim)'), flexShrink: 0 }}>{fmtDate(d.created_at)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {disputeFor && (
        <DisputeModal
          listing={disputeFor}
          token={token}
          onClose={() => setDisputeFor(null)}
          onSubmitted={() => { setDisputeFor(null); load() }}
        />
      )}
    </div>
  )
}

function Stat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
      <div style={{ fontFamily: 'var(--display)', fontSize: '1.5rem', fontWeight: 800, color, lineHeight: 1 }}>{value.toLocaleString()}</div>
      <div style={mono('.52rem', 'var(--dim)')}>{label}</div>
    </div>
  )
}

// ── Add-a-listing form ────────────────────────────────────────────────────────
function AddListingForm({ token, onCreated }: { token: () => Promise<string | null>; onCreated: () => void }) {
  const [title, setTitle] = useState('')
  const [applyUrl, setApplyUrl] = useState('')
  const [location, setLocation] = useState('')
  const [salary, setSalary] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState('Full-time')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const label: React.CSSProperties = { ...mono('.55rem', 'var(--sub)'), textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '.3rem', display: 'block' }
  const field: React.CSSProperties = { ...inputStyle, width: '100%', minWidth: 0 }

  async function submit() {
    if (title.trim().length < 3) { setErr('Title must be at least 3 characters.'); return }
    if (!/^https?:\/\//i.test(applyUrl.trim())) { setErr('Apply link must be a full http(s) URL.'); return }
    setBusy(true); setErr('')
    try {
      const authToken = await token()
      if (!authToken) { setErr('Your session expired — please sign in again.'); setBusy(false); return }
      const r = await fetch('/api/employer-listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          action: 'create',
          title: title.trim(),
          apply_url: applyUrl.trim(),
          location: location.trim() || undefined,
          salary: salary.trim() || undefined,
          description: description.trim() || undefined,
          type,
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(d?.error || 'Could not create that listing — please try again.'); setBusy(false); return }
      onCreated()
    } catch {
      setErr('Could not create that listing — please try again.')
      setBusy(false)
    }
  }

  return (
    <div style={{ background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 12, padding: '1.2rem', margin: '1.3rem 0' }}>
      <div style={{ ...mono('.55rem', 'var(--blue)'), textTransform: 'uppercase', letterSpacing: '.12em', marginBottom: '.9rem' }}>Add a listing</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '.9rem' }}>
        <div>
          <label style={label}>Title *</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Senior Product Designer" style={field} />
        </div>
        <div>
          <label style={label}>Apply link — where candidates are redirected to apply *</label>
          <input value={applyUrl} onChange={e => setApplyUrl(e.target.value)} placeholder="https://…" style={field} />
        </div>
        <div>
          <label style={label}>Location</label>
          <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Remote · US" style={field} />
        </div>
        <div>
          <label style={label}>Salary</label>
          <input value={salary} onChange={e => setSalary(e.target.value)} placeholder="$120k–$150k" style={field} />
        </div>
        <div>
          <label style={label}>Type</label>
          <select value={type} onChange={e => setType(e.target.value)} style={{ ...field, cursor: 'pointer' }}>
            <option value="Full-time">Full-time</option>
            <option value="Part-time">Part-time</option>
          </select>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={label}>Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="What the role is and who it's for." style={{ ...field, resize: 'vertical' }} />
        </div>
      </div>
      {err && <div style={{ ...mono('.62rem', 'var(--red)'), marginTop: '.8rem' }}>{err}</div>}
      <div style={{ display: 'flex', gap: '.6rem', marginTop: '1rem' }}>
        <button onClick={submit} disabled={busy} style={{ ...primaryBtn, opacity: busy ? .6 : 1 }}>{busy ? 'Posting…' : 'Post listing →'}</button>
      </div>
    </div>
  )
}

// ── Dispute modal ─────────────────────────────────────────────────────────────
function DisputeModal({ listing, token, onClose, onSubmitted }: { listing: Listing; token: () => Promise<string | null>; onClose: () => void; onSubmitted: () => void }) {
  const [kind, setKind] = useState<DisputeKind>('inactive')
  const [detail, setDetail] = useState('')
  const [pc, setPc] = useState<ProposedChanges>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const label: React.CSSProperties = { ...mono('.55rem', 'var(--sub)'), textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '.3rem', display: 'block' }
  const field: React.CSSProperties = { ...inputStyle, width: '100%', minWidth: 0 }

  async function submit() {
    if (detail.trim().length < 4) { setErr('Please describe what’s wrong (at least 4 characters).'); return }
    setBusy(true); setErr('')
    try {
      const authToken = await token()
      if (!authToken) { setErr('Your session expired — please sign in again.'); setBusy(false); return }
      const proposed = kind === 'edit'
        ? Object.fromEntries(Object.entries(pc).map(([k, v]) => [k, (v || '').trim()]).filter(([, v]) => v)) as ProposedChanges
        : undefined
      const r = await fetch('/api/employer-listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          action: 'dispute',
          job_id: listing.id,
          kind,
          detail: detail.trim(),
          ...(proposed && Object.keys(proposed).length ? { proposed_changes: proposed } : {}),
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(d?.error || 'Could not submit that dispute — please try again.'); setBusy(false); return }
      onSubmitted()
    } catch {
      setErr('Could not submit that dispute — please try again.')
      setBusy(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(3,5,12,.72)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 1rem', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 16, padding: '1.6rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '.3rem' }}>
          <div style={{ fontFamily: 'var(--display)', fontSize: '1.15rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.02em' }}>Dispute a listing</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--dim)', fontSize: '1rem', cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ ...mono('.6rem', 'var(--sub)'), marginBottom: '1.1rem' }}>{listing.title}</div>

        <label style={label}>What&apos;s the issue?</label>
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          {KIND_OPTIONS.map(o => {
            const active = kind === o.value
            return (
              <button key={o.value} onClick={() => setKind(o.value)} style={{ ...mono('.6rem', active ? 'var(--white)' : 'var(--sub)'), padding: '.35rem .7rem', borderRadius: 7, border: `1px solid ${active ? 'var(--white)' : 'var(--line2)'}`, background: active ? 'rgba(255,255,255,.06)' : 'transparent', cursor: 'pointer' }}>{o.label}</button>
            )
          })}
        </div>

        <label style={label}>What&apos;s wrong? *</label>
        <textarea value={detail} onChange={e => setDetail(e.target.value)} rows={4} placeholder="Tell our reviewers what needs to change and why." style={{ ...field, resize: 'vertical', marginBottom: '1rem' }} />

        {kind === 'edit' && (
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: '1rem', marginBottom: '1rem' }}>
            <div style={{ ...mono('.55rem', 'var(--blue)'), textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '.8rem' }}>Proposed changes (optional)</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '.8rem' }}>
              <div><label style={label}>New title</label><input value={pc.title || ''} onChange={e => setPc(p => ({ ...p, title: e.target.value }))} style={field} /></div>
              <div><label style={label}>New location</label><input value={pc.location || ''} onChange={e => setPc(p => ({ ...p, location: e.target.value }))} style={field} /></div>
              <div><label style={label}>New salary</label><input value={pc.salary || ''} onChange={e => setPc(p => ({ ...p, salary: e.target.value }))} style={field} /></div>
              <div><label style={label}>New apply link</label><input value={pc.apply_url || ''} onChange={e => setPc(p => ({ ...p, apply_url: e.target.value }))} placeholder="https://…" style={field} /></div>
              <div style={{ gridColumn: '1 / -1' }}><label style={label}>New description</label><textarea value={pc.description || ''} onChange={e => setPc(p => ({ ...p, description: e.target.value }))} rows={2} style={{ ...field, resize: 'vertical' }} /></div>
            </div>
          </div>
        )}

        <div style={{ ...mono('.56rem', 'var(--muted)'), lineHeight: 1.6, background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 8, padding: '.6rem .8rem', marginBottom: '1rem' }}>
          An admin reviews every dispute — nothing changes until it&apos;s approved.
        </div>

        {err && <div style={{ ...mono('.62rem', 'var(--red)'), marginBottom: '.8rem' }}>{err}</div>}
        <div style={{ display: 'flex', gap: '.6rem', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button onClick={submit} disabled={busy} style={{ ...primaryBtn, opacity: busy ? .6 : 1 }}>{busy ? 'Submitting…' : 'Submit dispute →'}</button>
        </div>
      </div>
    </div>
  )
}
