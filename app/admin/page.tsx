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
  jobs: { active: number; new_today: number; added_today: number; stale_or_expired: number; inactive_reports: InactiveReport[] }
  errors: { today: number; this_week: number; by_route: Record<string, number>; recent: { endpoint: string; error_msg: string; created_at: string }[] }
  issues: { open: number; items: Issue[] }
  duplicate_clusters: { suspected: number; items: DupCluster[] }
  feature_flags: FeatureFlag[]
  credits: { total_users: number; pro_users: number }
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
  id: string; company: string; title: string; city: string; url: string
  apply_url: string; created_at: string; availability_status: string; source: string
}
interface DupCompany { id: string; name: string; report_count: number; overall_score: number }
interface DupGroup { key: string; companies: DupCompany[] }
interface MergePrefill { primary: string; secondary: string; nonce: number }
interface FeatureFlag {
  flag_name: string; status: string; percentage: number | null; description: string
}

function KpiCard({ l, n, sub, borderColor, numColor }: { l: string; n: string | number; sub?: string; borderColor?: string; numColor?: string }) {
  return (
    <div className="adm-kpi" style={borderColor ? { borderLeft: `2px solid ${borderColor}` } : undefined}>
      <div className="adm-kpi-l">{l}</div>
      <div className="adm-kpi-n" style={{ fontSize: 'clamp(.85rem, 4vw, 1.8rem)', ...(numColor ? { color: numColor } : {}) }}>{n}</div>
      {sub && <div className="adm-kpi-sub">{sub}</div>}
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

const TOKEN_KEY = 'admin_token'

export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loggingIn, setLoggingIn] = useState(false)
  const [mergePrefill, setMergePrefill] = useState<MergePrefill | null>(null)

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

  return (
    <div className="page-full" style={{ background: 'radial-gradient(ellipse at 10% 0%,rgba(29,78,216,0.1) 0%,transparent 50%),radial-gradient(ellipse at 90% 10%,rgba(124,58,237,0.07) 0%,transparent 45%)' }}>
      <div className="adm-wrap">

        {/* Header */}
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.22em', color: 'var(--green)', marginBottom: '.65rem', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 22, height: 1, background: 'var(--green)', display: 'inline-block', flexShrink: 0 }} />
          Seen Admin
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.75rem', marginBottom: '1.5rem' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--display)', fontSize: 'clamp(1.35rem, 6vw, 2rem)', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.04em', lineHeight: 1.05, marginBottom: '.25rem' }}>Data flywheel</h1>
            <p style={{ fontSize: '.8rem', color: 'var(--sub)', fontWeight: 300 }}>Last updated just now</p>
          </div>
          <div style={{ display: 'flex', gap: '.5rem', flexShrink: 0, flexWrap: 'wrap' }}>
            <button onClick={() => token && load(token)} className="adm-btn" style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 8, padding: '.5rem 1rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--sub)', cursor: 'pointer', transition: 'all .15s' }}>↻ Refresh</button>
            <button onClick={logout} className="adm-btn-danger" style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 8, padding: '.5rem 1rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--dim)', cursor: 'pointer', transition: 'all .15s' }}>Sign out</button>
          </div>
        </div>

        {/* Users KPIs */}
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--dim)', marginBottom: '.4rem' }}>Users</div>
        <div className="adm-kpi-row" style={{ marginBottom: '1.25rem' }}>
          <KpiCard l="Total accounts" n={stats.users.total.toLocaleString()} sub="all time" />
          <KpiCard l="New today" n={stats.users.new_today} sub="last 24h" />
          <KpiCard l="New this week" n={stats.users.new_this_week} sub="last 7 days" />
          <KpiCard l="Companies scored" n={stats.companies.with_scores} sub="with AI scores" />
        </div>

        {/* Community KPIs */}
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--dim)', marginBottom: '.4rem' }}>Community data</div>
        <div className="adm-kpi-row" style={{ marginBottom: '1.25rem' }}>
          <KpiCard l="Total reports" n={stats.reports.total.toLocaleString()} sub="all time" borderColor="var(--green)" numColor="var(--green)" />
          <KpiCard l="Reports today" n={stats.reports.today} sub="last 24h" />
          <KpiCard l="Reports this week" n={stats.reports.this_week} sub="last 7 days" />
          <KpiCard l="Ghost rate (30d)" n={stats.applications.ghost_rate_pct != null ? `${stats.applications.ghost_rate_pct}%` : '—'} sub="of tracked apps" borderColor="var(--red)" numColor="var(--red)" />
        </div>

        {/* Application tracking KPIs */}
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--dim)', marginBottom: '.4rem' }}>Application tracking</div>
        <div className="adm-kpi-row" style={{ marginBottom: '1.5rem' }}>
          <KpiCard l="Apps tracked total" n={stats.applications.total.toLocaleString()} sub="across all users" />
          <KpiCard l="Ghosted (30d)" n={stats.applications.ghosted_30d} sub="tracked as ghosted" numColor="var(--amber)" />
          <KpiCard l="Hired (30d)" n={stats.applications.hired_30d} sub="tracked as hired" numColor="var(--green)" />
          <KpiCard l="Co. lookups today" n={stats.company_lookups?.ready ? stats.company_lookups.today : '—'} sub="company pages viewed" />
        </div>

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

        {/* Jobs KPIs */}
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--dim)', marginBottom: '.4rem' }}>Jobs</div>
        <div className="adm-kpi-row" style={{ marginBottom: '1.5rem' }}>
          <KpiCard l="Active listings" n={(stats.jobs?.active ?? 0).toLocaleString()} sub="live jobs users see" borderColor="var(--blue)" numColor="var(--blue)" />
          <KpiCard l="New today" n={stats.jobs?.new_today ?? 0} sub="never-seen-before jobs" borderColor="var(--green)" numColor="var(--green)" />
        </div>

        {/* Reports chart */}
        <div className="adm-panel" style={{ marginBottom: '.65rem' }}>
          <div className="adm-panel-hdr">
            Reports submitted — last 30 days
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--dim)' }}>one bar = one day</span>
          </div>
          <div style={{ padding: '.85rem 1rem .6rem' }}>
            <div className="adm-chart-row">
              {(stats.reports.chart || []).map(d => (
                <div
                  key={d.date}
                  className="adm-chart-bar"
                  style={{ height: `${chartMax > 0 ? (d.count / chartMax) * 100 : 0}%` }}
                  title={`${d.date}: ${d.count}`}
                />
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.65rem', marginBottom: '.65rem' }}>
          <div className="adm-panel">
            <div className="adm-panel-hdr">Most reported companies <span style={{ color: 'var(--dim)', fontWeight: 400 }}>(30d)</span></div>
            <BarChart
              items={(stats.reports.top_companies || []).slice(0, 8).map(c => ({ label: c.company, value: c.count }))}
              max={topReportedMax}
            />
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

        {/* Recent hiring reports */}
        <Card style={{ marginTop: '.65rem' }}>
          <CardHeader
            title="Recent hiring reports (last 25)"
            badge={needsReviewCount > 0 ? <Badge n={needsReviewCount} /> : undefined}
          />
          {(stats.reports.recent || []).length === 0
            ? <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--dim)' }}>No reports yet</div>
            : (stats.reports.recent || []).map(r => (
              <ReportRow key={r.id} report={r} token={token!} onRefresh={() => load(token!)} />
            ))
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
        <RecentJobsBrowser token={token!} onUnauthorized={() => { sessionStorage.removeItem(TOKEN_KEY); setToken(null); setStats(null); setLoginError('Session expired') }} />

        {/* Reported inactive listings */}
        <Card style={{ marginTop: '.65rem' }}>
          <CardHeader
            title="Reported inactive listings"
            badge={(stats.jobs?.inactive_reports || []).length > 0 ? <Badge n={stats.jobs.inactive_reports.length} color="var(--amber)" /> : undefined}
            action={<span style={{ fontFamily: 'var(--mono)', fontSize: '.48rem', color: 'var(--dim)' }}>User reports that a listing is no longer active</span>}
          />
          {(stats.jobs?.inactive_reports || []).length === 0
            ? <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--dim)' }}>No inactive reports this week</div>
            : (stats.jobs.inactive_reports || []).map(r => (
              <InactiveRow key={r.job_id} report={r} token={token!} />
            ))
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
              <IssueRow
                key={issue.id}
                issue={issue}
                token={token!}
                onRefresh={() => load(token!)}
                onOpenMerge={name => setMergePrefill({ primary: name, secondary: '', nonce: Date.now() })}
              />
            ))
          }
        </Card>

        {/* Company deduplication */}
        <MergePanel token={token!} prefill={mergePrefill} />

        {/* Feature flags */}
        <FlagsPanel flags={stats.feature_flags || []} token={token!} onRefresh={() => load(token!)} />

        {/* Duplicate account clusters */}
        <ClustersPanel
          clusters={stats.duplicate_clusters?.items || []}
          suspected={stats.duplicate_clusters?.suspected || 0}
          token={token!}
          onRefresh={() => load(token!)}
        />

        {/* API Health */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: '1.1rem', marginBottom: '1rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--dim)', marginBottom: '.85rem' }}>API Health (Today)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '.65rem', marginBottom: '.75rem' }}>
            <KpiCard l="Errors today" n={stats.errors?.today ?? 0} sub="last 24h" borderColor={stats.errors?.today > 10 ? 'var(--red)' : undefined} numColor={stats.errors?.today > 10 ? 'var(--red)' : undefined} />
            <KpiCard l="Errors this week" n={stats.errors?.this_week ?? 0} sub="last 7 days" />
            <KpiCard l="DAU" n={stats.users?.dau ?? 0} sub="active today" />
          </div>
          {stats.errors?.by_route && Object.keys(stats.errors.by_route).length > 0 && (
            <div style={{ marginBottom: '.75rem' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--dim)', marginBottom: '.4rem' }}>Errors by route</div>
              {Object.entries(stats.errors.by_route).sort((a, b) => b[1] - a[1]).map(([route, count]) => (
                <div key={route} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--sub)', padding: '.2rem 0' }}>
                  <span style={{ color: 'var(--dim)' }}>{route}</span>
                  <span style={{ color: 'var(--red)' }}>{count as number}</span>
                </div>
              ))}
            </div>
          )}
          {(stats.errors?.recent || []).length > 0 && (
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--dim)', marginBottom: '.4rem' }}>Recent</div>
              {stats.errors.recent.map((e, i) => (
                <div key={i} style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--muted)', padding: '.2rem 0', borderBottom: '1px solid var(--line2)' }}>
                  <span style={{ color: 'var(--dim)' }}>{relTime(e.created_at)}</span>
                  {' · '}
                  <span style={{ color: 'var(--sub)' }}>{e.endpoint}</span>
                  {' · '}
                  <span>{e.error_msg?.slice(0, 60)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Background job runner */}
        <JobRunner token={token!} />

      </div>
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
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.6rem' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: outcomeColor(r.outcome), background: outcomeColor(r.outcome) + '18', border: `1px solid ${outcomeColor(r.outcome)}30`, borderRadius: 4, padding: '.1rem .4rem', flexShrink: 0, marginTop: 1 }}>{r.outcome}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--white)' }}>{r.company_name} · {r.role}</div>
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
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.75rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {j.title || 'Unknown title'} · <span style={{ color: 'var(--sub)' }}>{j.company || 'Unknown company'}</span>
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)', marginTop: '.15rem' }}>
            {j.city || ''} · {r.report_count} report{r.report_count === 1 ? '' : 's'} · latest {relTime(r.latest_reported_at)}
          </div>
          {jobUrl && <a href={jobUrl} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--blue)', textDecoration: 'none', marginTop: '.2rem', display: 'inline-block' }}>↗ Verify listing →</a>}
        </div>
        <div style={{ display: 'flex', gap: '.45rem', flexShrink: 0, marginTop: '.1rem' }}>
          <button onClick={() => act('remove_listing')} disabled={acting} style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', padding: '.3rem .65rem', borderRadius: 6, border: '1px solid rgba(239,68,68,.4)', background: 'rgba(239,68,68,.08)', color: 'var(--red)', cursor: 'pointer' }}>Remove listing</button>
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

