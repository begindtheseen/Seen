'use client'

import { useState, useEffect, useRef, use, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Score } from '@/lib/score'
import { useAuth } from '@/lib/auth'
import { AppStore } from '@/lib/stores/AppStore'
import HiringProbability from '@/components/HiringProbability'
import CompanyScoreCard from '@/components/CompanyScoreCard'
import { isPublicDiscussion, isEmployeeReview, isImportedReview, reportDate, reportSourceBadge, reportSourceLink, sortReportsByDate } from '@/lib/reportSource'
import ReportSourceLink from '@/components/ReportSourceLink'
import { aggregateJobLocations } from '@/lib/jobLocations'
import CompanyRedditDiscussion, { type RedditDiscussionResult } from '@/components/CompanyRedditDiscussion'
import CompanyPublicRecord from '@/components/CompanyPublicRecord'
import IndustryBenchmark, { type Benchmark } from '@/components/IndustryBenchmark'
import Odometer from '@/components/motion/Odometer'
import { isGradeableScore, notEnoughReviewsLabel, gradeBasisLabel, MIN_REPORTS_FOR_GRADE } from '@/lib/gradeGate'
import { Crumbs } from '@/components/shell/PageHeader'
import ListingSignals from '@/components/ListingSignals'
import { gradeLetter, displayCompanyName, isResolvedOutcome, lastUpdatedLabel } from '@/lib/companyDisplay'

// ── Types ──────────────────────────────────────────────────────────────────────

// Grade gate (lib/gradeGate.ts): below MIN_REPORTS_FOR_GRADE real reports the API sends
// gradeable:false and every verdict field below as null — the page shows reports, not a grade.
interface CompanyScore {
  gradeable?: boolean
  overall_score: number | null
  response_rate: number | null
  ghost_rate: number | null
  avg_wait_days: number | null
  avg_rounds: number | null
  waste: number | null
  report_count: number
  first_party_report_count?: number
  web_report_count?: number
  mention_count?: number
  /** Employee reviews behind the grade — they move it by their letter grades (lib/server/employeeReviews.js). */
  employee_review_count?: number
  risk_level: 'safe' | 'warn' | 'danger' | null
  process_score?: number | null
  data_quality?: string
  data_source?: string
  industry?: string
  summary?: string
  web_reviews?: WebReview[]
  /** When the score was last (re)computed (api/reports.js _rowToScore). */
  updated_at?: string | null
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
  kind?: 'employee_review' | 'public_commentary' | 'applicant_outcome'
  url?: string
}

type SectionKey = 'odds' | 'breakdown' | 'reports' | 'online' | 'reddit' | 'locations' | 'roles' | 'compare' | 'about'

// ── Helpers ────────────────────────────────────────────────────────────────────

