'use client'

import { useState, useEffect, useCallback } from 'react'

interface RecentReport {
  id: string; company_name: string; outcome: string; role: string; city: string
  platform: string; created_at: string; report_text: string
  outcome_weight: number; trust_reason: string; needs_review: boolean
}
interface RecentApp {
  id: string; company_name: string; role: string; city: string
  status: string; stage: string; platform: string; created_at: string
}
interface AdminStats {
  monetization?: {
    stripe_connected: boolean
    total_accounts: number
    pro_users: number
    free_users: number
    conversion_pct: number
    trialing: number | null
    active_paid: number | null
    canceling: number | null
    past_due: number | null
    canceled: number | null
    mrr: number | null
    mrr_annualized: number | null
    outcome_card_shares: number
    shares_by_channel: Record<string, number>
  }
  users: { total: number; new_today: number; new_this_week: number; dau: number }
  companies: { with_scores: number }
  reports: {
    total: number; today: number; this_week: number
    chart: { date: string; count: number }[]
    top_companies: { company: string; count: number }[]
    outcome_breakdown: { ghosted: number; rejected: number; interview: number; offer: number; waiting: number }
    recent: RecentReport[]
  }
  applications: { total: number; ghosted_30d: number; hired_30d: number; ghost_rate_pct: number | null; recent: RecentApp[] }
  company_lookups?: { ready: boolean; today: number; top: { company: string; count: number }[] }
  jobs: { total?: number; active: number; new_today: number; added_today: number; stale_or_expired: number; inactive_reports: InactiveReport[] }
  job_health?: { active: number; total: number; stale: number; active_pct: number; crisis: boolean }
  errors: { today: number; this_week: number; by_route: Record<string, number>; recent: { endpoint: string; error_msg: string; created_at: string }[] }
  issues: { open: number; items: Issue[] }
  duplicate_clusters: { suspected: number; items: DupCluster[] }
  feature_flags: FeatureFlag[]
  credits: { total_users: number; pro_users: number; total_balance?: number; earned?: number; spent?: number }
  flywheel?: { job_searches_30d: number; resume_scans_30d: number }
}
interface Issue {
  id: string; type: string; target_name: string; notes: string; created_at: string; status: string
}
interface InactiveReport {
  job_id: string; report_count: number; latest_reported_at: string
  job: { id: string; company: string; title: string; city: string; url: string; apply_url: string; availability_status: string } | null
}
interface DupCluster {
  id: string; risk_score: number; status: string; signals: string[]; user_ids: string[]
}
interface RecentJob {
  id: string; company: string; title: string; city: string
  apply_url: string; created_at: string; availability_status: string; source: string
}
interface JobGroup { company: string; total: number; active: number }
interface DupCompany { id: string; name: string; report_count: number; overall_score: number }
interface DupGroup { key: string; companies: DupCompany[] }
interface MergePrefill { primary: string; secondary: string; nonce: number }
interface FeatureFlag {
  flag_name: string; status: string; percentage: number | null; description: string
}

function KpiCard({ l, n, sub, borderColor, numColor, onClick }: { l: string; n: string | number; sub?: string; borderColor?: string; numColor?: string; onClick?: () => void }) {
  return (
    <div
      className="adm-kpi"
      style={{ ...(borderColor ? { borderLeft: `3px solid ${borderColor}` } : {}), ...(onClick ? { cursor: 'pointer' } : {}) }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <div className="adm-kpi-l">{l}{onClick && <span style={{ float: 'right', opacity: .4, fontSize: '.6em' }}>▸</span>}</div>
      <div className="adm-kpi-n" style={numColor ? { color: numColor } : undefined}>{n}</div>
      {sub && <div className="adm-kpi-sub">{sub}</div>}
    </div>
  )
}

// Prominent red alert + one-click auto-remediation when the job board collapses.
// Calls the server-side emergency_job_refresh action, which in turn fires
// /api/refresh-jobs?all=1 (all batches + sources) to backfill listings now.
function JobCrisisBanner({
  health,
  token,
  onRefresh,
}: {
  health: NonNullable<AdminStats['job_health']>
  token: string
  onRefresh: () => void
}) {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const stalePct = Math.max(0, 100 - (health.active_pct || 0))

  async function runEmergencyRefresh() {
    setRunning(true)
    setResult(null)
    // Call refresh-jobs DIRECTLY (same-origin, its own 60s budget). Going through
    // /api/admin-stats used to time out: that function caps at 15s but the full
    // all-sources backfill takes ~40s, so the middle-man aborted → "fetch failed".
    // refresh-jobs validates this same admin-session token (X-Admin-Token) itself.
    const r = await runRefreshAndClear(token)
    if (r.ok) {
      setResult({ ok: true, msg: refreshResultMsg(r) })
      // Reload dashboard stats so the banner clears once the board recovers.
      setTimeout(onRefresh, 1500)
    } else {
      setResult({ ok: false, msg: (r.error || 'Refresh failed').slice(0, 120) })
    }
    setRunning(false)
  }

  return (
    <div
      role="alert"
      style={{
        background: 'linear-gradient(90deg, rgba(239,68,68,.16), rgba(239,68,68,.06))',
        border: '1px solid rgba(239,68,68,.5)',
        borderLeft: '4px solid var(--red)',
        borderRadius: 12,
        padding: '1rem 1.15rem',
        marginBottom: '1.25rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.95rem', color: 'var(--red)', letterSpacing: '-.01em', marginBottom: '.25rem' }}>
          ⚠️ JOB CRISIS — only {health.active.toLocaleString()} active listings
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--sub)', lineHeight: 1.5 }}>
          {health.stale.toLocaleString()} stale, {stalePct}% of corpus unavailable. Auto-refresh recommended.
        </div>
        {result && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', marginTop: '.4rem', color: result.ok ? 'var(--green)' : 'var(--red)' }}>
            {result.ok ? '✓ ' : '✗ '}{result.msg}
          </div>
        )}
      </div>
      <button
        onClick={runEmergencyRefresh}
        disabled={running}
        style={{
          background: 'var(--red)',
          border: 'none',
          borderRadius: 8,
          padding: '.6rem 1rem',
          color: '#fff',
          fontFamily: 'var(--mono)',
          fontSize: '.65rem',
          fontWeight: 700,
          cursor: running ? 'wait' : 'pointer',
          whiteSpace: 'nowrap',
          flexShrink: 0,
          opacity: running ? 0.7 : 1,
        }}
      >
        {running ? '⏳ Refreshing…' : 'Run emergency refresh →'}
      </button>
    </div>
  )
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="adm-panel" style={{ padding: '0 1rem 1rem', ...style }}>
      {children}
    </div>
  )
}

function CardHeader({ title, badge, action }: { title: string; badge?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="adm-panel-hdr" style={{ margin: '0 -1rem .85rem' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: '.5rem', overflow: 'hidden', flexShrink: 1, minWidth: 0 }}>
        {title}
        {badge}
      </span>
      {action && <div style={{ flexShrink: 0, display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>{action}</div>}
    </div>
  )
}

function Badge({ n, color = 'var(--red)' }: { n: number; color?: string }) {
  if (!n) return null
  return (
    <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', background: color + '22', color, border: `1px solid ${color}44`, borderRadius: 100, padding: '.1rem .4rem', flexShrink: 0 }}>{n}</span>
  )
}

function BarChart({ items, max, green }: { items: { label: string; value: number }[]; max: number; green?: boolean }) {
  return (
    <div>
      {items.map(item => (
        <div key={item.label} className="adm-row">
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--sub)', width: '40%', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
          <div className="adm-bar-wrap">
            <div className={green ? 'adm-bar green' : 'adm-bar'} style={{ width: `${max > 0 ? (item.value / max) * 100 : 0}%` }} />
          </div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', width: 28, textAlign: 'right', flexShrink: 0 }}>{item.value}</span>
        </div>
      ))}
    </div>
  )
}

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function outcomeColor(o: string) {
  if (o === 'ghosted') return 'var(--red)'
  if (o === 'rejected' || o === 'autoreject') return 'var(--amber)'
  if (o === 'interview' || o === 'human') return 'var(--blue)'
  if (o === 'offer' || o === 'hired') return 'var(--green)'
  return 'var(--dim)'
}

function stageColor(s: string) {
  if (s === 'Applied' || s === 'Screening') return 'var(--blue)'
  if (s === 'Interview') return 'var(--amber)'
  if (s === 'Offer' || s === 'Hired') return 'var(--green)'
  if (s === 'Rejected') return 'var(--red)'
  return 'var(--dim)'
}

const ISSUE_TYPE_LABEL: Record<string, string> = {
  wrong_data: 'Wrong data', duplicate: 'Duplicate', broken_listing: 'Broken listing', spam: 'Spam', other: 'Other',
}
function issueBadgeColor(type: string) {
  if (type === 'wrong_data') return 'var(--amber)'
  if (type === 'duplicate' || type === 'spam') return 'var(--red)'
  if (type === 'broken_listing') return 'var(--sub)'
  return 'var(--dim)'
}

// One user row in the KPI drill-down, with a two-step delete (full admins only).
function UserRow({ r, token, onDeleted, ts }: { r: Record<string, unknown>; token: string; onDeleted: (id: string) => void; ts: (i: unknown) => string }) {
  const [busy, setBusy] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [typed, setTyped] = useState('')
  const id = String(r.id ?? '')
  const email = String(r.email ?? '—')
  const canDelete = email !== '—' && typed.trim().toLowerCase() === email.trim().toLowerCase()
  // Grant-credits state
  const [grantAmt, setGrantAmt] = useState(5)
  const [granting, setGranting] = useState(false)
  const [grantMsg, setGrantMsg] = useState('')
  function closeModal() { if (!busy) { setShowModal(false); setTyped('') } }
  async function del() {
    if (!id || !canDelete) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'delete_user', user_id: id }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok && d.ok) { onDeleted(id); return }
      alert(d.error || 'Delete failed'); setBusy(false)
    } catch { alert('Network error'); setBusy(false) }
  }
  async function grant() {
    if (!id || granting) return
    const amt = Math.round(Number(grantAmt))
    if (!Number.isInteger(amt) || amt < 1 || amt > 500) { setGrantMsg('1–500'); return }
    setGranting(true); setGrantMsg('')
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'grant_credits', user_id: id, amount: amt }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok && d.ok) setGrantMsg(`✓ +${amt} (balance ${d.balance})`)
      else setGrantMsg(d.error || 'Failed')
    } catch { setGrantMsg('Network error') }
    setGranting(false)
  }
  return (
    <div className="ac-acct">
      <div className="ac-acct-top">
        <span className="ac-acct-email">{email}</span>
        <span className="ac-acct-age">{ts(r.created_at)}</span>
      </div>
      <div className="ac-acct-actions">
        {grantMsg && grantMsg.startsWith('✓') ? (
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--green)', whiteSpace: 'nowrap' }}>{grantMsg}</span>
        ) : (
          <>
            <input type="number" min={1} max={500} value={grantAmt} onChange={e => setGrantAmt(Number(e.target.value))} disabled={granting} style={{ width: 46, background: 'var(--void)', border: '1px solid var(--line2)', borderRadius: 5, color: 'var(--white)', fontFamily: 'var(--mono)', fontSize: '.55rem', padding: '.25rem .3rem', textAlign: 'center' }} />
            <button onClick={grant} disabled={granting} title="Grant AI credits to this account" style={{ background: 'none', border: '1px solid rgba(52,211,153,.4)', borderRadius: 5, color: 'var(--green)', fontFamily: 'var(--mono)', fontSize: '.55rem', padding: '.28rem .5rem', cursor: granting ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>{granting ? '…' : '＋ Credits'}</button>
            {grantMsg && <span style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--red)', whiteSpace: 'nowrap' }}>{grantMsg}</span>}
          </>
        )}
        <button onClick={() => setShowModal(true)} title="Permanently delete this user and all their data" style={{ marginLeft: 'auto', background: 'none', border: '1px solid rgba(239,68,68,.35)', borderRadius: 5, color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: '.55rem', padding: '.28rem .55rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>🗑 Delete</button>
      </div>
      {showModal && (
        <div onClick={closeModal} onKeyDown={e => { if (e.key === 'Escape') closeModal() }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 10, padding: '1.1rem 1.2rem', maxWidth: 380, width: '100%' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.72rem', color: 'var(--red)', fontWeight: 700, marginBottom: '.5rem' }}>Delete account</div>
            <p style={{ fontSize: '.68rem', color: 'var(--sub)', lineHeight: 1.5, margin: '0 0 .8rem' }}>
              This permanently deletes the account, applications, saved jobs, and credits. Reports and survey intel they contributed are kept and anonymized.
            </p>
            <p style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)', margin: '0 0 .3rem' }}>Type <span style={{ color: 'var(--white)' }}>{email}</span> to confirm:</p>
            <input autoFocus value={typed} onChange={e => setTyped(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') closeModal() }} disabled={busy} placeholder={email} style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--line2)', borderRadius: 6, color: 'var(--white)', fontFamily: 'var(--mono)', fontSize: '.65rem', padding: '.4rem .5rem', marginBottom: '.9rem', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
              <button onClick={closeModal} disabled={busy} style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 6, color: 'var(--dim)', fontFamily: 'var(--mono)', fontSize: '.62rem', padding: '.35rem .7rem', cursor: 'pointer' }}>Cancel</button>
              <button onClick={del} disabled={busy || !canDelete} style={{ background: canDelete ? 'var(--red)' : 'var(--line2)', border: 'none', borderRadius: 6, color: '#fff', fontFamily: 'var(--mono)', fontSize: '.62rem', padding: '.35rem .8rem', cursor: busy ? 'wait' : canDelete ? 'pointer' : 'not-allowed', opacity: canDelete ? 1 : .6 }}>{busy ? '…' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function KpiDetailRows({ metric, rows, token, onDeleteRow }: { metric: string; rows: Record<string, unknown>[]; token: string; onDeleteRow: (id: string) => void }) {
  const cell = (txt: unknown, color?: string) => (
    <span style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: color || 'var(--sub)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(txt ?? '—')}</span>
  )
  const ts = (iso: unknown) => {
    if (!iso) return '—'
    const d = new Date(String(iso)), now = Date.now(), diff = now - d.getTime(), m = Math.floor(diff / 60000)
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
  }

  // Users group — with per-row delete (full admins only; server enforces role)
  if (['total_accounts','new_today','new_this_week'].includes(metric)) {
    return <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
      {rows.map((r, i) => (
        <UserRow key={String(r.id ?? i)} r={r} token={token} onDeleted={onDeleteRow} ts={ts} />
      ))}
    </div>
  }

  // Companies scored
  if (metric === 'companies_scored') {
    return <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '.5rem', padding: '.5rem .6rem', background: 'var(--card)', borderRadius: 7, alignItems: 'center' }}>
          {cell(r.company, 'var(--white)')}
          {cell(`${Math.round(Number(r.score || 0))}`, Number(r.score) > 65 ? 'var(--green)' : Number(r.score) > 40 ? 'var(--amber)' : 'var(--red)')}
          {cell(ts(r.created_at))}
        </div>
      ))}
    </div>
  }

  // Reports group
  if (['total_reports','reports_today','reports_week','ghost_rate'].includes(metric)) {
    const outColor = (o: unknown) => {
      const s = String(o)
      if (s === 'ghosted') return 'var(--red)'
      if (s === 'rejected' || s === 'autoreject') return 'var(--amber)'
      if (s === 'interview' || s === 'human') return 'var(--blue)'
      if (s === 'offer' || s === 'hired') return 'var(--green)'
      return 'var(--dim)'
    }
    return <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '.5rem', padding: '.5rem .6rem', background: 'var(--card)', borderRadius: 7, alignItems: 'center' }}>
          {cell(r.company_name || r.company, 'var(--white)')}
          {cell(r.outcome, outColor(r.outcome))}
          {cell(ts(r.created_at || r.updated_at))}
        </div>
      ))}
    </div>
  }

  // Apps group
  if (['apps_total','ghosted_30d','hired_30d'].includes(metric)) {
    const statusColor = (s: unknown) => {
      const v = String(s)
      if (v === 'ghosted') return 'var(--red)'
      if (v === 'hired') return 'var(--green)'
      if (v === 'rejected') return 'var(--amber)'
      return 'var(--sub)'
    }
    return <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
      {rows.map((r, i) => (
        <div key={i} style={{ padding: '.5rem .6rem', background: 'var(--card)', borderRadius: 7 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '.5rem', marginBottom: '.2rem' }}>
            {cell(r.company_name, 'var(--white)')}
            {cell(r.status, statusColor(r.status))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '.5rem' }}>
            {cell(r.role || '—')}
            {cell(ts(r.created_at || r.updated_at))}
          </div>
        </div>
      ))}
    </div>
  }

  // Co. lookups
  if (metric === 'co_lookups') {
    return <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '.5rem', padding: '.5rem .6rem', background: 'var(--card)', borderRadius: 7, alignItems: 'center' }}>
          {cell(r.query, 'var(--white)')}
          {cell(ts(r.created_at))}
        </div>
      ))}
    </div>
  }

  // Jobs group (total/active/today/stale)
  return <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
    {rows.map((r, i) => (
      <div key={i} style={{ padding: '.5rem .6rem', background: 'var(--card)', borderRadius: 7 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '.5rem', marginBottom: '.2rem' }}>
          {cell(r.company, 'var(--white)')}
          {cell(r.availability_status || 'active', r.availability_status === 'stale' ? 'var(--amber)' : r.availability_status === 'expired' ? 'var(--red)' : 'var(--green)')}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '.5rem' }}>
          {cell(r.title)}
          {cell(ts(r.created_at || r.last_seen_at))}
        </div>
      </div>
    ))}
  </div>
}

