'use client'

// Admin → Community → "Duplicate reports": the same account stored more than once (lib/server/reportDupes.js).
// Scan shows how many copies exist per company; one press marks every copy (kept, hidden, never scored,
// audit-logged with its prior values — reversible) and recomputes the touched companies' grades.

import { useState } from 'react'
import { Card, CardHeader } from './primitives'
import { drainAdminAction, num } from './drain'

const btn: React.CSSProperties = { background: 'none', border: '1px solid var(--line2)', borderRadius: 8, padding: '.4rem .9rem', fontFamily: 'var(--mono)', fontSize: '.6rem', cursor: 'pointer', whiteSpace: 'nowrap' }

export function ReportDupesCard({ token, onChanged }: { token: string; onChanged?: () => void }) {
  const [busy, setBusy] = useState<'' | 'scan' | 'mark'>('')
  const [found, setFound] = useState<{ suspected: number; total: number; byCompany: Record<string, number> } | null>(null)
  const [msg, setMsg] = useState('')

  async function scan() {
    setBusy('scan'); setMsg(''); setFound(null)
    try {
      const r = await fetch('/api/admin-stats', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token }, body: JSON.stringify({ action: 'scan_report_dupes' }) })
      const d = await r.json().catch(() => ({}))
      if (!d.ok) throw new Error(d.error || `Scan failed (HTTP ${r.status})`)
      setFound({ suspected: d.suspected, total: d.total, byCompany: d.by_company || {} })
      setMsg(d.suspected === 0 ? `✓ No duplicate copies in ${Number(d.total).toLocaleString()} reports` : '')
    } catch (e) { setMsg(`✗ ${(e as Error).message}`) }
    setBusy('')
  }

  async function mark() {
    if (!found?.suspected) return
    if (!confirm(`Mark ${found.suspected} duplicate cop${found.suspected === 1 ? 'y' : 'ies'}? The original of each account stays and counts once; the extra copies are hidden and stop counting. Nothing is deleted, and every change is logged with its prior values.`)) return
    setBusy('mark'); setMsg('')
    let marked = 0, companies = 0
    const r = await drainAdminAction(token, 'dedupe_reports', {
      onRound: (d) => { marked += num(d.marked); companies = Math.max(companies, num(d.companies)); setMsg(`… marked ${marked}`); return num(d.marked) },
    })
    setMsg(!r.ok ? `✗ ${r.error || 'failed'}` : `${r.complete ? '✓' : '…'} Marked ${marked} duplicate cop${marked === 1 ? 'y' : 'ies'} · ${companies} compan${companies === 1 ? 'y' : 'ies'} rescored${r.complete ? '' : ' · not finished — press again'}${r.error ? ` · stopped: ${r.error.slice(0, 60)}` : ''}`)
    if (r.complete) setFound((f) => (f ? { ...f, suspected: 0, byCompany: {} } : f))
    if (marked) onChanged?.()
    setBusy('')
  }

  const rows = Object.entries(found?.byCompany || {}).sort((a, b) => b[1] - a[1])
  return (
    <Card style={{ marginBottom: '1.25rem' }}>
      <CardHeader title="Duplicate reports" action={<span style={{ fontFamily: 'var(--mono)', fontSize: '.48rem', color: 'var(--dim)' }}>Same company, outcome, source, role and text</span>} />
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: msg || rows.length ? '.6rem' : 0 }}>
        <button onClick={scan} disabled={!!busy} style={{ ...btn, borderColor: 'var(--blue)', color: 'var(--blue)' }}>{busy === 'scan' ? '⏳ Scanning…' : '⟳ Scan for duplicate reports'}</button>
        {!!found?.suspected && <button onClick={mark} disabled={!!busy} style={{ ...btn, borderColor: 'var(--red)', color: 'var(--red)' }}>{busy === 'mark' ? '⏳ Marking…' : `✕ Mark ${found.suspected} duplicate${found.suspected === 1 ? '' : 's'}`}</button>}
      </div>
      {rows.length > 0 && !!found?.suspected && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--amber)', lineHeight: 1.6 }}>
          {rows.map(([c, n]) => <div key={c}>{c}: {n} extra cop{n === 1 ? 'y' : 'ies'}</div>)}
        </div>
      )}
      {msg && <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: msg.startsWith('✗') ? 'var(--red)' : msg.startsWith('✓') ? 'var(--green)' : 'var(--amber)' }}>{msg}</div>}
    </Card>
  )
}
