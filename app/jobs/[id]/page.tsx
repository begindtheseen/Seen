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
import { JOB_INSIGHTS_COST, RESUME_OPTIMIZE_COST, creditCostLabel, dailyResetLabel } from '@/lib/creditRules'
import { displayCompanyName } from '@/lib/companyDisplay'
import { displayPay, payLabel } from '@/lib/jobs/pay.js'
import { paragraphs, isDescriptionPreview, stripDanglingEllipsis, endsCutOff } from '@/lib/jobs/descriptionText.js'
import { isGradeableScore } from '@/lib/gradeGate'
import ListingScoreRing from '@/components/jobs/ListingScoreRing'
import EmployerGradeChip from '@/components/jobs/EmployerGradeChip'
import { JOB_INSIGHTS_VERSION } from '@/lib/jobInsightsVersion.js'

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
  _src?: 'db' | 'generated' | 'empty' | 'uncached' | 'no_credits'
  price?: number
  cost?: number
  charged?: boolean
  balance?: number
  credits_required?: boolean
  error?: string
}

function companySlug(name: string) {
  return encodeURIComponent(name.toLowerCase().replace(/\s+/g, '-'))
}

function Skeleton({ widths, h }: { widths: number[]; h: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
      {widths.map((w, i) => (
        <div key={i} style={{ height: h, background: 'var(--raised)', borderRadius: 4, width: `${w}%`, animation: 'pulse 1.4s ease infinite' }} />
      ))}
    </div>
  )
}

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { isLoggedIn, user } = useAuth()

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
  const [insightsState, setInsightsState] = useState<'loading' | 'done' | 'unavailable' | 'no_desc' | 'uncached' | 'generating' | 'credits' | 'preview'>('loading')
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
    if (!isLoggedIn) { alert('Sign in to report listings.'); return }
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
    const desc = job.description || ''
    setInsightsState('generating'); setInsightNote('')
    try {
      const res = await fetch('/api/job-insights', {
        method: 'POST',
        headers: await aiHeaders(),
        body: JSON.stringify({ jobId: job.id, job: job.title, company: job.company, jobDescription: desc, needsSummary: true }),
      })
      const d = await res.json() as InsightsResponse
      if (d.credits_required || res.status === 401 || res.status === 402) {
        setInsightNote(d.error || 'Out of AI credits.'); setInsightsState('credits'); return
      }
      if (d.charged) {
        window.dispatchEvent(new Event('seen:credits-updated'))
        setInsightNote(`${creditCostLabel(d.cost ?? JOB_INSIGHTS_COST)} used${typeof d.balance === 'number' && d.balance < 900 ? ` · ${d.balance} left` : ''} · ${dailyResetLabel()}`)
      }
      if (d.what_they_want?.length) {
        try { localStorage.setItem('ji_' + job.id, JSON.stringify({ ts: Date.now(), v: JOB_INSIGHTS_VERSION, data: d })) } catch { /* ignore */ }
        setInsights(d as Insights); setInsightsState('done')
      } else { setInsights(d as Insights); setInsightsState('unavailable') }
    } catch { setInsightsState('unavailable') }
  }, [job])

  function revealInsights() {
    if (!isLoggedIn) { setInsightNote(''); setInsightsState('credits'); return }
    if (hasConfirmedCreditUse(user?.id)) generateInsights()
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

  const backBtn = (
    <button onClick={goBack} style={{ background: 'none', border: 'none', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--dim)', cursor: 'pointer', padding: '.25rem 0', marginBottom: '1.5rem', display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>← Back to jobs</button>
  )

  // Direct-link / refresh fallback — job not in this session's cache
  if (resolved && !job) {
    return (
      <div className="page-full">
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '1.25rem 1rem 7rem', width: '100%', boxSizing: 'border-box' }}>
          {backBtn}
          <div style={{ background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 12, padding: '1.5rem', textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--display)', fontSize: '1rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.4rem' }}>This listing isn&apos;t loaded</div>
            <div style={{ fontSize: '.8rem', color: 'var(--sub)', fontWeight: 300, marginBottom: '1rem', lineHeight: 1.6 }}>Job details are loaded from your search session. Run a search and open the listing from the results.</div>
            <button onClick={() => router.push('/jobs')} style={{ background: 'var(--green)', color: 'var(--ink)', border: 'none', borderRadius: 8, padding: '.6rem 1.25rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.82rem', cursor: 'pointer' }}>Search jobs →</button>
          </div>
        </div>
      </div>
    )
  }

  if (!job) return <div className="page-full"><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}><div className="spinner" /></div></div>

  const companyName = displayCompanyName(job.company) || job.company
  const pay = displayPay(job)
  const chips = [job.type, job.level, pay && pay !== '—' ? pay : ''].filter(Boolean) as string[]
  const avail = job.availability_status
  const preview = isDescriptionPreview(job)
  const cutOff = !preview && endsCutOff(job.description || '')
  const postingHref = httpHref(job.apply_url)
  // Paragraphs: the row's own newlines (ingest keeps them since 2026-10-24), else the headings and
  // bullets the one-line stored text carries (lib/jobs/descriptionText.js paragraphs).
  const descParas = paragraphs(insights?.description_summary || (preview ? stripDanglingEllipsis(job.description || '') : (job.description || '')))

  return (
    <div className="page-full">
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '1.25rem 1rem 7rem', width: '100%', boxSizing: 'border-box' }}>
        {backBtn}

        {/* Header card — glassmorphism glass panel */}
        <div className="hero-terminal" style={{ display: 'block', marginBottom: '1.5rem', padding: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', marginBottom: chips.length > 0 ? '.85rem' : 0 }}>
            <div style={{ width: 52, height: 52, borderRadius: 10, background: 'var(--raised)', border: '1px solid var(--line2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '1.3rem', color: 'var(--white)', flexShrink: 0 }}>
              {(companyName || '?')[0].toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={{ fontFamily: 'var(--display)', fontSize: '1.25rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.025em', lineHeight: 1.2, marginBottom: '.3rem' }}>{job.title}</h1>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--dim)' }}>{companyName}{job.location ? ` · 📍 ${job.location}` : ''}</div>
              {employerScore != null && <div style={{ marginTop: '.45rem' }}><EmployerGradeChip company={job.company} score={employerScore} /></div>}
            </div>
            <ListingScoreRing score={job.score} size={44} />
          </div>
          {chips.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem' }}>
              {chips.map((c, i) => (
                <span key={i} style={{ background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 5, padding: '.2rem .55rem', fontSize: '.65rem', fontFamily: 'var(--mono)', color: 'var(--sub)' }}>{c}</span>
              ))}
            </div>
          )}
        </div>

        {/* Stat grid — Score / Waste / Type / Level / Salary / Source */}
        <div className="jd-grid">
          <div className="jd-stat"><span className="jd-sn">{job.score ?? '–'}</span><span className="jd-sl">Listing score</span></div>
          <div className="jd-stat"><span className="jd-sn" style={{ color: job.waste == null ? 'var(--dim)' : job.waste > 55 ? 'var(--red)' : job.waste > 35 ? 'var(--amber)' : 'var(--green)' }}>{job.waste == null ? '–' : `${job.waste}%`}</span><span className="jd-sl">Waste risk</span></div>
          <div className="jd-stat"><span className="jd-sn" style={{ fontSize: '.75rem' }}>{job.type || 'Full-time'}</span><span className="jd-sl">Type</span></div>
          <div className="jd-stat"><span className="jd-sn" style={{ fontSize: '.75rem' }}>{job.level || '—'}</span><span className="jd-sl">Level</span></div>
          <div className="jd-stat"><span className="jd-sn" style={{ color: 'var(--green)', fontSize: '.78rem' }}>{pay || '—'}</span><span className="jd-sl">{pay ? payLabel(pay) : 'Salary'}</span></div>
          <div className="jd-stat"><span className="jd-sn" style={{ fontSize: '.68rem', color: 'var(--blue)' }}>{job.source || 'Job board'}</span><span className="jd-sl">Source</span></div>
        </div>

        {/* Waste score panel — shown when company has high waste risk */}
        {job.waste != null && job.waste > 40 && (
          <div className="waste-panel" style={{ animation: 'fadeUp .4s .1s ease both' }}>
            <span className="wp-label">⚠ {job.waste}% Waste risk</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)' }}>High chance of no response</span>
          </div>
        )}

        {/* Why this score — the exact factors behind the listing's transparency score. Every
            number is explained; nothing is a black box. */}
        {scoreWhy && Array.isArray(scoreWhy.score_factors) && scoreWhy.score_factors.length > 0 && (
          <details style={{ marginBottom: '.85rem', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '.15rem .2rem' }}>
            <summary style={{ cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--sub)', padding: '.5rem .7rem', listStyle: 'none' }}>
              ▸ Why this listing scores {job.score ?? 'unrated'}{job.score != null ? '/100' : ''} — see the exact factors
            </summary>
            <div style={{ padding: '.2rem .7rem .6rem' }}>
              {scoreWhy.score_factors.map((f, i) => (
                <div key={i} style={{ display: 'flex', gap: '.5rem', alignItems: 'baseline', padding: '.22rem 0', borderTop: i ? '1px solid var(--line2)' : 'none' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', fontWeight: 700, minWidth: 34, textAlign: 'right', color: f.points > 0 ? 'var(--green)' : f.points < 0 ? 'var(--red)' : 'var(--muted)' }}>
                    {f.points > 0 ? `+${f.points}` : f.points}
                  </span>
                  <span style={{ fontFamily: 'var(--body)', fontSize: '.66rem', color: 'var(--sub)', lineHeight: 1.5 }}>{f.reason}</span>
                </div>
              ))}
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.54rem', color: 'var(--muted)', marginTop: '.5rem', lineHeight: 1.55 }}>
                Scores run 18–95 on a 100-point scale. This grades the listing&apos;s transparency (salary disclosure, source, description quality) — not the company. It is not a verified fact about the employer.
              </div>
            </div>
          </details>
        )}

        {/* Status indicator — pulsing blue if listing was recently seen */}
        {avail === 'active' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '.45rem', marginBottom: '.85rem', fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--blue)', animation: 'fadeUp .4s .08s ease both' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--blue)', display: 'inline-block', animation: 'pulse 2s infinite', flexShrink: 0 }} />
            Active listing — seen recently
          </div>
        )}

        {/* Availability warning — only when the field exists (no invented data) */}
        {avail === 'stale' && (
          <div style={{ marginTop: '.85rem', padding: '.55rem .8rem', background: 'rgba(245,158,11,.07)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 8, fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--amber)', lineHeight: 1.55 }}>⚠ This listing hasn&apos;t been seen in 7+ days and may be closed. Verify before applying.</div>
        )}
        {job.filled && (
          <div style={{ marginTop: '.85rem', padding: '.55rem .8rem', background: 'rgba(16,185,129,.07)', border: '1px solid rgba(16,185,129,.25)', borderRadius: 8, fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--green)', lineHeight: 1.55 }}>✓ This position has been filled — the employer closed it on Seen.</div>
        )}
        {avail === 'expired' && !job.filled && (
          <div style={{ marginTop: '.85rem', padding: '.55rem .8rem', background: 'rgba(239,68,68,.07)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 8, fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--red)', lineHeight: 1.55 }}>✕ This listing is likely closed — it hasn&apos;t been seen in 14+ days. Check the company&apos;s careers page directly.</div>
        )}

        {/* Factual freshness — literally-true observations of OUR data (never an employer verdict);
            the evidence behind the availability note above. */}
        {job.freshness?.label && (
          <div style={{ marginTop: '.6rem', fontFamily: 'var(--mono)', fontSize: '.56rem', color: 'var(--dim)', lineHeight: 1.55 }}>
            {job.freshness.label}
          </div>
        )}
        {job.edited_at && (
          <div style={{ marginTop: '.3rem', fontFamily: 'var(--mono)', fontSize: '.56rem', color: 'var(--amber)', lineHeight: 1.55 }}>
            ✎ Edited by the employer {new Date(job.edited_at).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
        )}

        {/* Report inactive */}
        <div style={{ marginTop: '.4rem' }}>
          {!reportedInactive ? (
            <button
              onClick={reportInactive}
              disabled={reportingInactive}
              style={{ background: 'none', border: 'none', fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)', cursor: 'pointer', padding: '.1rem 0', opacity: .55, transition: 'opacity .15s' }}
              onMouseOver={e => (e.currentTarget.style.opacity = '1')}
              onMouseOut={e => (e.currentTarget.style.opacity = '.55')}
            >
              {reportingInactive ? 'Reporting…' : '⚑ Not active? Report it'}
            </button>
          ) : (
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--amber)' }}>✓ Reported — thanks</span>
          )}
        </div>

        {/* AI insights */}
        <div style={{ marginTop: '1.5rem', background: 'var(--gdim)', border: '1px solid var(--line)', borderRadius: 12, padding: '1.25rem', animation: 'fadeUp .4s .15s ease both' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--dim)', marginBottom: '.85rem' }}>
            WHAT {(companyName || 'THIS COMPANY').toUpperCase()} IS HIRING FOR
          </div>
          {(insightsState === 'loading' || insightsState === 'generating') && <Skeleton widths={[80, 65, 72, 58, 68]} h={10} />}
          {insightsState === 'no_desc' && <div style={{ fontSize: '.75rem', color: 'var(--muted)' }}>No description available for AI analysis.</div>}
          {insightsState === 'unavailable' && <div style={{ fontSize: '.75rem', color: 'var(--muted)' }}>AI insights unavailable for this listing.</div>}
          {insightsState === 'preview' && (
            <div style={{ fontSize: '.75rem', color: 'var(--muted)', lineHeight: 1.6 }}>
              This source gives Seen only a preview of the posting, so there is nothing to analyze yet.{' '}
              {postingHref ? <a href={postingHref} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--green)' }}>Open the full posting to analyze it ↗</a> : 'Open the full posting on the employer\'s site to analyze it.'}
            </div>
          )}
          {insightsState === 'uncached' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
              <div style={{ fontSize: '.75rem', color: 'var(--sub)', lineHeight: 1.6 }}>Nobody has generated the insight for this listing yet. Once generated it is free for everyone for 7 days.</div>
              <button type="button" onClick={revealInsights} data-testid="reveal-insights"
                style={{ alignSelf: 'flex-start', background: 'var(--green)', color: 'var(--ink)', border: 'none', borderRadius: 8, padding: '.55rem .95rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.8rem', cursor: 'pointer' }}>
                Reveal AI insights · {creditCostLabel(insightPrice)}
              </button>
            </div>
          )}
          {insightsState === 'credits' && (
            <div style={{ fontSize: '.75rem', color: 'var(--muted)', lineHeight: 1.6 }}>
              {isLoggedIn
                ? (insightNote || "You're out of AI credits for now — insights will be available again soon.")
                : <>Sign in to generate AI insights ({creditCostLabel(insightPrice)}; free once cached). <a href="/login" style={{ color: 'var(--green)' }}>Sign in →</a></>}
            </div>
          )}
          {insightsState === 'done' && insightNote && (
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', marginBottom: '.6rem' }}>{insightNote}</div>
          )}
          {insightsState === 'done' && insights && (
            <>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
                {insights.what_they_want.map((item, i) => (
                  <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '.55rem', fontSize: '.8rem', color: 'var(--sub)', lineHeight: 1.5 }}>
                    <span style={{ color: 'var(--green)', fontSize: '.6rem', marginTop: '.22rem', flexShrink: 0 }}>▶</span>{item}
                  </li>
                ))}
              </ul>
              {(insights.hidden_requirements?.length > 0 || insights.insider_tip) && (
                <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--line)' }}>
                  {insights.hidden_requirements?.length > 0 && (
                    <>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--dim)', marginBottom: '.55rem' }}>Unstated Expectations</div>
                      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 .85rem', display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
                        {insights.hidden_requirements.map((r, i) => (
                          <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '.5rem', fontSize: '.75rem', color: 'var(--muted)', lineHeight: 1.5 }}>
                            <span style={{ color: 'var(--red)', fontSize: '.55rem', marginTop: '.2rem', flexShrink: 0 }}>◆</span>{r}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {insights.insider_tip && (
                    <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 7, padding: '.65rem .9rem', fontSize: '.75rem', color: 'var(--sub)', lineHeight: 1.6 }}>
                      <span style={{ color: 'var(--green)', fontWeight: 700 }}>Tip: </span>{insights.insider_tip}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Description */}
        <div style={{ marginTop: '1.5rem', animation: 'fadeUp .4s .25s ease both' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--dim)', marginBottom: '.75rem' }}>ABOUT THIS ROLE</div>
          {insightsState === 'loading' || insightsState === 'generating'
            ? <Skeleton widths={[95, 82, 90, 70, 86, 75, 92, 65, 80, 88]} h={9} />
            : descParas.length > 0
              ? <>
                  {descParas.map((p, i) => <p key={i} style={{ fontSize: '.84rem', color: 'var(--sub)', lineHeight: 1.8, margin: '0 0 .85rem' }}>{p}</p>)}
                  {preview && (
                    <div style={{ margin: '0 0 .85rem', padding: '.55rem .8rem', background: 'rgba(245,158,11,.07)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 8, fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--amber)', lineHeight: 1.55 }}>
                      ✂ Preview from {job.source || 'this source'}. The full posting is on the employer&apos;s site{postingHref ? <> — <a href={postingHref} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--amber)' }}>open it ↗</a></> : '.'}
                    </div>
                  )}
                  {cutOff && !insights?.description_summary && (
                    <div style={{ margin: '0 0 .85rem', fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--dim)', lineHeight: 1.55 }}>
                      Continues on the employer&apos;s site{postingHref ? <> — <a href={postingHref} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--green)' }}>open it ↗</a></> : '.'}
                    </div>
                  )}
                </>
              : <p style={{ fontSize: '.84rem', color: 'var(--muted)', fontWeight: 300 }}>No description available.</p>
          }
        </div>

        {/* SeenFit Engine — deterministic, keyless résumé/application optimizer */}
        <SeenFitPanel job={job} />

        {/* HumanProof — runs AFTER SeenFit: removes generic AI tone, adds truthful work context */}
        <HumanProofPanel job={job} optimized={optimized} />

        {/* Report Your Experience — T1-15 */}
        <div style={{ marginTop: '1.5rem', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '1.25rem' }}>
          <div style={{ fontFamily: 'var(--display)', fontSize: '.9rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.3rem' }}>Report your experience</div>
          <p style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--sub)', marginBottom: '1rem', lineHeight: 1.6 }}>
            Applied here? Share how it went — takes 60 seconds and warns the next applicant.
          </p>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
            <a
              href={`/report?from=company&company=${encodeURIComponent(job?.company || '')}&role=${encodeURIComponent(job?.title || '')}&outcome=ghosted`}
              style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--red)', borderRadius: 7, padding: '.4rem .85rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', minHeight: 44 }}
            >
              👻 Got ghosted
            </a>
            <a
              href={`/report?from=company&company=${encodeURIComponent(job?.company || '')}&role=${encodeURIComponent(job?.title || '')}&outcome=rejected`}
              style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', color: 'var(--blue)', borderRadius: 7, padding: '.4rem .85rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', minHeight: 44 }}
            >
              🤝 Rejected
            </a>
            <a
              href={`/report?from=company&company=${encodeURIComponent(job?.company || '')}&role=${encodeURIComponent(job?.title || '')}&outcome=interviewing`}
              style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: 'var(--green)', borderRadius: 7, padding: '.4rem .85rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', minHeight: 44 }}
            >
              📅 Got an interview
            </a>
            <a
              href={`/report?from=company&company=${encodeURIComponent(job?.company || '')}&role=${encodeURIComponent(job?.title || '')}&outcome=hired`}
              style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', color: 'var(--green)', borderRadius: 7, padding: '.4rem .85rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', minHeight: 44 }}
            >
              ✅ Got an offer
            </a>
          </div>
        </div>
      </div>

      {/* Sticky footer */}
      <div style={{ position: 'sticky', bottom: 0, background: 'var(--ink)', borderTop: '1px solid var(--line2)', padding: '.9rem 1rem', paddingBottom: 'calc(.9rem + env(safe-area-inset-bottom))', zIndex: 10 }}>
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '.5rem', width: '100%', boxSizing: 'border-box' }}>
          <a href={`/company/${companySlug(job.company)}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 44, width: '100%', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--amber)', textDecoration: 'none', opacity: .85 }}>
            🏢 Check {companyName || 'company'} →
          </a>
          <div style={{ display: 'flex', gap: '.75rem' }}>
            <button onClick={toggleSave} aria-label={saved ? 'Unsave' : 'Save'} style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 8, padding: '.65rem 1rem', fontSize: '1.1rem', cursor: 'pointer', color: saved ? 'var(--green)' : 'var(--muted)', flexShrink: 0 }}>{saved ? '♥' : '♡'}</button>
            <button onClick={() => setShowShareCard(true)} aria-label="Share listing" title="Share this listing" style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 8, padding: '.65rem 1rem', fontSize: '1.05rem', cursor: 'pointer', color: 'var(--muted)', flexShrink: 0 }}>🖼</button>
            {job.filled ? (
              <button disabled style={{ flex: 1, background: 'var(--raised)', color: 'var(--muted)', border: '1px solid var(--line2)', borderRadius: 8, padding: '.65rem 1rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.85rem' }}>Position filled</button>
            ) : <>
            {takesSeenApply(job) && (
              <button
                onClick={() => setShowSeenApply(true)}
                style={{ flex: 1, textAlign: 'center', background: 'var(--green)', color: 'var(--ink)', borderRadius: 8, padding: '.65rem 1rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.85rem', border: 'none', cursor: 'pointer' }}
              >
                Apply on Seen →
              </button>
            )}
            {/* Same two actions as the search drawer: "Apply ↗" is FREE (opens the posting, then the
                tracker checkpoint offers to log it); "Optimize · 1 credit" is the paid optimizer. The
                page used to offer only "Apply & Optimize →" (audit 2026-10-24). */}
            {postingHref && job.apply_mode !== 'seen'
              ? <>
                  <a
                    href={postingHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="detail-apply-link"
                    onClick={() => { trackApplyClick(job); setCheckpointAuto(false); setShowCheckpoint(true) }}
                    style={takesSeenApply(job)
                      ? { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', background: 'none', color: 'var(--sub)', borderRadius: 8, padding: '.65rem .8rem', fontFamily: 'var(--display)', fontWeight: 700, fontSize: '.78rem', border: '1px solid var(--line2)', textDecoration: 'none', minWidth: 0 }
                      : { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', background: 'var(--green)', color: 'var(--ink)', borderRadius: 8, padding: '.65rem .8rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.85rem', textDecoration: 'none', minWidth: 0 }}
                  >
                    {takesSeenApply(job) ? 'Apply on their site ↗' : preview ? 'Open the full posting ↗' : 'Apply ↗'}
                  </a>
                  {!takesSeenApply(job) && !preview && (
                    <button
                      type="button"
                      data-testid="detail-optimize-btn"
                      onClick={() => setShowApplyModal(true)}
                      title={`Optimize your résumé for this job · ${OPTIMIZE_PRICE}`}
                      style={{ flex: 1, minWidth: 0, textAlign: 'center', background: 'rgba(99,102,241,.08)', color: '#a5b4fc', borderRadius: 8, padding: '.5rem .5rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.78rem', lineHeight: 1.15, border: '1px solid rgba(99,102,241,.35)', cursor: 'pointer' }}
                    >Optimize · {OPTIMIZE_PRICE.replace(' ', '\u00a0')}</button>
                  )}
                </>
              : !takesSeenApply(job) && <button disabled style={{ flex: 1, background: 'var(--muted)', color: 'var(--ink)', border: 'none', borderRadius: 8, padding: '.65rem 1rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.85rem', opacity: .65 }}>No apply link</button>
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
