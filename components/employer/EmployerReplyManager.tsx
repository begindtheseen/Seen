'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'

// The employer "respond" surface (Wave 2). An approved employer sees the outcome reports candidates
// filed about them and can post a public reply to any one — their side of the record. Replies are
// held for admin review (owner decision 2026-08-03) and NEVER affect the transparency score; this
// component only ever writes to api/employer-replies, never the scoring path.
//
// Self-scoped: reports come from the public reports-feed (by company name); the employer's own reply
// statuses come from api/employer-replies?action=mine (Bearer + approved claim). Rendered only for a
// scoped employer (the hub passes canRespond).

type Report = { id: string | null; role: string | null; outcome: string | null; created_at: string | null; experience_level: string | null; report_text: string | null }
type Reply = { id: number; report_id: string; body: string; status: 'pending' | 'approved' | 'rejected'; created_at: string; reviewed_at: string | null }

const outcomeTone = (o: string | null) => {
  const s = (o || '').toLowerCase()
  if (s.includes('ghost')) return { c: 'var(--red)', label: 'Ghosted' }
  if (s.includes('reject') || s === 'autoreject') return { c: 'var(--amber)', label: 'Rejected' }
  if (s.includes('hire') || s.includes('offer')) return { c: 'var(--green)', label: 'Hired' }
  if (s.includes('human') || s.includes('interview')) return { c: 'var(--green)', label: 'Responded' }
  return { c: 'var(--muted)', label: o || 'Reported' }
}

const statusChip: Record<Reply['status'], { c: string; bg: string; label: string }> = {
  pending: { c: 'var(--amber)', bg: 'rgba(245,158,11,.12)', label: 'Awaiting review' },
  approved: { c: 'var(--green)', bg: 'rgba(16,185,129,.12)', label: 'Published' },
  rejected: { c: 'var(--red)', bg: 'rgba(239,68,68,.12)', label: 'Not published' },
}

function fmtDate(iso: string | null) {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  try { return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) } catch { return '' }
}