function KpiModal({ metric, title, token, onClose }: { metric: string; title: string; token: string; onClose: () => void }) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)

  useEffect(() => {
    fetch('/api/admin-stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
      body: JSON.stringify({ action: 'get_kpi_detail', metric }),
    }).then(r => r.json()).then(d => setRows(d.rows || [])).catch(() => setRows([]))
  }, [metric, token])

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', zIndex: 300, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--surface)', borderRadius: '14px 14px 0 0', width: '100%', maxWidth: 640, maxHeight: '82vh', display: 'flex', flexDirection: 'column', animation: 'fadeUp .22s ease both' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem .75rem', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: '.95rem', color: 'var(--white)' }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '.9rem', padding: '.2rem .4rem', lineHeight: 1 }}>✕</button>
        </div>
        {/* Body */}
        <div style={{ overflow: 'auto', flex: 1, padding: '.75rem 1.25rem 2rem' }}>
          {rows === null ? (
            <div style={{ textAlign: 'center', padding: '2.5rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--dim)' }}>Loading…</div>
          ) : !rows.length ? (
            <div style={{ textAlign: 'center', padding: '2.5rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--dim)' }}>No data yet</div>
          ) : (
            <KpiDetailRows metric={metric} rows={rows} token={token} onDeleteRow={(id) => setRows(rs => (rs || []).filter(r => String(r.id) !== id))} />
          )}
        </div>
      </div>
    </div>
  )
}

const TOKEN_KEY = 'admin_token'

// ── Command-center presentational primitives (.ac-*) ──────────────────────────
type Tone = 'blue' | 'green' | 'amber' | 'red' | 'white' | 'dim' | 'sub'

function Panel({ title, right, hero, children, style }: { title: string; right?: React.ReactNode; hero?: boolean; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <section className={`ac-panel${hero ? ' hero' : ''}`} style={style}>
      <div className="ac-panel-hdr">
        <span className="ac-panel-title">{title}</span>
        {right}
      </div>
      {children}
    </section>
  )
}

// A compact command-center tile: big number + a status PHRASE (never a bare number).
function PulseTile({ label, value, phrase, tone = 'white' }: { label: string; value: React.ReactNode; phrase: string; tone?: Tone }) {
  return (
    <div className="ac-tile">
      <div className="ac-tile-l">{label}</div>
      <div className={`ac-tile-n ac-tone-${tone}`}>{value}</div>
      <div className="ac-tile-p" title={phrase}>{phrase}</div>
    </div>
  )
}

