'use client'

// Live, cached per-company Reddit discussion for the company page's Reddit tab.
//
// Fetches /api/company-reddit on mount (the tab is lazy, so this mounts only when the
// visitor opens Reddit — one on-demand search, then cache-served for everyone after).
// The page never blocks on this: it renders first, this loads async behind a skeleton.
//
// DEFAMATION-SAFE: every item is an ATTRIBUTED LINK to a real public Reddit thread; the
// whole block is framed as public third-party discussion (PUBLIC_DISCUSSION_LABEL), never
// Seen's own assertion. A genuinely-absent company gets an honest empty state (never a
// broken blank), and there is a good-faith "Dispute or correct this" path on every state.

import { useState, useEffect, useCallback } from 'react'
import { PUBLIC_DISCUSSION_LABEL } from '@/lib/reportSource'

interface RedditThread {
  id: string
  title: string
  subreddit: string
  permalink: string
  author?: string
  created?: string
}

type Status = 'loading' | 'ok' | 'empty' | 'checking' | 'error'

const DISPUTE_REASONS: Array<{ value: string; label: string }> = [
  { value: 'not_us', label: "These threads aren't about our company" },
  { value: 'outdated', label: 'This is outdated / no longer accurate' },
  { value: 'misleading', label: 'This misrepresents us' },
  { value: 'resolved', label: 'The issue discussed has been resolved' },
  { value: 'other', label: 'Something else' },
]

function relativeDate(iso?: string): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const days = Math.floor((Date.now() - t) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

// ── Dispute / correction form ──────────────────────────────────────────────────────
function DisputeForm({ companyName, presetPermalink, onClose }: {
  companyName: string; presetPermalink?: string; onClose: () => void
}) {
  const [reason, setReason] = useState('not_us')
  const [detail, setDetail] = useState('')
  const [contact, setContact] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [err, setErr] = useState('')

  const submit = async () => {
    if (detail.trim().length < 10) { setErr('Please add a bit more detail (at least 10 characters).'); return }
    setState('sending'); setErr('')
    try {
      const r = await fetch('/api/company-reddit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dispute', company: companyName, reason, detail, contact, permalink: presetPermalink || '' }),
      })
      const j = await r.json().catch(() => ({}))
      if (r.ok && j.ok) { setState('done') }
      else { setState('error'); setErr(j.error || 'Could not submit. Please try again.') }
    } catch { setState('error'); setErr('Could not submit. Please try again.') }
  }

  if (state === 'done') {
    return (
      <div style={{ background: 'var(--card)', border: '1px solid rgba(16,185,129,.3)', borderRadius: 8, padding: '1rem', marginTop: '.75rem' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.66rem', color: 'var(--green)', marginBottom: '.3rem' }}>✓ Thank you — your correction was recorded.</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)', lineHeight: 1.5 }}>
          A person will review it. We surface public discussion for transparency and correct it in good faith.
        </div>
        <button onClick={onClose} style={btnGhost}>Close</button>
      </div>
    )
  }

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 8, padding: '1rem', marginTop: '.75rem' }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--dim)', marginBottom: '.6rem', lineHeight: 1.5 }}>
        Dispute or correct the public discussion shown for <strong>{companyName}</strong>.
        {presetPermalink && <span style={{ color: 'var(--muted)' }}><br />Regarding a specific thread you flagged.</span>}
      </div>
      <label style={labelStyle}>Reason</label>
      <select value={reason} onChange={e => setReason(e.target.value)} style={inputStyle}>
        {DISPUTE_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
      </select>
      <label style={labelStyle}>What should we know?</label>
      <textarea
        value={detail} onChange={e => setDetail(e.target.value)} rows={3} maxLength={2000}
        placeholder="Explain the correction. Good-faith detail helps us act on it."
        style={{ ...inputStyle, resize: 'vertical', minHeight: 64 }}
      />
      <label style={labelStyle}>Contact email <span style={{ color: 'var(--muted)', textTransform: 'none' }}>(optional — only if you want a reply)</span></label>
      <input value={contact} onChange={e => setContact(e.target.value)} maxLength={200} placeholder="you@company.com" style={inputStyle} />
      {err && <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--red)', marginTop: '.4rem' }}>{err}</div>}
      <div style={{ display: 'flex', gap: '.5rem', marginTop: '.75rem' }}>
        <button onClick={submit} disabled={state === 'sending'} style={{ ...btnPrimary, opacity: state === 'sending' ? 0.6 : 1 }}>
          {state === 'sending' ? 'Sending…' : 'Submit correction'}
        </button>
        <button onClick={onClose} style={btnGhost}>Cancel</button>
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)', marginTop: '.6rem', lineHeight: 1.5 }}>
        No account needed. Submissions are rate-limited and reviewed by a person.
      </div>
    </div>
  )
}

