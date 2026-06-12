'use client'

import { useState, useEffect } from 'react'

interface AdminStats {
  users: { total: number; new_today: number; new_this_week: number }
  companies: { with_scores: number }
  reports: {
    total: number; today: number; this_week: number
    chart: { date: string; count: number }[]
    top_companies: { company: string; count: number }[]
    outcome_breakdown: { ghosted: number; rejected: number; interview: number; offer: number; waiting: number }
  }
  applications: { total: number; ghosted_30d: number; hired_30d: number; ghost_rate_pct: number }
  company_lookups?: { ready: boolean; today: number; top: { company: string; count: number }[] }
  generated_at: string
}

function StatBox({ n, label, highlight }: { n: string | number; label: string; highlight?: boolean }) {
  return (
    <div style={{ background: 'var(--card)', border: `1px solid ${highlight ? 'var(--blue)' : 'var(--line)'}`, borderRadius: 10, padding: '1.1rem', textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '1.55rem', fontWeight: 500, color: highlight ? 'var(--blue)' : 'var(--white)', lineHeight: 1 }}>{n}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)', marginTop: '.3rem' }}>{label}</div>
    </div>
  )
}

function BarChart({ items, max }: { items: { label: string; value: number }[]; max: number }) {
  return (
    <div>
      {items.map(item => (
        <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '.4rem' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)', width: 120, flexShrink: 0, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{item.label}</span>
          <div style={{ flex: 1, height: 5, background: 'var(--line2)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${max > 0 ? (item.value / max) * 100 : 0}%`, height: '100%', background: 'var(--blue)', borderRadius: 3 }} />
          </div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--sub)', width: 32, textAlign: 'right', flexShrink: 0 }}>{item.value}</span>
        </div>
      ))}
    </div>
  )
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

  useEffect(() => {
    const stored = sessionStorage.getItem(TOKEN_KEY)
    if (stored) {
      setToken(stored)
    } else {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (token) load(token)
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load(t: string) {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin-stats', {
        headers: { 'X-Admin-Token': t },
      })
      if (res.status === 401) {
        sessionStorage.removeItem(TOKEN_KEY)
        setToken(null)
        setLoading(false)
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as AdminStats
      setStats(data)
    } catch (e) {
      setError((e as Error).message)
    }
    setLoading(false)
  }

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

  function logout() {
    sessionStorage.removeItem(TOKEN_KEY)
    setToken(null)
    setStats(null)
  }

  if (!token) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <form onSubmit={login} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '2rem', width: 320 }}>
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

  return (
    <div style={{ minHeight: '100vh' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '2.5rem 2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.22em', color: 'var(--green)', marginBottom: '.3rem' }}>
              Admin · Data flywheel
            </div>
            <h1 style={{ fontFamily: 'var(--display)', fontSize: '1.75rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em' }}>
              Platform metrics
            </h1>
          </div>
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)' }}>
              {new Date(stats.generated_at).toLocaleTimeString()}
            </span>
            <button onClick={() => token && load(token)} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 6, padding: '.4rem .85rem', fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--sub)', cursor: 'pointer' }}>
              ↻ Refresh
            </button>
            <button onClick={logout} style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 6, padding: '.4rem .85rem', fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--muted)', cursor: 'pointer' }}>
              Sign out
            </button>
          </div>
        </div>

        {/* Users */}
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--dim)', marginBottom: '.65rem' }}>Users</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '.75rem', marginBottom: '2rem' }}>
          <StatBox n={stats.users.total.toLocaleString()} label="Total accounts" highlight />
          <StatBox n={stats.users.new_today} label="New today" />
          <StatBox n={stats.users.new_this_week} label="New this week" />
          <StatBox n={stats.companies.with_scores} label="Companies scored" />
        </div>

        {/* Reports */}
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--dim)', marginBottom: '.65rem' }}>Community data</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '.75rem', marginBottom: '2rem' }}>
          <StatBox n={stats.reports.total.toLocaleString()} label="Total reports" highlight />
          <StatBox n={stats.reports.today} label="Reports today" />
          <StatBox n={stats.reports.this_week} label="Reports this week" />
          <StatBox n={`${stats.applications.ghost_rate_pct}%`} label="Ghost rate (30d)" />
        </div>

        {/* Applications */}
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--dim)', marginBottom: '.65rem' }}>Application tracking</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '.75rem', marginBottom: '2rem' }}>
          <StatBox n={stats.applications.total.toLocaleString()} label="Apps tracked" />
          <StatBox n={stats.applications.ghosted_30d} label="Ghosted (30d)" />
          <StatBox n={stats.applications.hired_30d} label="Hired (30d)" />
          <StatBox n={stats.company_lookups?.today ?? 0} label="Co. lookups today" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '2rem' }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '1.25rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--dim)', marginBottom: '1rem' }}>Reports submitted (30d)</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 80 }}>
              {(stats.reports.chart || []).map(d => (
                <div key={d.date} style={{ flex: 1, background: 'var(--blue)', opacity: 0.7, borderRadius: '2px 2px 0 0', height: `${chartMax > 0 ? (d.count / chartMax) * 100 : 0}%`, minHeight: d.count > 0 ? 2 : 0, transition: 'height .3s' }} title={`${d.date}: ${d.count}`} />
              ))}
            </div>
          </div>

          <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '1.25rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--dim)', marginBottom: '1rem' }}>Outcome breakdown (30d)</div>
            {[
              { label: '👻 Ghosted', value: stats.reports.outcome_breakdown?.ghosted ?? 0, color: 'var(--red)' },
              { label: '🤖 Rejected', value: stats.reports.outcome_breakdown?.rejected ?? 0, color: 'var(--amber)' },
              { label: '💬 Interview', value: stats.reports.outcome_breakdown?.interview ?? 0, color: 'var(--blue)' },
              { label: '✅ Offer', value: stats.reports.outcome_breakdown?.offer ?? 0, color: 'var(--green)' },
            ].map(item => {
              const total = Object.values(stats.reports.outcome_breakdown ?? {}).reduce((a: number, b) => a + (b as number), 0)
              const pct = total > 0 ? Math.round((item.value / total) * 100) : 0
              return (
                <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '.5rem' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)', width: 90, flexShrink: 0 }}>{item.label}</span>
                  <div style={{ flex: 1, height: 5, background: 'var(--line2)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: item.color, borderRadius: 3 }} />
                  </div>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--sub)', width: 40, textAlign: 'right', flexShrink: 0 }}>{item.value} ({pct}%)</span>
                </div>
              )
            })}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '1.25rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--dim)', marginBottom: '1rem' }}>Most reported companies (30d)</div>
            <BarChart
              items={(stats.reports.top_companies || []).slice(0, 8).map(c => ({ label: c.company, value: c.count }))}
              max={topReportedMax}
            />
          </div>

          <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '1.25rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--dim)', marginBottom: '1rem' }}>Most researched companies (7d)</div>
            <BarChart
              items={(stats.company_lookups?.top || []).slice(0, 8).map(c => ({ label: c.company, value: c.count }))}
              max={topLookupMax}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
