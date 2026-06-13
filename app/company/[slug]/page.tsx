'use client'

import { useState, useEffect, use } from 'react'
import { Score } from '@/lib/score'

// ── Types ──────────────────────────────────────────────────────────────────────

interface CompanyScore {
  overall_score: number
  response_rate: number
  ghost_rate: number
  avg_wait_days: number
  avg_rounds: number
  waste: number
  report_count: number
  risk_level: 'safe' | 'warn' | 'danger'
  process_score?: number
  data_quality?: string
  data_source?: string
  industry?: string
  summary?: string
  web_reviews?: WebReview[]
}

interface Report {
  id: string
  outcome: string
  rounds: number
  wait_days: number
  unpaid_work: string
  created_at: string
  report_text?: string
  ghost_stage?: string
  role?: string
  location?: string
  city?: string
  platform?: string
}

interface WebReview {
  text: string
  sentiment: 'positive' | 'negative' | 'mixed'
  source?: string
  year?: string
}

type TabKey = 'overview' | 'process' | 'reports' | 'locations' | 'roles' | 'reddit' | 'compare'

// ── Helpers ────────────────────────────────────────────────────────────────────

function letterGrade(score: number): string {
  if (score >= 80) return 'A'
  if (score >= 65) return 'B'
  if (score >= 50) return 'C'
  if (score >= 35) return 'D'
  return 'F'
}

function pct(n: number | null | undefined): string {
  if (n == null) return '—'
  return Math.round(n * 100) + '%'
}

function riskColor(risk: string): string {
  if (risk === 'safe') return 'var(--green)'
  if (risk === 'danger') return 'var(--red)'
  return 'var(--amber)'
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function MetBox({ label, value, alarm, color }: { label: string; value: string; alarm?: boolean; color?: string }) {
  return (
    <div className={`co-m${alarm ? ' co-alarm' : ''}`}>
      <span className="co-mn" style={color ? { color } : undefined}>{value}</span>
      <span className="co-ml">{label}</span>
    </div>
  )
}

function BarRow({ label, value, color }: { label: string; value: number; color: string }) {
  const clamped = Math.min(100, Math.max(0, value))
  return (
    <div className="mbar">
      <div className="mbar-lbl" style={{ width: 110 }}>{label}</div>
      <div className="mbar-track">
        <div className="mbar-fill" style={{ width: `${clamped}%`, background: color }} />
      </div>
      <div className="mbar-val">{Math.round(clamped)}%</div>
    </div>
  )
}

function DataQualityBadge({ dq, reportCount }: { dq: string; reportCount: number }) {
  const map: Record<string, { emoji: string; label: string; color: string }> = {
    strong:   { emoji: '🟢', label: `High · ${reportCount} reports`,      color: 'var(--green)' },
    moderate: { emoji: '🟡', label: `Moderate · ${reportCount} reports`,  color: 'var(--amber)' },
    limited:  { emoji: '🟡', label: `Low · ${reportCount} reports`,       color: 'var(--amber)' },
    medium:   { emoji: '🟡', label: 'Moderate confidence',                color: 'var(--amber)' },
    low:      { emoji: '🔴', label: 'Low confidence',                     color: 'var(--red)'   },
    high:     { emoji: '🟢', label: `High confidence · ${reportCount} reports`, color: 'var(--green)' },
  }
  const info = map[dq] || { emoji: '🔴', label: 'Estimated', color: 'var(--red)' }
  return (
    <span style={{
      fontFamily: 'var(--mono)', fontSize: '.54rem', fontWeight: 600,
      color: info.color, display: 'inline-flex', alignItems: 'center', gap: '.3rem',
    }}>
      {info.emoji} {info.label}
    </span>
  )
}

function GhostSurgeAlert({ ghostRate }: { ghostRate: number }) {
  if (ghostRate <= 0.6) return null
  const ghostPct = Math.round(ghostRate * 100)
  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      background: 'linear-gradient(90deg,rgba(239,68,68,.14) 0%,rgba(239,68,68,.04) 100%)',
      border: '1px solid #ff3b5c35', borderLeft: '3px solid var(--red)',
      borderRadius: 9, padding: '.75rem 1rem', marginBottom: '.85rem',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.85rem',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--mono)', fontSize: '.56rem', fontWeight: 500, color: 'var(--red)',
          textTransform: 'uppercase', letterSpacing: '.16em', marginBottom: '.22rem',
          display: 'flex', alignItems: 'center', gap: '.4rem',
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', background: 'var(--red)',
            display: 'inline-block', flexShrink: 0,
          }} />
          ⚡ Ghost surge — high risk
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'rgba(255,59,92,.65)' }}>
          Most applicants never hear back from this company
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{
          fontFamily: 'var(--display)', fontSize: '1.7rem', fontWeight: 800,
          color: 'var(--red)', lineHeight: '.95', letterSpacing: '-.03em',
        }}>{ghostPct}%</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.46rem', color: 'rgba(255,59,92,.55)', textTransform: 'uppercase', letterSpacing: '.14em', marginTop: '.12rem' }}>Ghost rate</div>
      </div>
    </div>
  )
}