// label · optional status text · value, optionally clickable (opens a KPI drill-down).
function MetricRow({ label, value, status, tone = 'white', onClick }: { label: string; value: React.ReactNode; status?: string; tone?: Tone; onClick?: () => void }) {
  return (
    <div className={`ac-mrow${onClick ? ' ac-mrow-click' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined}>
      <span className="ac-mrow-l">{label}</span>
      <span className="ac-mrow-mid">{status}</span>
      <span className={`ac-mrow-n ac-tone-${tone}`}>{value}</span>
      {onClick && <span className="ac-mrow-arrow">▸</span>}
    </div>
  )
}

const SEV_COLOR: Record<string, string> = { red: 'var(--red)', amber: 'var(--amber)', blue: 'var(--blue)', green: 'var(--green)' }

// One actionable warning row for the Needs Attention panel.
function AttnRow({ item }: { item: AttnItem }) {
  return (
    <div className="ac-attn">
      <span className="ac-attn-dot" style={{ background: SEV_COLOR[item.sev] }} />
      <div className="ac-attn-body">
        <div className="ac-attn-t">{item.title}</div>
        <div className="ac-attn-d">{item.detail}</div>
      </div>
      {item.action && <button className="ac-attn-act" onClick={item.action.onClick} disabled={item.action.busy}>{item.action.busy ? '…' : item.action.label}</button>}
    </div>
  )
}

interface AttnItem {
  key: string
  title: string
  detail: string
  sev: 'red' | 'amber' | 'blue' | 'green'
  action?: { label: string; onClick: () => void; busy?: boolean }
}

// Manage accounts — reuses the get_kpi_detail(total_accounts) fetch (same data that powers
// the users drill-down) + the existing UserRow (grant-credits input + type-to-confirm delete).
// Adds an email search filter. Own scroll area, iPhone safe-area aware, mobile mini-cards.
function ManageAccountsModal({ token, onClose }: { token: string; onClose: () => void }) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    fetch('/api/admin-stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
      body: JSON.stringify({ action: 'get_kpi_detail', metric: 'total_accounts' }),
    }).then(r => r.json()).then(d => setRows(d.rows || [])).catch(() => setRows([]))
  }, [token])

  const ts = (iso: unknown) => {
    if (!iso) return '—'
    const d = new Date(String(iso)), m = Math.floor((Date.now() - d.getTime()) / 60000)
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
  }

  const needle = q.trim().toLowerCase()
  const filtered = (rows || []).filter(r => !needle || String(r.email ?? '').toLowerCase().includes(needle))

  return (
    <div className="ac-modal" onClick={onClose}>
      <div className="ac-modal-card" onClick={e => e.stopPropagation()}>
        <div className="ac-modal-hdr">
          <div>
            <div className="ac-modal-ttl">Manage accounts</div>
            <div className="ac-modal-sub">{rows === null ? 'Loading…' : `${rows.length} account${rows.length === 1 ? '' : 's'}${needle ? ` · ${filtered.length} match` : ''} · newest 100`}</div>
          </div>
          <button className="ac-modal-x" onClick={onClose}>✕</button>
        </div>
        <div className="ac-modal-search">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter by email…" autoComplete="off" />
        </div>
        <div className="ac-modal-body">
          {rows === null ? (
            <div style={{ textAlign: 'center', padding: '2rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--dim)' }}>Loading accounts…</div>
          ) : !filtered.length ? (
            <div style={{ textAlign: 'center', padding: '2rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--dim)' }}>{needle ? 'No accounts match that email.' : 'No accounts yet.'}</div>
          ) : (
            filtered.map((r, i) => (
              <UserRow key={String(r.id ?? i)} r={r} token={token} ts={ts} onDeleted={id => setRows(rs => (rs || []).filter(x => String(x.id) !== id))} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// Shared job-board remediation: (1) backfill fresh ACTIVE listings via refresh-jobs?all=1
// (it validates this admin session token itself), then (2) clear the unconfirmed-stale rows
// the sources couldn't re-confirm so the admin "Stale/expired" count actually drops. Both
// halves are needed for the button's outcome to observably match the number beside it.
async function runRefreshAndClear(token: string): Promise<{ ok: boolean; added: number | null; cleared: number | null; error?: string }> {
  try {
    const res = await fetch('/api/refresh-jobs?all=1', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token }, body: '{}' })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, added: null, cleared: null, error: d.error || `HTTP ${res.status}` }
    const added = d.upserted ?? d.inserted ?? d.found ?? null
    let cleared: number | null = null
    try {
      const pres = await fetch('/api/admin-stats', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token }, body: JSON.stringify({ action: 'purge_stale_jobs' }) })
      const pd = await pres.json().catch(() => ({}))
      if (pres.ok && pd.ok) cleared = pd.removed ?? 0
    } catch { /* purge is best-effort; the backfill already succeeded */ }
    return { ok: true, added, cleared }
  } catch (e) {
    return { ok: false, added: null, cleared: null, error: (e as Error).message }
  }
}

function refreshResultMsg(r: { added: number | null; cleared: number | null }): string {
  const parts: string[] = []
  if (r.added != null) parts.push(`+${r.added} fresh`)
  if (r.cleared != null) parts.push(`cleared ${r.cleared} stale`)
  return parts.length ? parts.join(' · ') : 'refresh triggered'
}

// Real, wired stale-job remediation for the Jobs & Companies panel — same flow the crisis
// banner uses (refresh-jobs validates the admin session token itself).
function JobRefreshButton({ token, onDone }: { token: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  async function run() {
    setBusy(true); setMsg('')
    const r = await runRefreshAndClear(token)
    if (r.ok) {
      setMsg('✓ ' + refreshResultMsg(r))
      setTimeout(onDone, 1500)
    } else {
      setMsg('✗ ' + (r.error || 'failed').slice(0, 40))
    }
    setBusy(false)
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem' }}>
      {msg && <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: msg.startsWith('✓') ? 'var(--green)' : 'var(--red)' }}>{msg}</span>}
      <button className="ac-attn-act" onClick={run} disabled={busy}>{busy ? '…' : 'Refresh now'}</button>
    </span>
  )
}

export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loggingIn, setLoggingIn] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [mergePrefill, setMergePrefill] = useState<MergePrefill | null>(null)
  const [kpiModal, setKpiModal] = useState<{ metric: string; title: string } | null>(null)
  const [manageOpen, setManageOpen] = useState(false)
  const [emgBusy, setEmgBusy] = useState(false)
  const [emgMsg, setEmgMsg] = useState<{ ok: boolean; text: string } | null>(null)
  function openKpi(metric: string, title: string) { setKpiModal({ metric, title }) }

  useEffect(() => {
    const stored = sessionStorage.getItem(TOKEN_KEY)
    if (stored) {
      setToken(stored)
    } else {
      setLoading(false)
    }
  }, [])

  const load = useCallback(async (t: string) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin-stats', {
        headers: { 'X-Admin-Token': t },
      })
      if (res.status === 401 || res.status === 403) {
        const msg = res.status === 403 ? 'Access denied' : 'Session expired'
        sessionStorage.removeItem(TOKEN_KEY)
        setToken(null)
        setLoading(false)
        setLoginError(msg)
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as AdminStats
      setStats(data)
    } catch (e) {
      setError((e as Error).message)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (token) load(token)
  }, [token, load])

  async function login(e: React.FormEvent) {
    e.preventDefault()
    setLoggingIn(true)
    setLoginError('')
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'admin_login', username, password }),
      })
      const json = await res.json()
      if (!res.ok) { setLoginError(json.error || 'Login failed'); setLoggingIn(false); return }
      sessionStorage.setItem(TOKEN_KEY, json.token)
      setToken(json.token)
    } catch {
      setLoginError('Network error')
    }
    setLoggingIn(false)
  }

  async function logout() {
    const t = token
    sessionStorage.removeItem(TOKEN_KEY)
    setToken(null)
    setStats(null)
    if (t) {
      try {
        await fetch('/api/admin-stats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Admin-Token': t },
          body: JSON.stringify({ action: 'admin_logout' }),
        })
      } catch { /* ignore */ }
    }
  }

  async function downloadCsv() {
    if (!token) return
    setDownloading(true)
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'export_csv' }),
      })
      const d = await res.json()
      if (d?.csv) {
        const blob = new Blob([d.csv], { type: 'text/csv;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = d.filename || 'seen-metrics.csv'; a.click()
        URL.revokeObjectURL(url)
      }
    } catch { /* ignore */ }
    setDownloading(false)
  }

  // Shared job-board remediation used by the Needs Attention rows. Backfills fresh listings
  // AND clears unconfirmed-stale rows, then surfaces a clear result (never a silent no-op)
  // and reloads so the stale count visibly drops.
  async function runEmergencyRefresh() {
    if (!token) return
    setEmgBusy(true); setEmgMsg(null)
    const r = await runRefreshAndClear(token)
    if (r.ok) {
      setEmgMsg({ ok: true, text: refreshResultMsg(r) })
      setTimeout(() => load(token), 1500)
    } else {
      setEmgMsg({ ok: false, text: (r.error || 'refresh failed').slice(0, 120) })
    }
    setEmgBusy(false)
  }

  if (!token) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <form onSubmit={login} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '2rem', width: 320 }}
        onKeyDown={e => e.key === 'Enter' && !loggingIn && login(e as unknown as React.FormEvent)}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.22em', color: 'var(--green)', marginBottom: '.5rem' }}>Admin</div>
        <div style={{ fontFamily: 'var(--display)', fontSize: '1.4rem', fontWeight: 800, color: 'var(--white)', marginBottom: '1.5rem' }}>Sign in</div>
        <input
          type="text" placeholder="Username" autoComplete="username" required value={username}
          onChange={e => setUsername(e.target.value)}
          style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 7, padding: '.6rem .85rem', color: 'var(--white)', fontFamily: 'var(--mono)', fontSize: '.72rem', outline: 'none', marginBottom: '.65rem', boxSizing: 'border-box' }}
        />
        <input
          type="password" placeholder="Password" autoComplete="current-password" required value={password}
          onChange={e => setPassword(e.target.value)}
          style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 7, padding: '.6rem .85rem', color: 'var(--white)', fontFamily: 'var(--mono)', fontSize: '.72rem', outline: 'none', marginBottom: '1rem', boxSizing: 'border-box' }}
        />
        {loginError && <div style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--red)', marginBottom: '.75rem' }}>{loginError}</div>}
        <button type="submit" disabled={loggingIn} style={{ width: '100%', background: 'var(--blue)', border: 'none', borderRadius: 7, padding: '.65rem', color: '#fff', fontFamily: 'var(--mono)', fontSize: '.72rem', fontWeight: 600, cursor: 'pointer' }}>
          {loggingIn ? 'Signing in…' : 'Sign in →'}
        </button>
      </form>
    </div>
  )

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: '.72rem', color: 'var(--muted)' }}>
      Loading data flywheel...
    </div>
  )

  if (error) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.72rem', color: 'var(--red)', marginBottom: '1rem' }}>{error}</div>
        <button onClick={() => token && load(token)} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 6, padding: '.45rem .9rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--sub)', cursor: 'pointer' }}>Retry</button>
      </div>
    </div>
  )

  if (!stats) return null

  const topReportedMax = Math.max(...(stats.reports.top_companies || []).map(c => c.count), 1)
  const topLookupMax = Math.max(...(stats.company_lookups?.top || []).map(c => c.count), 1)
  const chartMax = Math.max(...(stats.reports.chart || []).map(d => d.count), 1)
  const needsReviewCount = (stats.reports.recent || []).filter(r => r.needs_review).length

  // ── Derive the command center from REAL response fields ONLY ────────────────
  const m = stats.monetization
  const jh = stats.job_health
  const jb = stats.jobs
  const fw = stats.flywheel
  const inactiveCount = (jb?.inactive_reports || []).length
  const staleJobs = jb?.stale_or_expired ?? 0
  const activeJobs = jh?.active ?? jb?.active ?? 0
  const paidUsers = m?.active_paid ?? m?.pro_users ?? 0
  const mrr = m?.mrr ?? null
  const shares = m?.outcome_card_shares ?? 0
  const errToday = stats.errors?.today ?? 0
  const dupSuspected = stats.duplicate_clusters?.suspected ?? 0
  const openIssues = stats.issues?.open ?? 0
  const stripeOn = !!m?.stripe_connected
  const onUnauthorized = () => { sessionStorage.removeItem(TOKEN_KEY); setToken(null); setStats(null); setLoginError('Session expired') }

  // Data-flywheel status phrase from real activity (product-critical panel).
  const fwActivity = shares + (fw?.job_searches_30d ?? 0) + (fw?.resume_scans_30d ?? 0) + stats.reports.today
  const fwStatus = shares === 0 && (fw?.job_searches_30d ?? 0) === 0 ? 'Not moving yet' : fwActivity < 25 ? 'Early activity' : 'Community data growing'

  // Needs Attention — actionable warnings from real data. A benign zero (0 canceled,
  // 0 errors) never appears; only zeros that ARE the problem do (per product spec).
  const attn: AttnItem[] = []
  if (jh?.crisis) attn.push({ key: 'crisis', sev: 'red', title: `Job board crisis — ${activeJobs.toLocaleString()} active listings`, detail: `${(jh.stale ?? 0).toLocaleString()} stale · only ${jh.active_pct}% of the corpus is live. Seekers see a dead board.`, action: { label: 'Refresh', onClick: runEmergencyRefresh, busy: emgBusy } })
  else if (staleJobs > 500) attn.push({ key: 'stale', sev: 'amber', title: `${staleJobs.toLocaleString()} stale / expired listings`, detail: 'A large slice of the job corpus is unavailable. Refresh to keep the board fresh.', action: { label: 'Refresh', onClick: runEmergencyRefresh, busy: emgBusy } })
  if (errToday > 10) attn.push({ key: 'errs', sev: 'red', title: `${errToday} API errors today`, detail: 'Error volume is elevated — see System Health for the failing routes.' })
  if (stripeOn && paidUsers === 0) attn.push({ key: 'norev', sev: 'amber', title: '0 paid users — revenue not activated yet', detail: 'Stripe is connected but there are no active paid subscriptions. Conversion has not started.' })
  if ((m?.past_due ?? 0) > 0) attn.push({ key: 'pastdue', sev: 'amber', title: `${m!.past_due} subscription${m!.past_due === 1 ? '' : 's'} past due`, detail: 'Payment is failing — these accounts may churn without follow-up.' })
  if ((m?.trialing ?? 0) > 0) attn.push({ key: 'trials', sev: 'blue', title: `${m!.trialing} user${m!.trialing === 1 ? '' : 's'} trialing — watch conversion`, detail: 'Active trials in flight (cancelled trials excluded). Nudge them before the trial ends.' })
  if ((m?.canceling ?? 0) > 0) attn.push({ key: 'canceling', sev: 'amber', title: `${m!.canceling} subscription${m!.canceling === 1 ? '' : 's'} set to cancel`, detail: 'Cancelled but still live until period end — these will churn. Win them back before then.' })
  if (shares === 0) attn.push({ key: 'noshare', sev: 'blue', title: 'No outcome cards shared — flywheel not moving', detail: 'Outcome cards are the virality engine. Nothing has been shared yet.' })
  if (needsReviewCount > 0) attn.push({ key: 'review', sev: 'amber', title: `${needsReviewCount} report${needsReviewCount === 1 ? '' : 's'} need review`, detail: 'Flagged community reports are held out of scoring until cleared (Advanced tools → moderation).' })
  if (dupSuspected > 0) attn.push({ key: 'dup', sev: 'amber', title: `${dupSuspected} suspected duplicate account cluster${dupSuspected === 1 ? '' : 's'}`, detail: 'Shared-signal groups flagged for anti-Sybil review (Advanced tools → clusters).' })
  if (inactiveCount > 0) attn.push({ key: 'inactive', sev: 'amber', title: `${inactiveCount} reported inactive listing${inactiveCount === 1 ? '' : 's'}`, detail: 'Users flagged these jobs as no longer active — verify and remove (Advanced tools).' })
  if (openIssues > 0) attn.push({ key: 'issues', sev: 'amber', title: `${openIssues} open data-quality issue${openIssues === 1 ? '' : 's'}`, detail: 'Community-reported data problems awaiting resolution (Advanced tools → issues).' })

  return (
    <div className="page-full" style={{ background: 'radial-gradient(ellipse at 10% 0%,rgba(29,78,216,0.1) 0%,transparent 50%),radial-gradient(ellipse at 90% 10%,rgba(124,58,237,0.07) 0%,transparent 45%)' }}>
      <div className="adm-wrap">

        {/* 1. Header */}
        <header className="ac-hdr">
          <div className="ac-hdr-l">
            <div className="ac-eyebrow">Founder command center</div>
            <h1 className="ac-title">Seen Control</h1>
            <div className="ac-meta">updated just now · build {process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local'} · {process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_MESSAGE?.slice(0, 32) ?? 'dev'}</div>
          </div>
          <div className="ac-hdr-actions">
            <button onClick={() => token && load(token)} className="adm-btn">↻ Refresh</button>
            <button onClick={downloadCsv} disabled={downloading} className="adm-btn" style={{ borderColor: 'rgba(16,185,129,.4)', color: 'var(--green)' }}>{downloading ? 'Exporting…' : '⬇ CSV'}</button>
            <button onClick={logout} className="adm-btn-danger">Sign out</button>
          </div>
        </header>

        {/* Crisis banner stays prominent (one-click remediation) */}
        {jh?.crisis && <JobCrisisBanner health={jh} token={token!} onRefresh={() => load(token!)} />}

        {/* 2. Seen Pulse — command center */}
        <Panel title="Seen Pulse" hero right={<span className="ac-panel-status">what matters today</span>}>
          <div className="ac-pulse">
            <PulseTile label="Accounts" value={stats.users.total.toLocaleString()} phrase={stats.users.new_today > 0 ? `${stats.users.new_today} new today` : 'no new today'} tone="white" />
            <PulseTile label="Paid users" value={paidUsers.toLocaleString()} phrase={paidUsers > 0 ? 'converting' : 'none yet'} tone={paidUsers > 0 ? 'green' : 'dim'} />
            <PulseTile label="MRR" value={mrr != null ? `$${mrr.toLocaleString()}` : '$0'} phrase={mrr ? 'revenue moving' : stripeOn ? 'not activated yet' : 'Stripe off'} tone={mrr ? 'green' : 'dim'} />
            <PulseTile label="Trials" value={stripeOn ? (m?.trialing ?? 0) : '—'} phrase={stripeOn ? `${m?.trialing ?? 0} trialing now` : 'Stripe not connected'} tone={(m?.trialing ?? 0) > 0 ? 'blue' : 'dim'} />
            <PulseTile label="Cards shared" value={shares.toLocaleString()} phrase={shares > 0 ? 'flywheel moving' : 'none shared yet'} tone={shares > 0 ? 'blue' : 'dim'} />
            <PulseTile label="API" value={errToday} phrase={errToday === 0 ? 'No API incidents' : `${errToday} errors today`} tone={errToday > 10 ? 'red' : errToday > 0 ? 'amber' : 'green'} />
          </div>
        </Panel>

        {/* 3. Needs Attention */}
        <Panel title="Needs Attention" right={attn.length ? <span className="ac-badge" style={{ background: 'rgba(245,158,11,.15)', color: 'var(--amber)' }}>{attn.length}</span> : undefined}>
          {emgMsg && (
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', marginBottom: '.5rem', color: emgMsg.ok ? 'var(--green)' : 'var(--red)' }}>
              {emgMsg.ok ? '✓ ' : '✗ '}{emgMsg.text}
            </div>
          )}
          {attn.length === 0
            ? <div className="ac-allclear">✓ All clear — nothing needs action right now.</div>
            : attn.map(a => <AttnRow key={a.key} item={a} />)}
        </Panel>

        {/* 4 & 5. Revenue + Users */}
        <div className="ac-grid2">
          <Panel title="Revenue" right={<span className="ac-panel-status" style={{ color: mrr ? 'var(--green)' : 'var(--dim)' }}>{mrr ? 'Revenue is moving' : 'Not active yet'}</span>}>
            <MetricRow label="MRR" value={mrr != null ? `$${mrr.toLocaleString()}` : '$0'} status={m?.mrr_annualized != null ? `$${m.mrr_annualized.toLocaleString()}/yr` : (stripeOn ? 'no active subs' : 'Stripe not connected')} tone={mrr ? 'green' : 'dim'} />
            <MetricRow label="Paid users" value={paidUsers.toLocaleString()} status={m ? `${m.conversion_pct}% of ${m.total_accounts.toLocaleString()}` : ''} tone={paidUsers ? 'green' : 'dim'} />
            <MetricRow label="On trial" value={stripeOn ? (m?.trialing ?? 0) : '—'} status="trialing now" tone={(m?.trialing ?? 0) > 0 ? 'blue' : 'dim'} />
            <MetricRow label="Canceling" value={stripeOn ? (m?.canceling ?? 0) : '—'} status="cancels at period end" tone={(m?.canceling ?? 0) > 0 ? 'amber' : 'dim'} />
            <MetricRow label="Past due" value={stripeOn ? (m?.past_due ?? 0) : '—'} status="payment failing" tone={(m?.past_due ?? 0) > 0 ? 'amber' : 'dim'} />
            <MetricRow label="Canceled" value={stripeOn ? (m?.canceled ?? 0) : '—'} status="churned" tone={(m?.canceled ?? 0) > 0 ? 'red' : 'dim'} />
            <MetricRow label="Conversion" value={m ? `${m.conversion_pct}%` : '—'} status="free → paid" tone="sub" />
            {!stripeOn && <div className="ac-panel-foot">Stripe not connected — trial / paid / MRR breakdown unavailable.</div>}
          </Panel>

          <Panel title="Users" right={<span className="ac-panel-status">{stats.users.dau} active today</span>}>
            <MetricRow label="Total accounts" value={stats.users.total.toLocaleString()} status="all time" onClick={() => openKpi('total_accounts', 'All accounts')} />
            <MetricRow label="New today" value={stats.users.new_today} status="last 24h" tone={stats.users.new_today > 0 ? 'blue' : 'dim'} onClick={() => openKpi('new_today', 'New accounts today')} />
            <MetricRow label="New this week" value={stats.users.new_this_week} status="last 7 days" onClick={() => openKpi('new_this_week', 'New accounts this week')} />
            <MetricRow label="Free users" value={m ? m.free_users.toLocaleString() : '—'} status="not upgraded" tone="sub" />
            <MetricRow label="Paid users" value={paidUsers.toLocaleString()} status="Pro" tone={paidUsers ? 'green' : 'dim'} />
            <MetricRow label="Suspected duplicates" value={dupSuspected} status="shared-signal clusters" tone={dupSuspected > 0 ? 'amber' : 'dim'} />
            <button className="ac-btn" onClick={() => setManageOpen(true)}>Manage accounts →</button>
          </Panel>
        </div>

        {/* 6 & 7. Data Flywheel + Jobs & Companies */}
        <div className="ac-grid2">
          <Panel title="Data Flywheel" right={<span className="ac-panel-status" style={{ color: fwStatus === 'Not moving yet' ? 'var(--dim)' : 'var(--green)' }}>{fwStatus}</span>}>
            <MetricRow label="Outcome cards shared" value={shares.toLocaleString()} status="virality signal" tone={shares > 0 ? 'blue' : 'dim'} />
            <MetricRow label="Community reports" value={stats.reports.total.toLocaleString()} status={`${stats.reports.today} today`} tone="green" onClick={() => openKpi('total_reports', 'All reports')} />
            <MetricRow label="Job searches (30d)" value={fw ? fw.job_searches_30d.toLocaleString() : '—'} status="tracker demand" tone="sub" />
            <MetricRow label="Résumé scans (30d)" value={fw ? fw.resume_scans_30d.toLocaleString() : '—'} status="intel surveys" tone="sub" />
            <MetricRow label="Companies scored" value={stats.companies.with_scores.toLocaleString()} status="with AI scores" onClick={() => openKpi('companies_scored', 'Companies with scores')} />
            <MetricRow label="Credits earned / spent" value={`${(stats.credits.earned ?? 0).toLocaleString()} / ${(stats.credits.spent ?? 0).toLocaleString()}`} status="engagement" tone="sub" />
          </Panel>

          <Panel title="Jobs & Companies" right={staleJobs > 0 ? <JobRefreshButton token={token!} onDone={() => load(token!)} /> : <span className="ac-panel-status">{jh ? `${jh.active_pct}% live` : ''}</span>}>
            <MetricRow label="Total stored jobs" value={(jb?.total ?? 0).toLocaleString()} status="all statuses" onClick={() => openKpi('jobs_total', 'All stored jobs')} />
            <MetricRow label="Active listings" value={activeJobs.toLocaleString()} status="live jobs users see" tone={jh?.crisis ? 'red' : 'blue'} onClick={() => openKpi('jobs_active', 'Active job listings')} />
            <MetricRow label="Added today" value={jb?.added_today ?? jb?.new_today ?? 0} status="new listings" tone={(jb?.added_today ?? 0) > 0 ? 'green' : 'dim'} onClick={() => openKpi('jobs_today', 'Jobs added today')} />
            <MetricRow label="Stale / expired" value={staleJobs.toLocaleString()} status="flagged unavailable" tone={staleJobs > 500 ? 'amber' : 'dim'} onClick={() => openKpi('jobs_stale', 'Stale & expired jobs')} />
            <MetricRow label="Company scores" value={stats.companies.with_scores.toLocaleString()} status="graded companies" onClick={() => openKpi('companies_scored', 'Companies with scores')} />
            <MetricRow label="Reported inactive" value={inactiveCount} status="user-flagged listings" tone={inactiveCount > 0 ? 'amber' : 'dim'} />
          </Panel>
        </div>

        {/* 8. System Health */}
        <Panel title="System Health" right={<span className="ac-panel-status" style={{ color: (errToday > 0 || jh?.crisis) ? 'var(--amber)' : 'var(--green)' }}>{(errToday > 0 || jh?.crisis) ? 'Attention needed' : 'All systems normal'}</span>}>
          <MetricRow label="API errors today" value={errToday} status="last 24h" tone={errToday > 10 ? 'red' : errToday > 0 ? 'amber' : 'green'} />
          <MetricRow label="API errors this week" value={stats.errors?.this_week ?? 0} status="last 7 days" tone={(stats.errors?.this_week ?? 0) > 0 ? 'amber' : 'dim'} />
          <MetricRow label="Active users today" value={stats.users.dau} status="DAU" tone="sub" />
          <MetricRow label="Job refresh" value={jh?.crisis ? 'Behind' : 'Healthy'} status={jh ? `${jh.active_pct}% corpus live` : ''} tone={jh?.crisis ? 'red' : 'green'} />
          {stats.errors?.recent && stats.errors.recent.length > 0 ? (
            <div className="ac-panel-foot">
              <div style={{ marginBottom: '.35rem', color: 'var(--sub)' }}>Recent errors by route</div>
              {stats.errors.recent.slice(0, 4).map((e, i) => (
                <div key={i} style={{ padding: '.15rem 0', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ color: 'var(--dim)' }}>{relTime(e.created_at)}</span> · <span style={{ color: 'var(--sub)' }}>{e.endpoint}</span> · {e.error_msg?.slice(0, 50)}
                </div>
              ))}
            </div>
          ) : <div className="ac-panel-foot" style={{ color: 'var(--green)' }}>✓ No system issues detected.</div>}
        </Panel>

        {/* Advanced tools & full data — every original panel preserved, collapsed by default */}
        <details className="ac-adv">
          <summary>Advanced tools &amp; full data</summary>
          <div className="ac-adv-body">

            {/* Company lookups setup note */}
            {stats.company_lookups && !stats.company_lookups.ready && (
              <div id="admSetupNote" style={{ background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 10, padding: '1rem 1.1rem', marginBottom: '1rem' }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '.5rem' }}>Enable company lookup tracking</div>
                <p style={{ fontSize: '.78rem', color: 'var(--sub)', marginBottom: '.75rem', lineHeight: 1.6 }}>Run this SQL in your Supabase SQL editor once to track which companies users are researching:</p>
                <pre style={{ background: 'rgba(0,0,0,.35)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 6, padding: '.75rem 1rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--white)', overflowX: 'auto', lineHeight: 1.7, margin: 0 }}>
                  {`CREATE TABLE IF NOT EXISTS search_logs (
  id bigserial PRIMARY KEY,
  query text NOT NULL,
  created_at timestamptz DEFAULT now()
);`}
                </pre>
              </div>
            )}

            {/* Reports chart */}
            <div className="adm-panel" style={{ marginBottom: '.65rem' }}>
              <div className="adm-panel-hdr">
                Reports submitted — last 30 days
                <span style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--dim)' }}>one bar = one day</span>
              </div>
              <div style={{ padding: '.85rem 1rem .6rem' }}>
                <div className="adm-chart-row">
                  {(stats.reports.chart || []).map(d => (
                    <div key={d.date} className="adm-chart-bar" style={{ height: `${chartMax > 0 ? (d.count / chartMax) * 100 : 0}%` }} title={`${d.date}: ${d.count}`} />
                  ))}
                </div>
                {stats.reports.chart && stats.reports.chart.length > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '.3rem 0 0', fontFamily: 'var(--mono)', fontSize: '.44rem', color: 'var(--dim)' }}>
                    {[0, 7, 14, 21, 29].map(i => (
                      <span key={i}>{stats.reports.chart[i]?.date?.slice(5) || ''}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Two-column: most reported + most researched */}
            <div className="adm-2col">
              <div className="adm-panel">
                <div className="adm-panel-hdr">Most reported companies <span style={{ color: 'var(--dim)', fontWeight: 400 }}>(30d)</span></div>
                <BarChart items={(stats.reports.top_companies || []).slice(0, 8).map(c => ({ label: c.company, value: c.count }))} max={topReportedMax} />
              </div>
              <div className="adm-panel">
                <div className="adm-panel-hdr">Most researched companies <span style={{ color: 'var(--dim)', fontWeight: 400 }}>(7d)</span></div>
                {stats.company_lookups?.ready
                  ? <BarChart items={(stats.company_lookups.top || []).slice(0, 8).map(c => ({ label: c.company, value: c.count }))} max={topLookupMax} green />
                  : <div style={{ padding: '.85rem 1rem', fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--dim)' }}>search_logs not set up</div>
                }
              </div>
            </div>

            {/* Outcome breakdown */}
            <div className="adm-panel" style={{ marginBottom: '.65rem' }}>
              <div className="adm-panel-hdr">Report outcome breakdown <span style={{ color: 'var(--dim)', fontWeight: 400 }}>(30d)</span></div>
              <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', padding: '.75rem 1rem' }}>
                {Object.entries(stats.reports.outcome_breakdown ?? {}).filter(([, v]) => (v as number) > 0).map(([outcome, count]) => (
                  <div key={outcome} style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', padding: '.35rem .75rem', borderRadius: 6, background: outcomeColor(outcome) + '18', color: outcomeColor(outcome), border: `1px solid ${outcomeColor(outcome)}30` }}>
                    {outcome}: {count as number}
                  </div>
                ))}
              </div>
            </div>

            {/* Recent hiring reports (moderation) */}
            <Card style={{ marginTop: '.65rem' }}>
              <CardHeader title="Recent hiring reports (last 25)" badge={needsReviewCount > 0 ? <Badge n={needsReviewCount} /> : undefined} />
              {(stats.reports.recent || []).length === 0
                ? <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--dim)' }}>No reports yet</div>
                : (stats.reports.recent || []).map(r => (<ReportRow key={r.id} report={r} token={token!} onRefresh={() => load(token!)} />))
              }
            </Card>

            {/* Recent tracker applications */}
            <Card style={{ marginTop: '.65rem' }}>
              <CardHeader title="Recent tracker applications (last 25)" />
              {(stats.applications.recent || []).length === 0
                ? <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--muted)' }}>No applications tracked yet</div>
                : (stats.applications.recent || []).map(a => (
                  <div key={a.id} className="adm-row" style={{ margin: '0 -1rem', borderLeft: `3px solid ${stageColor(a.stage)}`, gap: '.6rem' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: stageColor(a.stage), background: stageColor(a.stage) + '18', border: `1px solid ${stageColor(a.stage)}30`, borderRadius: 4, padding: '.1rem .4rem', flexShrink: 0 }}>{a.stage}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--white)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.company_name} · {a.role}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)', flexShrink: 0 }}>{relTime(a.created_at)}</span>
                  </div>
                ))
              }
            </Card>

            {/* New job listings browser */}
            <AllJobsBrowser token={token!} onUnauthorized={onUnauthorized} />

            {/* Job deduplication */}
            <JobDedupePanel token={token!} />

            {/* Reported inactive listings */}
            <Card style={{ marginTop: '.65rem' }}>
              <CardHeader
                title="Reported inactive listings"
                badge={(stats.jobs?.inactive_reports || []).length > 0 ? <Badge n={stats.jobs.inactive_reports.length} color="var(--amber)" /> : undefined}
                action={<span style={{ fontFamily: 'var(--mono)', fontSize: '.48rem', color: 'var(--dim)' }}>User reports that a listing is no longer active</span>}
              />
              {(stats.jobs?.inactive_reports || []).length === 0
                ? <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--dim)' }}>No inactive reports this week</div>
                : (stats.jobs.inactive_reports || []).map(r => (<InactiveRow key={r.job_id} report={r} token={token!} />))
              }
            </Card>

            {/* Data quality issues queue */}
            <Card style={{ marginTop: '.65rem' }}>
              <CardHeader
                title="Data quality issues"
                badge={stats.issues?.open > 0 ? <Badge n={stats.issues.open} /> : undefined}
                action={<button onClick={() => token && load(token)} style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', padding: '.3rem .75rem', borderRadius: 6, border: '1px solid var(--line2)', background: 'transparent', color: 'var(--sub)', cursor: 'pointer' }}>↻ Refresh</button>}
              />
              {(stats.issues?.items || []).length === 0
                ? <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--green)' }}>✓ No open issues</div>
                : (stats.issues.items || []).map(issue => (
                  <IssueRow key={issue.id} issue={issue} token={token!} onRefresh={() => load(token!)} onOpenMerge={name => setMergePrefill({ primary: name, secondary: '', nonce: Date.now() })} />
                ))
              }
            </Card>

            {/* Company deduplication */}
            <MergePanel token={token!} prefill={mergePrefill} />

            {/* Per-company evidentiary export */}
            <CompanyExportPanel token={token!} />

            {/* Credits overview + master toggle */}
            <CreditsPanel credits={stats.credits} flags={stats.feature_flags || []} token={token!} onRefresh={() => load(token!)} />

            {/* Feature flags */}
            <FlagsPanel flags={stats.feature_flags || []} token={token!} onRefresh={() => load(token!)} />

            {/* Duplicate account clusters */}
            <ClustersPanel clusters={stats.duplicate_clusters?.items || []} suspected={stats.duplicate_clusters?.suspected || 0} token={token!} onRefresh={() => load(token!)} />

            {/* Background job runner */}
            <JobRunner token={token!} />

            {/* Deploy trigger */}
            <DeployPanel />

          </div>
        </details>

      </div>

      {kpiModal && (
        <KpiModal metric={kpiModal.metric} title={kpiModal.title} token={token!} onClose={() => setKpiModal(null)} />
      )}
      {manageOpen && (
        <ManageAccountsModal token={token!} onClose={() => setManageOpen(false)} />
      )}
    </div>
  )
}

const REDDIT_SUBS = ['recruitinghell', 'jobs', 'cscareerquestions', 'careerguidance']
const JOB_DEFS = [
  { key: 'refresh_jobs', name: 'Refresh job listings', desc: 'Pulls new openings from job boards · runs 6×/day', green: false },
  { key: 'refresh_demand', name: 'Refresh demand data', desc: 'Pulls BLS JOLTS + CES, updates demand index · runs monthly', green: false },
  { key: 'reddit_import', name: 'Reddit import', desc: 'Classifies hiring posts from r/recruitinghell + 3 others · runs nightly', green: true },
] as const

function JobRunner({ token }: { token: string }) {
  const [running, setRunning] = useState<string | null>(null)
  const [label, setLabel] = useState<Record<string, string>>({})
  const [result, setResult] = useState('')

  function hdrs() { return { 'Content-Type': 'application/json', 'X-Admin-Token': token } }

  async function run(job: string) {
    setRunning(job)
    setLabel(l => ({ ...l, [job]: '⏳ Running…' }))
    setResult('')
    try {
      if (job === 'reddit_import') {
        let totalImported = 0
        const subResults: string[] = []
        setResult('Running…')
        for (const sub of REDDIT_SUBS) {
          const r = await fetch('/api/reports', { method: 'POST', headers: hdrs(), body: JSON.stringify({ action: 'reddit_import', subreddit: sub }) })
          const d = await r.json().catch(() => ({}))
          const n = d.results ? Object.values(d.results).reduce((s: number, v) => s + ((v as { imported?: number }).imported || 0), 0) : 0
          const posts = d.debug?.subreddits?.[sub]?.posts ?? d.debug?.subreddits?.[sub]?.error ?? '?'
          totalImported += n
          subResults.push(`${sub}:${posts}(+${n})`)
          setResult(`Running… ${subResults.join(' ')}`)
        }
        setLabel(l => ({ ...l, [job]: '✓ Done' }))
        setResult(`✓ Reddit: ${totalImported} imported | ${subResults.join(' ')}`)
      } else {
        const url = job === 'refresh_jobs' ? '/api/refresh-jobs' : '/api/demand'
        const res = await fetch(url, { method: 'POST', headers: hdrs(), body: JSON.stringify({}) })
        const d = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(d.error || String(res.status))
        let msg = `✓ ${job} complete`
        if (job === 'refresh_jobs' && d.inserted != null) msg = `✓ Jobs: ${d.inserted} inserted, ${d.updated ?? 0} updated`
        else if (job === 'refresh_demand' && d.rows_upserted != null) msg = `✓ Demand: ${d.rows_upserted} rows updated`
        setLabel(l => ({ ...l, [job]: '✓ Done' }))
        setResult(msg)
      }
    } catch (e) {
      setLabel(l => ({ ...l, [job]: '✗ Error' }))
      setResult('✗ ' + (e as Error).message.slice(0, 80))
    }
    setRunning(null)
    setTimeout(() => setLabel(l => ({ ...l, [job]: '' })), 5000)
  }

  return (
    <Card style={{ marginBottom: '1.25rem' }}>
      <CardHeader title="Background jobs" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
        {JOB_DEFS.map(j => (
          <div key={j.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem', padding: '.6rem .75rem', background: 'var(--surface)', borderRadius: 8 }}>
            <div style={{ minWidth: 0, overflow: 'hidden' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.name}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.desc}</div>
            </div>
            <button
              onClick={() => run(j.key)}
              disabled={running === j.key}
              style={{ background: 'none', border: `1px solid ${j.green ? 'var(--green)' : 'var(--line2)'}`, borderRadius: 7, padding: '.35rem .8rem', fontFamily: 'var(--mono)', fontSize: '.6rem', color: j.green ? 'var(--green)' : 'var(--sub)', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              {label[j.key] || '▶ Run'}
            </button>
          </div>
        ))}
      </div>
      {result && <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--sub)', marginTop: '.6rem' }}>{result}</div>}
    </Card>
  )
}

function ReportRow({ report: r, token, onRefresh }: { report: RecentReport; token: string; onRefresh: () => void }) {
  const [acting, setActing] = useState(false)
  const [localStatus, setLocalStatus] = useState<string | null>(null)

  async function act(action: string) {
    setActing(true)
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action, id: r.id }),
      })
      if (res.ok) {
        setLocalStatus(action === 'approve_report' ? 'approved' : action === 'investigate_report' ? 'review' : 'denied')
        setTimeout(onRefresh, 1200)
      }
    } finally {
      setActing(false)
    }
  }

  const isDenied = localStatus === 'denied' || (r.outcome_weight === 0 && !r.needs_review)
  const oc = outcomeColor(r.outcome)
  return (
    <div style={{ padding: '.6rem 1rem', borderBottom: '1px solid var(--line2)', borderLeft: `3px solid ${oc}`, margin: '0 -1rem', opacity: isDenied ? 0.45 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.6rem', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: outcomeColor(r.outcome), background: outcomeColor(r.outcome) + '18', border: `1px solid ${outcomeColor(r.outcome)}30`, borderRadius: 4, padding: '.1rem .4rem', flexShrink: 0, marginTop: 1 }}>{r.outcome}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.company_name} · {r.role}</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--sub)', marginTop: '.15rem' }}>{r.report_text?.slice(0, 90)}{r.report_text?.length > 90 ? '…' : ''}</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)', marginTop: '.15rem' }}>
            {relTime(r.created_at)} · community · {r.trust_reason || r.platform}
            {r.needs_review && !localStatus && <span style={{ marginLeft: '.4rem', color: 'var(--amber)' }}>● Review</span>}
            {localStatus === 'denied' && <span style={{ marginLeft: '.4rem', color: 'var(--red)' }}>✗ Denied</span>}
            {localStatus === 'approved' && <span style={{ marginLeft: '.4rem', color: 'var(--green)' }}>✓ Approved</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '.3rem', flexShrink: 0 }}>
          <button onClick={() => act('approve_report')} disabled={acting} title="Approve" style={{ background: 'var(--green)', border: 'none', borderRadius: 5, width: 26, height: 26, color: '#fff', fontSize: '.75rem', cursor: 'pointer' }}>✓</button>
          <button onClick={() => act('investigate_report')} disabled={acting} title="Investigate" style={{ background: 'var(--amber)', border: 'none', borderRadius: 5, width: 26, height: 26, color: '#fff', fontSize: '.75rem', cursor: 'pointer' }}>?</button>
          <button onClick={() => act('deny_hiring_report')} disabled={acting} title="Deny" style={{ background: 'var(--red)', border: 'none', borderRadius: 5, width: 26, height: 26, color: '#fff', fontSize: '.75rem', cursor: 'pointer' }}>✗</button>
        </div>
      </div>
    </div>
  )
}

function IssueRow({ issue, token, onRefresh, onOpenMerge }: { issue: Issue; token: string; onRefresh: () => void; onOpenMerge: (name: string) => void }) {
  const [acting, setActing] = useState(false)
  const [done, setDone] = useState<'resolve' | 'dismiss' | null>(null)
  const color = issueBadgeColor(issue.type)

  async function act(action: 'resolve_issue' | 'dismiss_issue') {
    setActing(true)
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action, id: issue.id }),
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || res.status)
      setDone(action === 'resolve_issue' ? 'resolve' : 'dismiss')
      setTimeout(onRefresh, 1000)
    } catch (e) {
      setActing(false)
      alert('Error: ' + (e as Error).message)
    }
  }

  if (done) return (
    <div style={{ padding: '.65rem 0', borderBottom: '1px solid rgba(255,255,255,.04)', opacity: 0.4, fontFamily: 'var(--mono)', fontSize: '.6rem', color: done === 'resolve' ? 'var(--green)' : 'var(--dim)' }}>
      {done === 'resolve' ? '✓ Resolved' : '✓ Dismissed'} — {issue.target_name || ISSUE_TYPE_LABEL[issue.type] || issue.type}
    </div>
  )

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.65rem', padding: '.65rem 0', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap', marginBottom: '.2rem' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.48rem', textTransform: 'uppercase', letterSpacing: '.1em', padding: '.18rem .5rem', borderRadius: 4, flexShrink: 0, color, background: color + '1f' }}>
            {ISSUE_TYPE_LABEL[issue.type] || issue.type}
          </span>
          {issue.target_name && <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--white)', fontWeight: 600 }}>{issue.target_name}</span>}
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--dim)', marginLeft: 'auto', flexShrink: 0 }}>{relTime(issue.created_at)}</span>
        </div>
        {issue.notes && <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--sub)', lineHeight: 1.5, marginTop: '.18rem' }}>{issue.notes}</div>}
        {issue.type === 'duplicate' && issue.target_name && (
          <button onClick={() => onOpenMerge(issue.target_name)} style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', marginTop: '.3rem', padding: '.18rem .5rem', borderRadius: 4, border: '1px solid var(--line2)', background: 'transparent', color: 'var(--sub)', cursor: 'pointer' }}>Open in merge tool ↓</button>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem', flexShrink: 0 }}>
        <button onClick={() => act('resolve_issue')} disabled={acting} style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', padding: '.22rem .6rem', borderRadius: 5, border: '1px solid rgba(16,185,129,.3)', background: 'rgba(16,185,129,.08)', color: 'var(--green)', cursor: 'pointer' }}>Resolve</button>
        <button onClick={() => act('dismiss_issue')} disabled={acting} style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', padding: '.22rem .6rem', borderRadius: 5, border: '1px solid var(--line2)', background: 'transparent', color: 'var(--dim)', cursor: 'pointer' }}>Dismiss</button>
      </div>
    </div>
  )
}

function InactiveRow({ report: r, token }: { report: InactiveReport; token: string }) {
  const [acting, setActing] = useState(false)
  const [done, setDone] = useState<'removed' | 'kept' | null>(null)
  const j = r.job || ({} as NonNullable<InactiveReport['job']>)
  const jobUrl = j.url || j.apply_url || ''

  async function act(action: 'remove_listing' | 'deny_report') {
    if (action === 'remove_listing' && !confirm('Remove this job listing? It will be hidden from job seekers.')) return
    setActing(true)
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action, job_id: r.job_id }),
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || res.status)
      setDone(action === 'remove_listing' ? 'removed' : 'kept')
    } catch (e) {
      setActing(false)
      alert('Error: ' + (e as Error).message)
    }
  }

  if (done) return (
    <div style={{ padding: '.5rem 0', borderBottom: '1px solid var(--line2)', fontFamily: 'var(--mono)', fontSize: '.58rem', color: done === 'removed' ? 'var(--green)' : 'var(--dim)' }}>
      {done === 'removed' ? '✓ Listing removed' : '✓ Marked as still active'}
    </div>
  )

  return (
    <div style={{ padding: '.7rem 0', borderBottom: '1px solid var(--line2)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.75rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {j.title || 'Unknown title'} · <span style={{ color: 'var(--sub)' }}>{j.company || 'Unknown company'}</span>
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)', marginTop: '.15rem' }}>
            {j.city || ''} · {r.report_count} report{r.report_count === 1 ? '' : 's'} · latest {relTime(r.latest_reported_at)}
          </div>
          {jobUrl && <a href={jobUrl} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--blue)', textDecoration: 'none', marginTop: '.2rem', display: 'inline-block' }}>↗ Verify listing →</a>}
        </div>
        <div style={{ display: 'flex', gap: '.45rem', flexShrink: 0 }}>
          <button onClick={() => act('remove_listing')} disabled={acting} style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', padding: '.3rem .65rem', borderRadius: 6, border: '1px solid rgba(239,68,68,.4)', background: 'rgba(239,68,68,.08)', color: 'var(--red)', cursor: 'pointer' }}>Remove</button>
          <button onClick={() => act('deny_report')} disabled={acting} style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', padding: '.3rem .65rem', borderRadius: 6, border: '1px solid var(--line2)', background: 'transparent', color: 'var(--sub)', cursor: 'pointer' }}>Keep active</button>
        </div>
      </div>
    </div>
  )
}

function MergePanel({ token, prefill }: { token: string; prefill: MergePrefill | null }) {
  const [primary, setPrimary] = useState('')
  const [secondary, setSecondary] = useState('')
  const [status, setStatus] = useState<{ text: string; color: string } | null>(null)
  const [scanning, setScanning] = useState(false)
  const [autoMerging, setAutoMerging] = useState(false)
  const [merging, setMerging] = useState(false)
  const [dupes, setDupes] = useState<DupGroup[] | null>(null)

  // Prefill from issues queue "Open in merge tool"
  useEffect(() => {
    if (prefill) {
      setPrimary(prefill.primary)
      setSecondary(prefill.secondary)
    }
  }, [prefill])

  async function scan() {
    setScanning(true)
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'find_duplicates' }),
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || res.status)
      setDupes(d.duplicates || [])
    } catch (e) {
      setStatus({ text: 'Error: ' + (e as Error).message, color: 'var(--red)' })
    }
    setScanning(false)
  }

  async function manualMerge() {
    const p = primary.trim(), s = secondary.trim()
    if (!p || !s) { setStatus({ text: 'Both fields required', color: 'var(--red)' }); return }
    if (p.toLowerCase() === s.toLowerCase()) { setStatus({ text: 'Cannot merge a company with itself', color: 'var(--red)' }); return }
    setMerging(true)
    setStatus({ text: 'Merging…', color: 'var(--dim)' })
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'merge', primary: p, secondary: s }),
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || res.status)
      setStatus({ text: `✓ "${s}" merged into "${p}" — ${d.merged_report_count} total reports`, color: 'var(--green)' })
      setPrimary(''); setSecondary('')
      scan()
    } catch (e) {
      setStatus({ text: 'Error: ' + (e as Error).message, color: 'var(--red)' })
    }
    setMerging(false)
  }

  async function autoMerge() {
    setAutoMerging(true)
    setStatus({ text: 'Scanning and merging…', color: 'var(--dim)' })
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'auto_merge' }),
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || res.status)
      if (!d.merged) {
        setStatus({ text: '✓ Auto-merge complete — no duplicates found', color: 'var(--green)' })
      } else {
        const summary = (d.groups || []).map((g: { canonical: string; absorbed: string[] }) => `"${g.absorbed.join('", "')}" → "${g.canonical}"`).join(' · ')
        setStatus({ text: `✓ Merged ${d.merged} duplicate${d.merged !== 1 ? 's' : ''}: ${summary}`, color: 'var(--green)' })
      }
      scan()
    } catch (e) {
      setStatus({ text: 'Auto-merge failed: ' + (e as Error).message, color: 'var(--red)' })
    }
    setAutoMerging(false)
  }

  function setMerge(p: string, s: string) { setPrimary(p); setSecondary(s) }

  const inputStyle: React.CSSProperties = { width: '100%', background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 7, padding: '.42rem .65rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--white)', outline: 'none', boxSizing: 'border-box' }

  return (
    <Card style={{ marginBottom: '1.25rem' }}>
      <CardHeader
        title="Company deduplication"
        action={
          <div style={{ display: 'flex', gap: '.45rem' }}>
            <button onClick={scan} disabled={scanning} style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', padding: '.3rem .75rem', borderRadius: 6, border: '1px solid var(--line2)', background: 'transparent', color: 'var(--sub)', cursor: 'pointer' }}>
              {scanning ? 'Scanning…' : 'Scan for dupes'}
            </button>
            <button onClick={autoMerge} disabled={autoMerging} style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', padding: '.3rem .75rem', borderRadius: 6, border: '1px solid rgba(16,185,129,.3)', background: 'rgba(16,185,129,.08)', color: 'var(--green)', cursor: 'pointer' }}>
              {autoMerging ? 'Running…' : 'Auto-merge'}
            </button>
          </div>
        }
      />
      {/* Manual merge form */}
      <div style={{ paddingBottom: '.75rem', borderBottom: '1px solid var(--line2)', marginBottom: '.75rem' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.48rem', textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--dim)', marginBottom: '.5rem' }}>Manual merge</div>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 110 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.48rem', color: 'var(--muted)', marginBottom: '.22rem' }}>Keep (primary)</div>
            <input value={primary} onChange={e => setPrimary(e.target.value)} placeholder="e.g. Amazon" style={inputStyle} />
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.8rem', color: 'var(--dim)', flexShrink: 0, paddingBottom: '.45rem' }}>←</div>
          <div style={{ flex: 1, minWidth: 110 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.48rem', color: 'var(--muted)', marginBottom: '.22rem' }}>Absorb (secondary)</div>
            <input value={secondary} onChange={e => setSecondary(e.target.value)} placeholder="e.g. amazon.com" style={inputStyle} />
          </div>
          <button onClick={manualMerge} disabled={merging} style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', padding: '.42rem .9rem', borderRadius: 7, border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.08)', color: 'var(--red)', cursor: 'pointer', flexShrink: 0 }}>Merge →</button>
        </div>
        {status && <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', marginTop: '.45rem', color: status.color }}>{status.text}</div>}
      </div>
      {/* Detected duplicates list */}
      {dupes === null
        ? <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--dim)' }}>Click &quot;Scan for dupes&quot; to detect company name duplicates.</div>
        : dupes.length === 0
          ? <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--green)' }}>✓ No duplicates detected</div>
          : dupes.map(({ key, companies }) => {
            const prim = companies[0]
            const rest = companies.slice(1)
            return (
              <div key={key} style={{ padding: '.65rem 0', borderBottom: '1px solid var(--line2)' }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--amber)', marginBottom: '.3rem' }}>{companies.length} entries match &quot;{key}&quot;</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.35rem', flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', padding: '.18rem .55rem', borderRadius: 4, background: 'rgba(16,185,129,.12)', color: 'var(--green)', border: '1px solid rgba(16,185,129,.2)' }}>{prim.name} <span style={{ opacity: .6 }}>({prim.report_count || 0})</span></span>
                  {rest.map(c => (
                    <span key={c.id} style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', padding: '.18rem .55rem', borderRadius: 4, background: 'rgba(239,68,68,.08)', color: 'var(--red)', border: '1px solid rgba(239,68,68,.15)' }}>{c.name} <span style={{ opacity: .6 }}>({c.report_count || 0})</span></span>
                  ))}
                  <button onClick={() => setMerge(prim.name, rest[0].name)} style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', padding: '.18rem .55rem', borderRadius: 5, border: '1px solid var(--line2)', background: 'transparent', color: 'var(--sub)', cursor: 'pointer', marginLeft: 'auto' }}>Set to merge</button>
                </div>
              </div>
            )
          })
      }
    </Card>
  )
}

// Per-company evidentiary export — pulls the full audit bundle (every report + source/trust
// weight, the per-source aggregation, the live-recomputed grade, and a methodology key) and
// downloads it as JSON. Built for legal defensibility + showing exactly how a grade was derived.
function CompanyExportPanel({ token }: { token: string }) {
  const [company, setCompany] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ text: string; color: string } | null>(null)

  const inputStyle: React.CSSProperties = { width: '100%', background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 7, padding: '.42rem .65rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--white)', outline: 'none', boxSizing: 'border-box' }

  async function exportCompany() {
    const name = company.trim()
    if (name.length < 2) { setStatus({ text: 'Enter a company name', color: 'var(--red)' }); return }
    setBusy(true)
    setStatus({ text: 'Assembling audit bundle…', color: 'var(--dim)' })
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'export_company', company: name }),
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || res.status)
      const b = d.bundle
      const t = b?.totals || {}
      const cs = b?.computed_score || {}
      // Trigger a client-side JSON download.
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'company'
      const date = new Date().toISOString().slice(0, 10)
      const blob = new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `seen-company-audit-${slug}-${date}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setStatus({ text: `✓ Exported — ${t.total_reports ?? 0} reports (${t.included_in_score ?? 0} in score · ${t.excluded_needs_review ?? 0} held) · ${t.distinct_submitters ?? 0} submitters · grade ${cs.overall_score ?? 'n/a'}`, color: 'var(--green)' })
    } catch (e) {
      setStatus({ text: 'Export failed: ' + (e as Error).message, color: 'var(--red)' })
    }
    setBusy(false)
  }

  return (
    <Card style={{ marginBottom: '1.25rem' }}>
      <CardHeader title="Company data export" />
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)', marginBottom: '.6rem', lineHeight: 1.5 }}>
        Full evidentiary bundle for one company — every contributing &amp; held-out report with its source and trust weight, the per-source aggregation, the live-recomputed grade with all inputs, and the scoring methodology. Submitters are pseudonymized. Downloads as JSON.
      </div>
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.48rem', color: 'var(--muted)', marginBottom: '.22rem' }}>Company name</div>
          <input value={company} onChange={e => setCompany(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') exportCompany() }} placeholder="e.g. FedEx" style={inputStyle} />
        </div>
        <button onClick={exportCompany} disabled={busy} style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', padding: '.42rem .9rem', borderRadius: 7, border: '1px solid rgba(59,130,246,.3)', background: 'rgba(59,130,246,.08)', color: 'var(--blue)', cursor: 'pointer', flexShrink: 0 }}>
          {busy ? 'Exporting…' : 'Export JSON ↓'}
        </button>
      </div>
      {status && <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', marginTop: '.5rem', color: status.color, lineHeight: 1.5 }}>{status.text}</div>}
    </Card>
  )
}

const FLAG_STATUS_LABELS: Record<string, string> = {
  off: 'Off', admin_only: 'Admin only', beta_users: 'Beta (20%)', percentage_rollout: '% rollout', fully_on: 'Live',
}
const FLAG_STATUS_COLORS: Record<string, string> = {
  off: 'var(--muted)', admin_only: 'var(--amber)', beta_users: 'var(--blue)', percentage_rollout: 'var(--indigo)', fully_on: 'var(--green)',
}
const FLAG_STATUSES = ['off', 'admin_only', 'beta_users', 'percentage_rollout', 'fully_on']

// Curated admin toggle layout. Internal batch cursors / tuning values are HIDDEN — they
// aren't on/off product toggles and were the main source of confusion. Real toggles are
// grouped, with one Reddit toggle and one credit toggle. Anything unrecognized and not
// hidden still shows under "Other" so nothing silently disappears.
const HIDDEN_FLAGS = new Set([
  'reddit_offset_recruitinghell', 'reddit_offset_jobs', 'reddit_offset_cscareerquestions',
  'reddit_offset_careerguidance', 'reddit_offset_antiwork', 'reddit_offset_askhr',
  'reddit_offset_interviews', 'reddit_offset_experienceddevs', 'reddit_offset_ExperiencedDevs',
  'reddit_offset_AskHR', 'job_search_target',
])
const FLAG_FRIENDLY: Record<string, string> = {
  ai_credit_system_enabled: 'AI credit system',
  reddit_import_enabled: 'Reddit import',
  job_refresh_enabled: 'Job refresh',
  admin_panel_enabled: 'Admin panel',
  duplicate_detection_enabled: 'Duplicate detection',
  hiring_forecast_enabled: 'Hiring forecast',
  company_confidence_matching_enabled: 'Company match confidence',
  outcome_cards_v2_enabled: 'Outcome cards v2',
  resume_question_engine_enabled: 'Résumé credit questions',
}
const FLAG_GROUPS: { group: string; flags: string[] }[] = [
  { group: 'Credits', flags: ['ai_credit_system_enabled'] },
  { group: 'Data ingestion', flags: ['reddit_import_enabled', 'job_refresh_enabled'] },
  { group: 'Features', flags: ['admin_panel_enabled', 'duplicate_detection_enabled', 'hiring_forecast_enabled', 'company_confidence_matching_enabled', 'outcome_cards_v2_enabled', 'resume_question_engine_enabled'] },
]

// Credits overview + a single master enable/disable for the whole credit system.
function CreditsPanel({ credits, flags, token, onRefresh }: { credits: { total_users: number; pro_users: number; total_balance?: number; earned?: number; spent?: number }; flags: FeatureFlag[]; token: string; onRefresh: () => void }) {
  const sysFlag = flags.find(f => f.flag_name === 'ai_credit_system_enabled')
  const on = (sysFlag?.status || 'fully_on') !== 'off'
  const [saving, setSaving] = useState(false)
  async function toggle() {
    setSaving(true)
    try {
      const res = await fetch('/api/admin-stats', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token }, body: JSON.stringify({ action: 'set_flag', flag_name: 'ai_credit_system_enabled', status: on ? 'off' : 'fully_on' }) })
      const d = await res.json(); if (!d.ok) throw new Error(d.error || String(res.status))
      setTimeout(onRefresh, 400)
    } catch (e) { alert('✗ ' + (e as Error).message) }
    setSaving(false)
  }
  const Stat = ({ l, n, c }: { l: string; n: number | string; c?: string }) => (
    <div style={{ flex: '1 1 30%', minWidth: 92, padding: '.55rem .6rem', border: '1px solid var(--line2)', borderRadius: 8 }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.48rem', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{l}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '1.05rem', color: c || 'var(--white)', marginTop: '.15rem' }}>{typeof n === 'number' ? n.toLocaleString() : n}</div>
    </div>
  )
  return (
    <Card style={{ marginBottom: '1.25rem' }}>
      <CardHeader
        title="Credits"
        action={
          <button onClick={toggle} disabled={saving} style={{ background: on ? 'rgba(239,68,68,.1)' : 'rgba(34,197,94,.1)', border: `1px solid ${on ? 'rgba(239,68,68,.4)' : 'rgba(34,197,94,.4)'}`, borderRadius: 6, padding: '.3rem .7rem', fontFamily: 'var(--mono)', fontSize: '.58rem', color: on ? 'var(--red)' : 'var(--green)', cursor: 'pointer' }}>
            {saving ? '…' : on ? 'Disable credit system' : 'Enable credit system'}
          </button>
        }
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem' }}>
        <Stat l="Credits held" n={credits.total_balance ?? 0} />
        <Stat l="Users w/ credits" n={credits.total_users} />
        <Stat l="Pro users" n={credits.pro_users} />
        <Stat l="Total earned" n={credits.earned ?? 0} c="var(--green)" />
        <Stat l="Total spent" n={credits.spent ?? 0} c="var(--amber)" />
        <Stat l="System" n={on ? 'On' : 'Off'} c={on ? 'var(--green)' : 'var(--muted)'} />
      </div>
    </Card>
  )
}

function FlagsPanel({ flags, token, onRefresh }: { flags: FeatureFlag[]; token: string; onRefresh: () => void }) {
  const [saving, setSaving] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)
  // Optimistic local status overrides keyed by flag_name
  const [localStatus, setLocalStatus] = useState<Record<string, string>>({})

  async function setFlag(flagName: string, status: string) {
    setSaving(flagName)
    const prev = localStatus[flagName]
    setLocalStatus(s => ({ ...s, [flagName]: status }))
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'set_flag', flag_name: flagName, status }),
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || String(res.status))
    } catch (e) {
      setLocalStatus(s => ({ ...s, [flagName]: prev ?? '' }))
      alert('✗ Failed to update flag: ' + (e as Error).message)
    }
    setSaving(null)
  }

  async function seed() {
    setSeeding(true)
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'seed_flags' }),
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || String(res.status))
      setTimeout(onRefresh, 600)
    } catch (e) {
      setSeeding(false)
      alert('✗ ' + (e as Error).message)
    }
  }

  function effectiveStatus(f: FeatureFlag) { return localStatus[f.flag_name] || f.status }

  function row(f: FeatureFlag) {
    const status = effectiveStatus(f)
    return (
      <div key={f.flag_name} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.55rem 0', borderBottom: '1px solid var(--line2)', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0, fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--white)', overflow: 'hidden' }}>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{FLAG_FRIENDLY[f.flag_name] || f.flag_name}</div>
          {f.description && <div style={{ fontFamily: 'var(--mono)', fontSize: '.48rem', color: 'var(--dim)', marginTop: '.1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.description}</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.35rem', flexShrink: 0 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: FLAG_STATUS_COLORS[status] || 'var(--muted)', whiteSpace: 'nowrap' }}>
            {saving === f.flag_name ? 'Saving…' : (FLAG_STATUS_LABELS[status] || status)}
          </div>
          <select
            value={status}
            disabled={saving === f.flag_name}
            onChange={e => setFlag(f.flag_name, e.target.value)}
            style={{ background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 5, padding: '.18rem .4rem', fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--sub)', cursor: 'pointer' }}
          >
            {FLAG_STATUSES.map(s => <option key={s} value={s}>{FLAG_STATUS_LABELS[s]}</option>)}
          </select>
        </div>
      </div>
    )
  }

  const grouped = new Set(FLAG_GROUPS.flatMap(g => g.flags))
  const others = flags.filter(f => !grouped.has(f.flag_name) && !HIDDEN_FLAGS.has(f.flag_name))

  return (
    <Card style={{ marginBottom: '1.25rem' }}>
      <CardHeader
        title="Feature flags"
        action={
          <button onClick={seed} disabled={seeding} style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 6, padding: '.3rem .7rem', fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--sub)', cursor: 'pointer' }}>
            {seeding ? 'Creating…' : '+ Seed defaults'}
          </button>
        }
      />
      {flags.length === 0
        ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.75rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--dim)' }}>No flags in database</div>
            <button onClick={seed} disabled={seeding} style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', padding: '.3rem .75rem', borderRadius: 6, border: '1px solid rgba(59,130,246,.4)', background: 'rgba(59,130,246,.1)', color: 'var(--blue)', cursor: 'pointer' }}>
              {seeding ? 'Creating…' : 'Initialize default flags →'}
            </button>
          </div>
        )
        : (
          <>
            {FLAG_GROUPS.map(grp => {
              const rows = grp.flags.map(name => flags.find(f => f.flag_name === name)).filter(Boolean) as FeatureFlag[]
              if (!rows.length) return null
              return (
                <div key={grp.group} style={{ marginBottom: '.4rem' }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.06em', margin: '.5rem 0 .15rem' }}>{grp.group}</div>
                  {rows.map(row)}
                </div>
              )
            })}
            {others.length > 0 && (
              <div style={{ marginBottom: '.4rem' }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.06em', margin: '.5rem 0 .15rem' }}>Other</div>
                {others.map(row)}
              </div>
            )}
          </>
        )
      }
    </Card>
  )
}