const FLAG_STATUS_LABELS: Record<string, string> = {
  off: 'Off', admin_only: 'Admin only', beta_users: 'Beta (20%)', percentage_rollout: '% rollout', fully_on: 'Live',
}
const FLAG_STATUS_COLORS: Record<string, string> = {
  off: 'var(--muted)', admin_only: 'var(--amber)', beta_users: 'var(--blue)', percentage_rollout: 'var(--indigo)', fully_on: 'var(--green)',
}
const FLAG_STATUSES = ['off', 'admin_only', 'beta_users', 'percentage_rollout', 'fully_on']

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
        : flags.map(f => {
          const status = effectiveStatus(f)
          return (
            <div key={f.flag_name} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.55rem 0', borderBottom: '1px solid var(--line2)', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 0, fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--white)', overflow: 'hidden' }}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.flag_name}</div>
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
        })
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '.65rem' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', fontWeight: 700, color: CLUSTER_COLORS[status] || 'var(--sub)' }}>Risk {c.risk_score}/100</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)' }}>{c.user_ids?.length || 0} accounts · {(c.signals || []).join(', ')}</span>
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

const PERIOD_LABELS: Record<string, string> = { today: 'today', week: 'this week', month: 'this month' }
function availColor(a: string) {
  if (a === 'active') return 'var(--green)'
  if (a === 'stale') return 'var(--amber)'
  if (a === 'expired') return 'var(--red)'
  if (a === 'removed') return 'var(--dim)'
  return 'var(--sub)'
}

