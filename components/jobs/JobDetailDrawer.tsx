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
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Icon from '@/components/ui/Icon'
import StatTile from '@/components/ui/StatTile'
import { wastedEffortTone, wastedEffortWord } from '@/lib/ui/tone.js'
import d from '@/app/jobs/[id]/detail.module.css'
import w from './JobDetailDrawer.module.css'

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
    <div className={d.skel} role="status" aria-label="Loading">
      {widths.map((pct, i) => <div key={i} className="sk" style={{ height: h, width: `${pct}%` }} />)}
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
  const metaBits = [job.type, job.level].filter(Boolean) as string[]
  const wt = job.waste != null ? wastedEffortTone(job.waste) : null
  const foldText = foldLabel ? foldLabel.replace(/ ↓$/, '') : null

  return (
    <ModalPortal>
      {/* Scrim — a solid dim, no live blur over the page (ModalPortal note). */}
      <div className={`${w.scrim}${visible ? ' ' + w.scrimOn : ''}`} onClick={onClose} />
      {/* Slide-in panel — solid surface */}
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={`${job.title} at ${job.company}`} className={`${w.panel}${visible ? ' ' + w.panelOn : ''}`}>
        {/* Sticky header */}
        <div className={w.bar}>
          <Button variant="ghost" size="sm" onClick={onClose} icon="arrow-left">Back</Button>
          <div className={w.barText}>
            <div className={w.barTitle}>{job.title}</div>
            <div className={w.barCo}>{companyName}</div>
          </div>
          <a href={`/jobs/${encodeURIComponent(job.id)}`} className={w.barIcon} aria-label="Open the listing's own page" title="Open the listing's own page"><Icon name="external-link" size={18} /></a>
          <button type="button" onClick={onClose} aria-label="Close" className={w.barIcon}><Icon name="x" size={20} /></button>
        </div>

        {/* Scrollable content */}
        <div className={w.scroll}>
          <header className={d.head}>
            <div className={d.logo} aria-hidden="true">{(companyName || '?')[0].toUpperCase()}</div>
            <div className={d.headText}>
              <h2 className={d.title}>{job.title}</h2>
              <p className={d.meta}>
                <span className={d.co}>{companyName}</span>
                {job.location && <span className={d.place}><Icon name="map-pin" size={14} />{job.location}</span>}
                {metaBits.map(m => <span key={m}>{m}</span>)}
              </p>
              {externalApply && (
                <a href={job.apply_url!} target="_blank" rel="noopener noreferrer" data-testid="posting-link" onClick={() => trackApplyClick(job)} className={w.postingLink}>
                  Open the job posting <Icon name="arrow-up-right" size={14} />
                </a>
              )}
            </div>
            <ListingScoreRing score={job.score} size={40} />
          </header>

          <div className={d.tiles}>
            <StatTile label="Posting score" value={job.score ?? null} suffix="/100" />
            <StatTile label="Wasted-effort risk" value={job.waste ?? null} suffix="%" tone={wt} toneWord={wastedEffortWord(wt)} />
            {pay && <StatTile label={payLabel(pay)} value={pay} />}
            <StatTile label="Source" value={job.source || 'Job board'} />
          </div>

          <div className={d.status}>
            {avail === 'active' && <Badge tone="info" icon="radio">Active listing — seen recently</Badge>}
            {avail === 'stale' && <p className={d.notice} data-tone="caution"><Icon name="triangle-alert" size={14} />May be closed — verify before applying.</p>}
            {avail === 'expired' && <p className={d.notice} data-tone="bad"><Icon name="circle-x" size={14} />Likely closed — check the company&apos;s careers page.</p>}
            {/* Factual freshness — literally-true observations of OUR data (never an employer verdict). */}
            {job.freshness?.label && <p className={d.fine}>{job.freshness.label}</p>}
          </div>

          {/* AI Insights — only when there is a posting to read (one "no description" message, below). */}
          {insightsState !== 'no_desc' && (
            <section className={d.card} aria-label={`What ${companyName || 'this company'} is hiring for`}>
              <h3 className="ui-eyebrow">What {companyName || 'this company'} is hiring for</h3>
              {insightsState === 'preview' && (
                <div className={d.p}>
                  This source gives Seen only a preview of the posting, so there is nothing to analyze yet.{' '}
                  {postingHref ? <a href={postingHref} target="_blank" rel="noopener noreferrer" className={d.link}>Open the full posting</a> : 'The full posting is on the employer\'s site.'}
                  <PastePosting onAnalyze={analyzePasted} />
                </div>
              )}
              {insightsState === 'unread' && (
                <div className={d.p}>
                  {insightNote || "This listing doesn't state what it requires, so there is nothing to analyze — no credit used."}
                  <PastePosting onAnalyze={analyzePasted} />
                </div>
              )}
              {(insightsState === 'loading' || insightsState === 'generating') && <Skeleton widths={[80, 65, 72, 58, 68]} h={10} />}
              {insightsState === 'unavailable' && <p className={d.p}>AI insights are unavailable for this listing.</p>}
              {insightsState === 'uncached' && (
                <div className={d.stack}>
                  <p className={d.p}>Nobody has analyzed this listing yet. Generate what they really want, the unstated expectations and an insider tip.</p>
                  <Button variant="secondary" full onClick={revealInsights} data-testid="reveal-insights" icon="sparkles">Reveal AI insights · {priceLabel(insightPrice, pro)}</Button>
                  <p className={d.fine}>Once generated it is free for everyone for 7 days.{pro === true ? '' : ` ${dailyResetLabel()}.`}</p>
                </div>
              )}
              {insightsState === 'credits' && (
                <p className={d.p}>
                  {isLoggedIn
                    ? <>{insightNote || 'Out of AI credits.'} <a href="/tracker" className={d.link}>Earn credits</a> · <a href="/pricing" className={d.link}>Pricing</a></>
                    : <><a href="/login" className={d.link}>Sign in</a> to generate AI insights ({creditCostLabel(insightPrice)}; free once cached).</>}
                </p>
              )}
              {insightsState === 'done' && insights && (
                <>
                  {insightNote && <p data-testid="insight-note" className={d.fine}>{insightNote}</p>}
                  <ul className={d.list}>
                    {insights.what_they_want.map((item, i) => <li key={i}><Icon name="check" size={14} className={d.listIco} />{item}</li>)}
                  </ul>
                  {(insights.hidden_requirements?.length > 0 || insights.insider_tip) && (
                    <div className={d.rule}>
                      {insights.hidden_requirements?.length > 0 && (
                        <>
                          <h4 className="ui-eyebrow">Unstated expectations</h4>
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
          <section className={d.section} aria-label="About this role">
            <h3 className="ui-eyebrow">About this role</h3>
            {(insightsState === 'loading' || insightsState === 'generating')
              ? <Skeleton widths={[95, 82, 90, 70, 86, 75, 92]} h={9} />
              : descParas.length > 0
                ? <>
                    {descParas.map((p, i) => <p key={i} className={d.para}>{p}</p>)}
                    {preview && (
                      <p className={d.notice} data-tone="caution"><Icon name="scissors" size={14} />Preview from {job.source || 'this source'}. The full posting is on the employer&apos;s site{postingHref ? <> — <a href={postingHref} target="_blank" rel="noopener noreferrer" className={d.link}>open it</a></> : '.'}</p>
                    )}
                    {cutOff && !foldLabel && (
                      <p className={d.fine}>Continues on the employer&apos;s site{postingHref ? <> — <a href={postingHref} target="_blank" rel="noopener noreferrer" className={d.link}>open it</a></> : '.'}</p>
                    )}
                    {foldText && <Button variant="ghost" size="sm" onClick={() => setShowFull(true)} iconRight="chevron-down">{foldText}</Button>}
                    {showFull && summaryParas.length > 0 && <Button variant="ghost" size="sm" onClick={() => setShowFull(false)}>Show the summary</Button>}
                  </>
                : <p className={d.p}>This listing has no description, so there is nothing to read or analyze here.</p>
            }
          </section>

          {/* Report experience */}
          <section className={d.card} aria-label="Report your experience">
            <h3 className={w.h3}>Report your experience</h3>
            <p className={d.p}>Applied here? A minute warns the next applicant.</p>
            <div className={d.outcomes}>
              {([
                { label: 'Ghosted', outcome: 'ghosted', icon: 'ghost' },
                { label: 'Rejected', outcome: 'rejected', icon: 'circle-x' },
                { label: 'Interview', outcome: 'interviewing', icon: 'calendar' },
                { label: 'Offer', outcome: 'hired', icon: 'award' },
              ] as const).map(({ label, outcome, icon }) => (
                <Button key={outcome} size="sm" variant="secondary" icon={icon} href={`/report?from=company&company=${encodeURIComponent(job.company)}&role=${encodeURIComponent(job.title)}&outcome=${outcome}`}>{label}</Button>
              ))}
            </div>
          </section>
        </div>

        {/* Sticky footer — one primary action */}
        <div className={w.foot}>
          <Button variant="ghost" size="sm" onClick={() => onCheckCompany(job.company)} icon="building-2" className={w.check}>Check {companyName}</Button>
          <div className={d.footRow}>
            <button type="button" onClick={toggleSave} aria-label={saved ? 'Remove from saved' : 'Save'} aria-pressed={saved} className={d.iconBtn} data-on={saved ? '1' : '0'}><Icon name="heart" size={18} /></button>
            {seenApply && <Button variant="primary" onClick={() => setSeenApplyOpen(true)} className={d.grow} iconRight="arrow-right">Apply on Seen</Button>}
            {externalApply
              ? <>
                  {/* FREE: opens the posting in a new tab, then the tracker checkpoint asks "Did you apply?" —
                      the existing add path. Nothing is spent. */}
                  <Button
                    variant={seenApply ? 'secondary' : 'primary'}
                    href={job.apply_url!}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="drawer-apply-link"
                    onClick={applyExternal}
                    className={d.grow}
                    iconRight="arrow-up-right"
                  >{seenApply ? 'Apply on their site' : preview ? 'Open the full posting' : 'Apply'}</Button>
                  {!seenApply && (
                    <Button variant="secondary" data-testid="drawer-optimize-btn" onClick={() => { onClose(); onApply(job) }} title={`Optimize your résumé for this job · ${priceLabel(RESUME_OPTIMIZE_COST, pro)}`} className={d.grow}>
                      Optimize · {priceLabel(RESUME_OPTIMIZE_COST, pro).replace(' ', ' ')}
                    </Button>
                  )}
                </>
              : !seenApply && <Button variant="secondary" disabled className={d.grow}>No apply link</Button>
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
