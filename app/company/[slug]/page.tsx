'use client'

import { useState, useEffect, use } from 'react'
import { Score } from '@/lib/score'
import { useAuth } from '@/lib/auth'
import { AppStore } from '@/lib/stores/AppStore'
import HiringProbability from '@/components/HiringProbability'
import CompanyScoreCard from '@/components/CompanyScoreCard'
import { isRedditSourced, PUBLIC_DISCUSSION_LABEL } from '@/lib/reportSource'
import CompanyRedditDiscussion from '@/components/CompanyRedditDiscussion'
import CompanyPublicRecord from '@/components/CompanyPublicRecord'

// ── Types ──────────────────────────────────────────────────────────────────────

interface CompanyScore {
  overall_score: number
  response_rate: number
  ghost_rate: number
  avg_wait_days: number
  avg_rounds: number
  waste: number
  report_count: number
  first_party_report_count?: number
  web_report_count?: number
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

// Convert a stored rate (fraction in [0,1]) to a clamped whole-number percent. Raw values
// out of range (e.g. a hand-math merge writing 34.0 instead of 0.34) clamp to 0–100 and warn
// — the company page must NEVER render "3400%".
function ratePct(v: number | null | undefined): number | null {
  if (v == null) return null
  if (v > 1 || v < 0) console.warn('rate out of range', v)
  return Math.round(Math.min(1, Math.max(0, v)) * 100)
}

function pct(n: number | null | undefined): string {
  const p = ratePct(n)
  return p == null ? '—' : p + '%'
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

function DataQualityBadge({ dq, reportCount, webCount = 0 }: { dq: string; reportCount: number; webCount?: number }) {
  // reportCount here is FIRST-PARTY applicant reports only. With zero first-party rows the
  // score is a web-research estimate — say exactly that; never mint "High confidence · N
  // reports" from the LLM's claimed mention count (that number looked fake because it was).
  if (reportCount === 0) {
    return (
      <span style={{
        fontFamily: 'var(--mono)', fontSize: '.54rem', fontWeight: 600,
        color: 'var(--amber)', display: 'inline-flex', alignItems: 'center', gap: '.3rem',
      }}>
        🌐 {webCount > 0 ? 'Web-research estimate — no first-party reports yet' : 'Estimated'}
      </span>
    )
  }
  const map: Record<string, { emoji: string; label: string; color: string }> = {
    strong:   { emoji: '🟢', label: `High · ${reportCount} applicant reports`,      color: 'var(--green)' },
    moderate: { emoji: '🟡', label: `Moderate · ${reportCount} applicant reports`,  color: 'var(--amber)' },
    limited:  { emoji: '🟡', label: `Low · ${reportCount} applicant reports`,       color: 'var(--amber)' },
    medium:   { emoji: '🟡', label: 'Moderate confidence',                color: 'var(--amber)' },
    low:      { emoji: '🔴', label: 'Low confidence',                     color: 'var(--red)'   },
    high:     { emoji: '🟢', label: `High confidence · ${reportCount} applicant reports`, color: 'var(--green)' },
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

function computeVibes(sc: CompanyScore): { label: string; cls: string }[] {
  const vibes: { label: string; cls: string }[] = []
  const ghost = sc.ghost_rate || 0
  const wait = sc.avg_wait_days || 0
  const rounds = sc.avg_rounds || 0
  const waste = sc.waste || 0
  const rr = sc.response_rate || 0
  const score = sc.overall_score || 0

  if (ghost > 0.65)       vibes.push({ label: '👻 Frequent ghosting',              cls: 'v-r' })
  else if (ghost > 0.45)  vibes.push({ label: '👻 High ghost rate',                cls: 'v-r' })
  if (wait > 30)          vibes.push({ label: `⏳ Very slow pipeline (${wait}d)`,  cls: 'v-y' })
  else if (wait > 21)     vibes.push({ label: `⏳ Slow response (${wait}d avg)`,   cls: 'v-y' })
  if (rounds >= 5)        vibes.push({ label: `📋 ${Math.round(rounds)} rounds avg`,       cls: 'v-b' })
  else if (rounds >= 3.5) vibes.push({ label: `📋 ${rounds.toFixed(1)} rounds avg`,        cls: 'v-b' })
  if (waste > 70)         vibes.push({ label: '⚠ Very high waste risk',            cls: 'v-y' })
  else if (waste > 50)    vibes.push({ label: '⚠ High waste risk',                 cls: 'v-y' })
  // Mutually exclusive with the ghost-surge banner (surge wins at ghost>=0.5): a company
  // can't be both "highly responsive" and in a ghost surge.
  if (rr > 0.75 && ghost < 0.5) vibes.push({ label: '✅ Highly responsive',           cls: 'v-g' })
  if (score >= 80)        vibes.push({ label: '🌟 Strong hiring process',           cls: 'v-g' })
  if (score < 35)         vibes.push({ label: '❌ Low transparency',                cls: 'v-r' })
  return vibes.slice(0, 5)
}

function VibeTagList({ sc }: { sc: CompanyScore }) {
  const vibes = computeVibes(sc)
  if (vibes.length === 0) return null
  return (
    <div style={{ display: 'flex', gap: '.28rem', flexWrap: 'wrap', margin: '.55rem 0 .65rem' }}>
      {vibes.map(v => (
        <span key={v.label} className={`vibe ${v.cls}`}>{v.label}</span>
      ))}
    </div>
  )
}

function GhostSurgeAlert({ ghostRate }: { ghostRate: number }) {
  // Surge wins at ghost>=0.5; mutually exclusive with the "Highly responsive" badge.
  if (ghostRate < 0.5) return null
  const ghostPct = ratePct(ghostRate) ?? 0
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
  const rr = ratePct(sc.response_rate) ?? 0
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
  const rsp = ratePct(sc.response_rate) ?? 0
  const rgp = ratePct(sc.ghost_rate) ?? 0
  const viewedPct = Math.min(100, Math.round((Math.min(1, Math.max(0, sc.response_rate || 0)) * 1.8) * 100))
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
  const { isLoggedIn } = useAuth()
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [role, setRole] = useState('')
  const [showInput, setShowInput] = useState(false)

  async function handleTrack() {
    if (!role.trim()) { setShowInput(true); return }
    setState('loading')
    try {
      // AppStore.add handles both worlds correctly: local tracking for guests, and the
      // authed add_application sync (wrapped payload + Bearer token) for signed-in users.
      // The old raw fetch sent no auth and a flat body the handler couldn't read — this
      // button had never once succeeded.
      await AppStore.add({
        company: companyName,
        role: role.trim(),
        platform: 'Seen',
        status: 'active',
        stage: 'Applied',
      }, isLoggedIn)
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

function GhostVisual({ ghostRate, count }: { ghostRate: number; count: number }) {
  const pct = Math.round(ghostRate * 100)
  const outOf10 = Math.round(ghostRate * 10)
  if (pct < 15) return null
  return (
    <div style={{
      background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)',
      borderRadius: 10, padding: '.85rem 1rem', marginBottom: '.85rem',
      display: 'flex', alignItems: 'center', gap: '1rem',
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--red)', fontWeight: 600, marginBottom: '.3rem' }}>
          {outOf10} in 10 applicants never hear back
        </div>
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: '.3rem' }}>
          {Array.from({ length: 10 }).map((_, i) => (
            <span key={i} style={{ fontSize: '.9rem', opacity: i < outOf10 ? 0.25 : 0.9, filter: i < outOf10 ? 'grayscale(1)' : 'none', transition: `opacity .3s ${i * 0.04}s` }}>
              👤
            </span>
          ))}
        </div>
        {count > 0 && <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--dim)' }}>Based on {count} reported applications</div>}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontFamily: 'var(--display)', fontSize: '2.2rem', fontWeight: 800, color: 'var(--red)', lineHeight: .9, letterSpacing: '-.03em' }}>{pct}%</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.42rem', color: 'rgba(239,68,68,.5)', textTransform: 'uppercase', letterSpacing: '.14em' }}>ghost rate</div>
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
  const [notFound, setNotFound] = useState(false)
  const [tab, setTab] = useState<TabKey>('overview')
  const [location, setLocation] = useState('')
  const [webReviews, setWebReviews] = useState<WebReview[]>([])
  const [viewers, setViewers] = useState(0)
  const [perk, setPerk] = useState<{ featured: boolean; verified: boolean }>({ featured: false, verified: false })
  useEffect(() => {
    let alive = true
    fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'employer_perk', name: companyName }) })
      .then(r => r.json()).then(d => { if (alive && d) setPerk({ featured: !!d.featured, verified: !!d.verified }) }).catch(() => {})
    return () => { alive = false }
  }, [companyName])
  const [companyJobs, setCompanyJobs] = useState<Array<{title:string;company:string;location:string;salary:string|null;url:string|null;source:string;type:string;level:string;score:number}>>([])
  const [jobsLoading, setJobsLoading] = useState(false)
  const [jobsFetched, setJobsFetched] = useState(false)
  const [compareInput, setCompareInput] = useState('')
  const [compareList, setCompareList] = useState<Array<{name: string; score: CompanyScore | null; loading: boolean}>>([])

