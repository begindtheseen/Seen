'use client'

import { useState, useEffect, useRef, use, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Score } from '@/lib/score'
import { useAuth } from '@/lib/auth'
import { _sync } from '@/lib/sync'
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
import { LoadError } from '@/components/shell/LoadStates'
import ListingSignals from '@/components/ListingSignals'
import WarnFriendShare from '@/components/growth/WarnFriendShare'
import TrackCta from '@/components/company/TrackCta'
import { warnFriendText } from '@/lib/growthCopy.js'
import { gradeLetter, displayCompanyName, displayPlatform, isResolvedOutcome, lastUpdatedLabel } from '@/lib/companyDisplay'
import { buildCompanySummary, publicRowsHeading, reportsProvenanceLine, reportsSectionSummary, MIN_REPORTS_FOR_RATES, type CompanySummary } from '@/lib/companyPageSummary'
import { feedRowVerdict } from '@/lib/reports/feedFilter.js'
import { looksLikeBotOrLinkText, trimToSentence } from '@/lib/reports/excerptText.js'
import { displayPay } from '@/lib/jobs/pay.js'
import { jobsSearchHref } from '@/lib/searchRoute'
import { reportCardOutcome } from '@/lib/reportCardOutcome'
import { splitWebReviews, webResearchNote } from '@/lib/webReviewQuotes'
import { replyTiming, REPORT_WHEN_YOU_HEAR } from '@/lib/replyTiming'
import { useCompanySeed } from '@/components/CompanySeed'
import { httpHref } from '@/lib/safeHref.js'

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
  trust_reason?: string | null
  company_name?: string
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

// Reddit "still checking" polling: 5 asks 4 s apart ≈ 20 s, then the section hides itself.
const REDDIT_POLL_MS = 4000
const REDDIT_POLL_ATTEMPTS = 5

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