// ONE grade scale for the page, the sticky strip, the share card and the OG image (lib/companyDisplay.ts).
const letterGrade = (score: number): string => gradeLetter(score)

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
  // Integer figures ("48%", "12d", "16") roll in (components/motion/Odometer); anything else
  // ("—", "1.5") renders as text.
  const m = /^(\d{1,4})(%|d)?$/.exec(value)
  return (
    <div className={`co-m${alarm ? ' co-alarm' : ''}`}>
      <span className="co-mn" style={color ? { color } : undefined}>{m ? <Odometer value={Number(m[1])} suffix={m[2]} /> : value}</span>
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

// Every kind of evidence behind the grade, so the count matches the math: applicant reports (rates),
// employee reviews (their letter grades adjust the score) and online mentions (½ a report each).
function evidenceLine(reportCount: number, employeeCount = 0, mentionCount = 0): string {
  const parts = [`${reportCount} applicant report${reportCount === 1 ? '' : 's'}`]
  if (employeeCount > 0) parts.push(`${employeeCount} employee review${employeeCount === 1 ? '' : 's'}`)
  if (mentionCount > 0) parts.push(`${mentionCount} online mention${mentionCount === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

function DataQualityBadge({ dq, reportCount, webCount = 0, employeeCount = 0, mentionCount = 0 }: { dq: string; reportCount: number; webCount?: number; employeeCount?: number; mentionCount?: number }) {
  // reportCount here is FIRST-PARTY applicant reports only. With zero first-party rows the
  // score is a web-research estimate — say exactly that; never mint "High confidence · N
  // reports" from the LLM's claimed mention count (that number looked fake because it was).
  if (reportCount === 0) {
    return (
      <span className="co-dq" style={{ color: 'var(--amber)' }}>
        🌐 {webCount > 0 ? 'Web-research estimate — no first-party reports yet' : 'Estimated'}
      </span>
    )
  }
  const n = evidenceLine(reportCount, employeeCount, mentionCount)
  const map: Record<string, { emoji: string; label: string; color: string }> = {
    strong:   { emoji: '🟢', label: `High confidence · ${n}`,     color: 'var(--green)' },
    moderate: { emoji: '🟡', label: `Moderate confidence · ${n}`, color: 'var(--amber)' },
    limited:  { emoji: '🟡', label: `Low confidence · ${n}`,      color: 'var(--amber)' },
    medium:   { emoji: '🟡', label: `Moderate confidence · ${n}`, color: 'var(--amber)' },
    low:      { emoji: '🔴', label: `Low confidence · ${n}`,      color: 'var(--red)'   },
    high:     { emoji: '🟢', label: `High confidence · ${n}`,     color: 'var(--green)' },
  }
  const info = map[dq] || { emoji: '🔴', label: 'Estimated', color: 'var(--red)' }
  return (
    <span className="co-dq" style={{ color: info.color }}>
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

/** Ghost stages named in the ghosted reports: [{ label, n, pct }] sorted by count. Empty when none named one. */
function ghostStageRows(reports: Report[]): Array<{ label: string; n: number; pct: number }> {
  const counts: Record<string, number> = {}
  for (const r of reports) {
    if (r.outcome !== 'ghosted' || !r.ghost_stage) continue
    const k = String(r.ghost_stage).replace(/_/g, ' ').trim().toLowerCase()
    if (k) counts[k] = (counts[k] || 0) + 1
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label: label.charAt(0).toUpperCase() + label.slice(1), n, pct: Math.round((n / total) * 100) }))
}

function HiringFunnel({ rows }: { rows: Array<{ label: string; n: number; pct: number }> }) {
  const palette = ['var(--red)', 'var(--amber)', 'var(--blue)', 'var(--sub, #888)', 'var(--dim)']
  const stages = rows.slice(0, 5).map((r, i) => ({ label: r.label, pct: r.pct, color: palette[i] || 'var(--dim)', note: i === 0 ? '← most here' : undefined }))
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
      <div className="co-sec-lbl" style={{ marginBottom: '.75rem' }}>
        What people are saying online
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
              {rv.source && <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)' }}>{rv.kind === 'employee_review' ? 'Employee review · ' : ''}{rv.source}</span>}
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
            className="co-track-input"
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
    { label: 'Ghosted',   count: dist.ghosted || 0,                                                   color: 'var(--red)' },
    { label: 'Rejected',  count: (dist.rejected || 0) + (dist.autoreject || 0),                       color: 'var(--amber)' },
    { label: 'Interview', count: (dist.interview || 0) + (dist.human || 0) + (dist.interviewing || 0), color: 'var(--blue)' },
    { label: 'Hired',     count: (dist.hired || 0) + (dist.offer || 0),                               color: 'var(--green)' },
    { label: 'Waiting',   count: dist.waiting || 0,                                                    color: 'var(--dim)' },
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

// Truthful "self-filling" status: the company is queued for the public-discussion enrichment cron.
function EnrichmentNotice({ companyName }: { companyName: string }) {
  return (
    <div role="status" style={{ marginTop: '.75rem', fontFamily: 'var(--mono)', fontSize: '.66rem', color: 'var(--sub)', lineHeight: 1.6 }}>
      We&apos;re gathering public hiring discussions about <span style={{ textTransform: 'capitalize' }}>{companyName}</span> — check back shortly.
    </div>
  )
}

// ── Collapsible section ────────────────────────────────────────────────────────
// Every block below the hero is one of these: a header row that always shows a truthful,
// data-derived one-line summary, and a body that renders only while open (so sections that
// fetch — roles, locations, Reddit — fetch on demand). Nothing is removed from the page;
// it is just not expanded until asked for.
function Section({ id, icon, title, summary, count, open, onToggle, children }: {
  id: SectionKey; icon: string; title: string; summary?: ReactNode; count?: number | null
  open: boolean; onToggle: (id: SectionKey) => void; children: ReactNode
}) {
  return (
    <section className={`co-sec${open ? ' open' : ''}`} id={`sec-${id}`}>
      <button type="button" className="co-sec-hd" aria-expanded={open} aria-controls={`sec-${id}-body`} onClick={() => onToggle(id)}>
        <span className="co-sec-ico" aria-hidden>{icon}</span>
        <span className="co-sec-txt">
          <span className="co-sec-ttl">{title}{count != null && count > 0 ? <span className="co-sec-cnt">{count}</span> : null}</span>
          {summary ? <span className="co-sec-sum">{summary}</span> : null}
        </span>
        <span className="co-sec-chev" aria-hidden>{open ? '−' : '+'}</span>
      </button>
      {open && <div className="co-sec-body" id={`sec-${id}-body`}>{children}</div>}
    </section>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function CompanyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const companyName = decodeURIComponent(slug).replace(/-/g, ' ')
  // How the company is shown everywhere on this page ("walmart" → "Walmart", "aaa" → "AAA"). Lookups
  // keep using the lowercase slug name; only the rendering changes (lib/companyDisplay.ts).
  const displayName = displayCompanyName(companyName)
  // The report form is pre-filled with this company, named the way this page shows it, so "Report
  // experience" from a company page never asks which company again.
  const reportHref = `/report?company=${encodeURIComponent(displayName)}&from=company`

  const [reports, setReports] = useState<Report[]>([])
  const [score, setScore] = useState<CompanyScore | null>(null)
  const [industry, setIndustry] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notFound, setNotFound] = useState(false)
  // Self-filling pages: the score API reports when this company is queued for public-discussion
  // enrichment (api/enrich-companies cron). Only 'queued' / 'running' ever render a line.
  const [enrichmentStatus, setEnrichmentStatus] = useState<string | null>(null)
  // Which sections are expanded. The first ("odds") opens by default so the page is never a bare
  // list of closed rows; a #hash in the URL (e.g. /company/x#reports) opens that section instead.
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({
    odds: true, breakdown: false, reports: false, online: false, reddit: false,
    locations: false, roles: false, compare: false, about: false,
  })
  const toggle = (id: SectionKey) => setOpen(prev => ({ ...prev, [id]: !prev[id] }))
  const openSection = (id: SectionKey) => {
    setOpen(prev => ({ ...prev, [id]: true }))
    requestAnimationFrame(() => document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const [location, setLocation] = useState('')
  const [webReviews, setWebReviews] = useState<WebReview[]>([])
  const [benchmark, setBenchmark] = useState<Benchmark | null>(null)
  // Approved employer replies to reports, keyed by report id (Wave 2). Display-only employer voice,
  // never a score input — clearly labeled as the employer's claim.
  const [employerReplies, setEmployerReplies] = useState<Record<string, { body: string; created_at: string }>>({})
  const [perk, setPerk] = useState<{ featured: boolean; verified: boolean }>({ featured: false, verified: false })
  useEffect(() => {
    let alive = true
    fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'employer_perk', name: companyName }) })
      .then(r => r.json()).then(d => { if (alive && d) setPerk({ featured: !!d.featured, verified: !!d.verified }) }).catch(() => {})
    return () => { alive = false }
  }, [companyName])
  // Reddit discussion is fetched by the page (cache-first endpoint) so the SECTION can be hidden when
  // fewer than two relevant threads exist — one coincidental thread is not "discussion". null = not
  // answered yet (the section shows while checking).
  const [reddit, setReddit] = useState<RedditDiscussionResult | null>(null)
  useEffect(() => {
    let alive = true
    fetch('/api/company-reddit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company: companyName }) })
      .then(r => r.json().catch(() => ({})))
      .then((j: { items?: RedditDiscussionResult['items']; status?: string }) => {
        if (!alive) return
        const items = Array.isArray(j.items) ? j.items : []
        setReddit({ items, status: j.status === 'checking' ? 'checking' : items.length ? 'ok' : 'empty' })
      })
      .catch(() => { if (alive) setReddit({ items: [], status: 'error' }) })
    return () => { alive = false }
  }, [companyName])
  const [companyJobs, setCompanyJobs] = useState<Array<{title:string;company:string;location:string;salary:string|null;url:string|null;source:string;type:string;level:string;score:number}>>([])
  const [jobsLoading, setJobsLoading] = useState(false)
  const [jobsFetched, setJobsFetched] = useState(false)
  const [compareInput, setCompareInput] = useState('')
  const [compareList, setCompareList] = useState<Array<{name: string; score: CompanyScore | null; loading: boolean}>>([])
  // Reports render in pages of 5 — "Show more" reveals the rest; nothing is hidden for good.
  const [reportsShown, setReportsShown] = useState(5)
  const [copied, setCopied] = useState(false)
  // Sticky context strip: once the hero's grade card scrolls under the nav, a slim bar keeps the
  // company + grade in view with a way back — the page can be long, the context never leaves.
  const heroRef = useRef<HTMLDivElement | null>(null)
  const [stuck, setStuck] = useState(false)
  // Portal target: render the strip on <body> so no transformed/filtered ancestor can ever become its
  // containing block (.page-full's entrance animation used to hold a transform — see globals.css pageIn).
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    const el = heroRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([entry]) => {
      setStuck(!entry.isIntersecting && entry.boundingClientRect.top < 0)
    }, { rootMargin: '-58px 0px 0px 0px', threshold: 0 })
    io.observe(el)
    return () => io.disconnect()
  }, [loading])
  function goBack() {
    let sameSite = false
    try { sameSite = !!document.referrer && new URL(document.referrer).origin === window.location.origin } catch {}
    if (sameSite && window.history.length > 1) window.history.back()
    else window.location.href = '/companies'
  }

  const [showGradeCard, setShowGradeCard] = useState(false)
  const [myApp, setMyApp] = useState<{company: string; role: string; status: string; stage: string; appliedAt: number; daysSince: number} | null>(null)

  // Deep link: /company/<slug>#reports opens that section on load.
  useEffect(() => {
    const h = (window.location.hash || '').replace('#', '') as SectionKey
    if (h && h in open) setOpen(prev => ({ ...prev, [h]: true }))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  // (The "N Seen users checked this week" line was a hash of the slug + day, not data. Removed —
  // Seen shows no visitor counts it does not have.)

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
          // Newest experience first by its REAL date (imported rows: the source's posted date).
          if (rJson.reports) setReports(sortReportsByDate(rJson.reports))
        }

        // Approved employer replies for this company, keyed by report id (best-effort, public).
        try {
          const repRes = await fetch(`/api/employer-replies?company=${encodeURIComponent(companyName)}`)
          if (repRes.ok) {
            const repJson = await repRes.json() as { replies?: Record<string, { body: string; created_at: string }> }
            if (repJson.replies) setEmployerReplies(repJson.replies)
          }
        } catch { /* replies are additive — a failure just hides them */ }

        // Fetch score from company-score endpoint
        const sRes = await fetch('/api/reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: companyName }),
        })
        if (sRes.ok) {
          const sJson = await sRes.json() as { score?: CompanyScore; ok?: boolean; not_found?: boolean; enrichment?: { status?: string } }
          setEnrichmentStatus(typeof sJson.enrichment?.status === 'string' ? sJson.enrichment.status : null)
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

  // Industry benchmark — how this company ranks vs its sector on Seen (public aggregate). Turns a
  // bare score into authoritative context. Fail-soft: the page renders fine without it.
  useEffect(() => {
    let alive = true
    fetch('/api/reports', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'industry_benchmark', name: companyName }),
    })
      .then(r => (r.ok ? r.json() : { benchmark: null }))
      .then(d => { if (alive) setBenchmark((d?.benchmark as Benchmark) || null) })
      .catch(() => {})
    return () => { alive = false }
  }, [companyName])

  // Fetch open roles when the roles OR locations section is first opened — one shared request (the
  // Locations section's "Where <company> is hiring" aggregates these same listings).
  useEffect(() => {
    if ((!open.roles && !open.locations) || jobsFetched) return
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
  }, [open.roles, open.locations, companyName, jobsFetched])

  // Compare: Enter key and the button share one path.
  function addCompare() {
    const name = compareInput.trim()
    if (!name || compareList.length >= 2) return
    if (compareList.some(c => c.name.toLowerCase() === name.toLowerCase()) || name.toLowerCase() === companyName.toLowerCase()) {
      setCompareInput('')
      return
    }
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

  function share() {
    const url = window.location.href.split('#')[0]
    const data = {
      title: `${displayName} on Seen`,
      text: isGradeableScore(score)
        ? `${displayName} has a Seen score of ${score.overall_score}/100 (${letterGrade(score.overall_score)})`
        : `${displayName} on Seen — real applicant reports on how they hire`,
      url,
    }
    if (navigator.share) { navigator.share(data).catch(() => {}); return }
    navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800) }).catch(() => {})
  }

  // Only a gradeable score is a verdict — below the report bar there is no letter, number or risk.
  const graded = isGradeableScore(score)
  const risk = graded ? Score.risk(score.overall_score) : 'warn'
  const g = graded ? letterGrade(score.overall_score) : '—'
  const ungradedLabel = score && !graded ? notEnoughReviewsLabel(score) : ''
  // Honest count split (migration 063). Legacy payloads without the split fields infer from
  // data_source: only 'reports'-derived scores were counted from real rows — anything else is
  // the web-research pipeline's *claimed* number, which must never render as "reports".
  const fpReports = score ? (score.first_party_report_count ?? (score.data_source === 'reports' ? (score.report_count || 0) : 0)) : 0
  const webEst = score ? (score.web_report_count ?? (score.data_source === 'reports' ? 0 : (score.report_count || 0))) : 0
  // Honest status line: only while the enrichment worker has this company queued/running AND the
  // page has no first-party reports to show. It promises nothing about what will be found.
  const gatheringPublic = !loading && fpReports === 0 && reports.length === 0 && (enrichmentStatus === 'queued' || enrichmentStatus === 'running')
  const logoLetter = (companyName[0] || '?').toUpperCase()
  const ghostRate = graded ? score.ghost_rate || 0 : 0
  const ghostHigh = ghostRate > 0.5
  const ghostPct = graded ? (ratePct(score.ghost_rate) ?? 0) : 0
  const respPct = graded ? (ratePct(score.response_rate) ?? 0) : 0
  const ghostColor = ghostHigh ? 'var(--red)' : ghostRate > 0.3 ? 'var(--amber)' : 'var(--green)'
  const waitColor = (score?.avg_wait_days || 0) > 21 ? 'var(--amber)' : 'var(--text)'
  const wasteColor = (score?.waste || 0) > 60 ? 'var(--red)' : (score?.waste || 0) > 30 ? 'var(--amber)' : 'var(--green)'

  // One plain-English line a first-time visitor can act on, built only from the numbers shown.
  const verdict = graded ? (() => {
    const wait = score.avg_wait_days != null ? ` Typical wait to hear back: ${score.avg_wait_days} days.` : ''
    if (ghostRate >= 0.5) return `Most applicants never hear back — ${Math.round(ghostRate * 10)} in 10 are ghosted.${wait}`
    if ((score.response_rate || 0) >= 0.75) return `Most applicants hear back — ${respPct}% get a response.${wait}`
    return `Mixed: about ${respPct}% of applicants hear back, ${ghostPct}% are ghosted.${wait}`
  })() : ''

  // Report outcome counts for the section summary + distribution (reused by two blocks). Employee
  // reviews are shown but are NOT hiring outcomes, so they never enter these counts (same rule as
  // the score — lib/server/reportCounts.js).
  const hiringReports = reports.filter(r => !isEmployeeReview(r))
  const employeeN = reports.length - hiringReports.length
  // "Applicant reports" = rows with a decided outcome — the same rows the grade is built from
  // (lib/server/reportCounts.js scorableResolvedCountPath). Rows still "waiting" are listed but counted
  // apart: the header said "48 applicant reports" while this section said 77 (29 were waiting).
  const outcomeReports = hiringReports.filter(r => isResolvedOutcome(r.outcome))
  const waitingN = hiringReports.length - outcomeReports.length
  const oc = outcomeReports.reduce((m, r) => { const k = r.outcome || 'unknown'; m[k] = (m[k] || 0) + 1; return m }, {} as Record<string, number>)
  const ghostedN = oc.ghosted || 0
  const hiredN = (oc.hired || 0) + (oc.offer || 0)
  const interviewN = (oc.interview || 0) + (oc.human || 0) + (oc.interviewing || 0)
  const thirdPartyN = outcomeReports.filter(r => isPublicDiscussion(r.platform)).length
  const importedN = outcomeReports.filter(r => isImportedReview(r.platform)).length
  const seenN = outcomeReports.length - thirdPartyN - importedN
  // The list: what was submitted to Seen first, then everything compiled from public discussion and
  // review sites under its own heading — a raw Reddit quote must never look like a Seen user's report.
  const seenRows = reports.filter(r => !isPublicDiscussion(r.platform) && !isImportedReview(r.platform))
  const publicRows = reports.filter(r => isPublicDiscussion(r.platform) || isImportedReview(r.platform))
  const updatedLine = graded ? lastUpdatedLabel(score.updated_at) : ''

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

  // ── Locations data (derived; cheap) ──
  const cityMap: Record<string, { total: number; ghosted: number }> = {}
  let reportsWithCity = 0
  reports.forEach(r => {
    const city = (r.city || r.location || '').trim()
    if (!city) return
    reportsWithCity += 1
    if (!cityMap[city]) cityMap[city] = { total: 0, ghosted: 0 }
    cityMap[city].total += 1
    if (r.outcome === 'ghosted') cityMap[city].ghosted += 1
  })
  const cityRows = Object.entries(cityMap)
    .map(([city, data]) => ({ city, total: data.total, ghostRate: data.ghosted / data.total, responseRate: (data.total - data.ghosted) / data.total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6)
  const hiring = aggregateJobLocations(companyJobs, { top: 8 })
  const hiringRows = [...(hiring.remote > 0 ? [{ label: 'Remote', count: hiring.remote }] : []), ...hiring.places].sort((a, b) => b.count - a.count)
  const maxCount = hiringRows.reduce((m, r) => Math.max(m, r.count), 0)
  const capped = hiring.listings >= 20
  const sectionNote: CSSProperties = { fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', marginBottom: '1rem', lineHeight: 1.6 }

  // Compare cells: an ungraded company shows "Not graded" / "—", never a number standing in for one.
  const cmpScore = (sc: CompanyScore | null) => !sc ? '—' : isGradeableScore(sc) ? String(sc.overall_score) : 'Not graded'
  const cmpScoreColor = (sc: CompanyScore | null) => isGradeableScore(sc) ? riskColor(Score.risk(sc.overall_score)) : 'var(--muted)'
  const cmpGhostColor = (sc: CompanyScore | null) => {
    if (!isGradeableScore(sc) || sc.ghost_rate == null) return 'var(--muted)'
    return sc.ghost_rate > 0.5 ? 'var(--red)' : sc.ghost_rate > 0.3 ? 'var(--amber)' : 'var(--green)'
  }
  const cmpWait = (sc: CompanyScore | null) => isGradeableScore(sc) && sc.avg_wait_days != null ? `${sc.avg_wait_days}d` : '—'
  const compareRows = [
    {
      label: 'Score',
      current: cmpScore(score),
      get: cmpScore,
      currentColor: cmpScoreColor(score),
      getColor: cmpScoreColor,
    },
    {
      label: 'Ghost %',
      current: graded ? pct(score.ghost_rate) : '—',
      get: (sc: CompanyScore | null) => isGradeableScore(sc) ? pct(sc.ghost_rate) : '—',
      currentColor: cmpGhostColor(score),
      getColor: cmpGhostColor,
    },
    {
      label: 'Response %',
      current: graded ? pct(score.response_rate) : '—',
      get: (sc: CompanyScore | null) => isGradeableScore(sc) ? pct(sc.response_rate) : '—',
      currentColor: graded ? 'var(--blue)' : 'var(--muted)',
      getColor: (sc: CompanyScore | null) => isGradeableScore(sc) ? 'var(--blue)' : 'var(--muted)',
    },
    {
      label: 'Avg wait',
      current: cmpWait(score),
      get: cmpWait,
      currentColor: graded ? waitColor : 'var(--muted)',
      getColor: (sc: CompanyScore | null) => isGradeableScore(sc) ? ((sc.avg_wait_days || 0) > 21 ? 'var(--amber)' : 'var(--text)') : 'var(--muted)',
    },
  ]

  return (
    <div className="page-full">
      <div className="co-page">
        {/* Where you are: Dashboard › Companies › {name} — the same trail every inner page carries. */}
        <Crumbs items={[{ href: '/companies', label: 'Companies' }]} current={displayName} />

        {/* ── "You applied here" context strip ── */}
        {myApp && (
          <div className="co-myapp">
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
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

        {/* ── Sticky context strip (appears once the hero scrolls away) ── */}
        {mounted && createPortal(
          <div className={`co-sticky${stuck ? ' show' : ''}`} aria-hidden={!stuck}>
            <div className="co-sticky-in">
              <button type="button" className="co-sticky-back" onClick={goBack} aria-label="Back" tabIndex={stuck ? 0 : -1}>←</button>
              <span className="co-sticky-logo" aria-hidden>{logoLetter}</span>
              <span className="co-sticky-name">{displayName}</span>
              {graded && (
                <span className="co-sticky-grade">
                  <span className={`co-sticky-letter ${risk}`}>{g}</span>
                  <span className="co-sticky-score">{score.overall_score}<span>/100</span></span>
                </span>
              )}
            </div>
          </div>,
          document.body
        )}

        {/* ── Hero: who, the grade, one verdict, the numbers — each shown exactly once ── */}
        <div className="co-hdr" ref={heroRef}>
          <div className="co-top">
            <div className="co-logo-lg">{logoLetter}</div>
            <div className="co-id">
              <div className="co-name">
                {displayName}
                {perk.verified && (
                  <span className="co-badge co-badge-verified" title="This employer committed to responding to applicants. Reviewed against real outcome data — it never affects the transparency score.">✓ Transparency Verified</span>
                )}
                {perk.featured && (
                  <span className="co-badge co-badge-featured" title="Featured employer — paid placement. Never affects the transparency score.">★ Featured</span>
                )}
              </div>
              <div className="co-ind">
                {industry ? <span>{industry}</span> : null}
              </div>
            </div>
          </div>

          {loading ? (
            /* Skeleton mirrors the grade card + stat row it's about to become. */
            <div aria-label="Loading company data" role="status" style={{ display: 'flex', flexDirection: 'column', gap: '.8rem', padding: '.4rem 0 .2rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div className="sk" style={{ width: 64, height: 64, borderRadius: 14, flexShrink: 0 }} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
                  <div className="sk" style={{ width: '34%', height: 14 }} />
                  <div className="sk" style={{ width: '52%', height: 10 }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '.8rem' }}>
                <div className="sk" style={{ flex: 1, height: 58, borderRadius: 12 }} />
                <div className="sk" style={{ flex: 1, height: 58, borderRadius: 12 }} />
                <div className="sk" style={{ flex: 1, height: 58, borderRadius: 12 }} />
              </div>
            </div>
          ) : error ? (
            <div style={{ background: 'var(--rdim, rgba(239,68,68,.08))', border: '1px solid rgba(239,68,68,.25)', borderRadius: 8, padding: '1rem', fontFamily: 'var(--mono)', fontSize: '.72rem', color: 'var(--red)', textAlign: 'center' }}>
              {error}
            </div>
          ) : score && !graded ? (
            /* Below the report bar: no letter, score, rates or vibe tags — just what we actually hold. */
            <div className="co-grade-bar warn" role="status">
              <div className="co-grade-letter warn" aria-hidden style={{ fontSize: '1.4rem' }}>—</div>
              <div className="co-grade-main">
                <span className="co-grade-lbl">Seen Grade</span>
                <span className="co-grade-score" style={{ fontSize: '.95rem' }}>{ungradedLabel}</span>
                <p className="co-verdict">
                  {fpReports > 0
                    ? `We have ${gradeBasisLabel(score)} for ${displayName} so far. A grade appears at ${MIN_REPORTS_FOR_GRADE} — each report counts 1, each thing people say online counts ½.`
                    : `No applicant reports for ${displayName} yet. A grade appears once ${MIN_REPORTS_FOR_GRADE} real reports are in.`}
                </p>
                <div className="co-grade-meta">
                  <a href={reportHref} className="co-live" style={{ textDecoration: 'none' }}>+ Add yours to help grade it</a>
                </div>
              </div>
            </div>
          ) : graded ? (
            <>
              <div className={`co-grade-bar ${risk}`}>
                <div className={`co-grade-letter ${risk}`}>{g}</div>
                <div className="co-grade-main">
                  <span className="co-grade-lbl">Seen Grade</span>
                  <span className="co-grade-score"><Odometer value={score.overall_score} /> / 100</span>
                  {verdict && <p className="co-verdict">{verdict}</p>}
                  <div className="co-grade-meta">
                    {score.data_quality && <DataQualityBadge dq={score.data_quality} reportCount={fpReports} webCount={webEst} employeeCount={score.employee_review_count || 0} mentionCount={score.mention_count || 0} />}
                    {fpReports === 0 && webEst > 0 && <span className="co-live">web-research estimate</span>}
                    {updatedLine && <span className="co-dq" style={{ color: 'var(--muted)' }}>{updatedLine}</span>}
                  </div>
                </div>
              </div>

              <VibeTagList sc={score} />

              {/* A number the reports never gave (no wait or round counts on any row) is left out, never shown as "—". */}
              {(() => {
                const tiles = [
                  score.response_rate != null ? <MetBox key="r" label="Response" value={pct(score.response_rate)} color="var(--blue)" /> : null,
                  score.ghost_rate != null ? <MetBox key="g" label="Ghosted" value={pct(score.ghost_rate)} alarm={ghostHigh} color={ghostColor} /> : null,
                  score.avg_wait_days != null ? <MetBox key="w" label="Avg wait" value={`${score.avg_wait_days}d`} color={waitColor} /> : null,
                  score.avg_rounds != null ? <MetBox key="n" label="Rounds" value={score.avg_rounds.toFixed(1)} /> : null,
                  score.waste != null ? <MetBox key="x" label="Waste risk" value={`${score.waste}%`} color={wasteColor} /> : null,
                ].filter(Boolean)
                return tiles.length > 0 ? (
                  <div className={`co-mets${tiles.length === 5 ? ' co-mets-5' : ''}`} style={tiles.length !== 5 ? { gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` } : undefined}>
                    {tiles}
                  </div>
                ) : null
              })()}
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '1.5rem 1rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.72rem' }}>
              No score data found for this company.
              {gatheringPublic && <EnrichmentNotice companyName={companyName} />}
            </div>
          )}

          {/* The company's own job posts, rated on their own — separate from (and never part of) the Seen Grade. */}
          {!loading && !error && companyName && <ListingSignals companyName={companyName} />}

          {/* Actions: one primary, the rest compact. */}
          {!loading && (
            <div className="co-actions">
              <TrackCTA companyName={companyName} />
              <div className="co-action-row">
                <a href={`/resume?company=${encodeURIComponent(companyName || '')}`} className="co-act co-act-primary"><span>✨ Analyze résumé for {displayName}</span></a>
                <a href={reportHref} className="co-act">📝 Report experience</a>
              </div>
              <div className="co-chip-row">
                <button type="button" className="co-chip" onClick={() => openSection('compare')}>⚡ Compare</button>
                <button type="button" className="co-chip" onClick={share}>{copied ? '✓ Link copied' : '↗ Share'}</button>
                {/* ?sv=<score> versions the shared URL: Reddit caches unfurls PER URL roughly
                    forever, so links shared before the OG card existed are stuck blank. A new
                    score → a new URL → a fresh unfurl fetch. rel=canonical keeps SEO on the
                    clean URL; visitors landing with ?sv= see the normal page. */}
                <a
                  className="co-chip co-chip-reddit"
                  href={`https://reddit.com/submit?url=${encodeURIComponent(`https://seenjobs.io/company/${slug}${graded ? `?sv=${score.overall_score}` : ''}`)}&title=${encodeURIComponent(graded ? `Is ${displayName} worth applying to? Seen score: ${score.overall_score}/100` : `Is ${displayName} worth applying to? Applicant reports on Seen`)}`}
                  target="_blank" rel="noopener noreferrer"
                >🔴 Post to Reddit</a>
                {graded && <button type="button" className="co-chip" onClick={() => setShowGradeCard(true)}>🖼 Grade card</button>}
              </div>
            </div>
          )}

          {showGradeCard && graded && (
            <CompanyScoreCard
              data={{
                company: displayName,
                industry: industry || score.industry,
                updated_at: score.updated_at,
                overall_score: score.overall_score,
                ghost_rate: score.ghost_rate ?? 0,
                response_rate: score.response_rate ?? 0,
                avg_wait_days: score.avg_wait_days ?? 0,
                waste: score.waste ?? 0,
                // First-party only: the PNG renders "Based on N applicant reports" — feeding it
                // the fused web claim published the phantom number to social. Its own zero-state
                // ("Baseline estimate · share your experience") is the honest fallback.
                report_count: fpReports,
                risk: score.risk_level ?? undefined,
                tags: [
                  (score.ghost_rate ?? 0) >= 0.5 ? '👻 High ghost rate' : null,
                  (score.response_rate ?? 0) >= 0.5 ? '✅ Responsive' : null,
                  (score.waste || 0) >= 50 ? '⚠ High waste risk' : null,
                  (score.avg_wait_days || 0) >= 30 ? '⏳ Long wait times' : null,
                ].filter(Boolean) as string[],
              }}
              shareUrl={`https://seenjobs.io/company/${slug}`}
              onClose={() => setShowGradeCard(false)}
            />
          )}
        </div>

        {/* ── Sections: every detail the page used to spread across seven tabs, each behind one
            row with a truthful summary. Open what you need; nothing is gone. ── */}
        {!loading && (
          <div className="co-secs">
            {graded && (
              <Section id="odds" icon="📅" title="Your odds here" open={open.odds} onToggle={toggle}
                summary={`${score.avg_wait_days != null ? `${score.avg_wait_days}d typical wait · ` : ''}${respPct}% hear back · your response probability & industry rank`}>
                <HiringProbability responseRate={score.response_rate} ghostRate={score.ghost_rate} overallScore={score.overall_score} reportCount={fpReports} />
                {benchmark && (
                  <div style={{ margin: '1rem 0 0' }}>
                    <IndustryBenchmark benchmark={benchmark} variant="public" companyName={displayName} />
                  </div>
                )}
              </Section>
            )}

            {graded && (
              <Section id="breakdown" icon="📊" title="How the grade is built" open={open.breakdown} onToggle={toggle}
                summary={`Response ${respPct}% · ghost ${ghostPct}% · waste ${score.waste ?? 0}% · where in the process they ghost`}>
                <div className="co-two">
                  <div className="co-card">
                    <div className="co-sec-lbl" style={{ marginBottom: '.85rem' }}>Score breakdown</div>
                    <BarRow label="Response rate" value={respPct} color={riskColor(risk)} />
                    <BarRow label="Ghost rate" value={ghostPct} color="var(--red)" />
                    <BarRow label="Waste risk" value={score.waste || 0} color={wasteColor} />
                    <div className="co-kv">
                      <span>Process score</span><b style={{ color: riskColor(risk) }}>{score.process_score ?? score.overall_score} / 100</b>
                    </div>
                    <div className="co-kv">
                      <span>Avg rounds</span><b>{score.avg_rounds != null ? score.avg_rounds : '—'}</b>
                    </div>
                    <div className="co-kv">
                      <span>Avg timeline</span><b>{score.avg_wait_days != null ? `${score.avg_wait_days} days` : '—'}</b>
                    </div>
                  </div>
                  {(() => { const rows = ghostStageRows(hiringReports); const n = rows.reduce((a, r) => a + r.n, 0); return rows.length > 0 && (
                  <div className="co-card">
                    <div className="co-sec-lbl" style={{ marginBottom: '.85rem' }}>Where they ghost</div>
                    <HiringFunnel rows={rows} />
                    <div style={{ marginTop: '.85rem', fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', lineHeight: 1.5 }}>
                      Share of the {n} ghosted report{n !== 1 ? 's' : ''} that named the stage where contact stopped.
                    </div>
                  </div>) })()}
                </div>
                <OutcomeDistribution reports={hiringReports} />
              </Section>
            )}

            {/* The list holds applicant reports AND employee reviews, so the header names both and counts
                each separately — it used to read "Applicant reports 100" for 15 accounts + 85 reviews. */}
            <Section id="reports" icon="🗣" title={employeeN > 0 ? 'Applicant reports & employee reviews' : 'Applicant reports'} count={employeeN > 0 ? null : outcomeReports.length} open={open.reports} onToggle={toggle}
              summary={reports.length > 0
                ? [`${outcomeReports.length} applicant report${outcomeReports.length !== 1 ? 's' : ''}`, waitingN > 0 ? `${waitingN} still waiting (no outcome yet)` : '', employeeN > 0 ? `${employeeN} employee review${employeeN !== 1 ? 's' : ''}` : '', `${ghostedN} ghosted`, `${interviewN} interviewed`, `${hiredN} hired`, thirdPartyN > 0 ? `${thirdPartyN} from public discussion` : ''].filter(Boolean).join(' · ')
                : 'None yet — be the first to report'}>
              <div className="co-reports-tools">
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)', lineHeight: 1.6, flex: 1, minWidth: 180 }}>
                  {reports.length > 0
                    ? (thirdPartyN > 0 || importedN > 0 || employeeN > 0 || waitingN > 0
                        ? [`${outcomeReports.length} applicant report${outcomeReports.length !== 1 ? 's' : ''} with an outcome`,
                            seenN > 0 ? `${seenN} submitted to Seen` : '',
                            importedN > 0 ? `${importedN} imported from review sites (reduced weight)` : '',
                            thirdPartyN > 0 ? `${thirdPartyN} found in public discussion (reduced weight)` : '',
                            waitingN > 0 ? `${waitingN} still waiting — not counted until they resolve` : '',
                            employeeN > 0 ? `${employeeN} employee review${employeeN !== 1 ? 's' : ''} (their letter grades adjust the score; they are not hiring outcomes)` : '',
                          ].filter(Boolean).join(' · ')
                        : `${reports.length} report${reports.length !== 1 ? 's' : ''} submitted to Seen · anonymous applicant claims`)
                    : 'Reports are anonymous claims, labeled by source and weighted by trust.'}
                </div>
                <input
                  type="text"
                  placeholder="Filter by city…"
                  aria-label="Filter reports by city"
                  value={location}
                  onChange={e => setLocation(e.target.value)}
                  className="co-city-input"
                />
              </div>
              {reports.length > 0 ? (
                <>
                  {[...seenRows, ...publicRows].slice(0, reportsShown).map((r, i) => {
                    const badge = reportSourceBadge(r.platform, r.report_text)
                    const employee = isEmployeeReview(r)
                    const src = reportSourceLink(r.platform, r.report_text)
                    const body = src ? src.body : r.report_text
                    const when = reportDate(r.platform, r.report_text, r.created_at).label
                    const isPublic = i >= seenRows.length
                    // Group headings: Seen submissions first, then everything quoted from public sources.
                    const heading = i === 0 && seenRows.length > 0 && publicRows.length > 0
                      ? <div className="co-sec-lbl" style={{ margin: '.2rem 0 .6rem' }}>Submitted to Seen · {seenRows.length}</div>
                      : i === seenRows.length && publicRows.length > 0
                        ? (
                          <div style={{ margin: `${i === 0 ? '.2rem' : '1.1rem'} 0 .6rem` }}>
                            <div className="co-sec-lbl">From public discussion &amp; review sites · {publicRows.length}</div>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', color: 'var(--muted)', lineHeight: 1.6, marginTop: '.25rem' }}>
                              Quoted from public threads and review sites, each linked to its source. Counted at reduced weight — not submitted by a Seen user.
                            </div>
                          </div>
                        )
                        : null
                    const roleLine = r.role && !/^unknown/i.test(r.role) ? r.role : ''
                    return (
                      <div key={r.id} style={{ display: 'contents' }}>
                      {heading}
                      <div className={`rcard${r.outcome ? ` outcome-${r.outcome}` : ''}${isPublic ? ' rcard-public' : ''}`} style={isPublic ? { borderStyle: 'dashed' } : undefined}>
                        <div className="rc-hd">
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {(roleLine || r.ghost_stage) && (
                              <div className="rc-role">
                                {roleLine}
                                {r.ghost_stage && <span style={{ color: 'var(--muted)' }}>{roleLine ? ' · ' : ''}ghosted at {r.ghost_stage.replace(/_/g, ' ')}</span>}
                              </div>
                            )}
                            <div className="rc-meta">
                              {[r.city ? `📍 ${r.city}` : '', r.rounds ? `${r.rounds} round${r.rounds !== 1 ? 's' : ''}` : '', when].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                          <span className={`vibe rc-outcome ${employee ? 'v-n' : (ocClass[r.outcome] || 'v-n')}`}>{employee ? '💼 Employee review' : (ocLabel[r.outcome] || r.outcome)}</span>
                        </div>
                        {body && <div className="rc-body">{body}</div>}
                        {r.id && employerReplies[r.id] && (
                          <div className="rc-reply">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginBottom: '.3rem', flexWrap: 'wrap' }}>
                              <span style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--blue)' }}>Employer response</span>
                              <span style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--muted)' }}>· unverified claim, doesn&apos;t affect the score</span>
                            </div>
                            <div style={{ fontSize: '.78rem', color: 'var(--sub)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{employerReplies[r.id]!.body}</div>
                          </div>
                        )}
                        {/* One attribution line: third-party rows show their source badge + link; first-party rows the platform applied on. */}
                        <div className="rc-footer">
                          {badge ? (
                            <span className="vibe v-n rc-src" style={{ borderStyle: 'dashed', color: 'var(--dim)' }} title={badge.title}>{badge.label}</span>
                          ) : (
                            <span className="rc-via">via <span className="vibe v-n rc-src">{r.platform || 'Seen'}</span></span>
                          )}
                          {src && <ReportSourceLink url={src.url} host={src.host} posted={src.posted} className="rc-srclink" />}
                        </div>
                      </div>
                      </div>
                    )
                  })}
                  {reports.length > reportsShown && (
                    <button type="button" className="co-more" onClick={() => setReportsShown(n => n + 10)}>
                      Show {Math.min(10, reports.length - reportsShown)} more of {reports.length - reportsShown} remaining
                    </button>
                  )}
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '1.5rem 1rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.7rem', lineHeight: 1.7 }}>
                  {location
                    ? <>No reports mention &ldquo;{location}&rdquo;. <button type="button" onClick={() => setLocation('')} style={{ background: 'none', border: 'none', color: 'var(--blue)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', padding: 0 }}>Clear the city filter</button></>
                    : <>No community reports yet — {displayName} gets a grade once {MIN_REPORTS_FOR_GRADE} real reports are in.</>}
                  {gatheringPublic && <EnrichmentNotice companyName={companyName} />}
                  <div style={{ marginTop: '.6rem' }}><a href={reportHref} style={{ color: 'var(--green)', textDecoration: 'none' }}>Be the first to report →</a></div>
                </div>
              )}
            </Section>

            {webReviews.length > 0 && (
              <Section id="online" icon="💬" title="What applicants say online" count={webReviews.length} open={open.online} onToggle={toggle}
                summary="AI-summarized insights from public reviews and discussions · refreshed when the score is rebuilt">
                <WebReviewsSection reviews={webReviews} />
              </Section>
            )}

            {/* Shown only while checking, or once at least two threads about hiring at this company exist
                (api/company-reddit.js MIN_SHOW_THREADS). A page without real discussion has no Reddit row. */}
            {(reddit === null || reddit.status === 'checking' || reddit.items.length >= 2) && (
              <Section id="reddit" icon="🔴" title="Reddit discussion" count={reddit?.items.length || null} open={open.reddit} onToggle={toggle}
                summary={reddit?.items.length ? `${reddit.items.length} public threads about hiring at ${displayName} — every item links to its source` : `Checking public threads about hiring at ${displayName}…`}>
                <CompanyRedditDiscussion companyName={displayName} hasReportData={reports.length > 0 || !!score} prefetched={reddit} />
              </Section>
            )}

            <Section id="locations" icon="📍" title="Locations" open={open.locations} onToggle={toggle}
              summary={cityRows.length > 0
                ? `${cityRows.length} cit${cityRows.length === 1 ? 'y' : 'ies'} with reported outcomes · where ${displayName} is hiring now`
                : `Where ${displayName} is hiring now · no reports name a city yet`}>
              {cityRows.length > 0 && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <div className="co-sec-lbl" style={{ marginBottom: '.35rem' }}>Reported outcomes by city</div>
                  <div style={sectionNote}>From {reportsWithCity} applicant report{reportsWithCity !== 1 ? 's' : ''} that named a city</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
                    {cityRows.map(row => {
                      const ghostPctVal = Math.round(row.ghostRate * 100)
                      const barColor = row.ghostRate > 0.55 ? 'var(--red)' : row.ghostRate > 0.35 ? 'var(--amber)' : 'var(--green)'
                      // Ungraded companies: per-city percentages from a handful of reports are a verdict too.
                      if (!graded) return (
                        <div key={row.city} className="co-row">
                          <div style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--white)', minWidth: 110, flex: '1 1 120px', overflowWrap: 'anywhere' }}>{row.city}</div>
                          <span className="co-pill">{row.total} report{row.total !== 1 ? 's' : ''}</span>
                        </div>
                      )
                      return (
                        <div key={row.city} className="co-row">
                          <div style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--white)', minWidth: 110, flex: '1 1 120px', overflowWrap: 'anywhere' }}>{row.city}</div>
                          <div style={{ flex: '2 1 120px', minWidth: 80 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.2rem' }}>
                              <div style={{ flex: 1, height: 6, background: 'var(--line2)', borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{ width: `${ghostPctVal}%`, height: '100%', background: barColor, borderRadius: 3, transition: 'width .4s ease' }} />
                              </div>
                              <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: barColor, width: 36, textAlign: 'right', flexShrink: 0 }}>{ghostPctVal}%</span>
                            </div>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)' }}>ghost rate · {Math.round(row.responseRate * 100)}% responded</div>
                          </div>
                          <span className="co-pill">{row.total} report{row.total !== 1 ? 's' : ''}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              <div>
                <div className="co-sec-lbl" style={{ marginBottom: '.35rem' }}>Where {displayName} is hiring</div>
                {jobsLoading || !jobsFetched ? (
                  <div style={{ ...sectionNote, marginBottom: 0 }}>Checking current job listings…</div>
                ) : hiringRows.length > 0 ? (
                  <>
                    <div style={sectionNote}>
                      From {hiring.listings} current job listing{hiring.listings !== 1 ? 's' : ''}{capped ? ' (the top-scored open listings — there may be more)' : ''} · listing locations, not applicant reports
                      {hiring.withLocation < hiring.listings ? ` · ${hiring.listings - hiring.withLocation} without a stated location` : ''}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
                      {hiringRows.map(row => (
                        <div key={row.label} className="co-row">
                          <div style={{ fontFamily: 'var(--mono)', fontSize: '.66rem', color: 'var(--white)', minWidth: 110, flex: '1 1 140px', overflowWrap: 'anywhere' }}>
                            {row.label === 'Remote' ? '🌐 Remote' : `📍 ${row.label}`}
                          </div>
                          <div style={{ flex: '2 1 80px', height: 6, background: 'var(--line2)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${maxCount ? Math.round((row.count / maxCount) * 100) : 0}%`, height: '100%', background: 'var(--blue)', borderRadius: 3 }} />
                          </div>
                          <span className="co-pill">{row.count} listing{row.count !== 1 ? 's' : ''}</span>
                        </div>
                      ))}
                    </div>
                    {hiring.otherPlaces > 0 && (
                      <div style={{ ...sectionNote, marginTop: '.6rem', marginBottom: 0 }}>+ {hiring.otherPlaces} more location{hiring.otherPlaces !== 1 ? 's' : ''}</div>
                    )}
                    <button type="button" onClick={() => openSection('roles')} className="co-link-btn">See open roles →</button>
                  </>
                ) : (
                  <div style={{ ...sectionNote, marginBottom: 0 }}>
                    {companyJobs.length > 0
                      ? `${companyJobs.length} current job listing${companyJobs.length !== 1 ? 's' : ''}, but none states a location.`
                      : 'No current job listings found for this company.'}
                  </div>
                )}
              </div>
              {cityRows.length === 0 && (
                <div style={{ marginTop: '1.2rem', fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)' }}>
                  No applicant reports with a city yet.{' '}
                  <a href={reportHref} style={{ color: 'var(--green)', textDecoration: 'none' }}>Report your experience →</a>
                </div>
              )}
            </Section>

            <Section id="roles" icon="💼" title="Open roles" count={jobsFetched ? companyJobs.length : null} open={open.roles} onToggle={toggle}
              summary={jobsFetched ? (companyJobs.length > 0 ? `${companyJobs.length} current listing${companyJobs.length !== 1 ? 's' : ''} · apply with the ${graded ? 'grade' : 'reports'} in mind` : 'No open roles found right now') : `Current job listings at ${displayName}`}>
              {jobsLoading && (
                <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.7rem' }}>
                  Searching for open roles at {displayName}…
                </div>
              )}
              {!jobsLoading && jobsFetched && companyJobs.length === 0 && (
                <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.7rem' }}>
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
            </Section>

            <Section id="compare" icon="⚡" title="Compare" open={open.compare} onToggle={toggle}
              summary={compareList.length > 0 ? `${displayName} vs ${compareList.map(c => c.name).join(' & ')}` : 'Side by side with up to 2 other companies'}>
              <div className="co-cmp-form">
                <input
                  type="text"
                  placeholder="Company name"
                  aria-label="Company to compare"
                  value={compareInput}
                  onChange={e => setCompareInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addCompare() }}
                  disabled={compareList.length >= 2}
                  className="co-cmp-input"
                  style={{ opacity: compareList.length >= 2 ? 0.5 : 1 }}
                />
                <div className="co-cmp-btns">
                  <button
                    type="button"
                    disabled={!compareInput.trim() || compareList.length >= 2}
                    onClick={addCompare}
                    className="co-cmp-go"
                    style={{ cursor: compareList.length >= 2 ? 'not-allowed' : 'pointer', opacity: !compareInput.trim() || compareList.length >= 2 ? 0.5 : 1 }}
                  >
                    Compare →
                  </button>
                  {compareList.length > 0 && (
                    <button type="button" onClick={() => setCompareList([])} className="co-cmp-clear">Clear</button>
                  )}
                </div>
              </div>
              {compareList.length >= 2 && (
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--muted)', marginTop: '.45rem' }}>
                  You can compare up to 2 other companies at once — clear to start over.
                </div>
              )}
              {compareList.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '1.25rem', marginTop: '.85rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.66rem', background: 'var(--surface, #111)', border: '1px dashed var(--line2)', borderRadius: 10 }}>
                  Add a company to see score, ghost rate, response rate and wait time side by side.
                </div>
              ) : (
                <div className="co-cmp-wrap" style={{ marginTop: '.85rem' }}>
                  <table className="co-cmp-table">
                    <thead>
                      <tr>
                        <th className="co-cmp-metric-h">Metric</th>
                        <th className="co-cmp-co">
                          <div className="co-cmp-name">{displayName}</div>
                          <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--blue)', textTransform: 'uppercase', letterSpacing: '.08em' }}>current</div>
                        </th>
                        {compareList.map(c => (
                          <th key={c.name} className="co-cmp-co">
                            <div className="co-cmp-name">{c.name}</div>
                            {c.loading && <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--muted)' }}>loading…</div>}
                            {!c.loading && !c.score && <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--red)' }}>no data</div>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {compareRows.map((row, i) => (
                        <tr key={row.label} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                          <td className="co-cmp-metric">{row.label}</td>
                          <td className="co-cmp-val" style={{ color: row.currentColor }}>{row.current}</td>
                          {compareList.map(c => (
                            <td key={c.name} className="co-cmp-val" style={{ color: c.loading ? 'var(--muted)' : row.getColor(c.score) }}>
                              {c.loading ? '…' : row.get(c.score)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            <Section id="about" icon="ℹ" title="About this grade" open={open.about} onToggle={toggle}
              summary={score
                ? (!graded
                    ? `${ungradedLabel} · summary & public records`
                    : `Based on ${gradeBasisLabel(score)}${webEst > 0 ? ' + public web research' : ''} · summary & public records`)
                : 'Public records & data status'}>
              {score?.summary ? (
                <p style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--sub)', lineHeight: 1.7, margin: '0 0 .9rem' }}>{score.summary}</p>
              ) : null}
              {score && (
                <div className="co-about-line">
                  <span>📊 {!graded
                    ? `${ungradedLabel} — a grade needs ${MIN_REPORTS_FOR_GRADE}: each applicant report counts 1, each thing people say online counts ½; web estimates never count`
                    : `Based on ${gradeBasisLabel(score)}${webEst > 0 ? ' + public web research' : ''}`}</span>
                  <a href={reportHref} style={{ color: 'var(--green)', textDecoration: 'none' }}>+ Add your report →</a>
                </div>
              )}
              {gatheringPublic && <EnrichmentNotice companyName={companyName} />}
              {/* Attributed public-record signals (SEC 8-K, etc.) — self-hides when there are none; never score-gated. */}
              <div style={{ marginTop: '1rem' }}>
                <CompanyPublicRecord companyName={companyName} />
              </div>
            </Section>
          </div>
        )}
      </div>
    </div>
  )
}
