'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardHeader, relTime } from './primitives'

// Admin moderation for employer replies to outcome reports (Wave 2, migration 060).
//
// Employers reply to reports about them on their dashboard; those replies land 'pending' and are
// INVISIBLE to seekers until approved here (owner decision 2026-08-03). A reply is display-only
// employer voice — approving it never changes any score. Auth: the same X-Admin-Token session the
// rest of the dashboard uses (verified in api/admin-stats.js).

type ReplyReport = { role: string | null; outcome: string | null; report_text: string | null; company_name: string | null }
type Reply = {
  id: number
  report_id: string
  company_key: string
  body: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
  reviewed_at: string | null
  reviewed_by: string | null
  report: ReplyReport | null
}

const statusColor = (s: string) => (s === 'approved' ? 'var(--green)' : s === 'rejected' ? 'var(--red)' : 'var(--amber)')

export function EmployerRepliesPanel({ token }: { token: string }) {
  const [replies, setReplies] = useState<Reply[]>([])
  const [counts, setCounts] = useState<{ pending: number; approved: number; rejected: number }>({ pending: 0, approved: 0, rejected: 0 })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'list_employer_replies' }),
      })
      const d = await res.json()
      setReplies(Array.isArray(d.replies) ? d.replies : [])
      if (d.counts) setCounts(d.counts)
    } catch { setErr('Could not load replies') } finally { setLoading(false) }
  }, [token])

  useEffect(() => { load() }, [load])

  async function decide(id: number, decision: 'approve' | 'reject') {
    setBusy(id); setErr('')
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'moderate_employer_reply', reply_id: id, decision }),
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || 'Failed')
      await load()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }

  return (
    <Card style={{ marginBottom: '1.25rem', border: '1px solid rgba(59,130,246,.22)' }}>
      <CardHeader
        title="Employer replies to reports"
        action={<span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: counts.pending > 0 ? 'var(--amber)' : 'var(--dim)' }}>{counts.pending} pending · {counts.approved} live</span>}
      />
      {err && <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--red)', marginBottom: '.6rem' }}>{err}</div>}

      {loading ? (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)' }}>Loading…</div>
      ) : replies.length === 0 ? (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', lineHeight: 1.6 }}>
          No employer replies yet. When an approved employer responds to a report on their dashboard, it lands here for review before going public.
        </div>
      ) : (
        <div>
          {replies.map(r => {
            const pending = r.status === 'pending'
            return (
              <div key={r.id} style={{ padding: '.7rem 0', borderTop: '1px solid var(--line2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap', marginBottom: '.4rem' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: statusColor(r.status), border: `1px solid ${statusColor(r.status)}`, borderRadius: 5, padding: '.12rem .4rem', flexShrink: 0 }}>{r.status}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--white)', textTransform: 'capitalize' }}>{r.report?.company_name || r.company_key}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '.54rem', color: 'var(--dim)' }}>
                    {r.report?.role ? `${r.report.role} · ` : ''}{r.report?.outcome || 'report'} · {relTime(r.created_at)}
                    {r.reviewed_by ? ` · ${r.status} by ${r.reviewed_by}` : ''}
                  </span>
                </div>

                {r.report?.report_text && (
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', color: 'var(--muted)', lineHeight: 1.55, marginBottom: '.4rem', paddingLeft: '.6rem', borderLeft: '2px solid var(--line2)' }}>
                    Report: “{r.report.report_text.slice(0, 240)}{r.report.report_text.length > 240 ? '…' : ''}”
                  </div>
                )}
                <div style={{ fontSize: '.72rem', color: 'var(--sub)', lineHeight: 1.6, marginBottom: pending ? '.5rem' : 0 }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--blue)', textTransform: 'uppercase', letterSpacing: '.08em', marginRight: '.4rem' }}>Reply</span>
                  {r.body}
                </div>

                {pending && (
                  <div style={{ display: 'flex', gap: '.4rem' }}>
                    <button onClick={() => decide(r.id, 'approve')} disabled={busy === r.id} style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', padding: '.32rem .7rem', borderRadius: 6, border: '1px solid rgba(16,185,129,.4)', background: 'rgba(16,185,129,.12)', color: 'var(--green)', cursor: 'pointer' }}>{busy === r.id ? '…' : 'Approve & publish'}</button>
                    <button onClick={() => decide(r.id, 'reject')} disabled={busy === r.id} style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', padding: '.32rem .7rem', borderRadius: 6, border: '1px solid rgba(239,68,68,.4)', background: 'rgba(239,68,68,.1)', color: 'var(--red)', cursor: 'pointer' }}>Reject</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