export function EmployerReplyManager({ company }: { company: string }) {
  const { token } = useAuth()
  const [reports, setReports] = useState<Report[]>([])
  const [replies, setReplies] = useState<Record<string, Reply>>({})
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const loadReplies = useCallback(async () => {
    const t = await token()
    if (!t) return
    try {
      const r = await fetch('/api/employer-replies', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        body: JSON.stringify({ action: 'mine' }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok && Array.isArray(d.replies)) {
        const map: Record<string, Reply> = {}
        for (const x of d.replies as Reply[]) map[x.report_id] = x
        setReplies(map)
      }
    } catch { /* status just won't show */ }
  }, [token])

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      try {
        const r = await fetch(`/employers/dashboard/reports-feed?company=${encodeURIComponent(company)}`)
        const d = await r.json().catch(() => ({ reports: [] }))
        if (alive) setReports(Array.isArray(d.reports) ? (d.reports as Report[]).filter(x => x.id) : [])
      } catch { /* empty */ }
      await loadReplies()
      if (alive) setLoading(false)
    })()
    return () => { alive = false }
  }, [company, loadReplies])

  async function submit(reportId: string) {
    const body = draft.trim()
    if (!body) return
    setBusy(true); setErr('')
    try {
      const t = await token()
      if (!t) { setErr('Your session expired — sign in again.'); setBusy(false); return }
      const r = await fetch('/api/employer-replies', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        body: JSON.stringify({ action: 'create', report_id: reportId, body }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(d?.error || 'Could not save your reply — try again.'); setBusy(false); return }
      setOpenId(null); setDraft('')
      await loadReplies()
    } catch { setErr('Network error — try again.') }
    setBusy(false)
  }

  return (
    <section style={{ marginBottom: '1.6rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '.5rem', marginBottom: '.7rem' }}>
        <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.05rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.02em', margin: 0 }}>Respond to what candidates reported</h2>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)' }}>your voice · reviewed before public</span>
      </div>

      {loading ? (
        <div className="emp-card" style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '1.4rem', display: 'flex', alignItems: 'center', gap: '.6rem' }}>
          <div className="spinner" /><span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)' }}>Loading reports…</span>
        </div>
      ) : reports.length === 0 ? (
        <div className="emp-card" style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '1.6rem', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--display)', fontSize: '.9rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.3rem' }}>No reports to respond to yet</div>
          <p style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>When candidates report an outcome after applying to {company}, you can add your side here.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
          {reports.slice(0, 12).map((rep, i) => {
            const key = rep.id || String(i)
            const tone = outcomeTone(rep.outcome)
            const existing = rep.id ? replies[rep.id] : undefined
            const isOpen = openId === rep.id
            return (
              <div key={key} className="emp-card" style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '1rem 1.1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap', marginBottom: rep.report_text ? '.5rem' : '.2rem' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', fontWeight: 700, color: tone.c, background: 'var(--raised)', border: `1px solid ${tone.c}`, borderRadius: 6, padding: '.16rem .45rem', whiteSpace: 'nowrap' }}>{tone.label}</span>
                  <span style={{ fontFamily: 'var(--display)', fontSize: '.82rem', fontWeight: 600, color: 'var(--white)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rep.role || 'Role unspecified'}</span>
                  {rep.created_at && <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--dim)', marginLeft: 'auto' }}>{fmtDate(rep.created_at)}</span>}
                </div>
                {rep.report_text && (
                  <p style={{ color: 'var(--sub)', fontSize: '.76rem', lineHeight: 1.6, margin: '0 0 .6rem', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>&ldquo;{rep.report_text}&rdquo;</p>
                )}

                {existing ? (
                  <div style={{ borderTop: '1px solid var(--line)', paddingTop: '.6rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.35rem' }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', fontWeight: 700, color: statusChip[existing.status].c, background: statusChip[existing.status].bg, borderRadius: 6, padding: '.14rem .45rem' }}>{statusChip[existing.status].label}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--dim)' }}>your reply</span>
                    </div>
                    <p style={{ color: 'var(--sub)', fontSize: '.76rem', lineHeight: 1.6, margin: 0 }}>{existing.body}</p>
                    {existing.status === 'rejected' && (
                      <button onClick={() => { setOpenId(rep.id); setDraft(existing.body) }} style={{ marginTop: '.5rem', background: 'transparent', border: '1px solid var(--line2)', borderRadius: 7, padding: '.35rem .8rem', fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--white)', cursor: 'pointer' }}>Revise &amp; resubmit</button>
                    )}
                  </div>
                ) : isOpen ? (
                  <div style={{ borderTop: '1px solid var(--line)', paddingTop: '.6rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                    <textarea
                      value={draft} onChange={e => setDraft(e.target.value)} rows={3} autoFocus
                      placeholder="Add your side — what actually happened, or what you're changing. Shown publicly after review; never affects your score."
                      style={{ width: '100%', boxSizing: 'border-box', background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 8, padding: '.6rem .7rem', fontFamily: 'var(--sans, inherit)', fontSize: '.78rem', color: 'var(--white)', outline: 'none', resize: 'vertical' }}
                    />
                    {err && <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--red)' }}>{err}</div>}
                    <div style={{ display: 'flex', gap: '.5rem' }}>
                      <button onClick={() => rep.id && submit(rep.id)} disabled={busy || !draft.trim()} style={{ background: 'linear-gradient(135deg,#1d4ed8,#7c3aed)', border: 'none', borderRadius: 8, padding: '.5rem 1rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.72rem', color: '#fff', cursor: 'pointer', opacity: busy || !draft.trim() ? .6 : 1 }}>{busy ? 'Submitting…' : 'Submit for review'}</button>
                      <button onClick={() => { setOpenId(null); setDraft(''); setErr('') }} style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 8, padding: '.5rem .9rem', fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--dim)', cursor: 'pointer' }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => { setOpenId(rep.id); setDraft(''); setErr('') }} disabled={!rep.id} style={{ background: 'transparent', border: '1px solid var(--line2)', borderRadius: 7, padding: '.4rem .9rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.7rem', color: 'var(--white)', cursor: rep.id ? 'pointer' : 'default', opacity: rep.id ? 1 : .5 }}>Respond →</button>
                )}
              </div>
            )
          })}
          <p style={{ fontFamily: 'var(--mono)', fontSize: '.53rem', color: 'var(--muted)', lineHeight: 1.7, margin: '.3rem 0 0' }}>
            Replies are the employer&apos;s statement, shown next to the report on your public company page after review — clearly labeled as your response, never verified fact. They never change your ghost rate, response rate, or score.
          </p>
        </div>
      )}
    </section>
  )
}