function ExpectedTimeline({ sc, risk }: { sc: CompanyScore; risk: string }) {
  const avgWait = sc.avg_wait_days || 30
  const rr = Math.round((sc.response_rate || 0) * 100)
  const w = sc.waste || 40
  const wColor = w > 60 ? 'var(--red)' : w > 30 ? 'var(--amber)' : 'var(--green)'
  const rrColor = riskColor(risk)
  return (
    <div style={{
      background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.18)',
      borderRadius: 12, padding: '1rem 1.1rem', marginBottom: '1rem',
    }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--indigo, #818cf8)', marginBottom: '.75rem' }}>
        📅 If you applied today
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '.75rem', marginBottom: '.85rem' }}>
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '1.3rem', fontWeight: 500, color: 'var(--white)', lineHeight: 1, marginBottom: '.15rem' }}>{avgWait}d</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)' }}>avg response</div>
        </div>
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '1.3rem', fontWeight: 500, color: rrColor, lineHeight: 1, marginBottom: '.15rem' }}>{rr}%</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)' }}>hear back</div>
        </div>
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '1.3rem', fontWeight: 500, color: wColor, lineHeight: 1, marginBottom: '.15rem' }}>{w}%</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)' }}>waste risk</div>
        </div>
      </div>
    </div>
  )
}

