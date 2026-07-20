'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth'

// Employer posting analytics — the login-scoped CLIENT view for the hub's Analytics tab.
//
// The original /employers/analytics page is a server component that scopes by ?company= and reads
// with the service key. Inside the client hub we can't do a server read, so this component calls the
// auth-scoped endpoint POST /api/employer-analytics (Bearer JWT + approved-claim gate, mirrors
// api/employer-listings). The company is resolved server-side from the caller's approved claim —
// never a request param — so an employer only ever sees their own company's analytics (which is
// public-aggregate anyway: outcomes, no PII). The PRESENTATION is ported verbatim from the server
// page: headline tiles, monthly volume bars, sources / provenance / outcome breakdown tables, and
// the per-role table. States handled: loading, 401 (sign in), 403 no_approved_claim (pending),
// hasData=false (clean empty slate), and load error.

type Breakdown = { key: string; count: number; pct: number }
type OutcomeRow = { label: string; count: number; pct: number }
type MonthRow = { month: string; count: number }
type RoleRow = { role: string; count: number; responded: number; ghosted: number; respondedPct: number; ghostedPct: number }

type Headline = {
  overallScore: number | null
  grade: string | null
  ghostRate: number | null
  responseRate: number | null
  ghostPct: number | null
  responsePct: number | null
  avgWaitDays: number | null
  reportCount: number
  dataQuality: string
  ratesComputedLive: boolean
  ratesWithheld: boolean
  rateFloor: number
}

type Analytics = {
  hasData: boolean
  reportCount: number
  headline: Headline
  responseSummary: {
    total: number; responded: number; ghosted: number; rejected: number; pending: number
    respondedPct: number; ghostedPct: number; rejectedPct: number; pendingPct: number
  }
  outcomeBreakdown: OutcomeRow[]
  sources: Breakdown[]
  provenance: Breakdown[]
  monthly: MonthRow[]
  roles: RoleRow[]
  roleCount: number
}

type Loaded = {
  ok: true
  company: string
  industry: string | null
  verified: boolean
  analytics: Analytics
}