function RecentJobsBrowser({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const [period, setPeriod] = useState<string | null>(null)
  const [jobs, setJobs] = useState<RecentJob[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function loadPeriod(p: string) {
    setPeriod(p)
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'get_recent_jobs', period: p }),
      })
      if (res.status === 401 || res.status === 403) { onUnauthorized(); return }
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || res.status)
      setJobs(d.jobs || [])
      setTotal(d.total ?? (d.jobs || []).length)
    } catch (e) {
      setError((e as Error).message)
    }
    setLoading(false)
  }

  const tabStyle = (p: string) => ({
    fontFamily: 'var(--mono)', fontSize: '.55rem', padding: '.28rem .65rem', borderRadius: 6,
    border: `1px solid ${period === p ? 'var(--blue)' : 'var(--line2)'}`,
    background: period === p ? 'rgba(59,130,246,.15)' : 'transparent',
    color: period === p ? 'var(--blue)' : 'var(--sub)', cursor: 'pointer',
  } as React.CSSProperties)

  return (
    <Card style={{ marginBottom: '1.25rem' }}>
      <CardHeader
        title={`New job listings${period ? ` — ${total} ${PERIOD_LABELS[period] || ''}` : ''}`}
        action={
          <div style={{ display: 'flex', gap: '.35rem' }}>
            <button onClick={() => loadPeriod('today')} style={tabStyle('today')}>Today</button>
            <button onClick={() => loadPeriod('week')} style={tabStyle('week')}>This Week</button>
            <button onClick={() => loadPeriod('month')} style={tabStyle('month')}>This Month</button>
          </div>
        }
      />
      {!period && <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--dim)' }}>Click a period above to load listings.</div>}
      {period && loading && <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--dim)' }}>Loading…</div>}
      {period && !loading && error && <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--red)' }}>✗ {error}</div>}
      {period && !loading && !error && jobs.length === 0 && <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--dim)' }}>No new listings for this period.</div>}
      {period && !loading && !error && jobs.map(j => {
        const url = j.apply_url || j.url || ''
        const avail = j.availability_status || 'active'
        return (
          <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.5rem 0', borderBottom: '1px solid var(--line2)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {j.title || '—'} · <span style={{ color: 'var(--sub)' }}>{j.company || '—'}</span>
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--dim)', marginTop: '.1rem' }}>
                {j.city || ''} · {j.source || '—'} · <span style={{ color: availColor(avail) }}>{avail}</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexShrink: 0 }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--dim)' }}>{relTime(j.created_at)}</span>
              {url && <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--blue)', textDecoration: 'none' }}>↗</a>}
            </div>
          </div>
        )
      })}
    </Card>
  )
}
