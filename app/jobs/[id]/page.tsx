'use client'

// Job detail page — parity port of the old SPA `page-job-detail` (origin/main:index.html:2274–2293)
// driven by `openJobListing` (index.html:11213) + AI insights block (11260–11405).
// Source of truth: origin/main. AI uses the existing /api/job-insights endpoint (unchanged).

import { httpHref } from '@/lib/safeHref.js'
import { useState, useEffect, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import { JobCache } from '@/lib/stores/JobCache'
import { SavedJobsStore } from '@/lib/stores/SavedJobs'
import ListingCard from '@/components/ListingCard'
import SeenFitPanel from '@/components/SeenFitPanel'
import HumanProofPanel from '@/components/HumanProofPanel'
import { aiHeaders } from '@/lib/aiHeaders'
import { notify } from '@/lib/notify'
import { useAuth } from '@/lib/auth'
import { wasOptimized } from '@/lib/optimizedJobs'
import { trackApplyClick } from '@/lib/trackApply'
import type { Job } from '@/lib/types'
import ApplyOptimizeModal from '@/components/ApplyOptimizeModal'
import ApplyCheckpoint from '@/components/ApplyCheckpoint'
import SeenApplyModal from '@/components/jobs/SeenApplyModal'
import { takesSeenApply } from '@/lib/seenApplyMode'
import CreditConfirmDialog from '@/components/CreditConfirmDialog'
import { hasConfirmedCreditUse } from '@/lib/creditConfirm'
import { JOB_INSIGHTS_COST, RESUME_OPTIMIZE_COST, creditCostLabel, priceLabel, usageLine } from '@/lib/creditRules'
import { useProStatus } from '@/lib/hooks/useProStatus'
import { displayCompanyName } from '@/lib/companyDisplay'
import { displayPay, payLabel } from '@/lib/jobs/pay.js'
import { paragraphs, isDescriptionPreview, stripDanglingEllipsis, endsCutOff } from '@/lib/jobs/descriptionText.js'
import { isGradeableScore } from '@/lib/gradeGate'
import ListingScoreRing from '@/components/jobs/ListingScoreRing'
import EmployerGradeChip from '@/components/jobs/EmployerGradeChip'
import { JOB_INSIGHTS_VERSION } from '@/lib/jobInsightsVersion.js'
import PastePosting from '@/components/jobs/PastePosting'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Icon from '@/components/ui/Icon'
import StatTile from '@/components/ui/StatTile'
import { wastedEffortTone, wastedEffortWord } from '@/lib/ui/tone.js'
import d from './detail.module.css'

interface Insights {
  what_they_want: string[]
  hidden_requirements: string[]
  insider_tip: string
  description_summary: string
}

interface ScoreFactor { signal: string; points: number; reason: string }
interface ScoreExplanation {
  transparency_score: number
  score_factors: ScoreFactor[]
  waste_score: number
  waste_factors: ScoreFactor[]
}

// The optimizer's price, rendered from the credit rules (same label as the search drawer).
const OPTIMIZE_PRICE = creditCostLabel(RESUME_OPTIMIZE_COST)

const L1_TTL = 24 * 60 * 60 * 1000 // localStorage TTL — matches old _INSIGHTS_L1_TTL (24h)

// A score/waste value is a real number or null (unrated) — never a fabricated default.
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

// /api/job-insights answer shape (see that file's header): a probe never charges.
interface InsightsResponse extends Partial<Insights> {
  _src?: 'db' | 'generated' | 'empty' | 'uncached' | 'no_credits' | 'unread'
  message?: string
  price?: number
  cost?: number
  charged?: boolean
  pro?: boolean
  balance?: number
  credits_required?: boolean
  error?: string
}

function companySlug(name: string) {
  return encodeURIComponent(name.toLowerCase().replace(/\s+/g, '-'))
}

function Skeleton({ widths, h }: { widths: number[]; h: number }) {
  return (
    <div className={d.skel} role="status" aria-label="Loading">
      {widths.map((w, i) => <div key={i} className="sk" style={{ height: h, width: `${w}%` }} />)}
    </div>
  )
}

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { isLoggedIn, user } = useAuth()
  const pro = useProStatus()

  const [job, setJob] = useState<Job | null>(null)
  const [resolved, setResolved] = useState(false)
  const [saved, setSaved] = useState(false)
  const [insights, setInsights] = useState<Insights | null>(null)
  // loading → probing the shared cache (free) · uncached → not cached; the price-tagged "Reveal"
  // button is shown, nothing spent · generating → the paid call is in flight · credits → refused ·
  // preview → the row is a source's teaser (Adzuna): nothing to analyze, nothing to sell.
  // Until 2026-10-24 this page called /api/job-insights WITHOUT probe:true on load, so opening a
  // permalink while signed in generated — and charged — an insight nobody asked for; the drawer had
  // been fixed (PR #351), the permalink page had not. Same two-step flow now.
  // unread → the posting states nothing to read (free, never cached); the person can paste the full posting
  const [insightsState, setInsightsState] = useState<'loading' | 'done' | 'unavailable' | 'no_desc' | 'uncached' | 'generating' | 'credits' | 'preview' | 'unread'>('loading')
  // The posting text the insight runs on: the listing's own, or one the person pasted (preview rows).
  const [pastedDesc, setPastedDesc] = useState<string | null>(null)
  // "About this role": the summary first (it states the pay and what the job asks for), the full posting one tap away
  const [showFullDesc, setShowFullDesc] = useState(false)
  const [insightPrice, setInsightPrice] = useState<number>(JOB_INSIGHTS_COST)
  const [insightNote, setInsightNote] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [showApplyModal, setShowApplyModal] = useState(false)
  const [showCheckpoint, setShowCheckpoint] = useState(false)
  const [checkpointAuto, setCheckpointAuto] = useState(false)
  // HumanProof says "your application is optimized" only once this person actually ran the paid
  // optimizer for this job (the modal marks it — lib/optimizedJobs.ts). The free fit check is a
  // diagnosis, not an optimization: it used to flip this and the copy claimed work never done.
  const [optimized, setOptimized] = useState(false)
  const [showSeenApply, setShowSeenApply] = useState(false)
  const [showShareCard, setShowShareCard] = useState(false)
  const [reportedInactive, setReportedInactive] = useState(false)
  const [reportingInactive, setReportingInactive] = useState(false)
  const [scoreWhy, setScoreWhy] = useState<ScoreExplanation | null>(null)

  async function reportInactive() {
    if (!isLoggedIn) { notify({ title: 'Sign in to report listings', severity: 'info', duration: 2600 }); return }
    setReportingInactive(true)
    try {
      await fetch('/api/user-sync', {
        method: 'POST',
        headers: await aiHeaders(),
        // Send a snapshot of the listing so the admin can see WHAT was reported even when this is
        // a live/ephemeral search result (j_<hash> id) that was never stored in the jobs table.
        body: JSON.stringify({
          action: 'report_job_availability',
          job_id: String(id),
          status: 'expired',
          snapshot: {
            company: job?.company || null,
            title: job?.title || null,
            city: job?.location || null,
            apply_url: job?.apply_url || null,
          },
        }),
      })
      setReportedInactive(true)
    } catch { /* silent */ } finally {
      setReportingInactive(false)
    }
  }

  // Resolve the job — session cache first (fast path), then the saved snapshot
  // (so a SAVED listing always reopens to the exact thing saved, even in a new
  // session or after it has aged out of the DB), then DB fallback for direct links.
  useEffect(() => {
    const j = JobCache.get(id)
    if (j) {
      setJob(j)
      setSaved(SavedJobsStore.isSaved(j.id))
      setResolved(true)
      return
    }
    const snap = SavedJobsStore.getSnapshot(id)
    if (snap) {
      JobCache.set(snap)
      setJob(snap)
      setSaved(true)
      setResolved(true)
      return
    }
    fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_by_id', id }),
    })
      .then(r => r.json())
      .then((d: { job?: Record<string, unknown> }) => {
        if (!d.job) return
        const r = d.job
        const mapped: Job = {
          id: String(r.id ?? id),
          title: String(r.title ?? ''),
          company: String(r.company ?? ''),
          location: String(r.location ?? ''),
          score: numOrNull(r.score),
          waste: numOrNull(r.waste_score ?? r.waste),
          level: String(r.level ?? ''), // no level in the listing → shown as unknown, never invented
          type: String(r.type ?? 'Full-time'),
          source: String(r.source ?? 'Job board'),
          description: String(r.description ?? ''),
          salary: r.salary ? String(r.salary) : null,
          apply_url: r.apply_url ? String(r.apply_url) : (r.url ? String(r.url) : null),
          availability_status: r.availability_status ? String(r.availability_status) : undefined,
          freshness: (r as { freshness?: Job['freshness'] }).freshness,
          employer_posted: r.is_employer_posted === true,
          apply_mode: r.apply_mode === 'seen' || r.apply_mode === 'both' ? r.apply_mode : 'external',
          edited_at: r.edited_at ? String(r.edited_at) : undefined,
          filled: r.status === 'filled',
        }
        JobCache.set(mapped)
        setJob(mapped)
        const why = (r as { score_explanation?: ScoreExplanation }).score_explanation
        if (why && Array.isArray(why.score_factors)) setScoreWhy(why)
        setSaved(SavedJobsStore.isSaved(id))
      })
      .catch(() => {})
      .finally(() => setResolved(true))
  }, [id])

  // Step 1 (free): the device cache, then a PROBE of the shared cache. A probe never gates,
  // generates or charges — it either returns the cached insight or the price of a real call.
  const loadInsights = useCallback(async (j: Job) => {
    const desc = j.description || ''
    if (!desc || desc.length <= 80) {
      setInsightsState('no_desc')
      return
    }
    if (isDescriptionPreview(j)) { setInsightsState('preview'); return }
    // L1: localStorage 24h
    const cacheKey = 'ji_' + j.id
    try {
      const raw = localStorage.getItem(cacheKey)
      if (raw) {
        const entry = JSON.parse(raw)
        // an entry from an older generator version is ignored (lib/jobInsightsVersion.js)
        if (entry.v === JOB_INSIGHTS_VERSION && Date.now() - entry.ts < L1_TTL) { setInsights(entry.data); setInsightsState('done'); return }
        localStorage.removeItem(cacheKey)
      }
    } catch { /* ignore */ }

    // L2: the shared cache (DB, 7d) — probed, never generated from here.
    try {
      const res = await fetch('/api/job-insights', {
        method: 'POST',
        headers: await aiHeaders(),
        body: JSON.stringify({ jobId: j.id, job: j.title, company: j.company, jobDescription: desc, needsSummary: true, probe: true }),
      })
      const d = await res.json() as InsightsResponse
      if (d._src === 'unread') { setInsightNote(d.message || ''); setInsightsState('unread'); return }
      if (d._src === 'uncached') { setInsightPrice(typeof d.price === 'number' ? d.price : JOB_INSIGHTS_COST); setInsightsState('uncached'); return }
      if (d.what_they_want?.length) {
        try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), v: JOB_INSIGHTS_VERSION, data: d })) } catch { /* ignore */ }
        setInsights(d as Insights)
        setInsightsState('done')
      } else {
        setInsights(d as Insights) // may still carry description_summary
        setInsightsState('unavailable')
      }
    } catch {
      setInsightsState('unavailable')
    }
  }, [])

  useEffect(() => {
    if (job) loadInsights(job)
  }, [job, loadInsights])

  // Set after mount (device storage): was this job optimized by this person in the last 7 days?
  useEffect(() => { setOptimized(wasOptimized(user?.id, job?.id)) }, [user?.id, job?.id])

  // The employer's Seen grade (how it treats applicants), from the same DB-only batch_scores read the
  // job list uses (api/reports.js). Shown only when gradeable — the listing ring grades the post.
  const [employerScore, setEmployerScore] = useState<number | null>(null)
  useEffect(() => {
    const co = (job?.company || '').toLowerCase().trim()
    if (!co) return
    let alive = true
    fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'batch_scores', names: [co] }) })
      .then(r => (r.ok ? r.json() : { scores: {} }))
      .then((d: { scores?: Record<string, { overall_score?: number | null; gradeable?: boolean | null; first_party_report_count?: number | null }> }) => {
        const sc = d.scores?.[co]
        if (alive && isGradeableScore(sc)) setEmployerScore(sc.overall_score)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [job?.company])

  // Step 2 (paid, explicit): generate the insight. Reached only from the price-tagged button,
  // after the one-time confirmation on this account/device.
  const generateInsights = useCallback(async () => {
    if (!job) return
    const desc = pastedDesc || job.description || ''
    setInsightsState('generating'); setInsightNote('')
    try {
      const res = await fetch('/api/job-insights', {
        method: 'POST',
        headers: await aiHeaders(),
        body: JSON.stringify({ jobId: pastedDesc ? `${job.id}:pasted` : job.id, job: job.title, company: job.company, jobDescription: desc, needsSummary: true }),
      })
      const d = await res.json() as InsightsResponse
      if (d._src === 'unread') { setInsightNote(d.message || ''); setInsightsState('unread'); return }
      if (d.credits_required || res.status === 401 || res.status === 402) {
        setInsightNote(d.error || 'Out of AI credits.'); setInsightsState('credits'); return
      }
      // the ledger line says what the server did — a Pro account is never charged (d.pro)
      if (d.charged || d.pro) {
        window.dispatchEvent(new Event('seen:credits-updated'))
        setInsightNote(usageLine({ cost: d.cost ?? JOB_INSIGHTS_COST, charged: !!d.charged && !d.pro, pro: !!d.pro, balance: typeof d.balance === 'number' ? d.balance : null }))
      }
      if (d.what_they_want?.length) {
        if (!pastedDesc) { try { localStorage.setItem('ji_' + job.id, JSON.stringify({ ts: Date.now(), v: JOB_INSIGHTS_VERSION, data: d })) } catch { /* ignore */ } }
        setInsights(d as Insights); setInsightsState('done')
      } else { setInsights(d as Insights); setInsightsState('unavailable') }
    } catch { setInsightsState('unavailable') }
  }, [job, pastedDesc])

  // The person pasted the full posting (a preview row, or a listing that states nothing): probe it
  // like the listing's own text — free unless they then tap Reveal.
  const analyzePasted = useCallback(async (text: string) => {
    if (!job) return
    setPastedDesc(text); setInsightsState('loading'); setInsightNote('')
    try {
      const res = await fetch('/api/job-insights', {
        method: 'POST',
        headers: await aiHeaders(),
        body: JSON.stringify({ jobId: `${job.id}:pasted`, job: job.title, company: job.company, jobDescription: text, needsSummary: true, probe: true }),
      })
      const d = await res.json() as InsightsResponse
      if (d._src === 'unread') { setInsightNote(d.message || ''); setInsightsState('unread'); return }
      if (d._src === 'uncached') { setInsightPrice(typeof d.price === 'number' ? d.price : JOB_INSIGHTS_COST); setInsightsState('uncached'); return }
      if (d.what_they_want?.length) { setInsights(d as Insights); setInsightsState('done') } else setInsightsState('unavailable')
    } catch { setInsightsState('unavailable') }
  }, [job])

  function revealInsights() {
    if (!isLoggedIn) { setInsightNote(''); setInsightsState('credits'); return }
    if (pro === true || hasConfirmedCreditUse(user?.id)) generateInsights()
    else setConfirmOpen(true)
  }

  function toggleSave() {
    if (!job) return
    if (saved) {
      SavedJobsStore.remove(job.id, isLoggedIn)
      setSaved(false)
    } else {
      SavedJobsStore.save(job, isLoggedIn)
      setSaved(true)
    }
  }

  function goBack() {
    if (window.history.length > 1) router.back()
    else router.push('/jobs')
  }

  // The listing's own title in the tab (the layout's server title can only say "Job listing").
  useEffect(() => {
    if (!job) return
    const co = displayCompanyName(job.company) || job.company
    document.title = `${job.title}${co ? ` at ${co}` : ''} | Seen`
  }, [job])

  const backBtn = (
    <Button variant="ghost" size="sm" onClick={goBack} icon="arrow-left" className={d.back}>Back to jobs</Button>
  )

  // Direct-link / refresh fallback — job not in this session's cache
  if (resolved && !job) {
    return (
      <div className="page-full">
        <div className={d.page}>
          {backBtn}
          <div className={d.missing}>
            <h1 className={d.missingTitle}>This listing isn&apos;t loaded</h1>
            <p className={d.p}>Job details are loaded from your search session. Run a search and open the listing from the results.</p>
            <Button variant="primary" onClick={() => router.push('/jobs')} iconRight="arrow-right">Search jobs</Button>
          </div>
        </div>
      </div>
    )
  }

  // Same column as the loaded page (d.page), so the listing lands in place instead of the whole
  // container jumping from full width to the reading column (CLS 0.15–0.19 measured at 1440px).
  if (!job) return <div className="page-full"><div className={d.page}>{backBtn}<div className={d.loading}><div className="spinner" /></div></div></div>

  const companyName = displayCompanyName(job.company) || job.company
  const pay = displayPay(job)
  const avail = job.availability_status
  const preview = isDescriptionPreview(job)
  const cutOff = !preview && endsCutOff(job.description || '')
  const postingHref = httpHref(job.apply_url)
  const wt = job.waste != null ? wastedEffortTone(job.waste) : null
  // Paragraphs: the row's own newlines (ingest keeps them since 2026-10-24), else the headings and
  // bullets the one-line stored text carries (lib/jobs/descriptionText.js paragraphs).
  // "About this role": the summary (what the job is, what it asks for, the pay) with the full posting
  // one tap away. The summary used to REPLACE the posting with a 1,200-character slice cut mid-word
  // ("Help define whether new da") that hid the requirements and the pay (2026-10-25).
  const fullParas = paragraphs(preview ? stripDanglingEllipsis(job.description || '') : (job.description || ''))
  const summaryParas = paragraphs(insights?.description_summary || '')
  const descParas = !showFullDesc && summaryParas.length && fullParas.length ? summaryParas : fullParas
  const foldToFull = !showFullDesc && summaryParas.length > 0 && fullParas.length > 0
  const reportHref = (outcome: string) => `/report?from=company&company=${encodeURIComponent(job?.company || '')}&role=${encodeURIComponent(job?.title || '')}&outcome=${outcome}`
  const metaBits = [job.type, job.level].filter(Boolean) as string[]

  return (
    <div className="page-full">
      <div className={d.page}>
        {backBtn}

        {/* Header: what, who, where — each once. The tiles below carry the numbers (the old header
            repeated type/level/pay as chips that the tile grid then showed again — audit #27). */}
        <header className={d.head}>
          <div className={d.logo} aria-hidden="true">{(companyName || '?')[0].toUpperCase()}</div>
          <div className={d.headText}>
            <h1 className={d.title}>{job.title}</h1>
            <p className={d.meta}>
              <span className={d.co}>{companyName}</span>
              {job.location && <span className={d.place}><Icon name="map-pin" size={14} />{job.location}</span>}
              {metaBits.map(m => <span key={m}>{m}</span>)}
            </p>
            {/* Fixed-height slot: the employer's grade arrives after a fetch and must not push the page (CLS). */}
            <div className={d.gradeSlot}>{employerScore != null && <EmployerGradeChip company={job.company} score={employerScore} compact />}</div>
          </div>
          <ListingScoreRing score={job.score} size={44} />
        </header>

        <div className={d.tiles}>
          <StatTile label="Posting score" value={job.score ?? null} suffix="/100" note="How much the posting tells you" />
          <StatTile label="Wasted-effort risk" value={job.waste ?? null} suffix="%" tone={wt} toneWord={wastedEffortWord(wt)} />
          {pay && <StatTile label={payLabel(pay)} value={pay} />}
          <StatTile label="Source" value={job.source || 'Job board'} />
        </div>

        {/* Why this score — the exact factors behind the posting score. Every number is explained. */}
        {scoreWhy && Array.isArray(scoreWhy.score_factors) && scoreWhy.score_factors.length > 0 && (
          <details className={d.why}>
            <summary>Why this posting scores {job.score ?? 'unrated'}{job.score != null ? '/100' : ''} — the exact factors <Icon name="chevron-down" size={16} /></summary>
            <ul>
              {scoreWhy.score_factors.map((f, i) => (
                <li key={i}>
                  <span className="tnum" style={{ color: f.points > 0 ? 'var(--good-text)' : f.points < 0 ? 'var(--bad-text)' : 'var(--text-3)' }}>{f.points > 0 ? `+${f.points}` : f.points}</span>
                  <span>{f.reason}</span>
                </li>
              ))}
            </ul>
            <p className={d.fine}>Scores run 18–95 on a 100-point scale. This grades the posting&apos;s transparency (salary disclosure, source, description quality) — not the company. It is not a verified fact about the employer.</p>
          </details>
        )}

        {/* Status: one line each, only from fields that exist (no invented data). */}
        <div className={d.status}>
          {avail === 'active' && <Badge tone="info" icon="radio">Active listing — seen recently</Badge>}
          {avail === 'stale' && <p className={d.notice} data-tone="caution"><Icon name="triangle-alert" size={14} />This listing hasn&apos;t been seen in 7+ days and may be closed. Verify before applying.</p>}
          {job.filled && <p className={d.notice} data-tone="good"><Icon name="circle-check" size={14} />This position has been filled — the employer closed it on Seen.</p>}
          {avail === 'expired' && !job.filled && <p className={d.notice} data-tone="bad"><Icon name="circle-x" size={14} />This listing is likely closed — it hasn&apos;t been seen in 14+ days. Check the company&apos;s careers page directly.</p>}
          {job.freshness?.label && <p className={d.fine}>{job.freshness.label}</p>}
          {job.edited_at && <p className={d.fine}><Icon name="pencil" size={12} /> Edited by the employer {new Date(job.edited_at).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric' })}</p>}
          {!reportedInactive ? (
            <button type="button" onClick={reportInactive} disabled={reportingInactive} className={d.textBtn}>
              <Icon name="flag" size={14} />{reportingInactive ? 'Reporting…' : 'Not active? Report it'}
            </button>
          ) : (
            <span className={d.fine}><Icon name="check" size={14} /> Reported — thanks</span>
          )}
        </div>

        {/* AI insights — only when there is a posting to read (one "no description" message, below). */}
        {insightsState !== 'no_desc' && (
          <section className={d.card} aria-labelledby="jd-insights">
            <h2 id="jd-insights" className="ui-eyebrow">What {companyName || 'this company'} is hiring for</h2>
            {(insightsState === 'loading' || insightsState === 'generating') && <Skeleton widths={[80, 65, 72, 58, 68]} h={10} />}
            {insightsState === 'unavailable' && <p className={d.p}>AI insights are unavailable for this listing.</p>}
            {insightsState === 'preview' && (
              <div className={d.p}>
                This source gives Seen only a preview of the posting, so there is nothing to analyze yet.{' '}
                {postingHref ? <a href={postingHref} target="_blank" rel="noopener noreferrer" className={d.link}>Open the full posting</a> : 'The full posting is on the employer\'s site.'}
                <PastePosting onAnalyze={analyzePasted} />
              </div>
            )}
            {insightsState === 'unread' && (
              <div className={d.p} data-testid="insights-unread">
                {insightNote || "This listing doesn't state what it requires, so there is nothing to analyze — no credit used."}
                <PastePosting onAnalyze={analyzePasted} />
              </div>
            )}
            {insightsState === 'uncached' && (
              <div className={d.stack}>
                <p className={d.p}>Nobody has generated the insight for this listing yet. Once generated it is free for everyone for 7 days.</p>
                <Button variant="secondary" onClick={revealInsights} data-testid="reveal-insights" icon="sparkles">Reveal AI insights · {priceLabel(insightPrice, pro)}</Button>
              </div>
            )}
            {insightsState === 'credits' && (
              <p className={d.p}>
                {isLoggedIn
                  ? (insightNote || "You're out of AI credits for now — insights will be available again soon.")
                  : <>Sign in to generate AI insights ({creditCostLabel(insightPrice)}; free once cached). <a href="/login" className={d.link}>Sign in</a></>}
              </p>
            )}
            {insightsState === 'done' && insightNote && <p className={d.fine}>{insightNote}</p>}
            {insightsState === 'done' && insights && (
              <>
                <ul className={d.list}>
                  {insights.what_they_want.map((item, i) => <li key={i}><Icon name="check" size={14} className={d.listIco} />{item}</li>)}
                </ul>
                {(insights.hidden_requirements?.length > 0 || insights.insider_tip) && (
                  <div className={d.rule}>
                    {insights.hidden_requirements?.length > 0 && (
                      <>
                        <h3 className="ui-eyebrow">Unstated expectations</h3>
                        <ul className={d.list}>
                          {insights.hidden_requirements.map((r, i) => <li key={i}><Icon name="circle-alert" size={14} className={d.listIcoWarn} />{r}</li>)}
                        </ul>
                      </>
                    )}
                    {insights.insider_tip && <p className={d.tip}><b>Tip: </b>{insights.insider_tip}</p>}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* Description */}
        <section className={d.section} aria-labelledby="jd-about">
          <h2 id="jd-about" className="ui-eyebrow">About this role</h2>
          {insightsState === 'loading' || insightsState === 'generating'
            ? <Skeleton widths={[95, 82, 90, 70, 86, 75, 92, 65, 80, 88]} h={9} />
            : descParas.length > 0
              ? <>
                  {descParas.map((p, i) => <p key={i} className={d.para}>{p}</p>)}
                  {foldToFull && (
                    <Button variant="ghost" size="sm" onClick={() => setShowFullDesc(true)} data-testid="read-full-posting" iconRight="chevron-down">
                      Read the full posting ({(job.description || '').length.toLocaleString()} characters)
                    </Button>
                  )}
                  {preview && (
                    <p className={d.notice} data-tone="caution"><Icon name="scissors" size={14} />Preview from {job.source || 'this source'}. The full posting is on the employer&apos;s site{postingHref ? <> — <a href={postingHref} target="_blank" rel="noopener noreferrer" className={d.link}>open it</a></> : '.'}</p>
                  )}
                  {cutOff && !foldToFull && (
                    <p className={d.fine}>Continues on the employer&apos;s site{postingHref ? <> — <a href={postingHref} target="_blank" rel="noopener noreferrer" className={d.link}>open it</a></> : '.'}</p>
                  )}
                </>
              : <p className={d.p}>This listing has no description, so there is nothing to read or analyze here.</p>
          }
        </section>

        {/* SeenFit — the free fit check; HumanProof — runs after it (both under rebuild, untouched here). */}
        <SeenFitPanel job={job} />
        <HumanProofPanel job={job} optimized={optimized} />

        {/* Report your experience — the strategy's data engine: one tap per outcome. */}
        <section className={d.card} aria-labelledby="jd-report">
          <h2 id="jd-report" className={d.h2}>Report your experience</h2>
          <p className={d.p}>Applied here? Share how it went — it takes a minute and warns the next applicant.</p>
          <div className={d.outcomes}>
            <Button size="sm" variant="secondary" href={reportHref('ghosted')} icon="ghost">Got ghosted</Button>
            <Button size="sm" variant="secondary" href={reportHref('rejected')} icon="circle-x">Rejected</Button>
            <Button size="sm" variant="secondary" href={reportHref('interviewing')} icon="calendar">Got an interview</Button>
            <Button size="sm" variant="secondary" href={reportHref('hired')} icon="award">Got an offer</Button>
          </div>
        </section>
      </div>

      {/* Sticky footer — solid, one primary action. */}
      <div className={d.foot}>
        <div className={d.footIn}>
          <Button variant="ghost" size="sm" href={`/company/${companySlug(job.company)}`} prefetch={false} icon="building-2" className={d.check}>Check {companyName || 'company'}</Button>
          <div className={d.footRow}>
            <button type="button" onClick={toggleSave} aria-label={saved ? 'Remove from saved' : 'Save'} aria-pressed={saved} className={d.iconBtn} data-on={saved ? '1' : '0'}><Icon name="heart" size={18} /></button>
            <button type="button" onClick={() => setShowShareCard(true)} aria-label="Share this listing" title="Share this listing" className={d.iconBtn}><Icon name="share-2" size={18} /></button>
            {job.filled ? (
              <Button variant="secondary" disabled className={d.grow}>Position filled</Button>
            ) : <>
              {takesSeenApply(job) && (
                <Button variant="primary" onClick={() => setShowSeenApply(true)} className={d.grow} iconRight="arrow-right">Apply on Seen</Button>
              )}
              {/* Same two actions as the search drawer: "Apply" is FREE (opens the posting, then the tracker
                  checkpoint offers to log it); "Optimize · 1 credit" is the paid optimizer. */}
              {postingHref && job.apply_mode !== 'seen'
                ? <>
                    <Button
                      variant={takesSeenApply(job) ? 'secondary' : 'primary'}
                      href={postingHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="detail-apply-link"
                      onClick={() => { trackApplyClick(job); setCheckpointAuto(false); setShowCheckpoint(true) }}
                      className={d.grow}
                      iconRight="arrow-up-right"
                    >
                      {takesSeenApply(job) ? 'Apply on their site' : preview ? 'Open the full posting' : 'Apply'}
                    </Button>
                    {!takesSeenApply(job) && (
                      <Button variant="secondary" data-testid="detail-optimize-btn" onClick={() => setShowApplyModal(true)} title={`Optimize your résumé for this job · ${priceLabel(RESUME_OPTIMIZE_COST, pro)}`} className={d.grow}>
                        Optimize · {priceLabel(RESUME_OPTIMIZE_COST, pro).replace(' ', ' ')}
                      </Button>
                    )}
                  </>
                : !takesSeenApply(job) && <Button variant="secondary" disabled className={d.grow}>No apply link</Button>
              }
            </>}
          </div>
        </div>
        {showSeenApply && job && (
          <SeenApplyModal job={job} onClose={() => setShowSeenApply(false)} />
        )}
        {confirmOpen && (
          <CreditConfirmDialog
            cost={insightPrice}
            action={`generate AI insights for ${companyName}`}
            onConfirm={() => { setConfirmOpen(false); generateInsights() }}
            onCancel={() => setConfirmOpen(false)}
          />
        )}
        {showShareCard && job && (
          <ListingCard
            data={{
              title: job.title, company: companyName, location: job.location,
              level: job.level, type: job.type, score: job.score, waste: job.waste,
              whatTheyWant: insights?.what_they_want, insiderTip: insights?.insider_tip,
            }}
            onClose={() => setShowShareCard(false)}
          />
        )}
        {showApplyModal && job && (
          <ApplyOptimizeModal
            job={job}
            onClose={() => { setShowApplyModal(false); setOptimized(wasOptimized(user?.id, job.id)) }}
            onApplied={() => { setCheckpointAuto(true); setShowCheckpoint(true) }}
          />
        )}
        {showCheckpoint && job && (
          <ApplyCheckpoint job={job} autoConfirm={checkpointAuto} onClose={() => { setShowCheckpoint(false); setCheckpointAuto(false) }} />
        )}
      </div>
    </div>
  )
}
