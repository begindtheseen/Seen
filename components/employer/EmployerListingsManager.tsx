'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth'
import ModalPortal from '@/components/ModalPortal'

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
  apply_mode?: ApplyMode
  // Apply-on-Seen applications to this listing ({ total, new }) — 0s until the feature is live.
  seen_applications?: { total: number; new: number }
  applications: number
  openDispute: OpenDispute
  // Set when an admin took the listing down (via delete or an approved dispute) — carries the
  // reason so the employer sees "Deleted by admin · view why" instead of a silent expiry.
  removed: { reason: string; reasonLabel: string; at: string | null; disputeId: number | null; note: string | null; disputeKind: string | null } | null
}

type ApplyMode = 'external' | 'seen' | 'both'
const APPLY_MODE_LABEL: Record<ApplyMode, string> = { external: 'Applies on your site', seen: 'Applies on Seen', both: 'Applies on Seen + your site' }

type Summary = { total: number; active: number; employerPosted: number; applications: number; openDisputes: number }

type DisputeKind = 'inactive' | 'delete' | 'edit' | 'not_ours' | 'other' | 'still_active'
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
const card: React.CSSProperties = { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16, padding: '1.5rem', marginBottom: 0 }
const kicker: React.CSSProperties = { ...mono('.55rem', 'var(--blue)'), textTransform: 'uppercase', letterSpacing: '.16em', marginBottom: '.5rem' }
const h2: React.CSSProperties = { fontFamily: 'var(--display)', fontSize: '1.15rem', fontWeight: 800, color: 'var(--white)', margin: '0 0 .4rem', letterSpacing: '-.02em' }
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
  { value: 'still_active', label: 'Report is wrong — still active' },
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
  const [refreshing, setRefreshing] = useState(false)
  const [listings, setListings] = useState<Listing[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [disputes, setDisputes] = useState<Dispute[]>([])
  const [pending, setPending] = useState(false) // 403 no_approved_claim
  const [err, setErr] = useState('')
  const [company, setCompanyName] = useState('')

  const [showAdd, setShowAdd] = useState(false)
  const [disputeFor, setDisputeFor] = useState<Listing | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [whyOpen, setWhyOpen] = useState<Record<string, boolean>>({})
  const [modalDefaultKind, setModalDefaultKind] = useState<DisputeKind | null>(null)

  // Deep link from an employer notification: /employers/dashboard?dispute=<jobId>&kind=still_active
  // auto-opens the dispute modal for that listing once the list loads — "your listing was
  // reported" is disputable in one click, not a hunt through the table. Params are consumed
  // (replaceState) so refresh/back doesn't re-open the modal.
  const deepLinkRef = useRef<{ jobId: string; kind: DisputeKind } | null>(null)
  // ?prefill=<jobId> (from a listing-decay notification): open Add-a-listing prefilled from
  // that listing — "post this role yourself" / "repost" in one click.
  const prefillLinkRef = useRef<string | null>(null)
  const [prefill, setPrefill] = useState<ListingPrefill | null>(null)
  // Apply on Seen: switched on once the migration is live (list → seen_apply_available).
  const [seenApplyAvailable, setSeenApplyAvailable] = useState(false)
  const [inboxFor, setInboxFor] = useState<Listing | null>(null)
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search)
      const jid = p.get('dispute')
      const pre = p.get('prefill')
      if (!jid && !pre) return
      if (jid) {
        const k = p.get('kind') as DisputeKind | null
        deepLinkRef.current = { jobId: jid, kind: k && KIND_OPTIONS.some(o => o.value === k) ? k : 'still_active' }
      }
      if (pre) prefillLinkRef.current = pre
      p.delete('dispute'); p.delete('kind'); p.delete('prefill')
      const qs = p.toString()
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash)
    } catch { /* deep link is best-effort */ }
  }, [])
  useEffect(() => {
    if (loading) return
    const dl = deepLinkRef.current
    if (dl) {
      const target = listings.find(l => String(l.id) === dl.jobId)
      if (target) {
        deepLinkRef.current = null
        setShowAll(true)
        setModalDefaultKind(dl.kind)
        setDisputeFor(target)
      }
    }
    const pre = prefillLinkRef.current
    if (pre) {
      const target = listings.find(l => String(l.id) === pre)
      prefillLinkRef.current = null
      // Prefill from the listing when we have it (title/location/apply link — the list shape
      // carries no description); an unknown id still opens the empty form rather than nothing.
      setPrefill(target ? { title: target.title, location: target.location, apply_url: target.apply_url } : {})
      setShowAdd(true)
    }
  }, [loading, listings])

  // Your OWN posted listings lead, then the aggregated ones (newest first from the API). For a big
  // company that keeps the listings you manage from being lost in a wall of indexed roles.
  const VISIBLE_CAP = 6
  const sortedListings = [...listings].sort((a, b) => Number(b.is_employer_posted) - Number(a.is_employer_posted))
  const visibleListings = showAll ? sortedListings : sortedListings.slice(0, VISIBLE_CAP)
  const hiddenCount = sortedListings.length - visibleListings.length

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
      setSeenApplyAvailable(!!listData?.seen_apply_available)

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

  // Delete one of the employer's OWN posted listings (direct — the API enforces ownership).
  const removeListing = useCallback(async (id: string) => {
    if (!window.confirm('Delete this listing? It will be removed from Seen. This cannot be undone.')) return
    setDeletingId(id); setErr('')
    try {
      const authToken = await token()
      if (!authToken) return
      const res = await fetch('/api/employer-listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ action: 'delete', job_id: id }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(d?.error || 'Could not delete the listing — please try again.'); return }
      await load()
    } catch {
      setErr('Could not delete the listing — please try again.')
    } finally {
      setDeletingId(null)
    }
  }, [token, load])

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
            Every listing Seen has matched to your company. Post a new role (or import one from a link)
            and delete it anytime — listings you post or import on Seen appear ahead of aggregated
            listings in matching searches. For aggregated listings, dispute one that&apos;s inactive, wrong, or not yours — an admin
            reviews every dispute, so nothing third-party changes until it&apos;s approved.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '.5rem', flexShrink: 0 }}>
          <button onClick={() => setShowAdd(v => !v)} style={primaryBtn}>{showAdd ? 'Close' : '+ Add a listing'}</button>
          <button onClick={() => { setRefreshing(true); load().finally(() => setRefreshing(false)) }} disabled={refreshing} style={ghostBtn}>{refreshing ? '↻ Refreshing…' : '↻ Refresh'}</button>
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
      {showAdd && <AddListingForm key={prefill ? `pre-${prefill.title || 'blank'}` : 'blank'} token={token} initial={prefill} seenApplyAvailable={seenApplyAvailable} onCreated={() => { setShowAdd(false); setPrefill(null); load() }} />}

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
          {visibleListings.map(l => {
            const om = ORIGIN_META[l.origin] || ORIGIN_META.aggregated
            return (
              <div key={l.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap', padding: '.95rem 0', borderBottom: '1px solid var(--line)' }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--display)', fontSize: '.9rem', fontWeight: 700, color: l.removed ? 'var(--muted)' : 'var(--white)', textDecoration: l.removed ? 'line-through' : 'none' }}>{l.title}</span>
                    <span style={{ ...mono('.5rem', om.color), textTransform: 'uppercase', letterSpacing: '.08em', border: `1px solid ${om.color}`, borderRadius: 5, padding: '.1rem .4rem' }}>{om.label}</span>
                    {l.removed ? (
                      <span style={{ ...mono('.5rem', 'var(--red)'), textTransform: 'uppercase', letterSpacing: '.06em', background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.4)', borderRadius: 999, padding: '.1rem .45rem' }}>Deleted by admin</span>
                    ) : (
                      <span style={{ ...mono('.5rem', availColor(l.availability_status)), textTransform: 'uppercase', letterSpacing: '.06em', background: 'var(--raised)', border: `1px solid ${availColor(l.availability_status)}`, borderRadius: 999, padding: '.1rem .45rem' }}>{l.availability_status}</span>
                    )}
                    {l.removed && (
                      <button onClick={() => setWhyOpen(w => ({ ...w, [String(l.id)]: !w[String(l.id)] }))} style={{ background: 'none', border: 'none', cursor: 'pointer', ...mono('.55rem', 'var(--blue)'), textDecoration: 'underline', padding: 0 }}>
                        {whyOpen[String(l.id)] ? 'hide' : 'view why'}
                      </button>
                    )}
                  </div>
                  <div style={{ ...mono('.56rem', 'var(--dim)'), marginTop: '.3rem', display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                    {l.location && <span>{l.location}</span>}
                    {l.source && <span>· {l.source}</span>}
                    {l.created_at && <span>· posted {fmtDate(l.created_at)}</span>}
                    {!l.removed && l.expires_at && <span>· expires {fmtDate(l.expires_at)}</span>}
                    {l.apply_url && l.apply_mode !== 'seen' && <>· <a href={l.apply_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue)', textDecoration: 'none' }}>Apply link ↗</a></>}
                    {seenApplyAvailable && l.is_employer_posted && <span>· {APPLY_MODE_LABEL[l.apply_mode || 'external']}</span>}
                  </div>
                  {l.removed && whyOpen[String(l.id)] && (
                    <div style={{ marginTop: '.5rem', padding: '.6rem .8rem', background: 'rgba(239,68,68,.05)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 8 }}>
                      <div style={{ ...mono('.58rem', 'var(--white)'), fontWeight: 700 }}>{l.removed.reasonLabel}{l.removed.at ? ` · ${fmtDate(l.removed.at)}` : ''}</div>
                      {l.removed.disputeId && <div style={{ ...mono('.55rem', 'var(--sub)'), marginTop: '.25rem' }}>Via dispute <span style={{ color: 'var(--blue)' }}>#{l.removed.disputeId}</span>{l.removed.disputeKind ? ` (${KIND_LABEL[l.removed.disputeKind] || l.removed.disputeKind})` : ''}</div>}
                      {l.removed.note && <div style={{ ...mono('.55rem', 'var(--sub)'), marginTop: '.25rem', lineHeight: 1.5 }}>Admin note: {l.removed.note}</div>}
                      <div style={{ ...mono('.52rem', 'var(--muted)'), marginTop: '.35rem', lineHeight: 1.5 }}>Think this was a mistake? Repost the role or contact support to appeal.</div>
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '.35rem', flexShrink: 0 }}>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontFamily: 'var(--display)', fontSize: '1.1rem', fontWeight: 800, color: l.applications ? 'var(--white)' : 'var(--muted)', lineHeight: 1 }}>{l.applications}</span>
                    <span style={{ ...mono('.5rem', 'var(--dim)'), marginLeft: '.35rem' }}>application{l.applications === 1 ? '' : 's'}</span>
                  </div>
                  {seenApplyAvailable && l.is_employer_posted && (l.apply_mode === 'seen' || l.apply_mode === 'both' || (l.seen_applications?.total || 0) > 0) && (
                    <button onClick={() => setInboxFor(l)} style={{ ...ghostBtn, padding: '.35rem .8rem', ...mono('.6rem', (l.seen_applications?.new || 0) > 0 ? 'var(--green)' : 'var(--sub)'), borderColor: (l.seen_applications?.new || 0) > 0 ? 'var(--green)' : undefined }}>
                      Applications on Seen · {l.seen_applications?.total || 0}{(l.seen_applications?.new || 0) > 0 ? ` (${l.seen_applications?.new} new)` : ''}
                    </button>
                  )}
                  {l.removed ? (
                    // Already taken down by an admin — nothing to act on; "view why" is on the left.
                    <span style={{ ...mono('.55rem', 'var(--muted)') }}>Removed</span>
                  ) : l.is_employer_posted ? (
                    // Your OWN posted listing — delete it directly (no admin dispute needed).
                    <button onClick={() => removeListing(l.id)} disabled={deletingId === l.id} style={{ ...ghostBtn, padding: '.35rem .8rem', ...mono('.6rem', 'var(--red)'), borderColor: 'rgba(239,68,68,.45)', opacity: deletingId === l.id ? .6 : 1 }}>{deletingId === l.id ? 'Deleting…' : 'Delete'}</button>
                  ) : l.openDispute ? (
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
          {(hiddenCount > 0 || showAll) && sortedListings.length > VISIBLE_CAP && (
            <button
              onClick={() => setShowAll(v => !v)}
              style={{ ...ghostBtn, alignSelf: 'flex-start', marginTop: '.9rem', padding: '.45rem 1rem', ...mono('.62rem', 'var(--sub)') }}
            >
              {showAll ? '↑ Show fewer' : `↓ Show all ${sortedListings.length} listings`}
            </button>
          )}
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
                  {/* The dispute number — the same reference the admin verdict + your notification carry. */}
                  <div style={mono('.62rem', 'var(--white)')}><span style={{ color: 'var(--blue)', fontWeight: 700 }}>#{d.id}</span> · {KIND_LABEL[d.kind] || d.kind}</div>
                  <div style={{ ...mono('.58rem', 'var(--sub)'), lineHeight: 1.5, marginTop: '.15rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{d.detail}</div>
                  {d.admin_note && <div style={{ ...mono('.56rem', 'var(--muted)'), marginTop: '.2rem' }}>Admin note: {d.admin_note}</div>}
                </div>
                {d.created_at && <span style={{ ...mono('.52rem', 'var(--dim)'), flexShrink: 0 }}>{fmtDate(d.created_at)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {inboxFor && (
        <ApplicationsInbox listing={inboxFor} token={token} onClose={() => { setInboxFor(null); load() }} />
      )}

      {disputeFor && (
        <DisputeModal
          listing={disputeFor}
          token={token}
          defaultKind={modalDefaultKind}
          onClose={() => { setDisputeFor(null); setModalDefaultKind(null) }}
          onSubmitted={() => { setDisputeFor(null); setModalDefaultKind(null); load() }}
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
export type ListingPrefill = { title?: string; apply_url?: string | null; location?: string | null; salary?: string | null; description?: string | null }

function AddListingForm({ token, onCreated, initial, seenApplyAvailable }: { token: () => Promise<string | null>; onCreated: () => void; initial?: ListingPrefill | null; seenApplyAvailable?: boolean }) {
  const [title, setTitle] = useState(initial?.title || '')
  // Where candidates apply. 'external' until Apply on Seen is live (the API refuses the others).
  const [applyMode, setApplyMode] = useState<ApplyMode>('external')
  const needsLink = applyMode !== 'seen'
  const [applyUrl, setApplyUrl] = useState(initial?.apply_url || '')
  const [location, setLocation] = useState(initial?.location || '')
  const [salary, setSalary] = useState(initial?.salary || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [type, setType] = useState('Full-time')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // Import from a link → api/employer-listings import_preview (writes nothing; just prefills).
  const [importUrl, setImportUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [importNote, setImportNote] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | null>(null)

  async function importFromLink() {
    const url = importUrl.trim()
    if (!/^https?:\/\//i.test(url)) { setImportNote({ tone: 'err', text: 'Paste the full listing link (https://…).' }); return }
    setImporting(true); setImportNote(null)
    try {
      const authToken = await token()
      if (!authToken) { setImportNote({ tone: 'err', text: 'Your session expired — please sign in again.' }); return }
      const r = await fetch('/api/employer-listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ action: 'import_preview', url }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d?.listing) { setImportNote({ tone: 'err', text: d?.error || 'Could not read that link — fill the form in by hand.' }); return }
      const l = d.listing as { title: string; company: string; location: string; salary: string; type: string; description: string; apply_url: string }
      // Only overwrite with what the link actually gave us — never blank out typed fields.
      if (l.title) setTitle(l.title)
      if (l.apply_url) setApplyUrl(l.apply_url)
      if (l.location) setLocation(l.location)
      if (l.salary) setSalary(l.salary)
      if (l.description) setDescription(l.description)
      if (l.type === 'Part-time' || l.type === 'Full-time') setType(l.type)
      const notes: string[] = []
      let tone: 'ok' | 'warn' = 'ok'
      if (d.company_matches === false) {
        tone = 'warn'
        notes.push(`This listing names “${l.company}”, not ${d.your_company || 'your company'}. It will post under ${d.your_company || 'your company'} — only post roles you're hiring for.`)
      } else if (d.company_matches == null) {
        tone = 'warn'
        notes.push(`We couldn't tell which company this listing is for — check it's one of yours.`)
      }
      const missing: string[] = Array.isArray(d.missing) ? d.missing : []
      if (missing.length) {
        tone = 'warn'
        const names: Record<string, string> = { title: 'the title', description: 'the description', apply_url: 'the apply link' }
        notes.push(`We couldn't read ${missing.map(m => names[m] || m).join(' or ')} from that page — fill ${missing.length > 1 ? 'them' : 'it'} in below.`)
      }
      setImportNote({ tone, text: notes.length ? notes.join(' ') : 'Imported — review the details below, then post.' })
    } catch {
      setImportNote({ tone: 'err', text: 'Could not read that link — fill the form in by hand.' })
    } finally {
      setImporting(false)
    }
  }

  const label: React.CSSProperties = { ...mono('.55rem', 'var(--sub)'), textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '.3rem', display: 'block' }
  const field: React.CSSProperties = { ...inputStyle, width: '100%', minWidth: 0 }

  async function submit() {
    if (title.trim().length < 3) { setErr('Title must be at least 3 characters.'); return }
    if (needsLink && !/^https?:\/\//i.test(applyUrl.trim())) { setErr(applyMode === 'both' ? 'Add your website’s apply link (http/https), or choose “On Seen” only.' : 'Apply link must be a full http(s) URL.'); return }
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
          apply_url: applyUrl.trim() || undefined,
          apply_mode: seenApplyAvailable ? applyMode : 'external',
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
      <div style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid var(--line)' }}>
        <label style={label}>Import from a link — your careers page, ATS, Indeed, LinkedIn…</label>
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          <input value={importUrl} onChange={e => setImportUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') importFromLink() }} placeholder="https://boards.greenhouse.io/yourco/jobs/123" style={{ ...field, flex: '1 1 240px', width: 'auto' }} />
          <button onClick={importFromLink} disabled={importing} style={{ ...ghostBtn, opacity: importing ? .6 : 1 }}>{importing ? 'Reading…' : 'Import'}</button>
        </div>
        <div style={{ ...mono('.55rem', 'var(--dim)'), marginTop: '.4rem', lineHeight: 1.6 }}>
          We fill in the form below from the listing — you review it before anything is posted. Applicants are sent to the original link. Listings you post or import on Seen show ahead of aggregated listings in matching searches.
        </div>
        {importNote && (
          <div style={{ ...mono('.6rem', importNote.tone === 'err' ? 'var(--red)' : importNote.tone === 'warn' ? 'var(--amber)' : 'var(--green)'), marginTop: '.55rem', lineHeight: 1.6 }}>{importNote.text}</div>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '.9rem' }}>
        <div>
          <label style={label}>Title *</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Senior Product Designer" style={field} />
        </div>
        {seenApplyAvailable && (
          <div style={{ gridColumn: '1 / -1' }}>
            <span style={label}>How should candidates apply?</span>
            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
              {([
                ['external', 'On your website', 'Candidates go to your apply link'],
                ['seen', 'On Seen', 'Résumés come to your Seen inbox — no ATS needed'],
                ['both', 'Both', 'Candidates choose'],
              ] as [ApplyMode, string, string][]).map(([m, t, sub]) => (
                <button key={m} type="button" onClick={() => setApplyMode(m)} aria-pressed={applyMode === m}
                  style={{ flex: '1 1 150px', textAlign: 'left', background: applyMode === m ? 'rgba(16,185,129,.08)' : 'var(--card)', border: `1px solid ${applyMode === m ? 'var(--green)' : 'var(--line2)'}`, borderRadius: 9, padding: '.55rem .7rem', cursor: 'pointer' }}>
                  <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: '.8rem', color: applyMode === m ? 'var(--green)' : 'var(--white)' }}>{t}</div>
                  <div style={{ ...mono('.52rem', 'var(--muted)'), marginTop: '.15rem', lineHeight: 1.4 }}>{sub}</div>
                </button>
              ))}
            </div>
          </div>
        )}
        {needsLink && (
          <div>
            <label style={label}>Apply link — where candidates are redirected to apply *</label>
            <input value={applyUrl} onChange={e => setApplyUrl(e.target.value)} placeholder="https://…" style={field} />
          </div>
        )}
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
function DisputeModal({ listing, token, onClose, onSubmitted, defaultKind }: { listing: Listing; token: () => Promise<string | null>; onClose: () => void; onSubmitted: () => void; defaultKind?: DisputeKind | null }) {
  const [kind, setKind] = useState<DisputeKind>(defaultKind || 'inactive')
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
    <ModalPortal>
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(2,4,10,.86)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 1rem', overflowY: 'auto' }}>
      {/* SOLID surface — var(--card) is a translucent 3%-white raised tint (fine layered over a
          solid bg, but see-through as a floating panel), so the modal uses an opaque background. */}
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 16, padding: '1.6rem', boxShadow: '0 24px 70px rgba(0,0,0,.7)' }}>
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
    </ModalPortal>
  )
}

// ── Apply-on-Seen applications inbox (one listing) ───────────────────────────
type SeenApplication = {
  id: string; job_id: string; job_title: string | null; name: string; email: string; phone: string | null
  note: string | null; status: AppStatus; created_at: string; resume_file_name: string | null
  has_resume_file: boolean; has_resume_text: boolean
}
type AppStatus = 'new' | 'reviewed' | 'interviewing' | 'rejected' | 'hired'
const APP_STATUSES: [AppStatus, string][] = [['new', 'New'], ['reviewed', 'Reviewed'], ['interviewing', 'Interviewing'], ['rejected', 'Not moving forward'], ['hired', 'Hired']]

function ApplicationsInbox({ listing, token, onClose }: { listing: Listing; token: () => Promise<string | null>; onClose: () => void }) {
  const [apps, setApps] = useState<SeenApplication[] | null>(null)
  const [err, setErr] = useState('')
  const [resumeText, setResumeText] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)

  const call = useCallback(async (body: object) => {
    const authToken = await token()
    if (!authToken) throw new Error('Your session expired — please sign in again.')
    const r = await fetch('/api/employer-listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify(body),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(d?.error || 'Something went wrong — please try again.')
    return d
  }, [token])

  useEffect(() => {
    let cancelled = false
    call({ action: 'applications', job_id: listing.id })
      .then(d => { if (!cancelled) setApps(Array.isArray(d.applications) ? d.applications : []) })
      .catch(e => { if (!cancelled) setErr((e as Error).message) })
    return () => { cancelled = true }
  }, [call, listing.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function setStatus(a: SeenApplication, status: AppStatus) {
    const prev = a.status
    setApps(list => (list || []).map(x => x.id === a.id ? { ...x, status } : x)) // optimistic
    try { await call({ action: 'application_status', id: a.id, status }) }
    catch (e) { setApps(list => (list || []).map(x => x.id === a.id ? { ...x, status: prev } : x)); setErr((e as Error).message) }
  }

  async function openResume(a: SeenApplication) {
    setBusyId(a.id); setErr('')
    // Open the tab synchronously (popup blockers allow it only inside the click), then point it
    // at the short-lived signed URL once it's minted.
    const win = a.has_resume_file ? window.open('', '_blank') : null
    if (win) win.opener = null
    try {
      const d = await call({ action: 'application_resume', id: a.id })
      if (d.url) {
        if (win) win.location.href = d.url
        else window.open(d.url, '_blank', 'noopener,noreferrer')
      } else {
        win?.close()
        if (d.text) setResumeText(t => ({ ...t, [a.id]: d.text }))
      }
    } catch (e) { win?.close(); setErr((e as Error).message) }
    finally { setBusyId(null) }
  }

  return (
    <ModalPortal>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(2,4,10,.86)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 1rem', overflowY: 'auto' }}>
        <div role="dialog" aria-modal="true" aria-label={`Applications for ${listing.title}`} onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 640, background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 16, padding: '1.2rem 1.2rem 1.4rem' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.75rem', marginBottom: '.9rem' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...mono('.55rem', 'var(--green)'), textTransform: 'uppercase', letterSpacing: '.1em' }}>Applications on Seen</div>
              <div style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: '1.05rem', color: 'var(--white)', marginTop: '.2rem' }}>{listing.title}</div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" style={{ ...ghostBtn, width: 32, height: 32, padding: 0 }}>✕</button>
          </div>
          {err && <div role="alert" style={{ ...mono('.62rem', 'var(--red)'), marginBottom: '.7rem' }}>{err}</div>}
          {apps === null && !err && <div style={mono('.62rem', 'var(--muted)')}>Loading…</div>}
          {apps && apps.length === 0 && (
            <div style={{ ...mono('.62rem', 'var(--muted)'), lineHeight: 1.6 }}>No applications yet. When a candidate applies on Seen, their résumé, contact details and note show up here — and we email you.</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
            {(apps || []).map(a => (
              <div key={a.id} style={{ background: 'var(--raised)', border: `1px solid ${a.status === 'new' ? 'rgba(16,185,129,.4)' : 'var(--line2)'}`, borderRadius: 11, padding: '.8rem .9rem' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.6rem', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: '.9rem', color: 'var(--white)' }}>{a.name}</div>
                    <div style={{ ...mono('.58rem', 'var(--sub)'), marginTop: '.2rem', display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                      <a href={`mailto:${a.email}?subject=${encodeURIComponent(`Your application — ${listing.title}`)}`} style={{ color: 'var(--blue)', textDecoration: 'none' }}>{a.email}</a>
                      {a.phone && <a href={`tel:${a.phone}`} style={{ color: 'var(--blue)', textDecoration: 'none' }}>{a.phone}</a>}
                      <span style={{ color: 'var(--dim)' }}>· {fmtDate(a.created_at)}</span>
                    </div>
                  </div>
                  <select value={a.status} onChange={e => setStatus(a, e.target.value as AppStatus)} aria-label="Application status" style={{ ...inputStyle, flex: 'none', minWidth: 0, width: 'auto', padding: '.35rem .5rem', cursor: 'pointer' }}>
                    {APP_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                {a.note && <div style={{ ...mono('.6rem', 'var(--sub)'), lineHeight: 1.6, marginTop: '.55rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>“{a.note}”</div>}
                {(a.has_resume_file || a.has_resume_text) && (
                  <button type="button" onClick={() => openResume(a)} disabled={busyId === a.id} style={{ ...ghostBtn, marginTop: '.6rem', padding: '.35rem .8rem', ...mono('.6rem', 'var(--blue)'), opacity: busyId === a.id ? .6 : 1 }}>
                    {busyId === a.id ? 'Opening…' : a.has_resume_file ? `View résumé${a.resume_file_name ? ` (${a.resume_file_name})` : ''} ↗` : 'View résumé'}
                  </button>
                )}
                {resumeText[a.id] && (
                  <pre style={{ ...mono('.6rem', 'var(--text)'), whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '.7rem', marginTop: '.55rem', maxHeight: 360, overflowY: 'auto' }}>{resumeText[a.id]}</pre>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
