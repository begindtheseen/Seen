'use client'

// Paste-a-link import — add ANY job listing (Indeed, LinkedIn, a company careers page…)
// to Seen from its URL. On success the imported listing is handed to the parent, which
// drops it straight into the Apply & Optimize flow; the listing's apply_url points back
// at the original posting, so "optimize → apply online" returns the user to the exact
// page they pasted.
//
// Two-step contract with /api/import-listing: a first call with just { url } either
// returns the saved job, or needs_details:true with whatever was extractable (bot-walled
// pages) — then we ask the user for title/company and resubmit with those fields.

import { useState } from 'react'
import type { Job } from '@/lib/types'

const numOrNull = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

function toJob(j: Record<string, unknown>): Job {
  return {
    id: String(j.id || 'imp_' + Math.random().toString(36).slice(2, 10)),
    title: String(j.title || ''),
    company: String(j.company || ''),
    location: String(j.location || ''),
    score: numOrNull(j.score),
    waste: numOrNull(j.waste_score ?? j.waste),
    level: String(j.level || 'Mid level'),
    type: String(j.type || 'Full-time'),
    source: String(j.source || 'Imported'),
    description: String(j.description || ''),
    salary: j.salary ? String(j.salary) : null,
    apply_url: j.apply_url ? String(j.apply_url) : (j.url ? String(j.url) : null),
  }
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 9000,
  background: 'rgba(0,0,0,.8)', backdropFilter: 'blur(6px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: '1rem',
}

const sheet: React.CSSProperties = {
  width: '100%', maxWidth: 480,
  background: 'var(--surface)',
  border: '1px solid rgba(99,102,241,.22)',
  borderRadius: 20,
  overflow: 'hidden',
  boxShadow: '0 40px 120px rgba(0,0,0,.7), 0 0 80px rgba(99,102,241,.15)',
  maxHeight: '85dvh', overflowY: 'auto',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--card)',
  border: '1.5px solid var(--line2)',
  borderRadius: 8,
  padding: '.62rem .9rem',
  color: 'var(--white)',
  fontFamily: 'var(--body)',
  fontSize: '.85rem',
  outline: 'none',
  caretColor: 'var(--blue)',
}

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase',
  letterSpacing: '.08em', color: 'var(--dim)', marginBottom: '.3rem', display: 'block',
}

const btnPrimary: React.CSSProperties = {
  width: '100%', padding: '.8rem 1rem',
  background: 'linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%)',
  color: '#fff', border: 'none', borderRadius: 10,
  fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.88rem',
  cursor: 'pointer', boxShadow: '0 0 20px rgba(59,130,246,.3)',
}

type Phase = 'input' | 'details'

export default function ImportListingModal({
  onClose,
  onImported,
}: {
  onClose: () => void
  onImported: (job: Job) => void
}) {
  const [phase, setPhase] = useState<Phase>('input')
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [company, setCompany] = useState('')
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (busy) return
    if (!url.trim()) { setError('Paste the link to the job listing.'); return }
    if (phase === 'details' && (!title.trim() || !company.trim())) {
      setError('Job title and company are needed to import this listing.')
      return
    }
    setBusy(true); setError('')
    try {
      const r = await fetch('/api/import-listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          phase === 'details'
            ? { url: url.trim(), title: title.trim(), company: company.trim(), location: location.trim() }
            : { url: url.trim() }
        ),
      })
      const data = await r.json().catch(() => ({})) as {
        error?: string
        job?: Record<string, unknown>
        needs_details?: boolean
        draft?: { title?: string; company?: string; location?: string }
      }
      if (!r.ok) {
        setError(data.error || (r.status === 429 ? 'Too many imports — try again in a bit.' : 'Import failed — try again.'))
        return
      }
      if (data.needs_details) {
        setTitle(t => t || data.draft?.title || '')
        setCompany(c => c || data.draft?.company || '')
        setLocation(l => l || data.draft?.location || '')
        setPhase('details')
        return
      }
      if (data.job) {
        onImported(toJob(data.job))
        return
      }
      setError('Import failed — try again.')
    } catch {
      setError('Import failed — check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={sheet} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '.85rem 1.1rem', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontFamily: 'var(--display)', fontSize: '.88rem', fontWeight: 700, color: 'var(--white)' }}>
            {phase === 'details' ? 'Almost there — confirm the basics' : 'Add a job from a link'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', fontSize: '1rem', padding: '.2rem .3rem', lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ padding: '1.1rem' }}>
          {phase === 'input' && (
            <p style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--sub)', lineHeight: 1.7, marginBottom: '.9rem' }}>
              Paste a listing from Indeed, LinkedIn, or any careers page. We&apos;ll pull it into
              Seen so you can optimize your resume for it — then send you back to the original
              listing to apply.
            </p>
          )}
          {phase === 'details' && (
            <p style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--sub)', lineHeight: 1.7, marginBottom: '.9rem' }}>
              That site didn&apos;t let us read the whole listing. Confirm the job title and
              company and we&apos;ll take it from here.
            </p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
            <div>
              <label style={labelStyle}>Listing link</label>
              <input
                type="url"
                placeholder="https://www.indeed.com/viewjob?jk=…"
                value={url}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submit() }}
                disabled={phase === 'details'}
                autoFocus={phase === 'input'}
                style={{ ...inputStyle, opacity: phase === 'details' ? 0.55 : 1 }}
              />
            </div>

            {phase === 'details' && (
              <>
                <div>
                  <label style={labelStyle}>Job title</label>
                  <input type="text" placeholder="e.g. Senior Data Analyst" value={title}
                    onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit() }}
                    autoFocus style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Company</label>
                  <input type="text" placeholder="e.g. Acme Corp" value={company}
                    onChange={e => setCompany(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit() }}
                    style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Location <span style={{ textTransform: 'none', letterSpacing: 'normal' }}>(optional)</span></label>
                  <input type="text" placeholder="e.g. Austin, TX or Remote" value={location}
                    onChange={e => setLocation(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit() }}
                    style={inputStyle} />
                </div>
              </>
            )}

            {error && (
              <div style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 8, padding: '.6rem .85rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--red)' }}>
                {error}
              </div>
            )}

            <button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1, cursor: busy ? 'not-allowed' : 'pointer' }} onClick={submit} disabled={busy}>
              {busy ? 'Importing…' : phase === 'details' ? 'Add listing →' : '🔗 Import listing →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
