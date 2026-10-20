'use client'
// Admin → Community → "Reports awaiting review": every HELD report (needs_review) in one queue.
// Sorted "needs your eyes" first — anything that is not a clear positive outcome, plus anti-gaming
// holds — so the owner reads those one by one; positives can be approved in bulk. The rules for what
// each decision writes live server-side in lib/server/reportReview.js (approve never raises a trust
// weight; an employee review stays out of scores; reject keeps the row, hidden and unscored).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardHeader, Badge, relTime, outcomeColor } from './primitives'

type Held = {
  id: string; company_name: string; outcome: string; role?: string; platform?: string; source?: string
  created_at: string; report_text?: string; outcome_weight?: number; trust_reason?: string
  review: { kind: string; positive: boolean; group: 'needs_eyes' | 'positive' | 'employee_review'; sourceUrl: string | null; flags: string[] }
}
type Counts = { total: number; needs_eyes: number; positive: number; employee_review: number }

const GROUP_LABEL: Record<Held['review']['group'], string> = {
  needs_eyes: 'Needs your eyes — not a clear positive outcome',
  positive: 'Positive hiring outcomes',
  employee_review: 'Employee reviews — not hiring outcomes (never scored)',
}
const FLAG_LABEL: Record<string, string> = {
  no_source_link: 'no source link',
  not_a_hiring_outcome: 'employee review',
  anti_gaming_hold: 'anti-gaming hold',
  possible_duplicate: 'possible duplicate',
}
const SORT_LABEL: Record<string, string> = { needs_eyes: 'Needs your eyes first', newest: 'Newest', oldest: 'Oldest', company: 'Company', outcome: 'Outcome (negative first)' }

const btn = (bg: string, fg = '#fff'): React.CSSProperties => ({ fontFamily: 'var(--mono)', fontSize: '.55rem', padding: '.3rem .6rem', borderRadius: 5, border: 'none', background: bg, color: fg, cursor: 'pointer', whiteSpace: 'nowrap' })