const mono = (size: string, color: string): React.CSSProperties => ({ fontFamily: 'var(--mono)', fontSize: size, color })
const card: React.CSSProperties = { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16, padding: '1.6rem 1.7rem', marginBottom: '1.4rem' }
const kicker: React.CSSProperties = { fontFamily: 'var(--mono)', fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.16em', color: 'var(--blue)', marginBottom: '.55rem' }
const h2: React.CSSProperties = { fontFamily: 'var(--display)', fontSize: '1.15rem', fontWeight: 800, color: 'var(--white)', margin: '0 0 .2rem', letterSpacing: '-.02em' }
const sub: React.CSSProperties = { color: 'var(--sub)', fontSize: '.78rem', lineHeight: 1.6, margin: '.15rem 0 1.1rem' }

const fmtPct = (v: number | null | undefined) => (v == null ? '—' : `${Number.isInteger(v) ? v : v.toFixed(1)}%`)
const gradeColor = (g: string | null) => (g === 'A' || g === 'B' ? 'var(--green)' : g === 'C' ? 'var(--amber)' : 'var(--red)')
const monthLabel = (m: string) => {
  const [y, mm] = m.split('-')
  const d = new Date(Date.UTC(Number(y), Number(mm) - 1, 1))
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
}

function Bar({ pct, color = 'var(--blue)' }: { pct: number; color?: string }) {
  return (
    <div style={{ height: 8, background: 'var(--raised)', borderRadius: 999, overflow: 'hidden', minWidth: 60 }}>
      <div style={{ width: `${Math.max(2, Math.min(100, pct))}%`, height: '100%', background: color, borderRadius: 999 }} />
    </div>
  )
}

function BreakdownTable({ rows, color = 'var(--blue)' }: { rows: { key: string; count: number; pct: number }[]; color?: string }) {
  const max = Math.max(...rows.map(r => r.count), 1)
  return (
    <div style={{ display: 'grid', gap: '.6rem' }}>
      {rows.map(r => (
        <div key={r.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px,1.4fr) 2fr auto', gap: '.8rem', alignItems: 'center' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.key}</span>
          <Bar pct={(r.count / max) * 100} color={color} />
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.66rem', color: 'var(--dim)', whiteSpace: 'nowrap' }}>{r.count.toLocaleString()} · {fmtPct(r.pct)}</span>
        </div>
      ))}
    </div>
  )
}

function StatTile({ value, label, color = 'var(--white)', note }: { value: string; label: string; color?: string; note?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem', minWidth: 90 }}>
      <div style={{ fontFamily: 'var(--display)', fontSize: '1.7rem', fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{label}</div>
      {note ? <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)' }}>{note}</div> : null}
    </div>
  )
}

// A neutral message card — used for every non-data state so the tab is never blank.
function StateCard({ title, children, cta }: { title: string; children: React.ReactNode; cta?: React.ReactNode }) {
  return (
    <div style={card}>
      <div style={{ fontFamily: 'var(--display)', fontSize: '1.05rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.4rem' }}>{title}</div>
      <p style={{ color: 'var(--sub)', fontSize: '.8rem', lineHeight: 1.7, maxWidth: 540, margin: cta ? '0 0 1rem' : 0 }}>{children}</p>
      {cta}
    </div>
  )
}

export function EmployerAnalyticsView() {
  const { ready, isLoggedIn, isEmployer, claimsReady, token } = useAuth()

  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<'ok' | 'anon' | 'pending' | 'error'>('ok')
  const [data, setData] = useState<Loaded | null>(null)

  const load = useCallback(async () => {
    try {
      const authToken = await token()
      if (!authToken) { setStatus('anon'); setLoading(false); return }
      const r = await fetch('/api/employer-analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ action: 'analytics' }),
      })
      if (r.status === 401) { setStatus('anon'); setLoading(false); return }
      if (r.status === 403) {
        const d = await r.json().catch(() => ({}))
        if (d?.reason === 'no_approved_claim') { setStatus('pending'); setLoading(false); return }
        setStatus('error'); setLoading(false); return
      }
      const d = await r.json().catch(() => null)
      if (!r.ok || !d?.ok || !d?.analytics) { setStatus('error'); setLoading(false); return }
      setData(d as Loaded)
      setStatus('ok')
    } catch {
      setStatus('error')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (!ready || !claimsReady) return
    if (!isLoggedIn || !isEmployer) { setStatus('anon'); setLoading(false); return }
    load()
  }, [ready, claimsReady, isLoggedIn, isEmployer, load])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '20vh' }}>
        <div className="spinner" />
      </div>
    )
  }

  if (status === 'anon') {
    return (
      <StateCard
        title="Sign in to see your posting analytics"
        cta={<Link href="/employers" style={ctaStyle}>Go to the employer portal →</Link>}
      >
        Analytics are login-scoped to your approved company claim. Sign in as an employer to see your applicant sources, application volume over time, and response outcomes — all from real applicant-reported data.
      </StateCard>
    )
  }

  if (status === 'pending') {
    return (
      <StateCard
        title="Your company claim is pending approval"
        cta={<Link href="/employers" style={ctaStyle}>Check your claim status →</Link>}
      >
        Analytics unlock once an admin approves your company claim (migration 053). Until then, this is the same public applicant-outcome record that builds your reputation — nothing here is hidden, it just needs your claim approved to scope it to you.
      </StateCard>
    )
  }

  if (status === 'error' || !data) {
    return (
      <StateCard title="Couldn’t load analytics right now.">
        The applicant-outcome data source is temporarily unavailable. Try switching tabs and back, or refresh in a moment.
      </StateCard>
    )
  }

  const { analytics, industry, verified } = data
  const resolvedCompany = data.company
  const h = analytics.headline
  const rs = analytics.responseSummary

  // Matched by name, but no applicant reports on record — an honest clean slate.
  if (!analytics.hasData) {
    return (
      <StateCard
        title={`No applicant reports for “${resolvedCompany}” yet.`}
        cta={<Link href="/employers" style={ctaStyle}>See your reputation →</Link>}
      >
        Nothing to chart yet — which is a clean slate, not a bad sign. As candidates report how your postings went, their sources, volume, and response outcomes will appear here. This is the same record that builds your public reputation, so there are no numbers to show until the first real report lands.
      </StateCard>
    )
  }

  const maxMonth = Math.max(...analytics.monthly.map(m => m.count), 1)

  return (
    <div>
      {/* Identity + headline reputation (what candidates see) */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem', marginBottom: '1.2rem' }}>
          <div>
            <div style={kicker}>Reporting on</div>
            <div style={{ fontFamily: 'var(--display)', fontSize: '1.35rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.02em', textTransform: 'capitalize' }}>
              {resolvedCompany}
              {verified ? <span style={{ ...mono('.55rem', 'var(--green)'), marginLeft: '.6rem', textTransform: 'uppercase', letterSpacing: '.1em' }}>✓ Verified</span> : null}
            </div>
            {industry ? <div style={mono('.6rem', 'var(--dim)')}>{industry}</div> : null}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: 78, height: 78, borderRadius: 999, border: `4px solid ${gradeColor(h.grade)}`, flexShrink: 0 }}>
            {h.grade ? (
              <>
                <div style={{ fontFamily: 'var(--display)', fontSize: '2rem', fontWeight: 800, color: gradeColor(h.grade), lineHeight: 1 }}>{h.grade}</div>
                <div style={mono('.5rem', 'var(--dim)')}>{h.overallScore}/100</div>
              </>
            ) : (
              <div style={{ ...mono('.5rem', 'var(--dim)'), textAlign: 'center', padding: '0 .3rem' }}>grade<br />pending</div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '1.8rem', flexWrap: 'wrap', paddingTop: '1.2rem', borderTop: '1px solid var(--line)' }}>
          <StatTile value={h.reportCount.toLocaleString()} label="applicant reports" />
          <StatTile value={fmtPct(h.ghostPct)} label="ghost rate" color="var(--red)" note={h.ratesComputedLive ? 'from reports' : undefined} />
          <StatTile value={fmtPct(h.responsePct)} label="response rate" color="var(--green)" note={h.ratesComputedLive ? 'from reports' : undefined} />
          <StatTile value={h.avgWaitDays == null ? '—' : `${h.avgWaitDays}d`} label="avg reported wait" color="var(--amber)" />
          <StatTile value={String(analytics.roleCount)} label="roles reported" />
        </div>
        {h.ratesWithheld ? (
          <p style={{ ...mono('.58rem', 'var(--muted)'), marginTop: '1rem', lineHeight: 1.6 }}>
            Ghost / response rates need at least {h.rateFloor} reports before we’ll show a percentage — below that,
            a rate would be noise. The raw outcomes are broken out below.
          </p>
        ) : null}
      </div>

      {/* Application volume over time */}
      <div style={card}>
        <div style={kicker}>Application volume over time</div>
        <h2 style={h2}>When applicants reported applying</h2>
        <p style={sub}>
          Count of applicant reports per month. This is real reported volume — Seen doesn’t host your
          postings or track impressions, so there’s no applications-per-view rate to show, and we don’t invent one.
        </p>
        <div style={{ display: 'grid', gap: '.5rem' }}>
          {analytics.monthly.map(m => (
            <div key={m.month} style={{ display: 'grid', gridTemplateColumns: '52px 1fr auto', gap: '.8rem', alignItems: 'center' }}>
              <span style={mono('.62rem', 'var(--dim)')}>{monthLabel(m.month)}</span>
              <Bar pct={(m.count / maxMonth) * 100} color="var(--blue)" />
              <span style={mono('.64rem', 'var(--sub)')}>{m.count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Applicant sources */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: '1.4rem' }}>
        <div style={card}>
          <div style={kicker}>Applicant sources</div>
          <h2 style={h2}>Where applicants applied</h2>
          <p style={sub}>The platform each reported applicant applied through.</p>
          <BreakdownTable rows={analytics.sources} color="var(--blue)" />
        </div>
        <div style={card}>
          <div style={kicker}>Report provenance</div>
          <h2 style={h2}>How each outcome reached Seen</h2>
          <p style={sub}>Whether the outcome was reported directly or gathered from public applicant discussion.</p>
          <BreakdownTable rows={analytics.provenance} color="var(--purple)" />
        </div>
      </div>

      {/* Response outcomes */}
      <div style={card}>
        <div style={kicker}>Application outcomes</div>
        <h2 style={h2}>What happened after applicants applied</h2>
        <p style={sub}>
          The raw split of every reported outcome. Responded = interview, offer, hired, or a human reply; ghosted =
          no response at all; rejected = auto- or human rejection; pending = still awaiting a reply. The headline
          ghost / response rates above use the same trust-weighted computation as your public grade, so they can
          differ from this raw count.
        </p>
        <div style={{ display: 'flex', gap: '1.8rem', flexWrap: 'wrap', marginBottom: '1.3rem' }}>
          <StatTile value={rs.responded.toLocaleString()} label={`responded · ${fmtPct(rs.respondedPct)}`} color="var(--green)" />
          <StatTile value={rs.ghosted.toLocaleString()} label={`ghosted · ${fmtPct(rs.ghostedPct)}`} color="var(--red)" />
          <StatTile value={rs.rejected.toLocaleString()} label={`rejected · ${fmtPct(rs.rejectedPct)}`} color="var(--amber)" />
          <StatTile value={rs.pending.toLocaleString()} label={`pending · ${fmtPct(rs.pendingPct)}`} color="var(--dim)" />
        </div>
        <BreakdownTable rows={analytics.outcomeBreakdown.map(o => ({ key: o.label, count: o.count, pct: o.pct }))} color="var(--sub)" />
      </div>

      {/* Per-role breakdown */}
      <div style={card}>
        <div style={kicker}>Per-role breakdown</div>
        <h2 style={h2}>Performance by role</h2>
        <p style={sub}>
          Seen doesn’t host individual postings, so role is the finest posting-level cut the data supports —
          the honest stand-in for per-posting performance.
        </p>
        <div style={{ display: 'grid', gap: '.7rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px,2fr) 1fr 1fr 1fr', gap: '.6rem', paddingBottom: '.4rem', borderBottom: '1px solid var(--line)' }}>
            {['Role', 'Reports', 'Responded', 'Ghosted'].map((t, i) => (
              <span key={t} style={{ ...mono('.55rem', 'var(--dim)'), textTransform: 'uppercase', letterSpacing: '.08em', textAlign: i === 0 ? 'left' : 'right' }}>{t}</span>
            ))}
          </div>
          {analytics.roles.map(r => (
            <div key={r.role} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px,2fr) 1fr 1fr 1fr', gap: '.6rem', alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.role}</span>
              <span style={{ ...mono('.66rem', 'var(--sub)'), textAlign: 'right' }}>{r.count.toLocaleString()}</span>
              <span style={{ ...mono('.66rem', 'var(--green)'), textAlign: 'right' }}>{r.responded} · {fmtPct(r.respondedPct)}</span>
              <span style={{ ...mono('.66rem', 'var(--red)'), textAlign: 'right' }}>{r.ghosted} · {fmtPct(r.ghostedPct)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Methodology / honesty note */}
      <p style={{ ...mono('.56rem', 'var(--muted)'), lineHeight: 1.7, marginTop: '.4rem' }}>
        Methodology: numbers are computed from applicant-reported outcomes on record for this company (the same
        source as your public grade), excluding reports flagged for review. Seen aggregates listings from external
        sources and does not host employer postings or track views/impressions — so this page reports real applicant
        sources, volume, and response outcomes, never an impression-based conversion rate. Companies with no reports
        show no numbers, never fabricated ones.
      </p>
    </div>
  )
}

const ctaStyle: React.CSSProperties = {
  display: 'inline-block', background: 'linear-gradient(135deg,#1d4ed8,#7c3aed)', border: 'none', borderRadius: 8,
  padding: '.55rem 1.1rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.78rem', color: '#fff', textDecoration: 'none',
}