const CLUSTER_STATUSES = ['suspected', 'safe', 'watching', 'limited', 'frozen', 'suspended']
const CLUSTER_COLORS: Record<string, string> = {
  suspected: 'var(--amber)', watching: 'var(--blue)', limited: 'var(--red)',
  frozen: 'var(--red)', suspended: 'var(--red)', safe: 'var(--green)',
}

function ClustersPanel({ clusters, suspected, token, onRefresh }: { clusters: DupCluster[]; suspected: number; token: string; onRefresh: () => void }) {
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState('')
  const [localStatus, setLocalStatus] = useState<Record<string, string>>({})

  async function updateCluster(clusterId: string, status: string) {
    const prev = localStatus[clusterId]
    setLocalStatus(s => ({ ...s, [clusterId]: status }))
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'update_cluster', cluster_id: clusterId, status }),
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || res.status)
    } catch (e) {
      setLocalStatus(s => ({ ...s, [clusterId]: prev ?? '' }))
      alert('Failed to update cluster: ' + (e as Error).message)
    }
  }

  async function scan() {
    setScanning(true)
    setScanMsg('Scanning login signals…')
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'detect_duplicates_by_signals' }),
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || res.status)
      setScanMsg(`✓ Found ${d.suspects} suspect groups — created ${d.clusters_created} new clusters`)
      setTimeout(onRefresh, 1200)
    } catch (e) {
      setScanMsg('Error: ' + (e as Error).message)
      setScanning(false)
    }
  }

  return (
    <Card style={{ marginBottom: '1.25rem' }}>
      <CardHeader
        title="Duplicate account clusters"
        action={
          <button onClick={scan} disabled={scanning} style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 6, padding: '.3rem .7rem', fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--sub)', cursor: 'pointer' }}>
            Scan signals
          </button>
        }
      />
      {scanMsg && <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: scanMsg.startsWith('✓') ? 'var(--green)' : scanMsg.startsWith('Error') ? 'var(--red)' : 'var(--dim)', marginBottom: '.6rem' }}>{scanMsg}</div>}
      {suspected > 0 && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--amber)', marginBottom: '.6rem' }}>
          {suspected} suspected cluster{suspected === 1 ? '' : 's'}
        </div>
      )}
      {clusters.length === 0
        ? <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--dim)' }}>No suspected clusters — click &quot;Scan signals&quot; to detect</div>
        : clusters.map(c => {
          const status = localStatus[c.id] || c.status
          return (
            <div key={c.id} style={{ padding: '.6rem 0', borderBottom: '1px solid var(--line2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.65rem', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', fontWeight: 700, color: CLUSTER_COLORS[status] || 'var(--sub)', flexShrink: 0 }}>Risk {c.risk_score}/100</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.user_ids?.length || 0} accounts · {(c.signals || []).join(', ')}</span>
                <select
                  value={status}
                  onChange={e => updateCluster(c.id, e.target.value)}
                  style={{ background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 5, padding: '.18rem .4rem', fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--sub)', cursor: 'pointer', marginLeft: 'auto' }}
                >
                  {CLUSTER_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          )
        })
      }
    </Card>
  )
}

function availColor(a: string) {
  if (a === 'active') return 'var(--green)'
  if (a === 'stale') return 'var(--amber)'
  if (a === 'expired') return 'var(--red)'
  if (a === 'removed') return 'var(--dim)'
  return 'var(--sub)'
}

function JobDedupePanel({ token }: { token: string }) {
  const [scanning, setScanning] = useState(false)
  const [deduping, setDeduping] = useState(false)
  const [suspected, setSuspected] = useState<number | null>(null)
  const [deleted, setDeleted] = useState<number | null>(null)
  const [msg, setMsg] = useState('')
  const [target, setTarget] = useState('20')
  const [targetSaving, setTargetSaving] = useState(false)
  const [targetMsg, setTargetMsg] = useState('')

  useEffect(() => {
    fetch('/api/admin-stats', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token }, body: JSON.stringify({ action: 'get_job_target' }) })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.target) setTarget(String(d.target)) })
      .catch(() => {})
  }, [token])

  async function saveTarget() {
    const n = parseInt(target, 10)
    if (!Number.isFinite(n) || n < 5 || n > 60) { setTargetMsg('✗ Enter a number 5–60'); return }
    setTargetSaving(true); setTargetMsg('')
    try {
      const r = await fetch('/api/admin-stats', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token }, body: JSON.stringify({ action: 'set_job_target', target: n }) })
      const d = await r.json()
      if (!d.ok) throw new Error(d.error || 'Save failed')
      setTargetMsg(`✓ Saved — searches now aggregate up to ${d.target}`)
    } catch (e) { setTargetMsg(`✗ ${(e as Error).message}`) }
    setTargetSaving(false)
  }

  async function scan() {
    setScanning(true); setMsg(''); setSuspected(null); setDeleted(null)
    try {
      const r = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'scan_job_dupes' }),
      })
      const d = await r.json()
      if (!d.ok) throw new Error(d.error || 'Scan failed')
      setSuspected(d.suspected)
      setMsg(d.suspected === 0 ? '✓ No duplicates found' : `Found ${d.suspected} duplicate${d.suspected !== 1 ? 's' : ''} (exact apply_url match)`)
    } catch(e) { setMsg(`✗ ${(e as Error).message}`) }
    setScanning(false)
  }

  async function dedupe() {
    if (!confirm(`Remove ${suspected} duplicate job listing${suspected !== 1 ? 's' : ''}? This keeps the newest copy of each duplicate set and deletes the rest. Cannot be undone.`)) return
    setDeduping(true); setMsg('')
    try {
      const r = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'dedupe_jobs' }),
      })
      const d = await r.json()
      if (!d.ok) throw new Error(d.error || 'Dedupe failed')
      setDeleted(d.deleted); setSuspected(0)
      setMsg(d.deleted === 0 ? '✓ No duplicates to remove' : `✓ Removed ${d.deleted} duplicate listing${d.deleted !== 1 ? 's' : ''}`)
    } catch(e) { setMsg(`✗ ${(e as Error).message}`) }
    setDeduping(false)
  }

  const btnBase: React.CSSProperties = { background: 'none', border: '1px solid var(--line2)', color: 'var(--sub)', borderRadius: 8, padding: '.4rem .9rem', fontFamily: 'var(--mono)', fontSize: '.6rem', cursor: 'pointer', transition: 'all .15s', whiteSpace: 'nowrap' }

  return (
    <Card style={{ marginBottom: '1.25rem' }}>
      <CardHeader
        title="Job deduplication"
        action={<span style={{ fontFamily: 'var(--mono)', fontSize: '.48rem', color: 'var(--dim)' }}>Exact match on apply_url — keeps newest copy</span>}
      />
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: msg ? '.65rem' : 0 }}>
        <button onClick={scan} disabled={scanning || deduping} style={{ ...btnBase, borderColor: 'var(--blue)', color: 'var(--blue)' }}>
          {scanning ? '⏳ Scanning…' : '⟳ Scan for dupes'}
        </button>
        {suspected !== null && suspected > 0 && (
          <button onClick={dedupe} disabled={deduping || scanning} style={{ ...btnBase, borderColor: 'var(--red)', color: 'var(--red)' }}>
            {deduping ? '⏳ Removing…' : `✕ Remove ${suspected} dupe${suspected !== 1 ? 's' : ''}`}
          </button>
        )}
      </div>
      {msg && <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: deleted != null && deleted > 0 ? 'var(--green)' : suspected === 0 ? 'var(--green)' : msg.startsWith('✗') ? 'var(--red)' : 'var(--amber)' }}>{msg}</div>}

      {/* Aggregation target */}
      <div style={{ marginTop: '.85rem', paddingTop: '.75rem', borderTop: '1px solid var(--line2)' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.48rem', textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--dim)', marginBottom: '.4rem' }}>Aggregation target</div>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--sub)' }}>Min listings per search</span>
          <input type="number" min={5} max={60} value={target} onChange={e => setTarget(e.target.value)}
            style={{ width: 64, background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 6, padding: '.3rem .5rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--white)', outline: 'none' }} />
          <button onClick={saveTarget} disabled={targetSaving} style={{ ...btnBase, borderColor: 'var(--green)', color: 'var(--green)' }}>{targetSaving ? '⏳ Saving…' : 'Save'}</button>
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--dim)', marginTop: '.4rem' }}>
          If a search has fewer related listings than this, Seen pulls more from online and stores them. Higher = aggregate harder; lower = calm it down. (5–60)
        </div>
        {targetMsg && <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', marginTop: '.35rem', color: targetMsg.startsWith('✗') ? 'var(--red)' : 'var(--green)' }}>{targetMsg}</div>}
      </div>

      <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--dim)', marginTop: '.5rem' }}>
        Scan first to preview. Delete keeps the most recently seen copy. Run the SQL migration in <code style={{ color: 'var(--sub)' }}>014_job_dedup.sql</code> after deduping to block future dupes.
      </div>
    </Card>
  )
}