// ── Main block ──────────────────────────────────────────────────────────────────────
export default function CompanyRedditDiscussion({ companyName, hasReportData = false }: {
  companyName: string; hasReportData?: boolean
}) {
  const [status, setStatus] = useState<Status>('loading')
  const [items, setItems] = useState<RedditThread[]>([])
  const [showDispute, setShowDispute] = useState(false)
  const [flaggedPermalink, setFlaggedPermalink] = useState<string | undefined>(undefined)

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const r = await fetch('/api/company-reddit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: companyName }),
      })
      const j = await r.json().catch(() => ({})) as { items?: RedditThread[]; status?: string }
      setItems(Array.isArray(j.items) ? j.items : [])
      const s = j.status
      setStatus(s === 'ok' ? 'ok' : s === 'checking' ? 'checking' : (j.items && j.items.length ? 'ok' : 'empty'))
    } catch {
      setItems([]); setStatus('error')
    }
  }, [companyName])

  useEffect(() => { load() }, [load])

  const openDispute = (permalink?: string) => { setFlaggedPermalink(permalink); setShowDispute(true) }

  return (
    <div>
      {/* Attribution framing — always present, so the source is unambiguous */}
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--dim)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: '.35rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--red)', display: 'inline-block', flexShrink: 0 }} />
        What people are saying on Reddit
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
        {PUBLIC_DISCUSSION_LABEL} — public third-party threads, linked to their source. Not Seen&apos;s assessment.
      </div>

      {/* Loading skeleton — the page already rendered; this fills in behind it */}
      {status === 'loading' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 8, padding: '.85rem 1rem' }}>
              <div style={{ height: 10, width: `${70 - i * 12}%`, background: 'var(--line2)', borderRadius: 4, opacity: .7 }} />
              <div style={{ height: 8, width: '30%', background: 'var(--line2)', borderRadius: 4, marginTop: '.55rem', opacity: .4 }} />
            </div>
          ))}
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--muted)', textAlign: 'center', paddingTop: '.4rem' }}>
            Checking Reddit for public discussion about {companyName}…
          </div>
        </div>
      )}

      {/* Populated */}
      {status === 'ok' && items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
          {items.map(t => (
            <div key={t.id} style={{ background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 8, padding: '.85rem 1rem' }}>
              <a href={t.permalink} target="_blank" rel="noopener noreferrer nofollow"
                 style={{ fontFamily: 'var(--mono)', fontSize: '.7rem', color: 'var(--white, #fff)', lineHeight: 1.5, textDecoration: 'none', display: 'block' }}>
                {t.title} <span style={{ color: 'var(--blue)' }}>↗</span>
              </a>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginTop: '.5rem' }}>
                {t.subreddit && (
                  <a href={`https://www.reddit.com/r/${encodeURIComponent(t.subreddit)}/`} target="_blank" rel="noopener noreferrer nofollow"
                     style={{ fontFamily: 'var(--mono)', fontSize: '.54rem', color: 'var(--muted)', textDecoration: 'none', border: '1px solid var(--line2)', borderRadius: 4, padding: '.1rem .4rem' }}>
                    r/{t.subreddit}
                  </a>
                )}
                {t.created && <span style={{ fontFamily: 'var(--mono)', fontSize: '.54rem', color: 'var(--muted)' }}>{relativeDate(t.created)}</span>}
                <button onClick={() => openDispute(t.permalink)} title="Flag this thread as a name collision, outdated, or misleading"
                        style={{ ...flagBtn, marginLeft: 'auto' }}>Flag</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Honest empty state — never a broken blank. Points to the first-party report data. */}
      {(status === 'empty' || (status === 'ok' && items.length === 0)) && (
        <div style={{ textAlign: 'center', padding: '2rem 1.25rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.68rem', background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 10, lineHeight: 1.6 }}>
          No public Reddit discussion found yet for {companyName}.
          <br />
          <span style={{ fontSize: '.6rem', opacity: .75 }}>
            {hasReportData
              ? 'The scores and reports on this page are built from first-party applicant outcomes.'
              : 'Be the first to add a first-party outcome from the report tab.'}
          </span>
        </div>
      )}

      {/* Reddit unreachable right now — graceful, transient, never an error card */}
      {status === 'checking' && (
        <div style={{ textAlign: 'center', padding: '1.75rem 1.25rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.66rem', background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 10, lineHeight: 1.6 }}>
          Still checking Reddit for {companyName}…
          <br /><button onClick={load} style={{ ...btnGhost, marginTop: '.6rem' }}>Retry</button>
        </div>
      )}
      {status === 'error' && (
        <div style={{ textAlign: 'center', padding: '1.75rem 1.25rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.66rem', background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 10, lineHeight: 1.6 }}>
          Couldn&apos;t load Reddit discussion just now.
          <br /><button onClick={load} style={{ ...btnGhost, marginTop: '.6rem' }}>Retry</button>
        </div>
      )}

      {/* Dispute affordance — available on every state */}
      <div style={{ marginTop: '1rem' }}>
        {!showDispute
          ? <button onClick={() => openDispute(undefined)} style={btnDispute}>Dispute or correct this</button>
          : <DisputeForm companyName={companyName} presetPermalink={flaggedPermalink} onClose={() => setShowDispute(false)} />}
      </div>
    </div>
  )
}

// ── shared inline styles ─────────────────────────────────────────────────────────────
const labelStyle: React.CSSProperties = { display: 'block', fontFamily: 'var(--mono)', fontSize: '.54rem', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)', margin: '.6rem 0 .3rem' }
const inputStyle: React.CSSProperties = { width: '100%', background: 'var(--surface, #111)', border: '1px solid var(--line2)', borderRadius: 6, padding: '.45rem .7rem', color: 'var(--white, #fff)', fontFamily: 'var(--mono)', fontSize: '.66rem', outline: 'none', boxSizing: 'border-box' }
const btnPrimary: React.CSSProperties = { background: 'linear-gradient(135deg,rgba(99,102,241,0.15),rgba(16,185,129,0.15))', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 6, color: 'var(--blue)', fontFamily: 'var(--mono)', fontSize: '.66rem', padding: '.45rem 1rem', cursor: 'pointer' }
const btnGhost: React.CSSProperties = { background: 'none', border: '1px solid var(--line2)', borderRadius: 6, color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.64rem', padding: '.4rem .75rem', cursor: 'pointer' }
const btnDispute: React.CSSProperties = { background: 'none', border: '1px solid var(--line2)', borderRadius: 6, color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.6rem', padding: '.4rem .8rem', cursor: 'pointer' }
const flagBtn: React.CSSProperties = { background: 'none', border: 'none', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.52rem', cursor: 'pointer', textDecoration: 'underline', padding: 0 }
