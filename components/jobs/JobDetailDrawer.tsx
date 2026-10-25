'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useFocusTrap } from '@/lib/hooks/useFocusTrap'
import { SavedJobsStore } from '@/lib/stores/SavedJobs'
import { aiHeaders } from '@/lib/aiHeaders'
import { useAuth } from '@/lib/auth'
import type { Job } from '@/lib/types'
import ModalPortal from '@/components/ModalPortal'
import SeenApplyModal from '@/components/jobs/SeenApplyModal'
import ApplyCheckpoint from '@/components/ApplyCheckpoint'
import CreditConfirmDialog from '@/components/CreditConfirmDialog'
import { trackApplyClick } from '@/lib/trackApply'
import { hasConfirmedCreditUse } from '@/lib/creditConfirm'
import { JOB_INSIGHTS_COST, RESUME_OPTIMIZE_COST, creditCostLabel, dailyResetLabel, priceLabel, usageLine } from '@/lib/creditRules'
import { useProStatus } from '@/lib/hooks/useProStatus'
import { displayCompanyName } from '@/lib/companyDisplay'
import { displayPay, payLabel } from '@/lib/jobs/pay.js'
import { paragraphs, isDescriptionPreview, stripDanglingEllipsis, endsCutOff } from '@/lib/jobs/descriptionText.js'
import { httpHref } from '@/lib/safeHref.js'
import { JOB_INSIGHTS_VERSION } from '@/lib/jobInsightsVersion.js'
import ListingScoreRing from '@/components/jobs/ListingScoreRing'
import PastePosting from '@/components/jobs/PastePosting'

// ── Job detail drawer helpers ─────────────────────────────────────────────────

interface Insights {
  what_they_want: string[]
  hidden_requirements: string[]
  insider_tip: string
  description_summary: string
}

// /api/job-insights answer shape (see that file's header): a probe never charges.
interface InsightsResponse extends Partial<Insights> {
  _src?: 'db' | 'generated' | 'empty' | 'uncached' | 'no_credits' | 'unread'
  message?: string
  cached?: boolean
  price?: number
  cost?: number
  charged?: boolean
  pro?: boolean
  balance?: number
  credits_required?: boolean
  error?: string
}

// loading → probing the shared cache (free)
// done → insights on screen (cached, or just generated)
// uncached → not cached yet; the price-tagged "Reveal" button is shown, nothing spent
// generating → the paid call is in flight
// credits → the paid call was refused (out of credits / signed out)
// preview → the row is a source's teaser of the posting (Adzuna): nothing to analyze, nothing to sell
// unread → the posting states nothing to read (answered free, never cached); a paste box is offered
type InsightsState = 'loading' | 'done' | 'unavailable' | 'no_desc' | 'uncached' | 'generating' | 'credits' | 'preview' | 'unread'

const L1_TTL = 24 * 60 * 60 * 1000
const OPTIMIZE_PRICE = creditCostLabel(RESUME_OPTIMIZE_COST)

function Skeleton({ widths, h }: { widths: number[]; h: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
      {widths.map((w, i) => (
        <div key={i} style={{ height: h, background: 'var(--raised)', borderRadius: 4, width: `${w}%`, animation: 'pulse 1.4s ease infinite' }} />
      ))}
    </div>
  )
}

// ── Job Detail Drawer ─────────────────────────────────────────────────────────