export function ReviewQueuePanel({ token, onChanged }: { token: string; onChanged?: () => void }) {
  const [sort, setSort] = useState('needs_eyes')
  const [rows, setRows] = useState<Held[] | null>(null)
  const [counts, setCounts] = useState<Counts | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showEmployee, setShowEmployee] = useState(false)

  const call = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch('/api/admin-stats', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token }, body: JSON.stringify(body) })
    const d = await res.json().catch(() => ({}))
    if (!res.ok || d.ok === false) throw new Error(d.error || `HTTP ${res.status}`)
    return d
  }, [token])

  const load = useCallback(async () => {
    try {
      const d = await call({ action: 'list_held_reports', sort })
      setRows(d.reports); setCounts(d.counts); setTruncated(!!d.truncated); setSelected(new Set())
    } catch (e) { setMsg({ text: `Could not load the queue: ${(e as Error).message}`, ok: false }) }
  }, [call, sort])
  useEffect(() => { load() }, [load])

  const visible = useMemo(() => (rows || []).filter((r) => showEmployee || r.review.group !== 'employee_review'), [rows, showEmployee])
  const positiveIds = useMemo(() => (rows || []).filter((r) => r.review.group === 'positive' && !r.review.flags.includes('possible_duplicate')).map((r) => r.id), [rows])
  // "Approve all" = every pending report EXCEPT later copies of a duplicate: approving those would
  // publish (and, for hiring accounts, count) the same review twice. They stay for a manual call.
  const allIds = useMemo(() => (rows || []).filter((r) => !r.review.flags.includes('possible_duplicate')).map((r) => r.id), [rows])
  const allBreakdown = useMemo(() => {
    const keep = (rows || []).filter((r) => !r.review.flags.includes('possible_duplicate'))
    return {
      eyes: keep.filter((r) => r.review.group === 'needs_eyes').length,
      antiGaming: keep.filter((r) => r.review.flags.includes('anti_gaming_hold')).length,
      positive: keep.filter((r) => r.review.group === 'positive').length,
      employee: keep.filter((r) => r.review.group === 'employee_review').length,
      dupes: (rows || []).length - keep.length,
    }
  }, [rows])

  async function decide(ids: string[], decision: 'approve' | 'reject', confirmText?: string) {
    if (!ids.length) return
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(true); setMsg(null)
    try {
      let changed = 0, skipped = 0, recomputed = 0
      for (let i = 0; i < ids.length; i += 500) {
        const d = await call({ action: 'review_reports', decision, ids: ids.slice(i, i + 500) })
        changed += d.changed; skipped += d.skipped; recomputed += d.recomputed
      }
      setMsg({ text: `${decision === 'approve' ? 'Approved' : 'Rejected'} ${changed} report${changed === 1 ? '' : 's'}${skipped ? ` (${skipped} already decided)` : ''} · ${recomputed} company score${recomputed === 1 ? '' : 's'} recomputed.`, ok: true })
      await load(); onChanged?.()
    } catch (e) { setMsg({ text: `${decision} failed: ${(e as Error).message}`, ok: false }) }
    finally { setBusy(false) }
  }

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  let lastGroup = ''

  return (
    <Card style={{ marginTop: '.65rem' }}>
      <CardHeader title="Reports awaiting review" badge={counts?.needs_eyes ? <Badge n={counts.needs_eyes} /> : undefined}
        action={<select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort" style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', background: 'transparent', color: 'var(--sub)', border: '1px solid var(--line2)', borderRadius: 5, padding: '.2rem .35rem' }}>
          {Object.entries(SORT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>} />
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--sub)', lineHeight: 1.6, marginBottom: '.6rem' }}>
        Held reports are claims waiting for you. <b>Approve</b> publishes one at its original trust weight (never raised) and recomputes the company’s score; an employee review stays out of every score. <b>Reject</b> keeps the row and its history, hidden and unscored. Every decision is audit-logged.
      </div>
      {counts && (
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.6rem' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--white)' }}>{counts.total} held · <span style={{ color: 'var(--amber)' }}>{counts.needs_eyes} need your eyes</span> · {counts.positive} positive · {counts.employee_review} employee reviews{truncated ? ' · showing first 1000' : ''}</span>
          <span style={{ flex: 1 }} />
          <button disabled={busy || !positiveIds.length} style={btn('var(--green)')}
            onClick={() => decide(positiveIds, 'approve', `Approve all ${positiveIds.length} positive hiring report(s)? Possible duplicates and everything in "needs your eyes" are NOT included.`)}>
            ✓ Approve all positive ({positiveIds.length})
          </button>
          <button disabled={busy || !allIds.length} style={btn('var(--green)')}
            onClick={() => decide(allIds, 'approve', `Approve ALL ${allIds.length} held reports?\n\n• ${allBreakdown.eyes} not clearly positive ("needs your eyes")${allBreakdown.antiGaming ? `, incl. ${allBreakdown.antiGaming} anti-gaming hold(s)` : ''}\n• ${allBreakdown.positive} positive hiring outcomes\n• ${allBreakdown.employee} employee reviews (published, never scored)\n\n${allBreakdown.dupes} possible duplicate(s) are NOT included — reject or approve those yourself.\n\nApproved reports go public at their original trust weight and company scores are recomputed. Every decision is audit-logged.`)}>
            ✓ Approve all ({allIds.length})
          </button>
          <button disabled={busy || !selected.size} style={btn('var(--blue)')} onClick={() => decide([...selected], 'approve', `Approve ${selected.size} selected report(s)?`)}>✓ Approve selected ({selected.size})</button>
          <button disabled={busy || !selected.size} style={btn('var(--red)')} onClick={() => decide([...selected], 'reject', `Reject ${selected.size} selected report(s)? They are kept (hidden, unscored) and can be restored from the audit log.`)}>✗ Reject selected</button>
          <label style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--sub)', display: 'flex', gap: '.25rem', alignItems: 'center' }}>
            <input type="checkbox" checked={showEmployee} onChange={(e) => setShowEmployee(e.target.checked)} /> show employee reviews
          </label>
        </div>
      )}
      {msg && <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: msg.ok ? 'var(--green)' : 'var(--red)', marginBottom: '.5rem' }}>{msg.text}</div>}
      {rows === null ? <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)' }}>Loading held reports…</div>
        : !visible.length ? <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)' }}>Nothing awaiting review{rows.length ? ' (employee reviews hidden — tick “show employee reviews”)' : ''}.</div>
          : visible.map((r) => {
            const header = sort === 'needs_eyes' && r.review.group !== lastGroup ? (lastGroup = r.review.group, true) : false
            const oc = outcomeColor(r.outcome)
            return (
              <div key={r.id}>
                {header && <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', letterSpacing: '.1em', textTransform: 'uppercase', color: r.review.group === 'needs_eyes' ? 'var(--amber)' : 'var(--sub)', margin: '.8rem 0 .3rem' }}>{GROUP_LABEL[r.review.group]}</div>}
                <div style={{ display: 'flex', gap: '.55rem', alignItems: 'flex-start', padding: '.55rem 1rem', margin: '0 -1rem', borderBottom: '1px solid var(--line2)', borderLeft: `3px solid ${oc}` }}>
                  <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.company_name} report`} style={{ marginTop: 3 }} />
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', color: oc, background: oc + '18', border: `1px solid ${oc}30`, borderRadius: 4, padding: '.1rem .4rem', flexShrink: 0 }}>{r.review.group === 'employee_review' ? 'employee' : r.outcome}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '.64rem', color: 'var(--white)' }}>{r.company_name}{r.role ? ` · ${r.role}` : ''}</div>
                    {/* The stored text, verbatim — the reviewer judges what was actually imported. */}
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--sub)', marginTop: '.2rem', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.report_text || '(no text)'}</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '.53rem', color: 'var(--muted)', marginTop: '.2rem', display: 'flex', gap: '.45rem', flexWrap: 'wrap' }}>
                      <span>{relTime(r.created_at)}</span><span>{r.platform || r.source}</span><span>{r.trust_reason}</span><span>weight {r.outcome_weight ?? '—'}</span>
                      {r.review.sourceUrl && <a href={r.review.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue)' }}>source ↗</a>}
                      {r.review.flags.map((f) => <span key={f} style={{ color: f === 'possible_duplicate' || f === 'anti_gaming_hold' ? 'var(--red)' : 'var(--amber)' }}>● {FLAG_LABEL[f] || f}</span>)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '.3rem', flexShrink: 0 }}>
                    <button disabled={busy} title="Approve" onClick={() => decide([r.id], 'approve')} style={btn('var(--green)')}>✓</button>
                    <button disabled={busy} title="Reject (kept, hidden, unscored)" onClick={() => decide([r.id], 'reject')} style={btn('var(--red)')}>✗</button>
                  </div>
                </div>
              </div>
            )
          })}
    </Card>
  )
}
