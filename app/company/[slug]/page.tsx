'use client'

import { useState, useEffect, useRef, use, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
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
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Icon, { type IconName } from '@/components/ui/Icon'
import StatTile from '@/components/ui/StatTile'
import { accountsLabel, accountSources } from '@/lib/glossary.js'
import { gradeTone, ghostRateTone, responseRateTone, wastedEffortTone, ghostRateWord, responseRateWord, wastedEffortWord, gradeWord, toneText, toneFill } from '@/lib/ui/tone.js'
import c from './company.module.css'
import { isGradeableScore, notEnoughReviewsLabel, gradeBasisLabel, MIN_REPORTS_FOR_GRADE } from '@/lib/gradeGate'
import { Crumbs } from '@/components/shell/PageHeader'
import { LoadError } from '@/components/shell/LoadStates'
import ListingSignals from '@/components/ListingSignals'
import WarnFriendShare from '@/components/growth/WarnFriendShare'
import TrackCta from '@/components/company/TrackCta'
import { warnFriendText } from '@/lib/growthCopy.js'
import { gradeLetter, displayCompanyName, displayPlatform, isResolvedOutcome, lastUpdatedLabel } from '@/lib/companyDisplay'
import { buildCompanySummary, reportsProvenanceLine, MIN_REPORTS_FOR_RATES, type CompanySummary } from '@/lib/companyPageSummary'
import { feedRowVerdict } from '@/lib/reports/feedFilter.js'
import { looksLikeBotOrLinkText, trimToSentence } from '@/lib/reports/excerptText.js'
import { displayPay } from '@/lib/jobs/pay.js'
import { jobsSearchHref } from '@/lib/searchRoute'
import { reportCardOutcome } from '@/lib/reportCardOutcome'
import { splitWebReviews, webResearchNote } from '@/lib/webReviewQuotes'
import { replyTiming, REPORT_WHEN_YOU_HEAR } from '@/lib/replyTiming'
import { useCompanySeed } from '@/components/CompanySeed'
import { httpHref } from '@/lib/safeHref.js'
import { replaceParam, readParam, useScrollMemory } from '@/lib/nav/urlState'
import { useBack } from '@/lib/nav/backTrail'

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

// Reddit "still checking" polling: up to 5 asks 4 s apart, and never past REDDIT_POLL_DEADLINE_MS of wall
// clock (a slow answer used to stretch five asks far beyond 20 s). The section renders only once at least two
// threads exist — there is no "Checking…" row that could outlive its deadline (phone tester 2026-11-02: Fry's).
const REDDIT_POLL_MS = 4000
const REDDIT_POLL_ATTEMPTS = 5
const REDDIT_POLL_DEADLINE_MS = 20000
// A public-discussion enrichment request still 'queued' after this long is treated as nothing found: the
// cron did not get to it, and the page promises nothing it cannot show.
const ENRICHMENT_FRESH_MS = 24 * 60 * 60 * 1000

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


// ── Sub-components ─────────────────────────────────────────────────────────────

function BarRow({ label, value, fill }: { label: string; value: number; fill: string }) {
  const clamped = Math.min(100, Math.max(0, value))
  return (
    <div className={c.bar}>
      <div className={c.barLbl}>{label}</div>
      <div className={c.barTrack}><div className={c.barFill} style={{ width: `${clamped}%`, background: fill }} /></div>
      <div className={c.barVal}>{Math.round(clamped)}%</div>
    </div>
  )
}

// The ONE confidence label (lib/companyPageSummary.ts): from the stored data_quality, capped below
// "High" until enough reports come from Seen users (the cap note is its tooltip). A web-research
// estimate says exactly that — never "High confidence · N reports" from a claimed mention count.
function ConfidenceBadge({ sum, webCount }: { sum: CompanySummary; webCount: number }) {
  if (sum.applicantReports === 0) {
    return <Badge tone="caution" icon="globe">{webCount > 0 ? 'Web-research estimate — no applicant accounts yet' : 'Estimated'}</Badge>
  }
  if (!sum.confidence) return null
  return <Badge tone="neutral" icon="gauge" title={sum.confidence.capNote || undefined}>{sum.confidence.word}</Badge>
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
  return (
    <div className={c.stack}>
      {rows.slice(0, 5).map((s, i) => (
        <BarRow key={s.label} label={i === 0 ? `${s.label} (most)` : s.label} value={s.pct} fill={i === 0 ? 'var(--bad)' : 'var(--text-4)'} />
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
  // Open, but paged like the accounts list: the first few quotes, then "Show more" (26 open quotes made
  // the phone page 12,000px long). Three on a phone, four on a desktop. The section mounts only after the
  // client fetch fills webReviews, so reading the viewport here never disagrees with server HTML.
  const [shown, setShown] = useState(() => (typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches ? 3 : 4))
  const sentiment = (s: string): { tone: 'good' | 'bad' | 'caution'; word: string } =>
    s === 'positive' ? { tone: 'good', word: 'Positive' } : s === 'negative' ? { tone: 'bad', word: 'Negative' } : { tone: 'caution', word: 'Mixed' }
  return (
    <div>
      <div className={c.quotes}>
        {quotes.slice(0, shown).map((rv, i) => {
          const account = rv.kind === 'applicant_outcome'
          const href = httpHref(rv.url)
          const sent = sentiment(rv.sentiment)
          return (
            <figure key={i} className={c.quote}>
              <blockquote className={c.quoteText}>&ldquo;{trimToSentence(rv.text, 500)}&rdquo;</blockquote>
              <figcaption className={c.quoteMeta}>
                {account
                  ? <Badge tone={sent.tone}>{sent.word}</Badge>
                  : <Badge icon={rv.kind === 'employee_review' ? 'briefcase' : 'message-square'}>{rv.kind === 'employee_review' ? 'Employee review' : 'Commentary'}</Badge>}
                {rv.source && <span>{displayPlatform(rv.source)}</span>}
                {rv.year && <span>{rv.year}</span>}
                {href && <a href={href} target="_blank" rel="nofollow ugc noopener noreferrer" className={c.srcLink}>Source <Icon name="arrow-up-right" size={12} /></a>}
              </figcaption>
            </figure>
          )
        })}
      </div>
      {quotes.length > shown && (
        <Button variant="ghost" full onClick={() => setShown(n => n + 8)} className={c.more}>
          Show {Math.min(8, quotes.length - shown)} more of {quotes.length - shown} remaining
        </Button>
      )}
      {summaries.length > 0 && (
        <details className={c.note}>
          <summary>{webResearchNote(summaries.length)}</summary>
          <ul>{summaries.map((rv, i) => <li key={i}>{trimToSentence(rv.text, 300)}</li>)}</ul>
        </details>
      )}
      {hidden > 0 && (
        <p className={c.fine}>
          {hidden} quote{hidden === 1 ? '' : 's'} not shown: {hidden === 1 ? 'it contains' : 'they contain'} links or moderator-bot text, which is never a first-hand account.
        </p>
      )}
    </div>
  )
}

// ── Outcome distribution bar ────────────────────────────────────────────────────
// Fed the applicant accounts WITH an outcome only — the same rows (and the same count) as the hero. It
// used to be fed every hiring row and read "77 community reports" under a "48 applicant accounts" hero.
function OutcomeDistribution({ reports, label }: { reports: Report[]; label: string }) {
  if (!reports || reports.length < 3) return null
  const dist: Record<string, number> = {}
  reports.forEach(r => { const oc = r.outcome || 'unknown'; dist[oc] = (dist[oc] || 0) + 1 })
  const total = reports.length
  const merged = [
    { label: 'Ghosted',   count: dist.ghosted || 0,                                                   color: 'var(--bad)' },
    { label: 'Rejected',  count: (dist.rejected || 0) + (dist.autoreject || 0),                       color: 'var(--caution)' },
    { label: 'Interview', count: (dist.interview || 0) + (dist.human || 0) + (dist.interviewing || 0), color: 'var(--info)' },
    { label: 'Hired',     count: (dist.hired || 0) + (dist.offer || 0),                               color: 'var(--good)' },
    { label: 'Waiting',   count: dist.waiting || 0,                                                    color: 'var(--text-4)' },
  ].filter(s => s.count > 0)
  return (
    <div className={c.dist}>
      <div className="ui-eyebrow">{label}</div>
      <div className={c.distBar} aria-hidden="true">
        {merged.map(s => <div key={s.label} style={{ flex: s.count, background: s.color }} />)}
      </div>
      <ul className={c.distKey}>
        {merged.map(s => (
          <li key={s.label}><span className={c.swatch} style={{ background: s.color }} aria-hidden="true" />{s.label} <b className="tnum">{Math.round(s.count / total * 100)}%</b></li>
        ))}
      </ul>
    </div>
  )
}

type Enrichment = { status: string; requested_at?: string | null; done_at?: string | null } | null

// The end state of a page with nothing to show (phone tester 2026-11-02: Fry's read "Seen is looking for
// public hiring discussions…" beside a Reddit row that kept "checking"). ONE static sentence, decided from the
// enrichment status the score answer carried — nothing polls for it. Only a request the cron is running now,
// or queued within the last 24 h, adds that Seen is checking; 'empty' / 'done' / 'error', an older queue entry
// or no queue at all read as what they are: nothing found yet. The company is named the ONE way the page
// names it (displayCompanyName).
function enrichmentLine(enrichment: Enrichment, name: string, now = Date.now()): string {
  const base = 'No public hiring discussions found yet.'
  if (!enrichment) return base
  const requested = Date.parse(String(enrichment.requested_at || ''))
  const fresh = Number.isFinite(requested) && now - requested < ENRICHMENT_FRESH_MS
  const checking = enrichment.status === 'running' || (enrichment.status === 'queued' && fresh)
  return checking ? `No public hiring discussions found yet — Seen is checking public posts that name ${name}.` : base
}

function EnrichmentNotice({ companyName, enrichment }: { companyName: string; enrichment: Enrichment }) {
  return <p className={c.fine} data-enrichment={enrichment?.status || 'none'}>{enrichmentLine(enrichment, displayCompanyName(companyName))}</p>
}

// ── Collapsible section ────────────────────────────────────────────────────────
// The detail blocks below the evidence: a header row that always shows a truthful, data-derived one-line
// summary, and a body that renders only while open (so sections that fetch — roles, locations, Reddit —
// fetch on demand). The evidence itself (applicant accounts, quotes) is NOT behind one of these.
function Section({ id, icon, title, summary, count, open, onToggle, children }: {
  id: SectionKey; icon: IconName; title: string; summary?: ReactNode; count?: number | null
  open: boolean; onToggle: (id: SectionKey) => void; children: ReactNode
}) {
  return (
    <section className={`${c.sec}${open ? ' ' + c.secOpen : ''}`} id={`sec-${id}`}>
      <button type="button" className={c.secHd} aria-expanded={open} aria-controls={`sec-${id}-body`} onClick={() => onToggle(id)}>
        <span className={c.secIco} aria-hidden><Icon name={icon} size={18} /></span>
        <span className={c.secTxt}>
          <span className={c.secTtl}>{title}{count != null && count > 0 ? <span className={c.secCnt}>{count}</span> : null}</span>
          {summary ? <span className={c.secSum}>{summary}</span> : null}
        </span>
        <Icon name="chevron-down" size={18} className={c.secChev} />
      </button>
      {open && <div className={c.secBody} id={`sec-${id}-body`}>{children}</div>}
    </section>
  )
}

// "About four in ten" for 40%: the About line is generated from the SAME number the tiles show, so the
// stored web-research paraphrase ("roughly one-third report ghosting" under a 40% figure) can no longer
// disagree with it.
function tenthsPhrase(pct: number): string {
  const n = Math.round(pct / 10)
  if (n <= 0) return 'almost none'
  if (n >= 10) return 'nearly all'
  if (n === 5) return 'about half'
  const w = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][n]
  return `about ${w} in ten`
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
  // The score API answered `no_data` (no score row, no reports, no mentions). On its own that is not
  // "unknown": a company can have listings and no reports yet — so the page also asks for its job posts
  // (the `companies` row the listings hang on). No score + no listings + no reports = a name Seen knows
  // nothing about, and the page says exactly that instead of a full page of CTAs (tester 2026-11-02).
  const [noData, setNoData] = useState(false)
  const [hasListings, setHasListings] = useState<boolean | null>(null)
  // Self-filling pages: the score API reports this company's public-discussion enrichment request
  // (api/enrich-companies cron) — its status and when it was requested. Read once; it decides one sentence.
  const [enrichment, setEnrichment] = useState<Enrichment>(null)
  // Which detail sections are expanded. The evidence (applicant accounts, online quotes) is always open
  // on the page (audit #28: it used to sit inside 9 collapsed accordions); the detail rows start closed,
  // and a #hash in the URL (e.g. /company/x#locations) opens that section.
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({
    odds: false, breakdown: false, reports: false, online: false, reddit: false,
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
  // answered yet (the section stays hidden until threads exist).
  const [reddit, setReddit] = useState<RedditDiscussionResult | null>(null)
  // `status:'checking'` means Reddit has not answered yet (a background search). The page re-asks every
  // REDDIT_POLL_MS up to REDDIT_POLL_ATTEMPTS times and never past REDDIT_POLL_DEADLINE_MS, then treats it
  // as empty. Nothing on the page shows the checking state (audit 2026-10-23: a dead "Still checking… Retry";
  // phone tester 2026-11-02: "Checking public threads…" that never ended on a slow answer).
  useEffect(() => {
    let alive = true
    let attempts = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const started = Date.now()
    const ctrl = new AbortController()
    const ask = () => {
      // GET so the CDN caches it (lib/server/publicRead.js); re-asked while the worker is still 'checking'.
      fetch(`/api/company-reddit?company=${encodeURIComponent(companyName)}`, { signal: ctrl.signal })
        .then(r => r.json().catch(() => ({})))
        .then((j: { items?: RedditDiscussionResult['items']; status?: string }) => {
          if (!alive) return
          const items = Array.isArray(j.items) ? j.items : []
          if (j.status === 'checking' && items.length === 0) {
            attempts += 1
            const expired = Date.now() - started >= REDDIT_POLL_DEADLINE_MS
            if (attempts < REDDIT_POLL_ATTEMPTS && !expired) { setReddit({ items: [], status: 'checking' }); timer = setTimeout(ask, REDDIT_POLL_MS); return }
            setReddit({ items: [], status: 'empty' })
            return
          }
          setReddit({ items, status: items.length ? 'ok' : 'empty' })
        })
        .catch(() => { if (alive) setReddit({ items: [], status: 'error' }) })
    }
    ask()
    return () => { alive = false; ctrl.abort(); if (timer) clearTimeout(timer) }
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
  // Back to the Seen page this one was opened from (search results, the scoreboard…), else Companies.
  const back = useBack('/companies', 'Companies')

  const [showGradeCard, setShowGradeCard] = useState(false)
  const [myApp, setMyApp] = useState<{company: string; role: string; status: string; stage: string; appliedAt: number; daysSince: number} | null>(null)

  // Deep link: /company/<slug>#reports opens that section on load. The sections open and the reports
  // shown are also kept in the URL (?open=reports,roles&shown=15), so Back to this page reopens them
  // and scroll memory lands in the right place; ?open= wins over the hash ('none' = all closed).
  const [sectionsRead, setSectionsRead] = useState(false)
  const hashSection = useRef<SectionKey | null>(null)
  useEffect(() => {
    // the section names come from the page's own list, never from the URL itself
    const keys = Object.keys(open) as SectionKey[]
    const h = (window.location.hash || '').replace('#', '')
    hashSection.current = keys.find(k => k === h) || null
    const fromParam = readParam('open')
    const want = fromParam
      ? keys.filter(k => fromParam.split(',').includes(k))
      : hashSection.current ? [hashSection.current] : []
    if (want.length) setOpen(prev => { const next = { ...prev }; for (const k of want) next[k] = true; return next })
    const shown = parseInt(readParam('shown'), 10)
    if (Number.isFinite(shown) && shown > 5 && shown <= 500) setReportsShown(shown)
    setSectionsRead(true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!sectionsRead) return
    const keys = (Object.keys(open) as SectionKey[]).filter(k => open[k])
    replaceParam('open', keys.length ? keys.join(',') : hashSection.current ? 'none' : null)
  }, [open, sectionsRead])
  useEffect(() => {
    if (!sectionsRead) return
    replaceParam('shown', reportsShown > 5 ? String(reportsShown) : null)
  }, [reportsShown, sectionsRead])

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
        const sJson = await sRes.json() as { score?: CompanyScore | null; ok?: boolean; no_data?: boolean; enrichment?: { status?: string; requested_at?: string | null; done_at?: string | null } }
        const en = sJson.enrichment
        setEnrichment(en && typeof en.status === 'string' ? { status: en.status, requested_at: en.requested_at ?? null, done_at: en.done_at ?? null } : null)
        if (sJson.no_data || !sJson.score) {
          setNoData(true)
          // Does Seen know this company at all? Its listings say so. Only a known company is remembered
          // as "recently checked" (seen_recent_cos feeds the dashboard, the palette and the micro-survey).
          fetch(`/api/jobs?action=company_jobs&company=${encodeURIComponent(companyName)}`)
            .then(r => r.ok ? r.json() : { jobs: [] })
            .then(d => {
              if (!alive) return
              const jobs = Array.isArray(d?.jobs) ? d.jobs : []
              setCompanyJobs(jobs); setJobsFetched(true); setHasListings(jobs.length > 0)
              if (jobs.length > 0) rememberVisit()
            })
            .catch(() => { if (alive) { setJobsFetched(true); setHasListings(false) } })
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
  // Back to this page lands where it was scrolled, once the grade and the reports are on screen.
  useScrollMemory(sectionsRead && !loading && !reportsLoading)

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
  const logoLetter = (companyName[0] || '?').toUpperCase()
  const ghostPct = sum.ghostPct ?? 0
  const respPct = sum.responsePct ?? 0
  // One plain-English line a first-time visitor can act on — the SAME response rate and thresholds as
  // the odds panel (lib/companyPageSummary.ts responseVerdict), no percentage under MIN_REPORTS_FOR_RATES.
  const verdict = sum.verdict

  // The rows behind the counts. Employee reviews are shown but are NOT hiring outcomes (same rule as the
  // score — lib/server/reportCounts.js); "applicant accounts" are the hiring rows WITH an outcome.
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
  // The page's end state when there is nothing to show: no accounts counted, none listed, no quotes. One
  // sentence in the hero (enrichmentLine), rendered once both reads have answered — never a spinner.
  const nothingFound = !loading && !reportsLoading && fpReports === 0 && reports.length === 0 && shownWebReviews.length === 0
  // The reports section's own counts, each with its set named. The outcome mix is of the rows WITH a reported
  // outcome and sums to that number; employee reviews are listed apart. A bare number badge used to sit in the
  // heading beside a different number in the hero (phone tester 2026-11-02: "26" above, "49" here, "43" below).
  const listedLine = sum.listed.rows === 0
    ? 'None yet — be the first to report'
    : [
        `${sum.listed.withOutcome} with a reported outcome`,
        `${sum.outcomes.ghosted} ghosted · ${sum.outcomes.rejected} rejected · ${sum.outcomes.interview} interviewed · ${sum.outcomes.hired} hired`,
        sum.listed.employee > 0 ? `${sum.listed.employee} employee review${sum.listed.employee === 1 ? '' : 's'}` : '',
      ].filter(Boolean).join(' · ')
  const updatedLine = graded ? lastUpdatedLabel(score.updated_at) : ''

  // A name Seen knows nothing about: no score row, no listings, no reports. A true empty state — the
  // name once, one sentence, ONE outlined action; no Track / prep / share, and it is never remembered as
  // "recently checked". The route answers 200 (existence is decided client-side), so the <meta> keeps it
  // out of the index; the layout's companyRobots (lib/companyMeta.ts) already says noindex server-side
  // for an ungraded name. React 19 hoists the <meta> into <head>.
  const unknown = !loading && !error && noData && hasListings === false && !reportsLoading && reports.length === 0
  if (unknown) {
    return (
      <div className="page-full">
        <meta name="robots" content="noindex" />
        <div className={c.missing}>
          <Icon name="circle-help" size={40} className={c.missingIcon} />
          <h1 className={c.missingTitle}>{displayName}</h1>
          <p className={c.missingText}>Seen has no applicant accounts for this company yet.</p>
          <div className={c.missingActions}>
            <Button variant="secondary" href={reportHref} iconRight="arrow-right">Report an outcome</Button>
          </div>
          {/* A job title typed into a company box lands here too (conversion audit 2026-10-24: "barista"). */}
          <p className={c.fine}>Looking for a job instead? <a href={jobsSearchHref(companyName)} className={c.textLink}>Search &ldquo;{companyName}&rdquo; jobs</a> · <a href="/companies" className={c.textLink}>Browse company grades</a></p>
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

  // Compare cells: an ungraded company shows "Not graded" / "—", never a number standing in for one.
  // Tones come from the shared thresholds (lib/ui/tone.js) and the grade's letter (gradeScale.js).
  const cmpScore = (sc: CompanyScore | null) => !sc ? '—' : isGradeableScore(sc) ? `${letterGrade(sc.overall_score)} · ${sc.overall_score}` : 'Not graded'
  const cmpScoreColor = (sc: CompanyScore | null) => isGradeableScore(sc) ? toneText(gradeTone(sc.overall_score)) : 'var(--text-4)'
  const cmpGhostColor = (sc: CompanyScore | null) => isGradeableScore(sc) && sc.ghost_rate != null ? toneText(ghostRateTone(sc.ghost_rate)) : 'var(--text-4)'
  const cmpRespColor = (sc: CompanyScore | null) => isGradeableScore(sc) && sc.response_rate != null ? toneText(responseRateTone(sc.response_rate)) : 'var(--text-4)'
  const cmpWait = (sc: CompanyScore | null) => isGradeableScore(sc) && sc.avg_wait_days != null ? `${sc.avg_wait_days}d` : '—'
  const compareRows = [
    { label: 'Seen Grade', current: cmpScore(score), get: cmpScore, currentColor: cmpScoreColor(score), getColor: cmpScoreColor },
    { label: 'Ghost rate', current: graded ? pct(score.ghost_rate) : '—', get: (sc: CompanyScore | null) => isGradeableScore(sc) ? pct(sc.ghost_rate) : '—', currentColor: cmpGhostColor(score), getColor: cmpGhostColor },
    { label: 'Response rate', current: graded ? pct(score.response_rate) : '—', get: (sc: CompanyScore | null) => isGradeableScore(sc) ? pct(sc.response_rate) : '—', currentColor: cmpRespColor(score), getColor: cmpRespColor },
    { label: 'Avg wait', current: cmpWait(score), get: cmpWait, currentColor: 'var(--text-2)', getColor: () => 'var(--text-2)' },
  ]

  // The evidence line under the grade: how many applicant accounts, and — once the list has loaded —
  // how many are public posts and how many Seen users filed (lib/glossary.js, audit #3).
  // Every number on this page names the set it counts (DESIGN.md §1, Candid). The hero's count is the rows
  // the grade stands on — company_scores.first_party_report_count at the last recompute — never the longer
  // list below, which also holds still-waiting rows and commentary (26 vs 49 on /company/amazon, 2026-11-02).
  const srcPhrase = accountSources(fpReports, sum.sources ? sum.sources.public : null, sum.sources ? sum.sources.seen : null)
  const accounts = fpReports > 0 ? `${accountsLabel(fpReports)} counted in the grade${srcPhrase ? ` (${srcPhrase})` : ''}` : `${accountsLabel(0)} counted yet`
  const evidenceParts = [accounts, sum.employeeReviews > 0 ? `${sum.employeeReviews} employee review${sum.employeeReviews === 1 ? '' : 's'} (adjust the score, never outcomes)` : '', sum.mentions > 0 ? `${sum.mentions} online mention${sum.mentions === 1 ? '' : 's'} (each counts half)` : ''].filter(Boolean)
  const tone = graded ? gradeTone(score.overall_score) : null
  const respTone = sum.ratesShown ? responseRateTone(score?.response_rate) : null
  const ghostTone = sum.ratesShown ? ghostRateTone(score?.ghost_rate) : null
  const wasteTone = wastedEffortTone(score?.waste)

  return (
    <div className="page-full">
      <div className={c.page}>
        {/* Where you are: Dashboard › Companies › {name} — the same trail every inner page carries. */}
        <Crumbs items={[{ href: '/companies', label: 'Companies' }]} current={displayName} />

        {/* ── "You applied here" context strip ── */}
        {myApp && (
          <div className={c.myApp}>
            <span className="ui-eyebrow">Your application</span>
            <span className={c.myAppRole}>{myApp.role} · Day {myApp.daysSince}</span>
            <Badge tone={myApp.status === 'hired' ? 'good' : myApp.status === 'rejected' ? 'caution' : myApp.status === 'ghosted' ? 'bad' : 'neutral'}>
              {myApp.status === 'active' ? myApp.stage : myApp.status.charAt(0).toUpperCase() + myApp.status.slice(1)}
            </Badge>
            <Button variant="ghost" size="sm" href="/tracker" iconRight="arrow-right" className={c.myAppLink}>View in tracker</Button>
          </div>
        )}

        {/* ── Sticky context strip (appears once the hero scrolls away) — solid, never glass ── */}
        {mounted && createPortal(
          <div className={`co-sticky${stuck ? ' show' : ''}`} aria-hidden={!stuck}>
            <div className="co-sticky-in">
              <button type="button" className="co-sticky-back" onClick={back.go} aria-label={back.label} title={back.label} tabIndex={stuck ? 0 : -1}><Icon name="arrow-left" size={16} /></button>
              <span className="co-sticky-logo" aria-hidden>{logoLetter}</span>
              <span className="co-sticky-name">{displayName}</span>
              {graded && (
                <span className="co-sticky-grade" role="img" aria-label={`Seen Grade ${g}, ${score.overall_score} out of 100`}>
                  <span className="co-sticky-letter" style={{ color: toneText(tone) }}>{g}</span>
                  <span className="co-sticky-score tnum">{score.overall_score}<span>/100</span></span>
                </span>
              )}
            </div>
          </div>,
          document.body
        )}

        {/* ── Hero: who, the grade (letter · score · verdict · evidence), the numbers — each shown once ── */}
        <section className={c.hero} ref={heroRef} aria-labelledby="co-name">
          <div className={c.who}>
            <div className={c.logo} aria-hidden="true">{logoLetter}</div>
            <div className={c.whoText}>
              {/* The page's ONE h1, in the initial HTML and the accessibility tree (audit 2026-10-24). */}
              <h1 id="co-name" className={c.name}>{displayName}</h1>
              <div className={c.whoMeta}>
                {industry ? <span>{industry}</span> : null}
                {perk.verified && <Badge tone="info" icon="shield-check" title="This employer committed to responding to applicants. Reviewed against real outcome data — it never affects the Seen Grade.">Transparency Verified</Badge>}
                {perk.featured && <Badge tone="accent" icon="star" title="Featured employer — paid placement. Never affects the Seen Grade.">Featured</Badge>}
              </div>
            </div>
          </div>

          {loading ? (
            /* Skeleton mirrors the grade block + stat row it's about to become (same heights: no shift). */
            <div aria-label="Loading company data" role="status" className={c.heroSk}>
              <div className={c.gradeRow}>
                <div className="sk" style={{ width: 88, height: 88, borderRadius: 'var(--r-card)' }} />
                <div className={c.stack} style={{ flex: 1 }}>
                  <div className="sk" style={{ width: '34%', height: 18 }} />
                  <div className="sk" style={{ width: '72%', height: 14 }} />
                  <div className="sk" style={{ width: '52%', height: 12 }} />
                </div>
              </div>
              <div className={c.stats}>{[0, 1, 2, 3].map(i => <div key={i} className="sk" style={{ height: 92, borderRadius: 'var(--r-card)' }} />)}</div>
            </div>
          ) : error ? (
            <LoadError what={`${displayName}'s hiring data`} detail="Seen could not be reached. The grade, rates and accounts below are hidden until it loads — nothing here is a verdict yet." onRetry={() => setReloadKey(k => k + 1)} />
          ) : score && !graded ? (
            /* Below the bar: no letter, score or rates — just what Seen actually holds. */
            <div className={c.gradeRow} role="status">
              <div className={`${c.letter} ${c.letterNone}`} aria-hidden="true">—</div>
              <div className={c.gradeMain}>
                <p className="ui-eyebrow">Seen Grade</p>
                <p className={c.ungraded}>{ungradedLabel}</p>
                <p className={c.verdict}>
                  {fpReports > 0
                    ? `Seen has ${gradeBasisLabel(score)} for ${displayName} so far. A grade appears at ${MIN_REPORTS_FOR_GRADE} — each applicant account counts 1, each online mention counts ½.`
                    : `No applicant accounts for ${displayName} yet. A grade appears once there are ${MIN_REPORTS_FOR_GRADE}.`}
                </p>
                {nothingFound && <EnrichmentNotice companyName={companyName} enrichment={enrichment} />}
                <div className={c.meta}>
                  <Button variant="secondary" size="sm" href={reportHref} icon="plus">Add yours to help grade it</Button>
                  <a href="/methods" className={c.textLink}>How grades work</a>
                </div>
              </div>
            </div>
          ) : graded ? (
            <>
              <div className={c.gradeRow}>
                <div className={c.letter} style={{ color: toneText(tone) }} aria-hidden="true">{g}</div>
                <div className={c.gradeMain}>
                  <p className="ui-eyebrow" aria-hidden="true">Seen Grade</p>
                  {/* One sentence for assistive tech; the letter + rolling digits are presentational. */}
                  <div className={c.scoreLine}>
                    <span className="sr-only">{`Seen Grade ${g}, ${score.overall_score} out of 100`}</span>
                    <span className={c.score} aria-hidden="true"><Odometer value={score.overall_score} instant={!!seed} /><span className={c.scoreOf}>/100</span></span>
                    {tone && <Badge tone={tone}>{gradeWord(tone)}</Badge>}
                  </div>
                  {verdict && <p className={c.verdict}>{verdict}</p>}
                  <p className={c.evidence}><Icon name="users" size={14} />{evidenceParts.join(' · ')}{fpReports === 0 && webEst > 0 ? ' · web-research estimate' : ''}</p>
                  <div className={c.meta}>
                    <ConfidenceBadge sum={sum} webCount={webEst} />
                    {updatedLine && <span className={c.metaText}>{updatedLine}</span>}
                    <a href="/methods" className={c.textLink}>How grades work</a>
                  </div>
                </div>
              </div>

              {/* A number the reports never gave (no wait or round counts on any row) is left out, never shown as "—".
                  Response / ghost percentages need MIN_REPORTS_FOR_RATES applicant accounts (Chipotle showed "77%"
                  from 2 — audit 2026-10-23); below it the page says so instead. Every toned figure says its word. */}
              {(() => {
                const respP = ratePct(score.response_rate)
                const ghostP = ratePct(score.ghost_rate)
                const tiles = [
                  sum.ratesShown && respP != null ? <StatTile key="r" label="Hear back" value={respP} suffix="%" tone={respTone} toneWord={responseRateWord(respTone)} instant={!!seed} /> : null,
                  sum.ratesShown && ghostP != null ? <StatTile key="g" label="Ghosted" value={ghostP} suffix="%" tone={ghostTone} toneWord={ghostRateWord(ghostTone)} instant={!!seed} /> : null,
                  score.avg_wait_days != null ? <StatTile key="w" label="Avg wait" value={score.avg_wait_days} suffix="d" instant={!!seed} /> : null,
                  score.avg_rounds != null ? <StatTile key="n" label="Rounds" value={score.avg_rounds.toFixed(1)} /> : null,
                  score.waste != null ? <StatTile key="x" label="Wasted-effort risk" value={score.waste} suffix="%" tone={wasteTone} toneWord={wastedEffortWord(wasteTone)} instant={!!seed} /> : null,
                ].filter(Boolean)
                return (
                  <>
                    {tiles.length > 0 && <div className={c.stats}>{tiles}</div>}
                    {!sum.ratesShown && (
                      <p className={c.fine} role="note">Response and ghost rates appear at {MIN_REPORTS_FOR_RATES} applicant accounts — {fpReports} so far.</p>
                    )}
                  </>
                )
              })()}
            </>
          ) : (
            /* No score row at all (the API answered no_data): what Seen holds, then the one end-state sentence.
               A <div> — the old <p> wrapped the notice's own <p>, which the browser split in two. */
            <div role="status">
              <p className={c.fine}>No applicant accounts for {displayName} yet — a grade appears once there are {MIN_REPORTS_FOR_GRADE}.</p>
              {nothingFound && <EnrichmentNotice companyName={companyName} enrichment={enrichment} />}
            </div>
          )}
        </section>

        {/* The ONE primary action: "Applied here? Track it." Rendered from the first paint (its size does not
            depend on the score), so it never mounts late and pushes the page down (CLS, audit #11). */}
        {!error && companyName && (
          <div className={c.track}>
            <TrackCta company={displayName} slug={slug} responsePct={sum.ratesShown ? sum.responsePct : null} />
          </div>
        )}

        {/* ── The evidence, open: what applicants say. Hidden while the load failed — "None yet" under an
            error would be a false statement (R-5). ── */}
        {!loading && !error && (
          <>
            {/* The list holds applicant accounts AND employee reviews, so the header names both and counts
                each separately — it used to read "Applicant accounts 100" for 15 accounts + 85 reviews. */}
            <section className={c.block} id="sec-reports" aria-labelledby="co-accounts">
              <div className={c.blockHead}>
                <div>
                  <h2 id="co-accounts" className={c.h2}>{employeeN > 0 ? 'Applicant accounts & employee reviews' : 'Applicant accounts'}</h2>
                  <p className={c.blockSub}>{reports.length === 0 && reportsLoading ? 'Loading accounts…' : listedLine}</p>
                </div>
                <Button variant="secondary" size="sm" href={reportHref} icon="plus">Report yours</Button>
              </div>
              <div className={c.tools}>
                <p className={c.provenance}>
                  {reportsProvenanceLine(sum)}
                  {sum.listedNote ? ` ${sum.listedNote}` : ''}
                  {/* The grade's count is stored when the rows are imported (company_scores.first_party_report_count);
                      each card is re-judged by today's stricter first-hand rules (lib/reports/feedFilter.js). When the
                      two disagree — Amazon: "25 from public posts" counted beside 47 "Commentary" cards; Stripe: ten of
                      ten — say so in one sentence that carries both numbers, instead of two facts that contradict. */}
                  {commentaryN > 0
                    ? ` ${commentaryN} of the ${publicRows.length} public ${publicRows.length === 1 ? 'row reads' : 'rows read'} as commentary under today's stricter first-hand rules${(sum.sources?.public ?? 0) > publicRows.length - commentaryN ? ` — the ${sum.sources!.public} counted in the grade ${sum.sources!.public === 1 ? 'was' : 'were'} accepted when imported` : ''}.`
                    : ''}
                  {hiddenPublicN > 0 ? ` ${hiddenPublicN} hidden (links or bot text).` : ''}
                </p>
                <div className={c.cityFilter}>
                  <label htmlFor="co-city" className="sr-only">Filter accounts by city</label>
                  <input id="co-city" autoComplete="off" type="text" placeholder="Filter by city" value={location} onChange={e => setLocation(e.target.value)} className="ui-input" />
                </div>
              </div>
              {reportsLoading && reports.length === 0 ? (
                <p className={c.fine}>Loading accounts…</p>
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
                    // Group headings name their set: reports people filed with Seen first, then every account and
                    // quote compiled from public posts — still-waiting rows and commentary included, which the
                    // hero's grade count never holds (that is why this number is the larger one).
                    const heading = i === 0 && seenRows.length > 0 && publicRows.length > 0
                      ? <h3 className={c.group}>{seenRows.length} {seenRows.length === 1 ? 'report' : 'reports'} submitted to Seen</h3>
                      : i === seenRows.length && i > 0 && publicRows.length > 0
                        ? <h3 className={c.group}>{publicRows.length} accounts and quotes from public posts</h3>
                        : null
                    const roleLine = r.role && !/^unknown/i.test(r.role) ? r.role : ''
                    // One outcome per card: the chip and the "ghosted at …" stage come from one helper.
                    const card = reportCardOutcome(r, { employee, commentary })
                    const meta = [r.city || '', r.rounds ? `${r.rounds} round${r.rounds !== 1 ? 's' : ''}` : '', when].filter(Boolean)
                    return (
                      <div key={r.id} style={{ display: 'contents' }}>
                        {heading}
                        <article className={`${c.acct}${isPublic ? ' ' + c.acctPublic : ''}`} data-tone={card.tone}>
                          <div className={c.acctHd}>
                            <div className={c.acctWho}>
                              {(roleLine || card.ghostStage) && (
                                <div className={c.acctRole}>
                                  {roleLine}
                                  {card.ghostStage && <span className={c.acctStage}>{roleLine ? ' · ' : ''}ghosted at {card.ghostStage}</span>}
                                </div>
                              )}
                              {meta.length > 0 && <div className={c.acctMeta}>{r.city ? <Icon name="map-pin" size={12} /> : null}{meta.join(' · ')}</div>}
                            </div>
                            <Badge tone={card.tone} icon={card.icon as IconName} title={commentary ? 'Not the poster’s own applicant account under Seen’s rules — shown as commentary, no outcome' : undefined}>{card.label}</Badge>
                          </div>
                          {body && <p className={c.acctBody}>{body}</p>}
                          {r.id && employerReplies[r.id] && (
                            <div className={c.reply}>
                              <p className={c.replyHd}><span className="ui-eyebrow">Employer response</span> · unverified claim, doesn&apos;t affect the score</p>
                              <p className={c.replyBody}>{employerReplies[r.id]!.body}</p>
                            </div>
                          )}
                          {/* One attribution line: third-party rows show their source badge + link; first-party rows the platform applied on. */}
                          <div className={c.acctFoot}>
                            {badge ? (
                              <Badge title={badge.title}>{badge.label}</Badge>
                            ) : (
                              <span className={c.via}>via <Badge>{displayPlatform(r.platform) || 'Seen'}</Badge></span>
                            )}
                            {src && <ReportSourceLink url={src.url} host={src.host} posted={src.posted} className="rc-srclink" />}
                          </div>
                        </article>
                      </div>
                    )
                  })}
                  {listRows.length > reportsShown && (
                    <Button variant="ghost" full onClick={() => setReportsShown(n => n + 10)} className={c.more}>
                      Show {Math.min(10, listRows.length - reportsShown)} more of {listRows.length - reportsShown} remaining
                    </Button>
                  )}
                </>
              ) : (
                <div className={c.empty}>
                  {location
                    ? <p>No accounts mention &ldquo;{location}&rdquo;. <button type="button" onClick={() => setLocation('')} className={c.textLink}>Clear the city filter</button></p>
                    : <p>No applicant accounts yet — {displayName} gets a grade once there are {MIN_REPORTS_FOR_GRADE}.</p>}
                  <Button variant="secondary" href={reportHref} iconRight="arrow-right">Be the first to report</Button>
                </div>
              )}
            </section>

            {shownWebReviews.length > 0 && (
              <section className={c.block} id="sec-online" aria-labelledby="co-online">
                <div className={c.blockHead}>
                  <div>
                    <h2 id="co-online" className={c.h2}>What people say online</h2>
                    <p className={c.blockSub}>{shownWebReviews.length} quote{shownWebReviews.length === 1 ? '' : 's'} compiled from public reviews and discussions · each labelled by its source · not Seen&apos;s assessment</p>
                  </div>
                </div>
                <WebReviewsSection reviews={shownWebReviews} hidden={webReviews.length - shownWebReviews.length} />
              </section>
            )}

            {/* The company's own job posts, rated on their own — separate from (and never part of) the Seen Grade. */}
            {companyName && <ListingSignals companyName={companyName} />}

            {/* ── Detail, on demand ── */}
            <h2 className={`${c.h2} ${c.moreHead}`}>More about {displayName}</h2>
            <div className={c.secs}>
              {graded && (
                <Section id="odds" icon="calendar" title="Your odds here" open={open.odds} onToggle={toggle}
                  summary={`${timing.short} · ${sum.ratesShown ? `${respPct}% hear back` : `too few applicant accounts for a rate (${fpReports} of ${MIN_REPORTS_FOR_RATES})`} · your response probability & industry rank`}>
                  <div className={c.panel}>
                    <h3 className="ui-eyebrow">How long until they reply</h3>
                    <p className={c.panelText}>{timing.line}</p>
                    {!timing.known && <Button variant="ghost" size="sm" href={reportHref} iconRight="arrow-right">{REPORT_WHEN_YOU_HEAR}</Button>}
                  </div>
                  <HiringProbability responseRate={score.response_rate} ghostRate={score.ghost_rate} overallScore={score.overall_score} reportCount={fpReports} mentionCount={sum.mentions} context={sum.oddsContext} />
                  {benchmark && <div className={c.gapTop}><IndustryBenchmark benchmark={benchmark} variant="public" companyName={displayName} /></div>}
                </Section>
              )}

              {graded && (
                <Section id="breakdown" icon="chart-column" title="How the grade is built" open={open.breakdown} onToggle={toggle}
                  summary={`${sum.ratesShown ? `Response ${respPct}% · ghost ${ghostPct}% · ` : ''}wasted-effort risk ${score.waste ?? 0}% · ${sum.ratesShown ? 'where in the process they ghost' : `rates appear at ${MIN_REPORTS_FOR_RATES} applicant accounts (${fpReports} so far)`}`}>
                  <div className={c.two}>
                    <div className={c.panel}>
                      <h3 className="ui-eyebrow">Score breakdown</h3>
                      {sum.ratesShown ? (
                        <>
                          <BarRow label="Response rate" value={respPct} fill={toneFill(respTone)} />
                          <BarRow label="Ghost rate" value={ghostPct} fill={toneFill(ghostTone)} />
                        </>
                      ) : (
                        <p className={c.fine}>Response and ghost rates are shown from {MIN_REPORTS_FOR_RATES} applicant accounts — this grade stands on {sum.evidenceLine}.</p>
                      )}
                      <BarRow label="Wasted-effort risk" value={score.waste || 0} fill={toneFill(wasteTone)} />
                      <dl className={c.kv}>
                        <div><dt>Process score</dt><dd className="tnum">{score.process_score ?? score.overall_score} / 100</dd></div>
                        <div><dt>Avg rounds</dt><dd className="tnum">{score.avg_rounds != null ? score.avg_rounds : '—'}</dd></div>
                        <div><dt>Typical wait</dt><dd>{timing.known ? `${timing.days} days` : 'Not enough data yet'}</dd></div>
                      </dl>
                    </div>
                    {(() => {
                      const rows = ghostStageRows(hiringReports)
                      const n = rows.reduce((a, r) => a + r.n, 0)
                      const ghostedN = hiringReports.filter(r => r.outcome === 'ghosted').length
                      // Each bar is a share of the n rows that NAMED a stage — not of every ghosted row and not of the
                      // hero's count ("43%" read as a third number on the page) — so the line under the bars says
                      // both numbers.
                      return rows.length > 0 && (
                      <div className={c.panel}>
                        <h3 className="ui-eyebrow">Where they ghost</h3>
                        <HiringFunnel rows={rows} />
                        <p className={c.fine}>Each share is of the {n} ghosted account{n !== 1 ? 's' : ''} that named where contact stopped{ghostedN > n ? ` (${ghostedN - n} more ghosted ${ghostedN - n === 1 ? 'account' : 'accounts'} named no stage)` : ''}.</p>
                      </div>) })()}
                  </div>
                  <OutcomeDistribution reports={outcomeReports} label={`Outcome distribution · ${outcomeReports.length} listed account${outcomeReports.length === 1 ? '' : 's'} with a reported outcome${sum.listed.waiting > 0 ? ` · ${sum.listed.waiting} still waiting, not counted` : ''}`} />
                </Section>
              )}

              {/* Shown once at least two threads about hiring at this company exist (api/company-reddit.js
                  MIN_SHOW_THREADS) — never while checking. A page without real discussion has no Reddit row. */}
              {reddit !== null && reddit.items.length >= 2 && (
                <Section id="reddit" icon="message-square" title="Reddit discussion" count={reddit.items.length} open={open.reddit} onToggle={toggle}
                  summary={`${reddit.items.length} public threads about hiring at ${displayName} — every item links to its source`}>
                  <CompanyRedditDiscussion companyName={displayName} hasReportData={reports.length > 0 || !!score} prefetched={reddit} />
                </Section>
              )}

              <Section id="locations" icon="map-pin" title="Locations" open={open.locations} onToggle={toggle}
                summary={cityRows.length > 0
                  ? `${cityRows.length} cit${cityRows.length === 1 ? 'y' : 'ies'} with reported outcomes · where ${displayName} is hiring now`
                  : `Where ${displayName} is hiring now · no accounts name a city yet`}>
                {cityRows.length > 0 && (
                  <div className={c.gapBottom}>
                    <h3 className="ui-eyebrow">Reported outcomes by city</h3>
                    <p className={c.fine}>From {reportsWithCity} listed account{reportsWithCity !== 1 ? 's' : ''} that named a city (still-waiting rows included)</p>
                    <div className={c.stack}>
                      {cityRows.map(row => {
                        const ghostPctVal = Math.round(row.ghostRate * 100)
                        // Ungraded companies: per-city percentages from a handful of accounts are a verdict too.
                        if (!graded) return (
                          <div key={row.city} className={c.row}>
                            <span className={c.rowName}>{row.city}</span>
                            <Badge>{row.total} account{row.total !== 1 ? 's' : ''}</Badge>
                          </div>
                        )
                        const t = ghostRateTone(row.ghostRate)
                        return (
                          <div key={row.city} className={c.row}>
                            <span className={c.rowName}>{row.city}</span>
                            <div className={c.rowBar}>
                              <BarRow label="Ghosted" value={ghostPctVal} fill={toneFill(t)} />
                              <p className={c.fine}>{Math.round(row.responseRate * 100)}% responded</p>
                            </div>
                            <Badge>{row.total} account{row.total !== 1 ? 's' : ''}</Badge>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
                <div>
                  <h3 className="ui-eyebrow">Where {displayName} is hiring</h3>
                  {jobsLoading || !jobsFetched ? (
                    <p className={c.fine}>Checking current job listings…</p>
                  ) : hiringRows.length > 0 ? (
                    <>
                      <p className={c.fine}>
                        From {hiring.listings} current job listing{hiring.listings !== 1 ? 's' : ''}{capped ? ' (the top-scored open listings — there may be more)' : ''} · listing locations, not applicant accounts
                        {hiring.abroad > 0 ? ` · ${hiring.abroad} outside the US not shown` : ''}
                        {hiring.withLocation + hiring.abroad < hiring.listings ? ` · ${hiring.listings - hiring.withLocation - hiring.abroad} without a stated location` : ''}
                      </p>
                      <div className={c.stack}>
                        {hiringRows.map(row => (
                          <div key={row.label} className={c.row}>
                            <span className={c.rowName}><Icon name={row.label === 'Remote' ? 'globe' : 'map-pin'} size={14} />{row.label}</span>
                            <div className={c.rowBar}><div className={c.barTrack}><div className={c.barFill} style={{ width: `${maxCount ? Math.round((row.count / maxCount) * 100) : 0}%`, background: 'var(--info)' }} /></div></div>
                            <Badge>{row.count} listing{row.count !== 1 ? 's' : ''}</Badge>
                          </div>
                        ))}
                      </div>
                      {hiring.otherPlaces > 0 && <p className={c.fine}>+ {hiring.otherPlaces} more location{hiring.otherPlaces !== 1 ? 's' : ''}</p>}
                      <Button variant="ghost" size="sm" onClick={() => openSection('roles')} iconRight="arrow-right" className={c.gapTop}>See open roles</Button>
                    </>
                  ) : (
                    <p className={c.fine}>
                      {companyJobs.length > 0
                        ? (hiring.abroad === companyJobs.length
                            ? `${companyJobs.length} current job listing${companyJobs.length !== 1 ? 's' : ''}, all outside the US — Seen lists US and remote roles.`
                            : `${companyJobs.length} current job listing${companyJobs.length !== 1 ? 's' : ''}, but none states a US location.`)
                        : 'No current job listings found for this company.'}
                    </p>
                  )}
                </div>
                {cityRows.length === 0 && (
                  <p className={c.fine}>No applicant accounts with a city yet. <a href={reportHref} className={c.textLink}>Report your experience</a></p>
                )}
              </Section>

              <Section id="roles" icon="briefcase" title="Open roles" count={jobsFetched ? companyJobs.length : null} open={open.roles} onToggle={toggle}
                summary={jobsFetched ? (companyJobs.length > 0 ? `${companyJobs.length} current listing${companyJobs.length !== 1 ? 's' : ''} · apply with the ${graded ? 'grade' : 'accounts'} in mind` : 'No open roles found right now') : `Current job listings at ${displayName}`}>
                {jobsLoading && <p className={c.fine}>Searching for open roles at {displayName}…</p>}
                {!jobsLoading && jobsFetched && companyJobs.length === 0 && (
                  <div className={c.empty}>
                    <p>No open roles found right now.</p>
                    <Button variant="secondary" size="sm" href={`/jobs?q=${encodeURIComponent(companyName)}`} iconRight="arrow-right">Search jobs</Button>
                  </div>
                )}
                {!jobsLoading && companyJobs.length > 0 && (
                  <ul className={c.roles}>
                    {companyJobs.map((j, i) => (
                      <li key={i} className={c.roleRow}>
                        <div className={c.roleTop}>
                          <span className={c.roleTitle}>{j.title}</span>
                          {displayPay(j) && <span className={`${c.rolePay} tnum`}>{displayPay(j)}</span>}
                        </div>
                        <p className={c.roleMeta}>{[j.location || 'US', j.type, j.level, j.source].filter(Boolean).join(' · ')}</p>
                        {j.url && <Button variant="secondary" size="sm" href={httpHref(j.url) ?? undefined} target="_blank" rel="noopener noreferrer" iconRight="arrow-up-right">Apply</Button>}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section id="compare" icon="sliders-horizontal" title="Compare" open={open.compare} onToggle={toggle}
                summary={compareList.length > 0 ? `${displayName} vs ${compareList.map(x => x.name).join(' & ')}` : 'Side by side with up to 2 other companies'}>
                <form className={c.cmpForm} onSubmit={e => { e.preventDefault(); addCompare() }}>
                  <label htmlFor="co-cmp" className="sr-only">Company to compare</label>
                  <input id="co-cmp" autoComplete="off" type="text" placeholder="Company name" value={compareInput} onChange={e => setCompareInput(e.target.value)} disabled={compareList.length >= 2} className="ui-input" />
                  <Button type="submit" variant="secondary" disabled={!compareInput.trim() || compareList.length >= 2}>Compare</Button>
                  {compareList.length > 0 && <Button variant="ghost" onClick={() => setCompareList([])}>Clear</Button>}
                </form>
                {compareList.length >= 2 && <p className={c.fine}>You can compare up to 2 other companies at once — clear to start over.</p>}
                {compareList.length === 0 ? (
                  <p className={`${c.fine} ${c.dashed}`}>Add a company to see the grade, ghost rate, response rate and wait time side by side.</p>
                ) : (
                  <div className={c.cmpWrap}>
                    <table className={c.cmp}>
                      <thead>
                        <tr>
                          <th scope="col">Metric</th>
                          <th scope="col">{displayName} <span className={c.cmpCur}>current</span></th>
                          {compareList.map(x => (
                            <th key={x.name} scope="col">{x.name}{x.loading ? <span className={c.cmpCur}>loading…</span> : !x.score ? <span className={c.cmpCur}>no data</span> : null}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {compareRows.map(row => (
                          <tr key={row.label}>
                            <th scope="row">{row.label}</th>
                            <td style={{ color: row.currentColor }}>{row.current}</td>
                            {compareList.map(x => <td key={x.name} style={{ color: x.loading ? 'var(--text-4)' : row.getColor(x.score) }}>{x.loading ? '…' : row.get(x.score)}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>

              <Section id="about" icon="info" title="About this grade" open={open.about} onToggle={toggle}
                summary={score
                  ? (!graded ? `${ungradedLabel} · summary & public records` : `Based on ${gradeBasisLabel(score)}${webEst > 0 ? ' + public web research' : ''} · summary & public records`)
                  : 'Public records & data status'}>
                {sum.ratesShown && sum.ghostPct != null && sum.responsePct != null
                  ? <p className={c.panelText}>{`${tenthsPhrase(sum.ghostPct).charAt(0).toUpperCase()}${tenthsPhrase(sum.ghostPct).slice(1)} reported applicants (${sum.ghostPct}%) say ${displayName} ghosted them; ${sum.responsePct}% heard back.`}</p>
                  : score?.summary ? <p className={c.panelText}>{score.summary}</p> : null}
                {score && (
                  <p className={c.fine}>
                    {!graded
                      ? `${ungradedLabel} — a grade needs ${MIN_REPORTS_FOR_GRADE}: each applicant account counts 1, each online mention counts ½; web estimates never count.`
                      : `Based on ${gradeBasisLabel(score)}${webEst > 0 ? ' + public web research' : ''}.`}{' '}
                    <a href={reportHref} className={c.textLink}>Add your report</a>
                  </p>
                )}
                {/* Attributed public-record signals (SEC 8-K, etc.) — self-hides when there are none; never score-gated. */}
                <div className={c.gapTop}><CompanyPublicRecord companyName={companyName} /></div>
              </Section>
            </div>

            {/* Everything else you can do here — secondary, after the evidence. */}
            <div className={c.actions}>
              <Button variant="secondary" href={`/resume?company=${encodeURIComponent(companyName || '')}`} icon="file-text">Check your résumé for {displayName}</Button>
              {/* ?sv=<score> versions the shared URL: Reddit caches unfurls PER URL roughly forever, so links
                  shared before the OG card existed are stuck blank. A new score → a new URL → a fresh unfurl
                  fetch. rel=canonical keeps SEO on the clean URL. */}
              <Button
                variant="ghost"
                href={`https://reddit.com/submit?url=${encodeURIComponent(`https://seenjobs.io/company/${slug}${graded ? `?sv=${score.overall_score}` : ''}`)}&title=${encodeURIComponent(graded ? `Is ${displayName} worth applying to? Seen score: ${score.overall_score}/100` : `Is ${displayName} worth applying to? Applicant accounts on Seen`)}`}
                target="_blank" rel="noopener noreferrer" icon="share-2"
              >Post to Reddit</Button>
              {graded && <Button variant="ghost" onClick={() => setShowGradeCard(true)} icon="image">Grade card</Button>}
            </div>

            {/* Warn a friend, worded from exactly what this page shows (lib/growthCopy.js). */}
            {companyName && (
              <WarnFriendShare
                context="company_page"
                path={`/company/${slug}`}
                lead={`Know someone applying to ${displayName}?`}
                text={warnFriendText({ company: displayName, graded, letter: g, applicantReports: fpReports, ratesShown: sum.ratesShown, ghostRate: sum.ghostRate, responseRate: sum.responseRate })}
              />
            )}
          </>
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
              // First-party only: the PNG renders "Based on N applicant accounts" — feeding it
              // the fused web claim published the phantom number to social. Its own zero-state
              // ("Baseline estimate · share your experience") is the honest fallback.
              report_count: fpReports,
              // The SAME confidence word the hero shows (lib/companyPageSummary.ts) — the card never counts on its own.
              confidence: sum.confidence?.word,
              risk: score.risk_level ?? undefined,
              // Tag words come from the SAME thresholds as the tiles (lib/ui/tone.js): a 55% reply rate reads
              // "Moderate" on the tile and must not become "Responsive" on the card.
              tags: [
                ghostRateTone(score.ghost_rate) === 'bad' ? 'High ghost rate' : null,
                responseRateTone(score.response_rate) === 'good' ? 'Responsive' : null,
                wastedEffortTone(score.waste) === 'bad' ? 'High wasted-effort risk' : null,
                (score.avg_wait_days || 0) >= 30 ? 'Long wait times' : null,
              ].filter(Boolean) as string[],
            }}
            shareUrl={`https://seenjobs.io/company/${slug}`}
            onClose={() => setShowGradeCard(false)}
          />
        )}
      </div>
    </div>
  )
}