// The ONE confidence label (lib/companyPageSummary.ts): from the stored data_quality, with every kind of
// evidence behind the grade. The share card prints the same word (Target's card said "High" under a
// "Moderate" hero because it counted rows on its own — audit 2026-10-23).
function ConfidenceBadge({ sum, webCount }: { sum: CompanySummary; webCount: number }) {
  // With zero first-party rows the score is a web-research estimate — say exactly that; never mint
  // "High confidence · N reports" from the LLM's claimed mention count (that number looked fake because it was).
  if (sum.applicantReports === 0) {
    return (
      <span className="co-dq" style={{ color: 'var(--amber)' }}>
        🌐 {webCount > 0 ? 'Web-research estimate — no first-party reports yet' : 'Estimated'}
      </span>
    )
  }
  if (!sum.confidence) return null
  const color = sum.confidence.level === 'high' ? 'var(--green)' : sum.confidence.level === 'moderate' ? 'var(--amber)' : 'var(--red)'
  // The word is capped below "High" until enough reports come from Seen users, and the badge names where
  // the reports came from — the reports section below says the same (lib/companyPageSummary.ts).
  const src = sum.confidence.sources
  return (
    <>
      <span className="co-dq" style={{ color }} title={sum.confidence.capNote || undefined}>
        {sum.confidence.emoji} {sum.confidence.label}
      </span>
      {src ? <span className="co-dq" style={{ color: 'var(--muted)', flexBasis: '100%' }}>{src.charAt(0).toUpperCase() + src.slice(1)}</span> : null}
    </>
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

// Quotes compiled from public reviews and discussions (company_scores.web_reviews). They are raw words
// from the source, labelled by source — never "AI-summarized" (audit 2026-10-23). A quote the strict rules
// did not accept as a first-hand applicant account (kind 'public_commentary') carries no sentiment /
// outcome label, only "Commentary" (owner 2026-10-24: a Reddit AutoModerator notice read "~ Mixed").
// Quotes with links or bot text are filtered out before this renders (shownWebReviews).
//
// An entry with NO source link is not a quote: it is the old web-research pipeline's paraphrase
// ("Aggregated research · 2025: Applicants say the first step is…"), which read as machine-written to
// the conversion audit's visitors (2026-10-24). Those are folded into ONE collapsed note at the end,
// plainly labelled, never in quote marks; the section's count is unchanged (lib/webReviewQuotes.ts).
function WebReviewsSection({ reviews, hidden }: { reviews: WebReview[]; hidden: number }) {
  if (!reviews || reviews.length === 0) return null
  const { quotes, summaries } = splitWebReviews(reviews)
  const sentColor = (s: string) => s === 'positive' ? 'var(--green)' : s === 'negative' ? 'var(--red)' : 'var(--amber)'
  const sentLabel = (s: string) => s === 'positive' ? '✓ Positive' : s === 'negative' ? '✗ Negative' : '~ Mixed'
  const sentBorder = (s: string) => s === 'positive' ? 'rgba(16,185,129,.3)' : s === 'negative' ? 'rgba(239,68,68,.3)' : 'rgba(245,158,11,.3)'
  return (
    <div style={{ padding: '0 0 1.5rem' }}>
      {quotes.length > 0 && (
        <div className="co-sec-lbl" style={{ marginBottom: '.75rem' }}>
          What people are saying online
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
        {quotes.map((rv, i) => {
          const account = rv.kind === 'applicant_outcome'
          const href = httpHref(rv.url)
          return (
          <div key={i} style={{
            background: 'var(--card)', border: `1px solid ${account ? sentBorder(rv.sentiment) : 'var(--line2)'}`,
            borderRadius: 8, padding: '.85rem 1rem',
          }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--dim)', lineHeight: 1.55, marginBottom: '.5rem' }}>
              &ldquo;{trimToSentence(rv.text, 500)}&rdquo;
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
              {account
                ? <span style={{ fontFamily: 'var(--mono)', fontSize: '.54rem', fontWeight: 600, color: sentColor(rv.sentiment) }}>{sentLabel(rv.sentiment)}</span>
                : <span style={{ fontFamily: 'var(--mono)', fontSize: '.54rem', fontWeight: 600, color: 'var(--muted)' }}>{rv.kind === 'employee_review' ? '💼 Employee review' : '💬 Commentary'}</span>}
              {rv.source && <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)' }}>{displayPlatform(rv.source)}</span>}
              {rv.year && <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)' }}>{rv.year}</span>}
              {href && <a href={href} target="_blank" rel="nofollow ugc noopener noreferrer" style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--blue)', textDecoration: 'none' }}>Source ↗</a>}
            </div>
          </div>
          )
        })}
      </div>
      {summaries.length > 0 && (
        <details className="co-research-note" style={{ marginTop: quotes.length ? '.8rem' : 0, background: 'var(--surface)', border: '1px dashed var(--line2)', borderRadius: 8, padding: '.15rem .9rem' }}>
          <summary style={{ cursor: 'pointer', listStyle: 'none', padding: '.6rem 0', minHeight: 44, display: 'flex', alignItems: 'center', fontFamily: 'var(--mono)', fontSize: '.75rem', color: 'var(--muted)', lineHeight: 1.5 }}>
            {webResearchNote(summaries.length)}
          </summary>
          <ul style={{ margin: '0 0 .7rem', paddingLeft: '1.1rem', fontFamily: 'var(--body)', fontSize: '.78rem', color: 'var(--muted)', lineHeight: 1.6 }}>
            {summaries.map((rv, i) => <li key={i}>{trimToSentence(rv.text, 300)}</li>)}
          </ul>
        </details>
      )}
      {hidden > 0 && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', color: 'var(--muted)', marginTop: '.6rem', lineHeight: 1.6 }}>
          {hidden} quote{hidden === 1 ? '' : 's'} not shown: {hidden === 1 ? 'it contains' : 'they contain'} links or moderator-bot text, which is never a first-hand account.
        </div>
      )}
    </div>
  )
}

// ── Outcome distribution bar (for overview) ────────────────────────────────────

// Fed the applicant reports WITH an outcome only — the same rows (and the same count) as the hero. It
// used to be fed every hiring row and read "77 community reports" under a "48 applicant reports" hero.
function OutcomeDistribution({ reports, label }: { reports: Report[]; label: string }) {
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
        {label}
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
  const { isLoggedIn } = useAuth()

  const [reports, setReports] = useState<Report[]>([])
  // The same list with no city filter — null until it has loaded (lib/companyPageSummary.ts sources).
  const [allReports, setAllReports] = useState<Report[] | null>(null)
  // First paint from the server's stored row (components/CompanySeed.tsx) when it is gradeable — the
  // grade, answer sentence and stats are in the HTML; the live /api/reports read below replaces it.
  const seed = useCompanySeed()
  const [score, setScore] = useState<CompanyScore | null>(seed as CompanyScore | null)
  const [industry, setIndustry] = useState(seed?.industry || '')
  const [loading, setLoading] = useState(!seed)
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
    // Public reads are GETs so Vercel's CDN can answer repeat visitors (lib/server/publicRead.js); a
    // POST is never cached at the edge, which is why every one of these used to hit the database.
    fetch(`/api/reports?type=perk&name=${encodeURIComponent(companyName)}`)
      .then(r => r.json()).then(d => { if (alive && d) setPerk({ featured: !!d.featured, verified: !!d.verified }) }).catch(() => {})
    return () => { alive = false }
  }, [companyName])
  // Reddit discussion is fetched by the page (cache-first endpoint) so the SECTION can be hidden when
  // fewer than two relevant threads exist — one coincidental thread is not "discussion". null = not
  // answered yet (the section shows while checking).
  const [reddit, setReddit] = useState<RedditDiscussionResult | null>(null)
  // `status:'checking'` means Reddit has not answered yet (a background search). The page re-asks every
  // REDDIT_POLL_MS up to REDDIT_POLL_ATTEMPTS times (~20 s), then treats it as empty and hides the
  // section — never a dead "Still checking… Retry" (audit 2026-10-23: three companies sat on it 15 s+).
  useEffect(() => {
    let alive = true
    let attempts = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const ask = () => {
      // GET so the CDN caches it (lib/server/publicRead.js); polled while the worker is still 'checking'.
      fetch(`/api/company-reddit?company=${encodeURIComponent(companyName)}`)
        .then(r => r.json().catch(() => ({})))
        .then((j: { items?: RedditDiscussionResult['items']; status?: string }) => {
          if (!alive) return
          const items = Array.isArray(j.items) ? j.items : []
          if (j.status === 'checking' && items.length === 0) {
            attempts += 1
            if (attempts < REDDIT_POLL_ATTEMPTS) { setReddit({ items: [], status: 'checking' }); timer = setTimeout(ask, REDDIT_POLL_MS); return }
            setReddit({ items: [], status: 'empty' })
            return
          }
          setReddit({ items, status: items.length ? 'ok' : 'empty' })
        })
        .catch(() => { if (alive) setReddit({ items: [], status: 'error' }) })
    }
    ask()
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [companyName])
  const [companyJobs, setCompanyJobs] = useState<Array<{title:string;company:string;location:string;salary:string|null;url:string|null;source:string;type:string;level:string;score:number}>>([])
  const [jobsLoading, setJobsLoading] = useState(false)
  const [jobsFetched, setJobsFetched] = useState(false)
  const [compareInput, setCompareInput] = useState('')
  const [compareList, setCompareList] = useState<Array<{name: string; score: CompanyScore | null; loading: boolean}>>([])
  // Reports render in pages of 5 — "Show more" reveals the rest; nothing is hidden for good.
  const [reportsShown, setReportsShown] = useState(5)
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

  // T3-7: Record this company visit for the dashboard's "Recently checked" + its checklist — on this
  // device (localStorage) and, when signed in, on the account (user_recent_cos via log_recent_co), so a
  // second device sees it too — ONLY once the company is known to exist (the score API answered without
  // not_found). `seen_recent_cos` feeds the dashboard chips, the command palette and the micro-survey's
  // contextual question, so writing it on mount for any slug made the survey ask about a company that
  // does not exist (audit 2026-10-24 L-3). Best-effort; never blocks the page.
  const rememberVisit = () => {
    try {
      const raw = localStorage.getItem('seen_recent_cos')
      const prev: Array<{name: string; slug: string}> = raw ? JSON.parse(raw) : []
      const filtered = prev.filter(c => c.slug !== slug)
      const updated = [{ name: companyName, slug }, ...filtered].slice(0, 10)
      localStorage.setItem('seen_recent_cos', JSON.stringify(updated))
    } catch {}
    if (isLoggedIn && companyName) void _sync('log_recent_co', { company: companyName })
  }

  // The grade (score) and the report list are independent reads, so they start together and the hero
  // renders the moment the score answers. They used to run as one waterfall — list → employer replies →
  // score — so the grade, the thing the page exists for, arrived last, and the whole chain re-ran on
  // every keystroke in the city filter (which only the list uses). All GETs: CDN-cacheable.
  // `reloadKey` is bumped by the error block's Retry.
  const [reloadKey, setReloadKey] = useState(0)
  const [reportsLoading, setReportsLoading] = useState(true)
  useEffect(() => {
    let alive = true
    if (!seed) setLoading(true) // a seeded hero stays on screen while the live read runs
    setError('')
    fetch(`/api/reports?type=score&name=${encodeURIComponent(companyName)}`)
      .then(async sRes => {
        if (!alive) return
        // A non-2xx here is a FAILURE, not "no data": it used to fall through to "No score data found
        // for this company" under an SSR header that still showed the grade (audit 2026-10-24 R-1).
        if (!sRes.ok) throw new Error(`score HTTP ${sRes.status}`)
        const sJson = await sRes.json() as { score?: CompanyScore; ok?: boolean; not_found?: boolean; enrichment?: { status?: string } }
        setEnrichmentStatus(typeof sJson.enrichment?.status === 'string' ? sJson.enrichment.status : null)
        if (sJson.not_found) {
          setNotFound(true)
        } else {
          rememberVisit()
          if (sJson.score) {
            setScore(sJson.score)
            if (sJson.score.industry) setIndustry(sJson.score.industry)
            if (sJson.score.web_reviews?.length) setWebReviews(sJson.score.web_reviews)
          }
        }
      })
      .catch(() => { if (alive) setError('Failed to load company data.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [companyName, reloadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true
    setReportsLoading(true)
    const list = fetch(`/api/reports?type=list&company=${encodeURIComponent(companyName.toLowerCase())}&city=${encodeURIComponent(location)}`)
      .then(async rRes => {
        if (!alive || !rRes.ok) return
        const rJson = await rRes.json() as { reports?: Report[]; ok?: boolean }
        // Newest experience first by its REAL date (imported rows: the source's posted date).
        if (rJson.reports) {
          const sorted = sortReportsByDate(rJson.reports)
          setReports(sorted)
          // The hero badge names where the reports came from — from the UNFILTERED list, so typing a
          // city into the reports filter never changes the grade's source counts.
          if (!location) setAllReports(sorted)
        }
      })
      .catch(() => {})
      .finally(() => { if (alive) setReportsLoading(false) })
    // Approved employer replies for this company, keyed by report id (best-effort, public, additive —
    // a failure just hides them). Independent of the list, so it runs alongside it.
    fetch(`/api/employer-replies?company=${encodeURIComponent(companyName)}`)
      .then(async repRes => {
        if (!alive || !repRes.ok) return
        const repJson = await repRes.json() as { replies?: Record<string, { body: string; created_at: string }> }
        if (repJson.replies) setEmployerReplies(repJson.replies)
      })
      .catch(() => {})
    void list
    return () => { alive = false }
  }, [companyName, location, reloadKey])

  // Industry benchmark — how this company ranks vs its sector on Seen (public aggregate). Turns a
  // bare score into authoritative context. Fail-soft: the page renders fine without it.
  useEffect(() => {
    let alive = true
    fetch(`/api/reports?type=benchmark&name=${encodeURIComponent(companyName)}`)
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
    fetch(`/api/jobs?action=company_jobs&company=${encodeURIComponent(companyName)}`)
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
    fetch(`/api/reports?type=score&name=${encodeURIComponent(name)}`)
      .then(r => r.ok ? r.json() : { score: null })
      .then(d => setCompareList(prev => prev.map(c => c.name === name ? { ...c, score: d.score ?? null, loading: false } : c)))
      .catch(() => setCompareList(prev => prev.map(c => c.name === name ? { ...c, loading: false } : c)))
  }

  // Only a gradeable score is a verdict — below the report bar there is no letter, number or risk.
  const graded = isGradeableScore(score)
  const risk = graded ? Score.risk(score.overall_score) : 'warn'
  const g = graded ? letterGrade(score.overall_score) : '—'
  const ungradedLabel = score && !graded ? notEnoughReviewsLabel(score) : ''
  // ONE summary object (lib/companyPageSummary.ts) feeds every count, rate, confidence label and sentence on
  // this page — hero, odds, breakdown, the reports list, the share card. Before it, each block did its
  // own arithmetic and the page said 48, 77 and 28 for the same company (audit 2026-10-23/24).
  const sum = buildCompanySummary(score, reports, { sourceReports: allReports })
  const fpReports = sum.applicantReports
  // "How long until they reply?" — only from real numbers (lib/replyTiming.ts): the stored average, else
  // the median of ≥5 listed reports that name a wait, else an honest "not enough data yet".
  const timing = replyTiming(score?.avg_wait_days, (allReports ?? reports).map(r => r.wait_days))
  const webEst = sum.webClaim
  // Honest status line: only while the enrichment worker has this company queued/running AND the
  // page has no first-party reports to show. It promises nothing about what will be found.
  const gatheringPublic = !loading && !reportsLoading && fpReports === 0 && reports.length === 0 && (enrichmentStatus === 'queued' || enrichmentStatus === 'running')
  const logoLetter = (companyName[0] || '?').toUpperCase()
  const ghostRate = sum.ghostRate ?? 0
  const ghostHigh = sum.ratesShown && ghostRate > 0.5
  const ghostPct = sum.ghostPct ?? 0
  const respPct = sum.responsePct ?? 0
  const ghostColor = ghostHigh ? 'var(--red)' : ghostRate > 0.3 ? 'var(--amber)' : 'var(--green)'
  const waitColor = (score?.avg_wait_days || 0) > 21 ? 'var(--amber)' : 'var(--text)'
  const wasteColor = (score?.waste || 0) > 60 ? 'var(--red)' : (score?.waste || 0) > 30 ? 'var(--amber)' : 'var(--green)'
  // One plain-English line a first-time visitor can act on — the SAME response rate and thresholds as
  // the odds panel (lib/companyPageSummary.ts responseVerdict), no percentage under MIN_REPORTS_FOR_RATES.
  const verdict = sum.verdict

  // The rows behind the counts. Employee reviews are shown but are NOT hiring outcomes (same rule as the
  // score — lib/server/reportCounts.js); "applicant reports" are the hiring rows WITH an outcome.
  const hiringReports = reports.filter(r => !isEmployeeReview(r))
  const employeeN = sum.listed.employee
  const outcomeReports = hiringReports.filter(r => isResolvedOutcome(r.outcome))
  // The list: what was submitted to Seen first, then everything compiled from public discussion and
  // review sites under its own heading — a raw Reddit quote must never look like a Seen user's report.
  // A public row whose words carry a link or moderator-bot text is not shown at all (owner 2026-10-24,
  // lib/reports/excerptText.js); one the strict rules do not accept as the poster's own account is shown
  // as commentary with no outcome label (lib/reports/feedFilter.js — the feed's rule).
  const seenRows = reports.filter(r => !isPublicDiscussion(r.platform) && !isImportedReview(r.platform, r.trust_reason))
  const publicRowsAll = reports.filter(r => isPublicDiscussion(r.platform) || isImportedReview(r.platform, r.trust_reason))
  const publicRows = publicRowsAll.filter(r => !looksLikeBotOrLinkText(r.report_text))
  const hiddenPublicN = publicRowsAll.length - publicRows.length
  const isCommentary = (r: Report): boolean => {
    if (isEmployeeReview(r)) return false
    const v = feedRowVerdict({ ...r, company_name: r.company_name || companyName })
    return !!v && v.kind !== 'applicant_outcome'
  }
  const commentaryN = publicRows.filter(isCommentary).length
  const listRows = [...seenRows, ...publicRows]
  const shownWebReviews = webReviews.filter(rv => !looksLikeBotOrLinkText(rv.text))
  const updatedLine = graded ? lastUpdatedLabel(score.updated_at) : ''

  if (!loading && notFound) {
    return (
      <div className="page-full">
        {/* Soft-404: the company's existence is decided client-side (api/reports.js web check), so the
            route answers 200 — keep the "Can't verify" state out of the index. React 19 hoists this <meta>
            into <head>. */}
        <meta name="robots" content="noindex" />
        <div style={{ maxWidth: 600, margin: '0 auto', padding: '5rem 2rem', textAlign: 'center', width: '100%', boxSizing: 'border-box' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '2.5rem', marginBottom: '1rem', opacity: .4 }}>?</div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: '1.4rem', fontWeight: 800, color: 'var(--white)', marginBottom: '.6rem', letterSpacing: '-.02em' }}>
            Can&apos;t verify &ldquo;{companyName}&rdquo;
          </h1>
          <p style={{ color: 'var(--sub)', fontFamily: 'var(--mono)', fontSize: '.72rem', lineHeight: 1.7, marginBottom: '1.75rem' }}>
            We couldn&apos;t find a company by that name. Looking for a job instead? Search open roles — or use the company&apos;s official name to check how it treats applicants.
          </p>
          {/* A job title typed into a company box lands here (conversion audit 2026-10-24: "barista").
              The primary way on is the job search for the same words (lib/searchRoute.ts). */}
          <div style={{ display: 'flex', gap: '.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href={jobsSearchHref(companyName)} className="btn-shine" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, gap: '.4rem', background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', border: 'none', borderRadius: 9, padding: '.65rem 1.3rem', fontFamily: 'var(--display)', fontSize: '.85rem', fontWeight: 800, color: '#fff', textDecoration: 'none', maxWidth: '100%', minWidth: 0, overflowWrap: 'anywhere' }}>
              See &ldquo;{companyName}&rdquo; jobs →
            </a>
            <a href="/companies" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, gap: '.4rem', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 9, padding: '.65rem 1.3rem', fontFamily: 'var(--mono)', fontSize: '.75rem', fontWeight: 600, color: 'var(--blue)', textDecoration: 'none' }}>
              Browse company grades
            </a>
          </div>
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
                <span className="co-sticky-grade" role="img" aria-label={`Seen Grade ${g}, ${score.overall_score} out of 100`}>
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
              {/* The page's ONE h1, in the initial HTML and the accessibility tree (audit 2026-10-24: the
                  server h1 lived inside a closed <details>, so the page had no readable heading). */}
              <h1 className="co-name" style={{ margin: '0 0 .12rem' }}>
                {displayName}
                {perk.verified && (
                  <span className="co-badge co-badge-verified" title="This employer committed to responding to applicants. Reviewed against real outcome data — it never affects the transparency score.">✓ Transparency Verified</span>
                )}
                {perk.featured && (
                  <span className="co-badge co-badge-featured" title="Featured employer — paid placement. Never affects the transparency score.">★ Featured</span>
                )}
              </h1>
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
            <LoadError what={`${displayName}'s hiring data`} detail="Seen could not be reached. The grade, rates and reports below are hidden until it loads — nothing here is a verdict yet." onRetry={() => setReloadKey(k => k + 1)} />
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
                  <a href="/methods" className="co-method">How grades work</a>
                </div>
              </div>
            </div>
          ) : graded ? (
            <>
              <div className={`co-grade-bar ${risk}`}>
                <div className={`co-grade-letter ${risk}`} aria-hidden="true">{g}</div>
                <div className="co-grade-main">
                  <span className="co-grade-lbl" aria-hidden="true">Seen Grade</span>
                  {/* One sentence for assistive tech; the letter + rolling digits are presentational. */}
                  <span className="co-grade-score">
                    <span className="sr-only">{`Seen Grade ${g}, ${score.overall_score} out of 100`}</span>
                    <span aria-hidden="true"><Odometer value={score.overall_score} instant={!!seed} /> / 100</span>
                  </span>
                  {verdict && <p className="co-verdict">{verdict}</p>}
                  <div className="co-grade-meta">
                    <ConfidenceBadge sum={sum} webCount={webEst} />
                    {fpReports === 0 && webEst > 0 && <span className="co-live">web-research estimate</span>}
                    {updatedLine && <span className="co-dq" style={{ color: 'var(--muted)' }}>{updatedLine}</span>}
                    <a href="/methods" className="co-method">How grades work</a>
                  </div>
                </div>
              </div>

              <VibeTagList sc={score} />

              {/* A number the reports never gave (no wait or round counts on any row) is left out, never shown as "—".
                  Response / ghost percentages need MIN_REPORTS_FOR_RATES applicant reports (Chipotle showed "77%"
                  from 2 — audit 2026-10-23); below it the page says so instead. */}
              {(() => {
                const tiles = [
                  sum.ratesShown && score.response_rate != null ? <MetBox key="r" label="Response" value={pct(score.response_rate)} color="var(--blue)" /> : null,
                  sum.ratesShown && score.ghost_rate != null ? <MetBox key="g" label="Ghosted" value={pct(score.ghost_rate)} alarm={ghostHigh} color={ghostColor} /> : null,
                  score.avg_wait_days != null ? <MetBox key="w" label="Avg wait" value={`${score.avg_wait_days}d`} color={waitColor} /> : null,
                  score.avg_rounds != null ? <MetBox key="n" label="Rounds" value={score.avg_rounds.toFixed(1)} /> : null,
                  score.waste != null ? <MetBox key="x" label="Waste risk" value={`${score.waste}%`} color={wasteColor} /> : null,
                ].filter(Boolean)
                return (
                  <>
                    {tiles.length > 0 && (
                      <div className={`co-mets${tiles.length === 5 ? ' co-mets-5' : ''}`} style={tiles.length !== 5 ? { gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` } : undefined}>
                        {tiles}
                      </div>
                    )}
                    {!sum.ratesShown && (
                      <div className="co-dq" role="note" style={{ display: 'block', color: 'var(--muted)', marginTop: '.5rem', lineHeight: 1.6 }}>
                        Response and ghost rates appear at {MIN_REPORTS_FOR_RATES} applicant reports — {fpReports} so far.
                      </div>
                    )}
                  </>
                )
              })()}
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '1.5rem 1rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.72rem' }}>
              No score data found for this company.
              {gatheringPublic && <EnrichmentNotice companyName={companyName} />}
            </div>
          )}

          {!loading && !error && companyName && <TrackCta company={displayName} slug={slug} responsePct={sum.ratesShown ? sum.responsePct : null} />}

          {/* Warn a friend: right under the grade, worded from exactly what this page shows (lib/growthCopy.js).
              A signed-in person's link carries their invite code. Replaces the old plain "Share" chip. */}
          {!loading && !error && companyName && (
            <WarnFriendShare
              context="company_page"
              path={`/company/${slug}`}
              lead={`Know someone applying to ${displayName}?`}
              text={warnFriendText({ company: displayName, graded, letter: g, applicantReports: fpReports, ratesShown: sum.ratesShown, ghostRate: sum.ghostRate, responseRate: sum.responseRate })}
            />
          )}

          {/* The company's own job posts, rated on their own — separate from (and never part of) the Seen Grade. */}
          {!loading && !error && companyName && <ListingSignals companyName={companyName} />}

          {/* Actions: one primary, the rest compact. */}
          {!loading && (
            <div className="co-actions">
              <div className="co-action-row">
                <a href={`/resume?company=${encodeURIComponent(companyName || '')}`} className="co-act co-act-primary"><span>✨ Analyze résumé for {displayName}</span></a>
                <a href={reportHref} className="co-act">📝 Report experience</a>
              </div>
              <div className="co-chip-row">
                <button type="button" className="co-chip" onClick={() => openSection('compare')}>⚡ Compare</button>
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
                // The SAME confidence word the hero shows (lib/companyPageSummary.ts) — the card never counts on its own.
                confidence: sum.confidence?.word,
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
            row with a truthful summary. Open what you need; nothing is gone. Hidden while the load
            failed: "None yet — be the first to report" under an error is a false statement (R-5). ── */}
        {!loading && !error && (
          <div className="co-secs">
            {graded && (
              <Section id="odds" icon="📅" title="Your odds here" open={open.odds} onToggle={toggle}
                summary={`${timing.short} · ${sum.ratesShown ? `${respPct}% hear back` : `too few applicant reports for a rate (${fpReports} of ${MIN_REPORTS_FOR_RATES})`} · your response probability & industry rank`}>
                <div className="co-card" style={{ marginBottom: '1rem' }}>
                  <div className="co-sec-lbl" style={{ marginBottom: '.45rem' }}>How long until they reply</div>
                  <p style={{ margin: 0, fontSize: '.9rem', color: 'var(--text)', lineHeight: 1.55 }}>{timing.line}</p>
                  {!timing.known && (
                    <a href={reportHref} style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, fontFamily: 'var(--mono)', fontSize: '.75rem', color: 'var(--green)', textDecoration: 'none' }}>{REPORT_WHEN_YOU_HEAR} →</a>
                  )}
                </div>
                <HiringProbability responseRate={score.response_rate} ghostRate={score.ghost_rate} overallScore={score.overall_score} reportCount={fpReports} mentionCount={sum.mentions} context={sum.oddsContext} />
                {benchmark && (
                  <div style={{ margin: '1rem 0 0' }}>
                    <IndustryBenchmark benchmark={benchmark} variant="public" companyName={displayName} />
                  </div>
                )}
              </Section>
            )}

            {graded && (
              <Section id="breakdown" icon="📊" title="How the grade is built" open={open.breakdown} onToggle={toggle}
                summary={`${sum.ratesShown ? `Response ${respPct}% · ghost ${ghostPct}% · ` : ''}waste ${score.waste ?? 0}% · ${sum.ratesShown ? 'where in the process they ghost' : `rates appear at ${MIN_REPORTS_FOR_RATES} applicant reports (${fpReports} so far)`}`}>
                <div className="co-two">
                  <div className="co-card">
                    <div className="co-sec-lbl" style={{ marginBottom: '.85rem' }}>Score breakdown</div>
                    {sum.ratesShown ? (
                      <>
                        <BarRow label="Response rate" value={respPct} color={riskColor(risk)} />
                        <BarRow label="Ghost rate" value={ghostPct} color="var(--red)" />
                      </>
                    ) : (
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--muted)', lineHeight: 1.6, marginBottom: '.6rem' }}>
                        Response and ghost rates are shown from {MIN_REPORTS_FOR_RATES} applicant reports — this grade stands on {sum.evidenceLine}.
                      </div>
                    )}
                    <BarRow label="Waste risk" value={score.waste || 0} color={wasteColor} />
                    <div className="co-kv">
                      <span>Process score</span><b style={{ color: riskColor(risk) }}>{score.process_score ?? score.overall_score} / 100</b>
                    </div>
                    <div className="co-kv">
                      <span>Avg rounds</span><b>{score.avg_rounds != null ? score.avg_rounds : '—'}</b>
                    </div>
                    <div className="co-kv">
                      <span>Typical wait</span><b>{timing.known ? `${timing.days} days` : 'Not enough data yet'}</b>
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
                <OutcomeDistribution reports={outcomeReports} label={`Outcome distribution · ${outcomeReports.length} applicant report${outcomeReports.length === 1 ? '' : 's'} with an outcome${sum.listed.waiting > 0 ? ` · ${sum.listed.waiting} still waiting not counted` : ''}`} />
              </Section>
            )}

            {/* The list holds applicant reports AND employee reviews, so the header names both and counts
                each separately — it used to read "Applicant reports 100" for 15 accounts + 85 reviews. */}
            <Section id="reports" icon="🗣" title={employeeN > 0 ? 'Applicant reports & employee reviews' : 'Applicant reports'} count={employeeN > 0 ? null : sum.listed.withOutcome} open={open.reports} onToggle={toggle}
              summary={reports.length === 0 && reportsLoading ? 'Loading reports…' : reportsSectionSummary(sum)}>
              <div className="co-reports-tools">
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)', lineHeight: 1.6, flex: 1, minWidth: 180 }}>
                  {reportsProvenanceLine(sum)}
                  {sum.listedNote ? ` ${sum.listedNote}` : ''}
                  {commentaryN > 0 ? ` ${commentaryN} ${commentaryN === 1 ? 'quote is' : 'quotes are'} commentary, not counted.` : ''}
                  {hiddenPublicN > 0 ? ` ${hiddenPublicN} hidden (links or bot text).` : ''}
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
              {reportsLoading && reports.length === 0 ? (
                <p style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', color: 'var(--muted)', margin: '8px 0 0' }}>Loading reports…</p>
              ) : reports.length > 0 ? (
                <>
                  {listRows.slice(0, reportsShown).map((r, i) => {
                    const badge = reportSourceBadge(r.platform, r.report_text, r.trust_reason)
                    const employee = isEmployeeReview(r)
                    const src = reportSourceLink(r.platform, r.report_text)
                    // Quotes end at a sentence or a whole word, never mid-word ("…an onsite interview. Perhaps").
                    const body = trimToSentence(src ? src.body : r.report_text, 2000)
                    const when = reportDate(r.platform, r.report_text, r.created_at).label
                    const isPublic = i >= seenRows.length
                    const commentary = isPublic && isCommentary(r)
                    // Group headings: Seen submissions first, then everything quoted from public sources.
                    const heading = i === 0 && seenRows.length > 0 && publicRows.length > 0
                      ? <div className="co-sec-lbl" style={{ margin: '.2rem 0 .6rem' }}>Submitted to Seen · {seenRows.length}</div>
                      : i === seenRows.length && i > 0 && publicRows.length > 0
                        ? <div className="co-sec-lbl" style={{ margin: '1.1rem 0 .6rem' }}>{publicRowsHeading(sum.listed)}</div>
                        : null
                    const roleLine = r.role && !/^unknown/i.test(r.role) ? r.role : ''
                    // One outcome per card: the chip and the "ghosted at …" stage come from one helper.
                    const card = reportCardOutcome(r, { employee, commentary })
                    return (
                      <div key={r.id} style={{ display: 'contents' }}>
                      {heading}
                      <div className={`rcard${r.outcome ? ` outcome-${r.outcome}` : ''}${isPublic ? ' rcard-public' : ''}`} style={isPublic ? { borderStyle: 'dashed' } : undefined}>
                        <div className="rc-hd">
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {(roleLine || card.ghostStage) && (
                              <div className="rc-role">
                                {roleLine}
                                {card.ghostStage && <span style={{ color: 'var(--muted)' }}>{roleLine ? ' · ' : ''}ghosted at {card.ghostStage}</span>}
                              </div>
                            )}
                            <div className="rc-meta">
                              {[r.city ? `📍 ${r.city}` : '', r.rounds ? `${r.rounds} round${r.rounds !== 1 ? 's' : ''}` : '', when].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                          <span className={`vibe rc-outcome ${card.cls}`} title={commentary ? 'Not the poster’s own applicant account under Seen’s rules — shown as commentary, no outcome' : undefined}>
                            {card.label}
                          </span>
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
                            <span className="rc-via">via <span className="vibe v-n rc-src">{displayPlatform(r.platform) || 'Seen'}</span></span>
                          )}
                          {src && <ReportSourceLink url={src.url} host={src.host} posted={src.posted} className="rc-srclink" />}
                        </div>
                      </div>
                      </div>
                    )
                  })}
                  {listRows.length > reportsShown && (
                    <button type="button" className="co-more" onClick={() => setReportsShown(n => n + 10)}>
                      Show {Math.min(10, listRows.length - reportsShown)} more of {listRows.length - reportsShown} remaining
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

            {shownWebReviews.length > 0 && (
              <Section id="online" icon="💬" title="What people say online" count={shownWebReviews.length} open={open.online} onToggle={toggle}
                summary="Quotes compiled from public reviews and discussions · each labelled by its source · not Seen's assessment">
                <WebReviewsSection reviews={shownWebReviews} hidden={webReviews.length - shownWebReviews.length} />
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
                      {hiring.abroad > 0 ? ` · ${hiring.abroad} outside the US not shown` : ''}
                      {hiring.withLocation + hiring.abroad < hiring.listings ? ` · ${hiring.listings - hiring.withLocation - hiring.abroad} without a stated location` : ''}
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
                      ? (hiring.abroad === companyJobs.length
                          ? `${companyJobs.length} current job listing${companyJobs.length !== 1 ? 's' : ''}, all outside the US — Seen lists US and remote roles.`
                          : `${companyJobs.length} current job listing${companyJobs.length !== 1 ? 's' : ''}, but none states a US location.`)
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
                        {displayPay(j) && <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--green)', whiteSpace: 'nowrap' }}>{displayPay(j)}</span>}
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
                          Apply ↗
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