  const [displayScore, setDisplayScore] = useState(0)
  const [showGradeCard, setShowGradeCard] = useState(false)
  const [scoreRevealed, setScoreRevealed] = useState(false)
  const [myApp, setMyApp] = useState<{company: string; role: string; status: string; stage: string; appliedAt: number; daysSince: number} | null>(null)

  // Load matching tracker entry for this company
  useEffect(() => {
    try {
      const apps = AppStore.loadSync()
      // Match by slug: normalize app.company to slug format and compare
      const match = apps.find(a => {
        const appSlug = a.company.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
        const pageSlug = slug.replace(/[^a-z0-9-]/g, '')
        return appSlug === pageSlug || a.company.toLowerCase().includes(slug.replace(/-/g, ' ')) || slug.replace(/-/g, ' ').includes(a.company.toLowerCase())
      })
      if (match) {
        setMyApp({
          company: match.company,
          role: match.role,
          status: match.status,
          stage: match.stage,
          appliedAt: match.appliedAt,
          daysSince: Math.floor((Date.now() - match.appliedAt) / 86400000),
        })
      }
    } catch {}
  }, [slug])

  // T3-9: Stable per-session viewer count (consistent for same company + day)
  useEffect(() => {
    const day = Math.floor(Date.now() / 86400000)
    const hash = [...(slug + day)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) & 0xffff, 0)
    setViewers((hash % 22) + 5)
  }, [slug])

  // T3-7: Record this company visit in localStorage for dashboard "Recently checked"
  useEffect(() => {
    try {
      const raw = localStorage.getItem('seen_recent_cos')
      const prev: Array<{name: string; slug: string}> = raw ? JSON.parse(raw) : []
      const filtered = prev.filter(c => c.slug !== slug)
      const updated = [{ name: companyName, slug }, ...filtered].slice(0, 10)
      localStorage.setItem('seen_recent_cos', JSON.stringify(updated))
    } catch {}
  }, [slug, companyName])

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
          const sJson = await sRes.json() as { score?: CompanyScore; ok?: boolean; not_found?: boolean }
          if (sJson.not_found) {
            setNotFound(true)
          } else if (sJson.score) {
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

  // Fetch open roles when roles tab is first opened
  useEffect(() => {
    if (tab !== 'roles' || jobsFetched) return
    setJobsLoading(true)
    fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'company_jobs', company: companyName }),
    })
      .then(r => r.ok ? r.json() : { jobs: [] })
      .then(d => { setCompanyJobs(d.jobs || []); setJobsFetched(true) })
      .catch(() => setJobsFetched(true))
      .finally(() => setJobsLoading(false))
  }, [tab, companyName, jobsFetched])

  // Score reveal animation
  useEffect(() => {
    if (!score || scoreRevealed) return
    setScoreRevealed(true)
    const target = score.overall_score
    const duration = 1200
    const start = performance.now()
    function tick(now: number) {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplayScore(Math.round(eased * target))
      if (progress < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [score]) // eslint-disable-line react-hooks/exhaustive-deps

  const risk = score ? Score.risk(score.overall_score) : 'warn'
  const g = score ? letterGrade(score.overall_score) : '—'
  // Honest count split (migration 063). Legacy payloads without the split fields infer from
  // data_source: only 'reports'-derived scores were counted from real rows — anything else is
  // the web-research pipeline's *claimed* number, which must never render as "reports".
  const fpReports = score ? (score.first_party_report_count ?? (score.data_source === 'reports' ? (score.report_count || 0) : 0)) : 0
  const webEst = score ? (score.web_report_count ?? (score.data_source === 'reports' ? 0 : (score.report_count || 0))) : 0
  const logoLetter = (companyName[0] || '?').toUpperCase()
  const ghostHigh = (score?.ghost_rate || 0) > 0.5
  const ghostPct = score ? (ratePct(score.ghost_rate) ?? 0) : 0
  const respPct = score ? (ratePct(score.response_rate) ?? 0) : 0
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

  if (!loading && notFound) {
    return (
      <div className="page-full">
        <div style={{ maxWidth: 600, margin: '0 auto', padding: '5rem 2rem', textAlign: 'center', width: '100%', boxSizing: 'border-box' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '2.5rem', marginBottom: '1rem', opacity: .4 }}>?</div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: '1.4rem', fontWeight: 800, color: 'var(--white)', marginBottom: '.6rem', letterSpacing: '-.02em' }}>
            Can&apos;t verify &ldquo;{companyName}&rdquo;
          </h1>
          <p style={{ color: 'var(--sub)', fontFamily: 'var(--mono)', fontSize: '.72rem', lineHeight: 1.7, marginBottom: '1.75rem' }}>
            We couldn&apos;t find this company online. Make sure you&apos;re using the official company name — we need to verify it exists before scoring.
          </p>
          <a href="/companies" style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 9, padding: '.65rem 1.3rem', fontFamily: 'var(--mono)', fontSize: '.72rem', fontWeight: 600, color: 'var(--blue)', textDecoration: 'none' }}>
            ← Back to company scoreboard
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="page-full">
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '2.5rem 2rem', width: '100%', boxSizing: 'border-box' }}>

        {/* ── "You applied here" context strip ── */}
        {myApp && (
          <div style={{ background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.22)', borderRadius: 10, padding: '.65rem 1rem', marginBottom: '.85rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.75rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--indigo)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Your application</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--sub)' }}>
                {myApp.role} · Day {myApp.daysSince}
              </span>
              <span style={{
                fontFamily: 'var(--mono)', fontSize: '.52rem', borderRadius: 4, padding: '.08rem .28rem',
                color: myApp.status === 'ghosted' ? 'var(--muted)' : myApp.status === 'hired' ? 'var(--green)' : myApp.status === 'rejected' ? 'var(--red)' : 'var(--amber)',
                background: myApp.status === 'ghosted' ? 'rgba(156,163,175,.1)' : myApp.status === 'hired' ? 'rgba(16,185,129,.1)' : myApp.status === 'rejected' ? 'rgba(239,68,68,.1)' : 'rgba(245,158,11,.1)',
                border: `1px solid ${myApp.status === 'ghosted' ? 'rgba(156,163,175,.2)' : myApp.status === 'hired' ? 'rgba(16,185,129,.2)' : myApp.status === 'rejected' ? 'rgba(239,68,68,.2)' : 'rgba(245,158,11,.2)'}`,
              }}>
                {myApp.status === 'active' ? myApp.stage : myApp.status}
              </span>
            </div>
            <a href="/tracker" style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--indigo)', textDecoration: 'none', flexShrink: 0 }}>View in tracker →</a>
          </div>
        )}

        {/* ── Company header ── */}
        <div className="co-hdr">
          <div className="co-top">
            <div className="co-logo-lg">{logoLetter}</div>
            <div style={{ flex: 1 }}>
              <div className="co-name" style={{ display: 'inline-flex', alignItems: 'center', gap: '.55rem', flexWrap: 'wrap' }}>
                {companyName}
                {perk.verified && (
                  <span title="This employer committed to responding to applicants. Reviewed against real outcome data — it never affects the transparency score." style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontFamily: 'var(--mono)', fontSize: '.5rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--blue)', background: 'rgba(59,130,246,.12)', border: '1px solid rgba(59,130,246,.4)', borderRadius: 999, padding: '.2rem .55rem', whiteSpace: 'nowrap' }}>✓ Transparency Verified</span>
                )}
                {perk.featured && (
                  <span title="Featured employer — paid placement. Never affects the transparency score." style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontFamily: 'var(--mono)', fontSize: '.5rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#f7c948', background: 'rgba(247,201,72,.12)', border: '1px solid rgba(247,201,72,.4)', borderRadius: 999, padding: '.2rem .55rem', whiteSpace: 'nowrap' }}>★ Featured</span>
                )}
              </div>
              {industry && <div className="co-ind">{industry}</div>}
              {/* T3-9: Live viewer count */}
              {viewers > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '.65rem', flexWrap: 'wrap', marginTop: '.3rem' }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', color: 'var(--dim)', display: 'flex', alignItems: 'center', gap: '.3rem' }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--green)', display: 'inline-block', animation: 'pulse 1.5s ease infinite' }} />
                    {viewers} Seen users checked this week
                  </div>
                  {score && score.ghost_rate > 0.4 && (
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--amber)', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 100, padding: '.1rem .45rem' }}>
                      ↑ High ghost activity
                    </div>
                  )}
                </div>
              )}
              {/* T3-8: Share buttons */}
              <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginTop: '.6rem' }}>
                <a
                  href={`https://reddit.com/submit?url=${encodeURIComponent(`https://seenjobs.io/company/${slug}`)}&title=${encodeURIComponent(`Is ${companyName} worth applying to? Seen score: ${score?.overall_score ?? '?'}/100`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', background: 'rgba(255,69,0,0.1)', border: '1px solid rgba(255,69,0,0.25)', color: '#ff6314', borderRadius: 6, padding: '.25rem .6rem', textDecoration: 'none' }}
                >
                  🔴 Reddit
                </a>
                <button
                  onClick={() => {
                    navigator.share?.({
                      title: `${companyName} on Seen`,
                      text: `${companyName} has a Seen score of ${score?.overall_score ?? '?'}/100`,
                      url: window.location.href,
                    }).catch(() => {
                      navigator.clipboard?.writeText(window.location.href)
                    })
                  }}
                  style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', background: 'var(--card)', border: '1px solid var(--line2)', color: 'var(--sub)', borderRadius: 6, padding: '.25rem .6rem', cursor: 'pointer' }}
                >
                  ↗ Share
                </button>
                {score && (
                  <button
                    onClick={() => setShowGradeCard(true)}
                    style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', color: '#a5b4fc', borderRadius: 6, padding: '.25rem .6rem', cursor: 'pointer' }}
                  >
                    🖼 Share grade card
                  </button>
                )}
              </div>
            </div>
            {showGradeCard && score && (
              <CompanyScoreCard
                data={{
                  company: companyName,
                  industry: industry || score.industry,
                  overall_score: score.overall_score,
                  ghost_rate: score.ghost_rate,
                  response_rate: score.response_rate,
                  avg_wait_days: score.avg_wait_days,
                  waste: score.waste,
                  // First-party only: the PNG renders "Based on N applicant reports" — feeding it
                  // the fused web claim published the phantom number to social. Its own zero-state
                  // ("Baseline estimate · share your experience") is the honest fallback.
                  report_count: fpReports,
                  risk: score.risk_level,
                  tags: [
                    score.ghost_rate >= 0.5 ? '👻 High ghost rate' : null,
                    score.response_rate >= 0.5 ? '✅ Responsive' : null,
                    (score.waste || 0) >= 50 ? '⚠ High waste risk' : null,
                    (score.avg_wait_days || 0) >= 30 ? '⏳ Long wait times' : null,
                  ].filter(Boolean) as string[],
                }}
                shareUrl={`https://seenjobs.io/company/${slug}`}
                onClose={() => setShowGradeCard(false)}
              />
            )}
            <div className="co-city-filter">
              <input
                type="text"
                placeholder="Filter by city..."
                value={location}
                onChange={e => setLocation(e.target.value)}
                style={{
                  background: 'var(--surface, #111)', border: '1px solid var(--line2)',
                  borderRadius: 6, padding: '.35rem .65rem', color: 'var(--white)',
                  fontFamily: 'var(--mono)', fontSize: '.65rem', outline: 'none',
                  width: 140, caretColor: 'var(--blue)',
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
                  <span className="co-grade-score">{displayScore} / 100</span>
                  {score.data_quality && (
                    <div style={{ marginTop: '.35rem' }}>
                      <DataQualityBadge dq={score.data_quality} reportCount={fpReports} webCount={webEst} />
                    </div>
                  )}
                </div>
                {(fpReports > 0 || webEst > 0) && (
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <span className="co-live">{fpReports > 0 ? `${fpReports} applicant report${fpReports === 1 ? '' : 's'}` : 'web-research estimate'}</span>
                  </div>
                )}
              </div>

              {/* Vibe / explanation tags */}
              <VibeTagList sc={score} />

              {/* Ghost surge alert */}
              <GhostSurgeAlert ghostRate={score.ghost_rate || 0} />

              {/* Emotional ghost rate visual */}
              <GhostVisual ghostRate={score.ghost_rate || 0} count={fpReports} />

              {/* Metrics grid */}
              <div className="co-mets">
                <MetBox label="Score" value={String(displayScore)} color={riskColor(risk)} />
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

        {/* ── Pre-filled CTAs — T3-13 ── */}
        {!loading && (
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <a
              href={`/resume?company=${encodeURIComponent(companyName || '')}`}
              style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)', color: '#fff', borderRadius: 7, padding: '.4rem .9rem', textDecoration: 'none', fontWeight: 700 }}
            >
              ✨ Analyze resume for {companyName}
            </a>
            <a
              href={`/report?company=${encodeURIComponent(companyName || '')}`}
              style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', background: 'var(--card)', border: '1px solid var(--line)', color: 'var(--sub)', borderRadius: 7, padding: '.4rem .9rem', textDecoration: 'none' }}
            >
              📝 Report experience
            </a>
          </div>
        )}

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
                <HiringProbability
                  responseRate={score.response_rate}
                  ghostRate={score.ghost_rate}
                  overallScore={score.overall_score}
                />
                <OutcomeDistribution reports={reports} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: '1rem', marginBottom: '1rem' }}>
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
                {/* Attributed public-record signals (SEC 8-K, etc.) — self-hides when there are none. */}
                <div style={{ marginBottom: '1rem' }}>
                  <CompanyPublicRecord companyName={companyName} />
                </div>
                <div style={{ background: 'var(--raised, #111)', borderRadius: 7, padding: '.7rem .95rem', fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem' }}>
                  <span>📊 {fpReports > 0
                    ? `Based on ${fpReports} applicant report${fpReports === 1 ? '' : 's'}${webEst > 0 ? ' + public web research' : ''}`
                    : webEst > 0
                      ? 'Score estimated from public web research — no first-party applicant reports yet'
                      : 'No reports yet'}</span>
                  <a href="/report" style={{ color: 'var(--green)', textDecoration: 'none', whiteSpace: 'nowrap' }}>+ Add your report →</a>
                </div>
              </div>
            )}

            {/* ── PROCESS SCORE TAB ── */}
            {tab === 'process' && score && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: '1rem', marginBottom: '1rem' }}>
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
                          {isRedditSourced(r.platform) && (
                            <span className="vibe v-n" style={{ fontSize: '.55rem', borderStyle: 'dashed', color: 'var(--dim)' }} title="Imported from a public Reddit thread, not submitted directly to Seen">{PUBLIC_DISCUSSION_LABEL}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </>
                ) : (
                  <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.7rem' }}>
                    {webEst > 0 && fpReports === 0
                      ? <>No first-party reports yet — the score on this page is estimated from public web research.<br /><br /></>
                      : <>No community reports yet.<br /><br /></>}
                    <a href="/report" style={{ color: 'var(--green)', textDecoration: 'none' }}>Be the first to report →</a>
                  </div>
                )}
              </div>
            )}

            {/* ── LOCATIONS TAB ── */}
            {tab === 'locations' && (
              <div>
                {reports.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.7rem' }}>
                    No location data yet — reports populate as applications come in
                  </div>
                ) : (() => {
                  // Group reports by city
                  const cityMap: Record<string, { total: number; ghosted: number }> = {}
                  reports.forEach(r => {
                    const city = r.city || r.location || 'Unknown'
                    if (!cityMap[city]) cityMap[city] = { total: 0, ghosted: 0 }
                    cityMap[city].total += 1
                    if (r.outcome === 'ghosted') cityMap[city].ghosted += 1
                  })
                  const cityRows = Object.entries(cityMap)
                    .map(([city, data]) => ({
                      city,
                      total: data.total,
                      ghostRate: data.ghosted / data.total,
                      responseRate: (data.total - data.ghosted) / data.total,
                    }))
                    .sort((a, b) => b.total - a.total)
                    .slice(0, 6)

                  return (
                    <div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)', marginBottom: '1rem' }}>
                        Location breakdown · {reports.length} reports
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
                        {cityRows.map(row => {
                          const ghostPctVal = Math.round(row.ghostRate * 100)
                          const barColor = row.ghostRate > 0.55 ? 'var(--red)' : row.ghostRate > 0.35 ? 'var(--amber)' : 'var(--green)'
                          return (
                            <div key={row.city} style={{
                              background: 'var(--surface, #111)', border: '1px solid var(--line2)',
                              borderRadius: 8, padding: '.75rem 1rem',
                              display: 'flex', alignItems: 'center', gap: '.85rem', flexWrap: 'wrap',
                            }}>
                              <div style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--white)', minWidth: 120, flexShrink: 0 }}>
                                {row.city}
                              </div>
                              <div style={{ flex: 1, minWidth: 80 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.2rem' }}>
                                  <div style={{ flex: 1, height: 6, background: 'var(--line2)', borderRadius: 3, overflow: 'hidden' }}>
                                    <div style={{ width: `${ghostPctVal}%`, height: '100%', background: barColor, borderRadius: 3, transition: 'width .4s ease' }} />
                                  </div>
                                  <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: barColor, width: 36, textAlign: 'right', flexShrink: 0 }}>
                                    {ghostPctVal}%
                                  </span>
                                </div>
                                <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)' }}>
                                  ghost rate · {Math.round(row.responseRate * 100)}% responded
                                </div>
                              </div>
                              <span style={{
                                fontFamily: 'var(--mono)', fontSize: '.54rem', fontWeight: 600,
                                background: 'var(--card)', border: '1px solid var(--line2)',
                                borderRadius: 100, padding: '.1rem .5rem', color: 'var(--sub)',
                                flexShrink: 0,
                              }}>
                                {row.total} report{row.total !== 1 ? 's' : ''}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}

            {/* ── OPEN ROLES TAB ── */}
            {tab === 'roles' && (
              <div>
                {jobsLoading && (
                  <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.7rem' }}>
                    Searching for open roles at {companyName}…
                  </div>
                )}
                {!jobsLoading && companyJobs.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.7rem' }}>
                    No open roles found right now.<br />
                    <a href={`/jobs?q=${encodeURIComponent(companyName)}`} style={{ color: 'var(--blue)', marginTop: '.6rem', display: 'inline-block' }}>Search jobs →</a>
                  </div>
                )}
                {!jobsLoading && companyJobs.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
                    {companyJobs.map((j, i) => (
                      <div key={i} className="jlc" style={{ display: 'flex', flexDirection: 'column', gap: '.35rem', padding: '.85rem 1rem', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap' }}>
                          <span className="jlc-title" style={{ fontSize: '.95rem', fontWeight: 700, color: 'var(--white)', letterSpacing: '-.02em', flex: 1 }}>{j.title}</span>
                          {j.salary && <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--green)', whiteSpace: 'nowrap' }}>{j.salary}</span>}
                        </div>
                        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)' }}>{j.location || 'US'}</span>
                          <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)' }}>·</span>
                          <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)' }}>{j.type}</span>
                          <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)' }}>·</span>
                          <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)' }}>{j.level}</span>
                          {j.source && <><span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)' }}>·</span><span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)' }}>{j.source}</span></>}
                        </div>
                        {j.url && (
                          <a href={j.url} target="_blank" rel="noopener noreferrer" className="analyze-btn" style={{ display: 'inline-block', textAlign: 'center', padding: '.45rem 1rem', fontSize: '.7rem', marginTop: '.2rem', width: 'auto', alignSelf: 'flex-start' }}>
                            Apply → 1 credit
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── REDDIT TAB ── */}
            {tab === 'reddit' && (
              <div>
                {/* LIVE, cached per-company Reddit search — populates on demand so this
                    section is (almost) never empty, and never blocks page render. Every
                    item is an attributed link to a public thread; includes the dispute path. */}
                <CompanyRedditDiscussion companyName={companyName} hasReportData={reports.length > 0 || !!score} />

                {/* Secondary: the AI-summarized cross-source insights from the scoring
                    pipeline (Reddit/Glassdoor/Blind), when the batch enrichment has them. */}
                {!loading && webReviews.length > 0 && (
                  <div style={{ marginTop: '1.75rem', borderTop: '1px solid var(--line2)', paddingTop: '1.25rem' }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--dim)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--amber)', display: 'inline-block', flexShrink: 0 }} />
                      AI-summarized insights · Reddit, Glassdoor &amp; Blind · updated every 30 days
                    </div>
                    <WebReviewsSection reviews={webReviews} />
                  </div>
                )}
              </div>
            )}

            {/* ── COMPARE TAB ── */}
            {tab === 'compare' && (
              <div>
                {/* Add company input */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)', marginBottom: '.6rem' }}>
                    Compare {companyName} with another company
                  </div>
                  <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                    <input
                      type="text"
                      placeholder="Company name (e.g. Google)"
                      value={compareInput}
                      onChange={e => setCompareInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && compareInput.trim() && compareList.length < 2) {
                          const name = compareInput.trim()
                          setCompareList(prev => [...prev, { name, score: null, loading: true }])
                          setCompareInput('')
                          fetch('/api/reports', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ name }),
                          })
                            .then(r => r.ok ? r.json() : { score: null })
                            .then(d => setCompareList(prev => prev.map(c => c.name === name ? { ...c, score: d.score ?? null, loading: false } : c)))
                            .catch(() => setCompareList(prev => prev.map(c => c.name === name ? { ...c, loading: false } : c)))
                        }
                      }}
                      disabled={compareList.length >= 2}
                      style={{
                        flex: 1, minWidth: 200, background: 'var(--surface, #111)', border: '1px solid var(--line2)',
                        borderRadius: 6, padding: '.45rem .7rem', color: 'var(--white)',
                        fontFamily: 'var(--mono)', fontSize: '.68rem', outline: 'none',
                        opacity: compareList.length >= 2 ? 0.5 : 1,
                      }}
                    />
                    <button
                      disabled={!compareInput.trim() || compareList.length >= 2}
                      onClick={() => {
                        const name = compareInput.trim()
                        if (!name || compareList.length >= 2) return
                        setCompareList(prev => [...prev, { name, score: null, loading: true }])
                        setCompareInput('')
                        fetch('/api/reports', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ name }),
                        })
                          .then(r => r.ok ? r.json() : { score: null })
                          .then(d => setCompareList(prev => prev.map(c => c.name === name ? { ...c, score: d.score ?? null, loading: false } : c)))
                          .catch(() => setCompareList(prev => prev.map(c => c.name === name ? { ...c, loading: false } : c)))
                      }}
                      style={{
                        background: 'linear-gradient(135deg,rgba(99,102,241,0.15),rgba(16,185,129,0.15))',
                        border: '1px solid rgba(99,102,241,0.3)', borderRadius: 6,
                        color: 'var(--blue)', fontFamily: 'var(--mono)', fontSize: '.68rem',
                        padding: '.45rem 1rem', cursor: compareList.length >= 2 ? 'not-allowed' : 'pointer',
                        opacity: !compareInput.trim() || compareList.length >= 2 ? 0.5 : 1,
                        flexShrink: 0,
                      }}
                    >
                      Compare →
                    </button>
                    {compareList.length > 0 && (
                      <button
                        onClick={() => setCompareList([])}
                        style={{
                          background: 'none', border: '1px solid var(--line2)', borderRadius: 6,
                          color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.65rem',
                          padding: '.45rem .75rem', cursor: 'pointer', flexShrink: 0,
                        }}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  {compareList.length >= 2 && (
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', color: 'var(--muted)', marginTop: '.35rem' }}>
                      Max 2 companies added (1 current + 2 comparison)
                    </div>
                  )}
                </div>

                {/* Comparison table */}
                {compareList.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.68rem', background: 'var(--surface, #111)', border: '1px solid var(--line2)', borderRadius: 10 }}>
                    Add a company to compare
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--mono)', fontSize: '.65rem' }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left', padding: '.55rem .75rem', color: 'var(--muted)', fontWeight: 500, fontSize: '.54rem', textTransform: 'uppercase', letterSpacing: '.08em', borderBottom: '1px solid var(--line2)', minWidth: 120 }}>
                            Metric
                          </th>
                          {/* Current company column */}
                          <th style={{ textAlign: 'center', padding: '.55rem .75rem', borderBottom: '1px solid var(--line2)', minWidth: 130 }}>
                            <div style={{ color: 'var(--white)', fontWeight: 700, fontSize: '.68rem', marginBottom: '.15rem' }}>{companyName}</div>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--blue)', textTransform: 'uppercase', letterSpacing: '.08em' }}>current</div>
                          </th>
                          {/* Added companies columns */}
                          {compareList.map(c => (
                            <th key={c.name} style={{ textAlign: 'center', padding: '.55rem .75rem', borderBottom: '1px solid var(--line2)', minWidth: 130 }}>
                              <div style={{ color: 'var(--white)', fontWeight: 700, fontSize: '.68rem', marginBottom: '.15rem' }}>{c.name}</div>
                              {c.loading && <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--muted)' }}>loading…</div>}
                              {!c.loading && !c.score && <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--red)' }}>no data</div>}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          {
                            label: 'Score',
                            current: score ? String(score.overall_score) : '—',
                            get: (sc: CompanyScore | null) => sc ? String(sc.overall_score) : '—',
                            currentColor: score ? riskColor(Score.risk(score.overall_score)) : 'var(--muted)',
                            getColor: (sc: CompanyScore | null) => sc ? riskColor(Score.risk(sc.overall_score)) : 'var(--muted)',
                          },
                          {
                            label: 'Ghost %',
                            current: score ? pct(score.ghost_rate) : '—',
                            get: (sc: CompanyScore | null) => sc ? pct(sc.ghost_rate) : '—',
                            currentColor: ghostColor,
                            getColor: (sc: CompanyScore | null) => sc ? ((sc.ghost_rate > 0.5) ? 'var(--red)' : (sc.ghost_rate > 0.3) ? 'var(--amber)' : 'var(--green)') : 'var(--muted)',
                          },
                          {
                            label: 'Response %',
                            current: score ? pct(score.response_rate) : '—',
                            get: (sc: CompanyScore | null) => sc ? pct(sc.response_rate) : '—',
                            currentColor: 'var(--blue)',
                            getColor: () => 'var(--blue)',
                          },
                          {
                            label: 'Avg wait days',
                            current: score ? `${score.avg_wait_days ?? '—'}d` : '—',
                            get: (sc: CompanyScore | null) => sc ? `${sc.avg_wait_days ?? '—'}d` : '—',
                            currentColor: waitColor,
                            getColor: (sc: CompanyScore | null) => sc ? ((sc.avg_wait_days || 0) > 21 ? 'var(--amber)' : 'var(--text)') : 'var(--muted)',
                          },
                        ].map((row, i) => (
                          <tr key={row.label} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                            <td style={{ padding: '.55rem .75rem', color: 'var(--muted)', fontSize: '.6rem', borderBottom: '1px solid var(--line2)' }}>
                              {row.label}
                            </td>
                            <td style={{ textAlign: 'center', padding: '.55rem .75rem', fontWeight: 600, color: row.currentColor, borderBottom: '1px solid var(--line2)', fontSize: '.72rem' }}>
                              {row.current}
                            </td>
                            {compareList.map(c => (
                              <td key={c.name} style={{ textAlign: 'center', padding: '.55rem .75rem', fontWeight: 600, color: c.loading ? 'var(--muted)' : row.getColor(c.score), borderBottom: '1px solid var(--line2)', fontSize: '.72rem' }}>
                                {c.loading ? '…' : row.get(c.score)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