function HiringFunnel({ sc }: { sc: CompanyScore }) {
  const rsp = Math.round((sc.response_rate || 0) * 100)
  const rgp = Math.round((sc.ghost_rate || 0) * 100)
  const viewedPct = Math.round((sc.response_rate || 0) * 1.8 * 100)
  const stages = [
    { label: 'Applied',   pct: 100,      color: 'var(--sub, #888)'     },
    { label: 'Viewed',    pct: Math.min(100, viewedPct), color: 'var(--blue)'  },
    { label: 'Responded', pct: rsp,      color: 'var(--amber)'          },
    { label: 'Ghosted',   pct: rgp,      color: 'var(--red)',  note: '← most here' },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
      {stages.map(s => (
        <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
          <div style={{ width: 80, fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)', flexShrink: 0 }}>{s.label}</div>
          <div style={{ flex: 1, height: 8, background: 'var(--line2)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${Math.max(0, Math.min(100, s.pct))}%`, height: '100%', background: s.color, borderRadius: 4, transition: 'width .6s ease' }} />
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--muted)', width: 48, textAlign: 'right', flexShrink: 0 }}>
            {s.pct}%{s.note ? <span style={{ color: 'var(--red)', marginLeft: '.2rem' }}>{s.note}</span> : null}
          </div>
        </div>
      ))}
    </div>
  )
}

function WebReviewsSection({ reviews }: { reviews: WebReview[] }) {
  if (!reviews || reviews.length === 0) return null
  const sentColor = (s: string) => s === 'positive' ? 'var(--green)' : s === 'negative' ? 'var(--red)' : 'var(--amber)'
  const sentLabel = (s: string) => s === 'positive' ? '✓ Positive' : s === 'negative' ? '✗ Negative' : '~ Mixed'
  const sentBorder = (s: string) => s === 'positive' ? 'rgba(16,185,129,.3)' : s === 'negative' ? 'rgba(239,68,68,.3)' : 'rgba(245,158,11,.3)'
  return (
    <div style={{ padding: '0 0 1.5rem' }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)', marginBottom: '.75rem' }}>
        What applicants are saying online
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
        {reviews.map((rv, i) => (
          <div key={i} style={{
            background: 'var(--card)', border: `1px solid ${sentBorder(rv.sentiment)}`,
            borderRadius: 8, padding: '.85rem 1rem',
          }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--dim)', lineHeight: 1.55, marginBottom: '.5rem' }}>
              &ldquo;{rv.text}&rdquo;
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '.54rem', fontWeight: 600, color: sentColor(rv.sentiment) }}>{sentLabel(rv.sentiment)}</span>
              {rv.source && <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)' }}>{rv.source}</span>}
              {rv.year && <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)' }}>{rv.year}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

interface TrackCTAProps {
  companyName: string
}
function TrackCTA({ companyName }: TrackCTAProps) {
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [role, setRole] = useState('')
  const [showInput, setShowInput] = useState(false)

  async function handleTrack() {
    if (!role.trim()) { setShowInput(true); return }
    setState('loading')
    try {
      const res = await fetch('/api/user-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_application',
          company: companyName,
          role: role.trim(),
          status: 'active',
          stage: 'Applied',
          addedAt: new Date().toISOString(),
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setState('success')
    } catch {
      setState('error')
    }
  }

  if (state === 'success') {
    return (
      <div style={{
        background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.2)',
        borderRadius: 10, padding: '.75rem 1rem', marginBottom: '.75rem',
        fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--green)',
      }}>
        ✓ Application tracked — check your tracker to follow up
      </div>
    )
  }

  return (
    <div style={{ marginBottom: '.75rem' }}>
      {showInput ? (
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          <input
            autoFocus
            type="text"
            placeholder="Job title (e.g. Software Engineer)"
            value={role}
            onChange={e => setRole(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleTrack()}
            style={{
              flex: 1, minWidth: 180, background: 'var(--surface, #111)', border: '1px solid var(--line2)',
              borderRadius: 6, padding: '.45rem .7rem', color: 'var(--white)',
              fontFamily: 'var(--mono)', fontSize: '.68rem', outline: 'none',
            }}
          />
          <button
            onClick={handleTrack}
            disabled={state === 'loading'}
            style={{
              background: 'linear-gradient(135deg,rgba(16,185,129,0.15),rgba(99,102,241,0.15))',
              border: '1px solid rgba(16,185,129,0.3)', borderRadius: 6,
              color: 'var(--green)', fontFamily: 'var(--mono)', fontSize: '.68rem',
              padding: '.45rem 1rem', cursor: 'pointer', flexShrink: 0,
            }}
          >
            {state === 'loading' ? 'Saving...' : 'Track →'}
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowInput(true)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(135deg,rgba(16,185,129,0.15),rgba(99,102,241,0.15))',
            border: '1px solid rgba(16,185,129,0.3)', borderRadius: 10,
            color: 'var(--green)', fontFamily: 'var(--mono)', fontSize: '.78rem',
            padding: '.75rem 1rem', cursor: 'pointer', fontWeight: 500,
          }}
        >
          + I applied here — track this application
        </button>
      )}
      {state === 'error' && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--red)', marginTop: '.35rem' }}>
          Could not save. Make sure you&apos;re signed in.
        </div>
      )}
    </div>
  )
}

// ── Outcome distribution bar (for overview) ────────────────────────────────────

function OutcomeDistribution({ reports }: { reports: Report[] }) {
  if (!reports || reports.length < 3) return null
  const dist: Record<string, number> = {}
  reports.forEach(r => { const oc = r.outcome || 'unknown'; dist[oc] = (dist[oc] || 0) + 1 })
  const total = reports.length
  const merged = [
    { label: 'Ghosted',   count: dist.ghosted || 0,                                                   color: '#ef4444' },
    { label: 'Rejected',  count: (dist.rejected || 0) + (dist.autoreject || 0),                       color: '#f59e0b' },
    { label: 'Interview', count: (dist.interview || 0) + (dist.human || 0) + (dist.interviewing || 0), color: '#3b82f6' },
    { label: 'Hired',     count: (dist.hired || 0) + (dist.offer || 0),                               color: '#10b981' },
    { label: 'Waiting',   count: dist.waiting || 0,                                                    color: '#6b7280' },
  ].filter(s => s.count > 0)

  return (
    <div style={{ marginBottom: '.8rem' }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--muted)', marginBottom: '.3rem' }}>
        Outcome distribution · {total} community reports
      </div>
      <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: '.18rem' }}>
        {merged.map(s => (
          <div key={s.label} style={{ flex: s.count, background: s.color }} />
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.25rem', flexWrap: 'wrap' }}>
        {merged.map((s, i) => (
          <span key={s.label} style={{ fontFamily: 'var(--mono)', fontSize: '.48rem', color: 'var(--dim)' }}>
            {s.label} {Math.round(s.count / total * 100)}%
            {i < merged.length - 1 && <span style={{ color: 'var(--line2)', margin: '0 .18rem' }}>·</span>}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function CompanyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const companyName = decodeURIComponent(slug).replace(/-/g, ' ')

  const [reports, setReports] = useState<Report[]>([])
  const [score, setScore] = useState<CompanyScore | null>(null)
  const [industry, setIndustry] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<TabKey>('overview')
  const [location, setLocation] = useState('')
  const [webReviews, setWebReviews] = useState<WebReview[]>([])

  // Fetch reports + score
  useEffect(() => {
    async function load() {
      setLoading(true)
      setError('')
      try {
        // Fetch community reports
        const rRes = await fetch('/api/reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ company: companyName.toLowerCase(), city: location }),
        })
        if (rRes.ok) {
          const rJson = await rRes.json() as { reports?: Report[]; ok?: boolean }
          if (rJson.reports) setReports(rJson.reports)
        }

        // Fetch score from company-score endpoint
        const sRes = await fetch('/api/reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: companyName }),
        })
        if (sRes.ok) {
          const sJson = await sRes.json() as { score?: CompanyScore; ok?: boolean }
          if (sJson.score) {
            setScore(sJson.score)
            if (sJson.score.industry) setIndustry(sJson.score.industry)
            if (sJson.score.web_reviews?.length) setWebReviews(sJson.score.web_reviews)
          }
        }
      } catch {
        setError('Failed to load company data.')
      }
      setLoading(false)
    }
    load()
  }, [companyName, location]) // eslint-disable-line react-hooks/exhaustive-deps

  const risk = score ? Score.risk(score.overall_score) : 'warn'
  const g = score ? letterGrade(score.overall_score) : '—'
  const logoLetter = (companyName[0] || '?').toUpperCase()
  const ghostHigh = (score?.ghost_rate || 0) > 0.5
  const ghostPct = score ? Math.round((score.ghost_rate || 0) * 100) : 0
  const respPct = score ? Math.round((score.response_rate || 0) * 100) : 0
  const ghostColor = ghostHigh ? 'var(--red)' : (score?.ghost_rate || 0) > 0.3 ? 'var(--amber)' : 'var(--green)'
  const waitColor = (score?.avg_wait_days || 0) > 21 ? 'var(--amber)' : 'var(--text)'
  const wasteColor = (score?.waste || 0) > 60 ? 'var(--red)' : (score?.waste || 0) > 30 ? 'var(--amber)' : 'var(--green)'

  const TABS: { key: TabKey; label: string }[] = [
    { key: 'overview',  label: 'Overview' },
    { key: 'process',   label: 'Process Score' },
    { key: 'reports',   label: `Reports${reports.length > 0 ? ` (${reports.length})` : ''}` },
    { key: 'locations', label: 'Locations' },
    { key: 'roles',     label: 'Open Roles' },
    { key: 'reddit',    label: 'Reddit' },
    { key: 'compare',   label: '⚡ Compare' },
  ]

  const ocLabel: Record<string, string> = {
    ghosted: '👻 Ghosted', autoreject: '🤖 Auto-rejected',
    human: '✅ Got response', hired: '🎉 Hired',
    offer: '🎁 Offer', interview: '📞 Interview',
    rejected: '❌ Rejected', waiting: '⏳ Waiting',
  }
  const ocClass: Record<string, string> = {
    ghosted: 'v-r', autoreject: 'v-y', rejected: 'v-y',
    human: 'v-g', hired: 'v-g', offer: 'v-g', interview: 'v-b', waiting: 'v-n',
  }

  return (
    <div className="page-full">
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '2.5rem 2rem' }}>

        {/* ── Company header ── */}
        <div className="co-hdr">
          <div className="co-top">
            <div className="co-logo-lg">{logoLetter}</div>
            <div style={{ flex: 1 }}>
              <div className="co-name">{companyName}</div>
              {industry && <div className="co-ind">{industry}</div>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
              <input
                type="text"
                placeholder="Filter by city..."
                value={location}
                onChange={e => setLocation(e.target.value)}
                style={{
                  background: 'var(--surface, #111)', border: '1px solid var(--line2)',
                  borderRadius: 6, padding: '.35rem .65rem', color: 'var(--white)',
                  fontFamily: 'var(--mono)', fontSize: '.65rem', outline: 'none',
                  width: 160, caretColor: 'var(--blue)',
                }}
              />
            </div>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.72rem' }}>
              Loading company data...
            </div>
          ) : error ? (
            <div style={{ background: 'var(--rdim, rgba(239,68,68,.08))', border: '1px solid rgba(239,68,68,.25)', borderRadius: 8, padding: '1rem', fontFamily: 'var(--mono)', fontSize: '.72rem', color: 'var(--red)', textAlign: 'center' }}>
              {error}
            </div>
          ) : score ? (
            <>
              {/* Grade bar */}
              <div className={`co-grade-bar ${risk}`} style={{ marginBottom: '1rem' }}>
                <div className={`co-grade-letter ${risk}`}>{g}</div>
                <div style={{ flex: 1 }}>
                  <span className="co-grade-lbl">Seen Grade</span>
                  <span className="co-grade-score">{score.overall_score} / 100</span>
                  {score.data_quality && (
                    <div style={{ marginTop: '.35rem' }}>
                      <DataQualityBadge dq={score.data_quality} reportCount={score.report_count} />
                    </div>
                  )}
                </div>
                {score.report_count > 0 && (
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <span className="co-live">{score.report_count} reports</span>
                  </div>
                )}
              </div>

              {/* Ghost surge alert */}
              <GhostSurgeAlert ghostRate={score.ghost_rate || 0} />

              {/* Metrics grid */}
              <div className="co-mets">
                <MetBox label="Score" value={String(score.overall_score)} color={riskColor(risk)} />
                <MetBox label="Response %" value={pct(score.response_rate)} color="var(--blue)" />
                <MetBox label="Ghost %" value={pct(score.ghost_rate)} alarm={ghostHigh} color={ghostColor} />
                <MetBox label="Avg wait" value={score.avg_wait_days != null ? `${score.avg_wait_days}d` : '—'} color={waitColor} />
                <MetBox label="Avg rounds" value={score.avg_rounds != null ? String(score.avg_rounds.toFixed(1)) : '—'} />
                <MetBox label="Waste risk" value={score.waste != null ? `${score.waste}%` : '—'} color={wasteColor} />
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.72rem' }}>
              No score data found for this company.
            </div>
          )}
        </div>

        {/* ── Track CTA ── */}
        {!loading && <TrackCTA companyName={companyName} />}

        {/* ── Tabs ── */}
        {!loading && (
          <>
            <div className="co-tabs" style={{ display: 'flex', gap: '.08rem', borderBottom: '1px solid var(--line)', marginBottom: '1.35rem', overflowX: 'auto' }}>
              {TABS.map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`ctab${tab === t.key ? ' active' : ''}`}
                  style={{
                    background: 'none', border: 'none',
                    borderBottom: `2px solid ${tab === t.key ? 'var(--blue)' : 'transparent'}`,
                    color: tab === t.key ? 'var(--white)' : 'var(--muted)',
                    fontFamily: 'var(--mono)', fontSize: '.65rem',
                    padding: '.55rem .9rem', cursor: 'pointer', transition: 'all .15s',
                    whiteSpace: 'nowrap', flexShrink: 0,
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* ── OVERVIEW TAB ── */}
            {tab === 'overview' && score && (
              <div>
                <ExpectedTimeline sc={score} risk={risk} />
                <OutcomeDistribution reports={reports} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                  <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '1.2rem' }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)', marginBottom: '.85rem' }}>
                      Score breakdown
                    </div>
                    <BarRow label="Response rate" value={respPct} color={riskColor(risk)} />
                    <BarRow label="Ghost rate" value={ghostPct} color="var(--red)" />
                    <BarRow label="Waste risk" value={score.waste || 0} color={wasteColor} />
                  </div>
                  <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '1.2rem' }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)', marginBottom: '.85rem' }}>
                      At a glance
                    </div>
                    {score.summary ? (
                      <p style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--sub)', lineHeight: 1.65, margin: '0 0 .75rem' }}>
                        {score.summary}
                      </p>
                    ) : null}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem', marginTop: '.5rem' }}>
                      <a href="/report" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid var(--line2)', borderRadius: 6, color: 'var(--sub)', fontFamily: 'var(--mono)', fontSize: '.72rem', padding: '.5rem .75rem', cursor: 'pointer', textDecoration: 'none', textAlign: 'center' }}>
                        + Report your experience
                      </a>
                    </div>
                  </div>
                </div>
                {webReviews.length > 0 && <WebReviewsSection reviews={webReviews} />}
                <div style={{ background: 'var(--raised, #111)', borderRadius: 7, padding: '.7rem .95rem', fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem' }}>
                  <span>📊 Based on {score.report_count || 0} {score.data_source === 'web_research' ? 'web research reports' : 'verified reports'}</span>
                  <a href="/report" style={{ color: 'var(--green)', textDecoration: 'none', whiteSpace: 'nowrap' }}>+ Add your report →</a>
                </div>
              </div>
            )}

            {/* ── PROCESS SCORE TAB ── */}
            {tab === 'process' && score && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                  <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '1.2rem' }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)', marginBottom: '.85rem' }}>Process score</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '2.5rem', fontWeight: 500, color: riskColor(risk), lineHeight: 1, marginBottom: '.25rem' }}>
                      {score.process_score ?? score.overall_score}
                    </div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '1rem' }}>out of 100</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--dim)' }}>
                      Avg rounds: <span style={{ color: 'var(--text)' }}>{score.avg_rounds != null ? score.avg_rounds : '—'}</span>
                    </div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--dim)', marginTop: '.3rem' }}>
                      Avg timeline: <span style={{ color: 'var(--text)' }}>{score.avg_wait_days != null ? `${score.avg_wait_days} days` : '—'}</span>
                    </div>
                    {score.data_quality && (
                      <div style={{ marginTop: '.75rem' }}>
                        <DataQualityBadge dq={score.data_quality} reportCount={score.report_count} />
                      </div>
                    )}
                  </div>
                  <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '1.2rem' }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)', marginBottom: '.85rem' }}>Where they ghost</div>
                    <HiringFunnel sc={score} />
                  </div>
                </div>
                <div style={{ background: 'rgba(16,185,129,.06)', border: '1px solid rgba(16,185,129,.18)', borderRadius: 8, padding: '.75rem 1rem', fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--green)' }}>
                  This feature is exclusive to Seen. No other job board tracks which stage companies ghost at.
                </div>
              </div>
            )}

            {/* ── REPORTS TAB ── */}
            {tab === 'reports' && (
              <div>
                {reports.length > 0 ? (
                  <>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)', marginBottom: '.85rem' }}>
                      {reports.length} report{reports.length !== 1 ? 's' : ''} from real applicants · anonymous · verified
                    </div>
                    {reports.map(r => (
                      <div key={r.id} className="rcard">
                        <div className="rc-hd">
                          <div className="rc-av">{(r.role || '?')[0].toUpperCase()}</div>
                          <div style={{ flex: 1 }}>
                            <div className="rc-role">
                              {r.role || 'Unknown role'}
                              {r.ghost_stage && <span style={{ color: 'var(--muted)' }}> · ghosted at {r.ghost_stage}</span>}
                            </div>
                            <div className="rc-meta">
                              {r.city ? `📍 ${r.city} · ` : ''}
                              {r.rounds ? `${r.rounds} round${r.rounds !== 1 ? 's' : ''} · ` : ''}
                              {r.created_at ? `${Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000)}d ago` : ''}
                            </div>
                          </div>
                          <span className={`vibe ${ocClass[r.outcome] || 'v-n'}`}>{ocLabel[r.outcome] || r.outcome}</span>
                        </div>
                        {r.report_text && (
                          <div className="rc-body">{r.report_text}</div>
                        )}
                        <div className="rc-footer">
                          <span style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', color: 'var(--muted)' }}>via</span>
                          <span className="vibe v-n" style={{ fontSize: '.55rem' }}>{r.platform || 'Seen'}</span>
                        </div>
                      </div>
                    ))}
                  </>
                ) : (
                  <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.7rem' }}>
                    No community reports yet.<br /><br />
                    <a href="/report" style={{ color: 'var(--green)', textDecoration: 'none' }}>Be the first to report →</a>
                  </div>
                )}
              </div>
            )}

            {/* ── LOCATIONS TAB ── */}
            {tab === 'locations' && (
              <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.7rem' }}>
                Location-specific scores coming soon.<br />
                <span style={{ fontSize: '.6rem', opacity: .6 }}>Use the city filter above to narrow reports to a specific location.</span>
              </div>
            )}

            {/* ── OPEN ROLES TAB ── */}
            {tab === 'roles' && (
              <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.7rem' }}>
                Open roles coming soon.<br />
                <span style={{ fontSize: '.6rem', opacity: .6 }}>Search for &ldquo;{companyName}&rdquo; in Jobs to see current listings.</span>
              </div>
            )}

            {/* ── REDDIT TAB ── */}
            {tab === 'reddit' && (
              <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.7rem' }}>
                Reddit aggregation coming soon.<br />
                <span style={{ fontSize: '.6rem', opacity: .6 }}>Reddit loads server-side — community data appears in the reports tab.</span>
              </div>
            )}

            {/* ── COMPARE TAB ── */}
            {tab === 'compare' && (
              <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.7rem' }}>
                ⚡ Company comparison coming soon.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