export default function JobDetailDrawer({ job, isLoggedIn, onClose, onApply, onCheckCompany }: {
  job: Job
  isLoggedIn: boolean
  onClose: () => void
  onApply: (job: Job) => void
  onCheckCompany: (company: string) => void
}) {
  const { user } = useAuth()
  const pro = useProStatus()
  const panelRef = useRef<HTMLDivElement>(null)
  // Tab cycles inside the drawer; closing returns focus to the job card that opened it.
  useFocusTrap(panelRef, true)
  const [visible, setVisible] = useState(false)
  const [saved, setSaved] = useState(() => SavedJobsStore.isSaved(job.id))
  const [insights, setInsights] = useState<Insights | null>(null)
  const [insightsState, setInsightsState] = useState<InsightsState>('loading')
  // The text the insight runs on: the listing's own, or a full posting the person pasted.
  const [pastedDesc, setPastedDesc] = useState<string | null>(null)
  useEffect(() => { setPastedDesc(null) }, [job.id])
  const [insightPrice, setInsightPrice] = useState<number>(JOB_INSIGHTS_COST)
  // The ledger line after a paid generation ("1 credit used · 4 left") and any refusal text.
  const [insightNote, setInsightNote] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [checkpoint, setCheckpoint] = useState(false)
  // Apply on Seen: an employer-posted listing whose employer takes applications here
  // (apply_mode 'seen' | 'both'); 'both' also keeps the employer's own site as a second button.
  const mode = job.employer_posted ? (job.apply_mode || 'external') : 'external'
  const seenApply = mode === 'seen' || mode === 'both'
  const externalApply = mode !== 'seen' && !!job.apply_url
  const [seenApplyOpen, setSeenApplyOpen] = useState(false)

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [])

  // Esc closes the drawer, like the backdrop and ✕ (the Seen-apply modal on top handles its own).
  useEffect(() => {
    if (seenApplyOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, seenApplyOpen])

  // The AI summary replaces the posting text by default; the full posting is one tap away. A long
  // posting with no summary is folded at a paragraph boundary with "Read more" (never a bare "…").
  const [showFull, setShowFull] = useState(false)
  useEffect(() => { setShowFull(false) }, [job.id])

  // Step 1 (free): the device cache, then a PROBE of the shared cache. A probe never gates,
  // generates or charges — it either returns the cached insight or the price of a real call.
  const loadInsights = useCallback(async (j: Job) => {
    const desc = j.description || ''
    if (!desc || desc.length <= 80) { setInsightsState('no_desc'); return }
    // A teaser is not the posting: analyzing it would charge a credit for the employer's mission
    // paragraph plus a cut-off sentence (owner report 2026-10-24).
    if (isDescriptionPreview(j)) { setInsightsState('preview'); return }
    const key = 'ji_' + j.id
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const e = JSON.parse(raw)
        // an entry from an older generator version is ignored (lib/jobInsightsVersion.js)
        if (e.v === JOB_INSIGHTS_VERSION && Date.now() - e.ts < L1_TTL) { setInsights(e.data); setInsightsState('done'); return }
        localStorage.removeItem(key)
      }
    } catch { /* ignore */ }
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
        try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), v: JOB_INSIGHTS_VERSION, data: d })) } catch { /* ignore */ }
        setInsights(d as Insights); setInsightsState('done')
      } else { setInsights(d as Insights); setInsightsState('unavailable') }
    } catch { setInsightsState('unavailable') }
  }, [])

  useEffect(() => { loadInsights(job) }, [job, loadInsights])

  // Step 2 (paid, explicit): generate the insight. Reached only from the price-tagged button,
  // after the one-time confirmation on this account/device.
  const generateInsights = useCallback(async () => {
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

  // A pasted full posting is probed like the listing's own text — free unless they tap Reveal.
  const analyzePasted = useCallback(async (text: string) => {
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

  function applyExternal() {
    trackApplyClick(job)
    setCheckpoint(true)
  }

  function toggleSave() {
    if (saved) { SavedJobsStore.remove(job.id, isLoggedIn); setSaved(false) }
    else { SavedJobsStore.save(job, isLoggedIn); setSaved(true) }
  }

  const avail = job.availability_status
  const companyName = displayCompanyName(job.company) || job.company
  const preview = isDescriptionPreview(job)
  const cutOff = !preview && endsCutOff(job.description || '')
  const postingHref = httpHref(job.apply_url)
  // Paragraphs: the row's own newlines (ingest keeps them since 2026-10-24), else the headings and
  // bullets the one-line stored text carries (lib/jobs/descriptionText.js paragraphs).
  const fullParas = paragraphs(preview ? stripDanglingEllipsis(job.description || '') : (job.description || ''))
  const summaryParas = paragraphs(insights?.description_summary || '')
  const FOLD_CHARS = 1400
  const fullChars = (job.description || '').length
  // Which paragraphs to show: the summary (collapsed), the whole posting (expanded), or a long
  // posting folded after the paragraphs that fit FOLD_CHARS.
  let descParas = fullParas
  let foldLabel: string | null = null
  if (!showFull && summaryParas.length && fullParas.length) {
    descParas = summaryParas
    foldLabel = `Read the full posting (${fullChars.toLocaleString()} characters) ↓`
  } else if (!showFull && !summaryParas.length && fullChars > FOLD_CHARS + 300) {
    const kept: string[] = []
    let used = 0
    for (const p of fullParas) { if (used && used + p.length > FOLD_CHARS) break; kept.push(p); used += p.length }
    descParas = kept
    foldLabel = 'Read more ↓'
  }
  const pay = displayPay(job)
  const chips = [job.type, job.level, pay && pay !== '—' ? pay : ''].filter(Boolean) as string[]

  return (
    <ModalPortal>
      {/* Backdrop */}
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 9800,
          background: `rgba(0,0,0,${visible ? '.65' : '0'})`,
          backdropFilter: visible ? 'blur(3px)' : 'none',
          transition: 'background .3s ease, backdrop-filter .3s ease',
        }}
        onClick={onClose}
      />
      {/* Slide-in panel */}
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={`${job.title} at ${job.company}`} style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 9900,
        width: 'min(540px, 100vw)',
        background: 'var(--surface)',
        borderLeft: '1px solid var(--line)',
        boxShadow: '-12px 0 48px rgba(0,0,0,.55),-40px 0 80px rgba(99,102,241,.12),-60px 0 120px rgba(124,58,237,.06)',
        transform: `translateX(${visible ? '0' : '100%'})`,
        transition: 'transform .3s cubic-bezier(.32,.72,0,1)',
        display: 'flex', flexDirection: 'column',
        overflowY: 'hidden',
      }}>
        {/* Sticky header */}
        <div style={{ flexShrink: 0, borderBottom: '1px solid var(--line)', padding: '.85rem 1.15rem', display: 'flex', alignItems: 'center', gap: '.65rem' }}>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 7, color: 'var(--dim)', cursor: 'pointer', fontSize: '.72rem', padding: '.28rem .65rem', fontFamily: 'var(--mono)', flexShrink: 0 }}>← Back</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--display)', fontSize: '.85rem', fontWeight: 700, color: 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.title}</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)' }}>{companyName}</div>
          </div>
          <a href={`/jobs/${encodeURIComponent(job.id)}`} style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)', textDecoration: 'none', flexShrink: 0, padding: '.25rem' }}>↗</a>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', fontSize: '1rem', padding: '.2rem', lineHeight: 1, flexShrink: 0 }}>✕</button>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.15rem', paddingBottom: '0' }}>
          {/* Header card */}
          <div className="hero-terminal" style={{ display: 'block', marginBottom: '1.1rem', padding: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.8rem', marginBottom: chips.length ? '.7rem' : 0 }}>
              <div style={{ width: 44, height: 44, borderRadius: 9, background: 'var(--raised)', border: '1px solid var(--line2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '1.1rem', color: 'var(--white)', flexShrink: 0 }}>
                {(companyName || '?')[0].toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--display)', fontSize: '1.05rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.025em', lineHeight: 1.2, marginBottom: '.22rem' }}>{job.title}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)' }}>{companyName}{job.location ? ` · 📍 ${job.location}` : ''}</div>
                {externalApply && (
                  <a href={job.apply_url!} target="_blank" rel="noopener noreferrer" data-testid="posting-link"
                    onClick={() => trackApplyClick(job)}
                    style={{ display: 'inline-block', marginTop: '.4rem', fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--green)', textDecoration: 'none' }}>
                    Open the job posting ↗
                  </a>
                )}
              </div>
              <ListingScoreRing score={job.score} size={40} />
            </div>
            {chips.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem' }}>
                {chips.map((c, i) => <span key={i} style={{ background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 5, padding: '.18rem .48rem', fontSize: '.58rem', fontFamily: 'var(--mono)', color: 'var(--sub)' }}>{c}</span>)}
              </div>
            )}
          </div>

          {/* Stat grid */}
          <div className="jd-grid" style={{ marginBottom: '1rem' }}>
            <div className="jd-stat"><span className="jd-sn">{job.score ?? '–'}</span><span className="jd-sl">Listing score</span></div>
            <div className="jd-stat"><span className="jd-sn" style={{ color: job.waste == null ? 'var(--dim)' : job.waste > 55 ? 'var(--red)' : job.waste > 35 ? 'var(--amber)' : 'var(--green)' }}>{job.waste == null ? '–' : `${job.waste}%`}</span><span className="jd-sl">Waste risk</span></div>
            <div className="jd-stat"><span className="jd-sn" style={{ fontSize: '.72rem' }}>{job.type || 'Full-time'}</span><span className="jd-sl">Type</span></div>
            <div className="jd-stat"><span className="jd-sn" style={{ fontSize: '.72rem' }}>{job.level || '—'}</span><span className="jd-sl">Level</span></div>
            <div className="jd-stat"><span className="jd-sn" style={{ color: 'var(--green)', fontSize: '.75rem' }}>{pay || '—'}</span><span className="jd-sl">{pay ? payLabel(pay) : 'Salary'}</span></div>
            <div className="jd-stat"><span className="jd-sn" style={{ fontSize: '.65rem', color: 'var(--blue)' }}>{job.source || 'Job board'}</span><span className="jd-sl">Source</span></div>
          </div>

          {/* Waste panel */}
          {job.waste != null && job.waste > 40 && (
            <div className="waste-panel">
              <span className="wp-label">⚠ {job.waste}% Waste risk</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)' }}>High chance of no response</span>
            </div>
          )}

          {/* Availability */}
          {avail === 'active' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginBottom: '.75rem', fontFamily: 'var(--mono)', fontSize: '.56rem', color: 'var(--blue)' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--blue)', display: 'inline-block', animation: 'pulse 2s infinite', flexShrink: 0 }} />
              Active listing — seen recently
            </div>
          )}
          {avail === 'stale' && (
            <div style={{ marginBottom: '.75rem', padding: '.5rem .75rem', background: 'rgba(245,158,11,.07)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 8, fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--amber)', lineHeight: 1.5 }}>⚠ May be closed — verify before applying.</div>
          )}
          {avail === 'expired' && (
            <div style={{ marginBottom: '.75rem', padding: '.5rem .75rem', background: 'rgba(239,68,68,.07)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 8, fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--red)', lineHeight: 1.5 }}>✕ Likely closed — check the company&apos;s careers page.</div>
          )}

          {/* Factual freshness — literally-true observations of OUR data (never an employer verdict);
              shows the evidence behind the availability note above. */}
          {job.freshness?.label && (
            <div style={{ marginBottom: '.75rem', fontFamily: 'var(--mono)', fontSize: '.54rem', color: 'var(--dim)', lineHeight: 1.5 }}>
              {job.freshness.label}
            </div>
          )}

          {/* AI Insights */}
          <div style={{ background: 'var(--gdim)', border: '1px solid var(--line)', borderRadius: 12, padding: '1rem', marginBottom: '1.1rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', textTransform: 'uppercase' as const, letterSpacing: '.08em', color: 'var(--dim)', marginBottom: '.7rem' }}>
              WHAT {(companyName || 'THIS COMPANY').toUpperCase()} IS HIRING FOR
            </div>
            {insightsState === 'preview' && (
              <div style={{ fontSize: '.72rem', color: 'var(--muted)', lineHeight: 1.6 }}>
                This source gives Seen only a preview of the posting, so there is nothing to analyze yet.{' '}
                {postingHref ? <a href={postingHref} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--green)' }}>Open the full posting ↗</a> : 'The full posting is on the employer\'s site.'}
                <PastePosting onAnalyze={analyzePasted} />
              </div>
            )}
            {insightsState === 'unread' && (
              <div style={{ fontSize: '.72rem', color: 'var(--muted)', lineHeight: 1.6 }}>
                {insightNote || "This listing doesn't state what it requires, so there is nothing to analyze — no credit used."}
                <PastePosting onAnalyze={analyzePasted} />
              </div>
            )}
            {(insightsState === 'loading' || insightsState === 'generating') && <Skeleton widths={[80, 65, 72, 58, 68]} h={10} />}
            {insightsState === 'no_desc' && <div style={{ fontSize: '.72rem', color: 'var(--muted)' }}>No description for AI analysis.</div>}
            {insightsState === 'unavailable' && <div style={{ fontSize: '.72rem', color: 'var(--muted)' }}>AI insights unavailable for this listing.</div>}
            {insightsState === 'uncached' && (
              <div>
                <div style={{ fontSize: '.74rem', color: 'var(--sub)', lineHeight: 1.6, marginBottom: '.6rem' }}>
                  Nobody has analyzed this listing yet. Generate what they really want, the unstated expectations and an insider tip.
                </div>
                <button type="button" onClick={revealInsights} data-testid="reveal-insights"
                  style={{ width: '100%', padding: '.62rem .9rem', background: 'rgba(16,185,129,.12)', color: 'var(--green)', border: '1px solid rgba(16,185,129,.4)', borderRadius: 9, fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.8rem', cursor: 'pointer' }}>
                  Reveal AI insights · {priceLabel(insightPrice, pro)}
                </button>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.54rem', color: 'var(--muted)', marginTop: '.4rem', lineHeight: 1.5 }}>
                  Once generated it is free for everyone for 7 days.{pro === true ? '' : ` ${dailyResetLabel()}.`}
                </div>
              </div>
            )}
            {insightsState === 'credits' && (
              <div style={{ fontSize: '.72rem', color: 'var(--muted)', lineHeight: 1.6 }}>
                {isLoggedIn
                  ? <>{insightNote || 'Out of AI credits.'} <a href="/tracker" style={{ color: 'var(--green)' }}>Earn credits</a> · <a href="/pricing" style={{ color: 'var(--green)' }}>Pricing</a></>
                  : <><a href="/login" style={{ color: 'var(--green)' }}>Sign in</a> to generate AI insights ({creditCostLabel(insightPrice)}; free once cached).</>}
              </div>
            )}
            {insightsState === 'done' && insights && (
              <>
                {insightNote && <div data-testid="insight-note" style={{ fontFamily: 'var(--mono)', fontSize: '.54rem', color: 'var(--muted)', marginBottom: '.55rem' }}>{insightNote}</div>}
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                  {insights.what_they_want.map((item, i) => (
                    <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '.5rem', fontSize: '.78rem', color: 'var(--sub)', lineHeight: 1.5 }}>
                      <span style={{ color: 'var(--green)', fontSize: '.58rem', marginTop: '.2rem', flexShrink: 0 }}>▶</span>{item}
                    </li>
                  ))}
                </ul>
                {(insights.hidden_requirements?.length > 0 || insights.insider_tip) && (
                  <div style={{ marginTop: '.8rem', paddingTop: '.8rem', borderTop: '1px solid var(--line)' }}>
                    {insights.hidden_requirements?.length > 0 && (
                      <>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase' as const, letterSpacing: '.08em', color: 'var(--dim)', marginBottom: '.45rem' }}>Unstated expectations</div>
                        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 .7rem', display: 'flex', flexDirection: 'column', gap: '.38rem' }}>
                          {insights.hidden_requirements.map((r, i) => (
                            <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '.45rem', fontSize: '.72rem', color: 'var(--muted)', lineHeight: 1.5 }}>
                              <span style={{ color: 'var(--red)', fontSize: '.52rem', marginTop: '.2rem', flexShrink: 0 }}>◆</span>{r}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {insights.insider_tip && (
                      <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 7, padding: '.6rem .8rem', fontSize: '.72rem', color: 'var(--sub)', lineHeight: 1.6 }}>
                        <span style={{ color: 'var(--green)', fontWeight: 700 }}>Tip: </span>{insights.insider_tip}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Description */}
          <div style={{ marginBottom: '1.1rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', textTransform: 'uppercase' as const, letterSpacing: '.08em', color: 'var(--dim)', marginBottom: '.6rem' }}>ABOUT THIS ROLE</div>
            {(insightsState === 'loading' || insightsState === 'generating')
              ? <Skeleton widths={[95, 82, 90, 70, 86, 75, 92]} h={9} />
              : descParas.length > 0
                ? <>
                    {descParas.map((p, i) => <p key={i} style={{ fontSize: '.8rem', color: 'var(--sub)', lineHeight: 1.8, margin: '0 0 .75rem' }}>{p}</p>)}
                    {preview && (
                      <div style={{ margin: '0 0 .75rem', padding: '.5rem .75rem', background: 'rgba(245,158,11,.07)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 8, fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--amber)', lineHeight: 1.55 }}>
                        ✂ Preview from {job.source || 'this source'}. The full posting is on the employer&apos;s site{postingHref ? <> — <a href={postingHref} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--amber)' }}>open it ↗</a></> : '.'}
                      </div>
                    )}
                    {cutOff && !foldLabel && (
                      <div style={{ margin: '0 0 .75rem', fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)', lineHeight: 1.55 }}>
                        Continues on the employer&apos;s site{postingHref ? <> — <a href={postingHref} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--green)' }}>open it ↗</a></> : '.'}
                      </div>
                    )}
                    {foldLabel && (
                      <button type="button" onClick={() => setShowFull(true)} style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 7, color: 'var(--green)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '.62rem', padding: '.4rem .75rem' }}>{foldLabel}</button>
                    )}
                    {showFull && summaryParas.length > 0 && (
                      <button type="button" onClick={() => setShowFull(false)} style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 7, color: 'var(--dim)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '.62rem', padding: '.4rem .75rem' }}>Show the summary ↑</button>
                    )}
                  </>
                : <p style={{ fontSize: '.8rem', color: 'var(--muted)', fontWeight: 300 }}>No description available.</p>
            }
          </div>

          {/* Report experience */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '1rem', marginBottom: '1rem' }}>
            <div style={{ fontFamily: 'var(--display)', fontSize: '.82rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.22rem' }}>Report your experience</div>
            <p style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--sub)', marginBottom: '.75rem', lineHeight: 1.6 }}>Applied here? 60 seconds warns the next applicant.</p>
            <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
              {([
                { label: '👻 Ghosted',   outcome: 'ghosted',      bg: 'rgba(239,68,68,0.1)',    border: 'rgba(239,68,68,0.3)',    color: 'var(--red)'   },
                { label: '🤝 Rejected',  outcome: 'rejected',     bg: 'rgba(99,102,241,0.1)',  border: 'rgba(99,102,241,0.3)',  color: 'var(--blue)'  },
                { label: '📅 Interview', outcome: 'interviewing', bg: 'rgba(16,185,129,0.1)',  border: 'rgba(16,185,129,0.3)',  color: 'var(--green)' },
                { label: '✅ Offer',     outcome: 'hired',        bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.2)',  color: 'var(--green)' },
              ] as const).map(({ label, outcome, bg, border, color }) => (
                <a key={outcome}
                  href={`/report?from=company&company=${encodeURIComponent(job.company)}&role=${encodeURIComponent(job.title)}&outcome=${outcome}`}
                  style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', background: bg, border: `1px solid ${border}`, color, borderRadius: 7, padding: '.32rem .7rem', textDecoration: 'none' }}>
                  {label}
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* Sticky footer */}
        <div style={{ flexShrink: 0, borderTop: '1px solid var(--line2)', padding: '.85rem 1.15rem', background: 'var(--ink)' }}>
          <button
            onClick={() => onCheckCompany(job.company)}
            style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--amber)', padding: '.05rem 0 .45rem', opacity: .85, cursor: 'pointer' }}
          >
            🏢 Check {companyName} →
          </button>
          <div style={externalApply && !seenApply && !preview
            ? { display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) minmax(0, 1fr)', gap: '.6rem', alignItems: 'stretch' }
            : { display: 'flex', gap: '.6rem' }}>
            <button onClick={toggleSave} style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 8, padding: '.58rem .85rem', fontSize: '.95rem', cursor: 'pointer', color: saved ? 'var(--green)' : 'var(--muted)', flexShrink: 0 }}>{saved ? '♥' : '♡'}</button>
            {seenApply && (
              <button
                onClick={() => setSeenApplyOpen(true)}
                style={{ flex: 1, textAlign: 'center', background: 'var(--green)', color: 'var(--ink)', borderRadius: 8, padding: '.58rem 1rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.82rem', border: 'none', cursor: 'pointer' }}
              >Apply on Seen →</button>
            )}
            {externalApply
              ? <>
                  {/* FREE: opens the posting in a new tab, then the tracker checkpoint asks
                      "Did you apply?" — the existing add path. Nothing is spent. */}
                  <a
                    href={job.apply_url!}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="drawer-apply-link"
                    onClick={applyExternal}
                    style={seenApply
                      ? { flex: 1, textAlign: 'center', background: 'none', color: 'var(--sub)', borderRadius: 8, padding: '.58rem .8rem', fontFamily: 'var(--display)', fontWeight: 700, fontSize: '.76rem', border: '1px solid var(--line2)', textDecoration: 'none' }
                      : { minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', background: 'var(--green)', color: 'var(--ink)', borderRadius: 8, padding: '.58rem .6rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.82rem', textDecoration: 'none', ...(preview ? { flex: 1 } : {}) }}
                  >{seenApply ? 'Apply on their site ↗' : preview ? 'Open the full posting ↗' : 'Apply ↗'}</a>
                  {!seenApply && !preview && (
                    <button
                      type="button"
                      data-testid="drawer-optimize-btn"
                      onClick={() => { onClose(); onApply(job) }}
                      title={`Optimize your résumé for this job · ${priceLabel(RESUME_OPTIMIZE_COST, pro)}`}
                      style={{ minWidth: 0, textAlign: 'center', background: 'rgba(99,102,241,.08)', color: '#a5b4fc', borderRadius: 8, padding: '.5rem .5rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.74rem', lineHeight: 1.15, border: '1px solid rgba(99,102,241,.35)', cursor: 'pointer' }}
                    >Optimize · {priceLabel(RESUME_OPTIMIZE_COST, pro).replace(' ', '\u00a0')}</button>
                  )}
                </>
              : !seenApply && <button disabled style={{ flex: 1, background: 'var(--raised)', color: 'var(--muted)', border: 'none', borderRadius: 8, padding: '.58rem 1rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.82rem', opacity: .45 }}>No apply link</button>
            }
          </div>
        </div>
      </div>
      {seenApplyOpen && (
        <SeenApplyModal job={job} onClose={() => setSeenApplyOpen(false)} />
      )}
      {checkpoint && <ApplyCheckpoint job={job} onClose={() => setCheckpoint(false)} />}
      {confirmOpen && (
        <CreditConfirmDialog
          cost={insightPrice}
          action={`generate AI insights for ${companyName}`}
          onConfirm={() => { setConfirmOpen(false); generateInsights() }}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </ModalPortal>
  )
}