function AllJobsBrowser({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const [groups, setGroups] = useState<JobGroup[]>([])
  const [totalJobs, setTotalJobs] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [companyJobs, setCompanyJobs] = useState<Record<string, RecentJob[]>>({})
  const [companyLoading, setCompanyLoading] = useState<string | null>(null)
  const COLLAPSED_COUNT = 10

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/admin-stats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
          body: JSON.stringify({ action: 'get_jobs_grouped' }),
        })
        if (res.status === 401 || res.status === 403) { onUnauthorized(); return }
        const d = await res.json()
        if (!d.ok) throw new Error(d.error || String(res.status))
        setGroups(d.groups || [])
        setTotalJobs(d.total_jobs || 0)
      } catch (e) {
        setError((e as Error).message)
      }
      setLoading(false)
    }
    load()
  }, [token, onUnauthorized])

  async function toggleCompany(company: string) {
    if (expanded === company) { setExpanded(null); return }
    setExpanded(company)
    if (companyJobs[company]) return
    setCompanyLoading(company)
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'get_company_jobs', company }),
      })
      if (res.status === 401 || res.status === 403) { onUnauthorized(); return }
      const d = await res.json()
      if (!d.ok) throw new Error(d.error)
      setCompanyJobs(prev => ({ ...prev, [company]: d.jobs || [] }))
    } catch (e) {
      setCompanyJobs(prev => ({ ...prev, [company]: [] }))
    }
    setCompanyLoading(null)
  }

  const filtered = search.trim()
    ? groups.filter(g => g.company.toLowerCase().includes(search.toLowerCase()))
    : groups
  // Keep the list short by default — show the first N, with a toggle to extend.
  // When filtering, always show all matches.
  const visible = (search.trim() || showAll) ? filtered : filtered.slice(0, COLLAPSED_COUNT)

  return (
    <Card style={{ marginBottom: '1.25rem' }}>
      <CardHeader title={`All job listings${totalJobs ? ` — ${totalJobs.toLocaleString()} total` : ''}`} />
      <div style={{ marginBottom: '.75rem' }}>
        <input
          type="text"
          placeholder="Filter by company…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box',
            fontFamily: 'var(--mono)', fontSize: '.62rem',
            padding: '.35rem .6rem', borderRadius: 6,
            border: '1px solid var(--line2)', background: 'var(--bg2)',
            color: 'var(--white)', outline: 'none',
          }}
        />
      </div>
      {loading && <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--dim)' }}>Loading…</div>}
      {!loading && error && <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--red)' }}>✗ {error}</div>}
      {!loading && !error && filtered.length === 0 && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--dim)' }}>No companies match.</div>
      )}
      {!loading && !error && visible.map(g => {
        const isOpen = expanded === g.company
        const jobs = companyJobs[g.company] || []
        const isLoadingJobs = companyLoading === g.company
        return (
          <div key={g.company} style={{ borderBottom: '1px solid var(--line2)' }}>
            <div
              onClick={() => toggleCompany(g.company)}
              style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.45rem 0', cursor: 'pointer' }}
            >
              <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--sub)', width: '.8rem', flexShrink: 0 }}>
                {isOpen ? '▾' : '▸'}
              </span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--white)', flex: 1 }}>{g.company}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)', flexShrink: 0 }}>
                {g.total} total · <span style={{ color: g.active > 0 ? 'var(--green)' : 'var(--dim)' }}>{g.active} active</span>
              </span>
            </div>
            {isOpen && (
              <div style={{ paddingLeft: '1.4rem', paddingBottom: '.5rem' }}>
                {isLoadingJobs && <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)' }}>Loading…</div>}
                {!isLoadingJobs && jobs.length === 0 && <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)' }}>No listings found.</div>}
                {!isLoadingJobs && jobs.map(j => {
                  const avail = j.availability_status || 'active'
                  return (
                    <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.3rem 0', borderBottom: '1px solid var(--line2)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {j.title || '—'}
                        </div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--dim)', marginTop: '.08rem' }}>
                          {j.city || '—'} · <span style={{ color: availColor(avail) }}>{avail}</span> · {relTime(j.created_at)}
                        </div>
                      </div>
                      {j.apply_url && (
                        <a href={j.apply_url} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--blue)', textDecoration: 'none', flexShrink: 0 }}>↗</a>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
      {!loading && !error && !search.trim() && filtered.length > COLLAPSED_COUNT && (
        <button
          onClick={() => setShowAll(v => !v)}
          style={{ marginTop: '.6rem', fontFamily: 'var(--mono)', fontSize: '.58rem', padding: '.4rem .8rem', borderRadius: 6, border: '1px solid var(--line2)', background: 'transparent', color: 'var(--sub)', cursor: 'pointer', width: '100%' }}
        >
          {showAll ? `▴ Show less` : `▾ Show all ${filtered.length} companies`}
        </button>
      )}
    </Card>
  )
}

const DEPLOY_HOOK_KEY = 'seen_deploy_hook_url'

function DeployPanel() {
  const [hookUrl, setHookUrl] = useState('')
  const [saved, setSaved] = useState('')
  const [input, setInput] = useState('')
  const [deploying, setDeploying] = useState(false)
  const [status, setStatus] = useState<{ text: string; color: string } | null>(null)
  const [showInput, setShowInput] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(DEPLOY_HOOK_KEY) || ''
    setSaved(stored)
    setHookUrl(stored)
  }, [])

  function saveHook() {
    const url = input.trim()
    if (!url.startsWith('https://')) { setStatus({ text: 'Paste the full Vercel deploy hook URL', color: 'var(--red)' }); return }
    localStorage.setItem(DEPLOY_HOOK_KEY, url)
    setSaved(url)
    setHookUrl(url)
    setInput('')
    setShowInput(false)
    setStatus({ text: '✓ Deploy hook saved', color: 'var(--green)' })
    setTimeout(() => setStatus(null), 3000)
  }

  async function deploy() {
    if (!hookUrl) { setShowInput(true); return }
    setDeploying(true)
    setStatus({ text: 'Triggering deploy…', color: 'var(--dim)' })
    try {
      await fetch(hookUrl, { method: 'POST' })
      setStatus({ text: '✓ Deploy triggered — Vercel is building next-migration now', color: 'var(--green)' })
    } catch {
      setStatus({ text: '✗ Failed to reach Vercel. Check the hook URL.', color: 'var(--red)' })
    }
    setDeploying(false)
  }

  const masked = saved ? saved.slice(0, 40) + '…' : ''

  return (
    <Card style={{ marginBottom: '1.25rem', border: '1px solid rgba(99,102,241,.25)' }}>
      <CardHeader
        title="Deploy to production"
        action={
          saved ? (
            <button
              onClick={() => { setShowInput(s => !s); setStatus(null) }}
              style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', padding: '.25rem .6rem', borderRadius: 5, border: '1px solid var(--line2)', background: 'transparent', color: 'var(--dim)', cursor: 'pointer' }}
            >
              {showInput ? 'Cancel' : 'Change hook'}
            </button>
          ) : undefined
        }
      />

      {(!saved || showInput) && (
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--sub)', lineHeight: 1.65, marginBottom: '.65rem' }}>
            In Vercel → Seen project → Settings → find <span style={{ color: 'var(--white)' }}>Deploy Hooks</span> → create one for branch <span style={{ color: 'var(--blue)' }}>next-migration</span> → paste the URL below.
          </div>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="https://api.vercel.com/v1/integrations/deploy/…"
              style={{ flex: 1, minWidth: 200, background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 7, padding: '.42rem .65rem', fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--white)', outline: 'none' }}
            />
            <button
              onClick={saveHook}
              disabled={!input.trim()}
              style={{ background: 'rgba(99,102,241,.15)', border: '1px solid rgba(99,102,241,.35)', borderRadius: 7, padding: '.42rem .9rem', fontFamily: 'var(--mono)', fontSize: '.6rem', color: '#a5b4fc', cursor: 'pointer', flexShrink: 0 }}
            >
              Save →
            </button>
          </div>
        </div>
      )}

      {saved && !showInput && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--dim)', marginBottom: '.85rem' }}>
          Hook: {masked}
        </div>
      )}

      <button
        onClick={deploy}
        disabled={deploying}
        style={{
          width: '100%',
          background: saved ? 'linear-gradient(135deg,rgba(99,102,241,.2),rgba(16,185,129,.15))' : 'var(--raised)',
          border: `1px solid ${saved ? 'rgba(99,102,241,.4)' : 'var(--line2)'}`,
          borderRadius: 9, padding: '.85rem 1.25rem',
          fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.95rem',
          color: saved ? '#a5b4fc' : 'var(--sub)',
          cursor: deploying ? 'not-allowed' : 'pointer', opacity: deploying ? 0.7 : 1,
          letterSpacing: '-.01em', textAlign: 'left' as const,
        }}
      >
        {deploying ? '⏳ Deploying…' : saved ? '🚀 Deploy latest Claude changes →' : '⚙ Paste deploy hook URL above to enable'}
        {saved && !deploying && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', fontWeight: 400, color: 'rgba(165,180,252,.55)', marginTop: '.2rem' }}>
            Pushes all Claude commits live in ~1 min
          </div>
        )}
      </button>

      {status && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: status.color, marginTop: '.65rem' }}>{status.text}</div>
      )}
    </Card>
  )
}
