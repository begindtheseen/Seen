'use client'

// The Optimize sheet — the ONE way into the résumé optimizer from a job card, the job drawer and the job
// page (UX audit 2026-11-10, F2–F10/F12/F14). Opening it never charges: it reads the free fit check (the
// one verdict + the one requirement list) and asks whether this exact optimization is already paid for.
// A credit is spent only on the price-tagged button.
//
// Phase-B seams (the finished-résumé contract): `ResultDownload` is where the downloadable résumé VERSION
// replaces "your résumé as uploaded"; `PlanChanges` already lists each change before → after with its why.

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Icon from '@/components/ui/Icon'
import Button from '@/components/ui/Button'
import { useFocusTrap } from '@/lib/hooks/useFocusTrap'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { aiHeaders } from '@/lib/aiHeaders'
import { _syncRaw } from '@/lib/sync'
import { ResumeStore } from '@/lib/stores/ResumeStore'
import UpgradeModal from './UpgradeModal'
import CreditConfirmDialog from './CreditConfirmDialog'
import { LOCK_NOTE, PASS_AFTER_WIN } from '@/lib/pricing'
import { RESUME_OPTIMIZE_COST, creditCostLabel, priceLabel } from '@/lib/creditRules'
import { hasConfirmedCreditUse } from '@/lib/creditConfirm'
import { trackApplyClick } from '@/lib/trackApply'
import type { Job } from '@/lib/types'
import ModalPortal from '@/components/ModalPortal'
import { loginHref, httpHref } from '@/lib/safeHref.js'
import { afterPendingBack } from '@/lib/nav/urlState'
import { markQuiet } from '@/lib/quietWindow'
import { markOptimized } from '@/lib/optimizedJobs'
import { VerdictCard, VerdictStrip, RequirementsView, Checklist, PlanChanges, CopyBtn, planChangeCount, type Verdict, type RequirementRow, type ConstraintRow, type PaidPlan } from './optimizer/Verdict'
import PostingInput, { PostingReadRow, type PostingRead } from './jobs/PostingInput'
import ResumePicker from './resume/ResumePicker'
import ParseNotice from './resume/ParseNotice'
import { parseResume as parseResumeText } from '@/lib/resume/engine-client'
import { ResumeLibrary, useResumeList, type SavedResume } from '@/lib/resumeLibrary'
import { chooseResumeId } from '@/lib/resumeChoice.js'
import { needsSignIn, outOfCredits, signInHereHref, SIGNIN_EXPIRED_TITLE, SIGNIN_EXPIRED_TEXT } from '@/lib/toolAuth.js'
import { readFacts, linkHost, sameHost } from '@/lib/postingRead.js'
import { requirementCounts, offerSentence } from '@/lib/requirementList.js'
import { displaySkill } from '@/lib/optimizer/explainScore.js'
import { similarJobsHref } from './jobs/JobDetailDrawer'
import s from './ApplyOptimizeModal.module.css'

// Fallback for the server's 422 no_requirements message (lib/server/optimizePackage.js unoptimizableListing).
const NO_REQUIREMENTS_NOTE = "This posting doesn't list enough requirements to optimize against. No credit was used."

interface OptimizeBullet { original: string; optimized: string; humanized?: string; addresses: string }

// What an endpoint said it read (server request in reports/s-screens-a.md — read when present, never guessed).
interface PostingEcho { title?: string; company?: string; source?: string; host?: string }

// The paid package (api/resume.js tool:optimize → lib/server/optimizePackage.js): a strict superset of the free check.
interface OptimizeResult extends PaidPlan {
  optimized_bullets?: OptimizeBullet[]
  wording_notes?: string[]
  _seenfit_score?: number | null
  verdict?: Verdict
  matched_requirements?: RequirementRow[]
  unsupported_requirements?: RequirementRow[]
  constraints?: ConstraintRow[]
  cached?: boolean
  charged?: boolean
  balance?: number
  posting?: PostingEcho
}
// The free check (api/optimizer.js action:optimize).
interface FreeDiagnosis {
  verdict: Verdict
  matched_requirements: RequirementRow[]
  unsupported_requirements: RequirementRow[]
  constraints: ConstraintRow[]
  posting?: PostingEcho
}
type ApiErr = { error?: string; message?: string; reason?: string; from_link?: boolean; credits_required?: boolean; pro_required?: boolean; requirement_count?: number }

// HumanProof "package mode" response (/api/optimizer action:'humanize' with bullets[]).
interface HpItem { original: string; humanized_text: string; human_signal: number }
interface HumanProofResult { package: { bullets: HpItem[] }; humanproof_score: number; ai_slop_risk: 'low' | 'medium' | 'high' }

type Step =
  | 'loading-resume' | 'checking' | 'needs-posting' | 'no-requirements' | 'not-logged-in' | 'signin'
  | 'no-resume' | 'resume-corrupted' | 'choose' | 'optimizing' | 'review' | 'sending' | 'done'
type HpState = 'idle' | 'loading' | 'done' | 'locked' | 'error'

// Which posting the sheet is about. `other` = a link to a DIFFERENT posting was pasted in this job's sheet:
// the header follows what was read and nothing is sent under this job's title (UX audit F8 — a Saxbys link was
// scored as "Sales Associate · Petco").
interface PostingCtx { pasted: string | null; title: string; company: string; other: boolean; link: string | null }

// A bullet is a real before → after rewrite unless either side is a "(…)" guidance placeholder.
const isGuidance = (x: string) => /^\s*\(/.test(String(x || ''))
const tone = (n: number): 'good' | 'caution' | undefined => n >= 70 ? 'good' : n >= 45 ? 'caution' : undefined

function Waiting({ text }: { text: string }) {
  return <div className={s.wait} role="status"><div className={s.spin} aria-hidden="true" /><p className={s.waitText}>{text}</p></div>
}

function StateHead({ icon, tone: t, title, children }: { icon: Parameters<typeof Icon>[0]['name']; tone?: 'bad' | 'caution'; title: string; children?: React.ReactNode }) {
  return (
    <div className={s.stateHead}>
      <span className={s.stateIco} data-tone={t}><Icon name={icon} size={24} /></span>
      <div>
        <h3 className={s.stateTitle}>{title}</h3>
        {children}
      </div>
    </div>
  )
}

export default function ApplyOptimizeModal({ job, onClose, onApplied }: { job: Job; onClose: () => void; onApplied: () => void }) {
  const router = useRouter()
  const { isLoggedIn, user, profile } = useAuth()
  const sheetRef = useRef<HTMLDivElement>(null)
  useFocusTrap(sheetRef, true)
  const [step, setStep] = useState<Step>('loading-resume')
  const [resumeText, setResumeText] = useState('')
  const { list: resumeList } = useResumeList(isLoggedIn, user?.id)
  const [resumeId, setResumeId] = useState<string | null>(null)
  const [pickErr, setPickErr] = useState('')
  const [result, setResult] = useState<OptimizeResult | null>(null)
  const [error, setError] = useState('')
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [upgradeReason, setUpgradeReason] = useState<'credits' | 'generic' | 'pro'>('credits')
  const [upgradeFeature, setUpgradeFeature] = useState<string | undefined>(undefined)
  const [pro, setPro] = useState<boolean | null>(null)
  const [balance, setBalance] = useState<number | null>(null)
  const [hpState, setHpState] = useState<HpState>('idle')
  const [hp, setHp] = useState<HumanProofResult | null>(null)
  const [diag, setDiag] = useState<FreeDiagnosis | null>(null)
  const [ctx, setCtx] = useState<PostingCtx>({ pasted: null, title: job.title, company: job.company, other: false, link: null })
  const [read, setRead] = useState<PostingRead | null>(null)
  const [postingGone, setPostingGone] = useState(false)
  const [postingLinkFailed, setPostingLinkFailed] = useState(false)
  const [noReqNote, setNoReqNote] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [prepping, setPrepping] = useState(false)
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)
  const [pdfFailed, setPdfFailed] = useState(false)
  const [pdfName, setPdfName] = useState('Resume.pdf')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState(false)
  // lines of the résumé the parser could not place — named on screen before anything is scored (no silent loss)
  const resumeDoc = useMemo(() => { try { return resumeText.length > 50 ? parseResumeText(resumeText) : null } catch { return null } }, [resumeText])

  // Load the saved résumé. An unreadable one goes to "we couldn't read it" with a way forward — never
  // "Upload your resume first" (F10). Read here, not through ResumeStore.load, which drops an unreadable
  // résumé and answers null (requested change: return { unreadable: true } — reports/s-screens-a.md).
  useEffect(() => {
    if (!isLoggedIn) { setStep('not-logged-in'); return }
    let live = true
    ;(async () => {
      const r = await _syncRaw('load_profile')
      if (!live) return
      if (r.status === 401) { setStep('signin'); return }
      const text = String((r.body as { profile?: { resume_text?: string } } | null)?.profile?.resume_text || '')
      if (text && !ResumeStore.isReadable(text)) { setStep('resume-corrupted'); return }
      if (text.length > 50) { setResumeText(text); void prepare(text, ctx); return }
      setStep('no-resume')
    })()
    return () => { live = false }
  }, [isLoggedIn, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!resumeList || !resumeList.ready) return
    setResumeId(id => chooseResumeId(resumeList, id))
  }, [resumeList])

  // Another résumé picked: re-run the FREE check + cache probe with it. Never charges.
  async function pickResume(r: SavedResume) {
    if (r.id === resumeId || !r.usable) return
    setPickErr('')
    const text = await ResumeLibrary.text(r.id)
    if (!text || text.length <= 50) { setPickErr('Could not open that résumé — try again.'); return }
    setResumeId(r.id)
    setResumeText(text)
    setResult(null); setDiag(null); setHp(null); setHpState('idle'); setPdfBlob(null); setPdfFailed(false)
    void prepare(text, ctx)
  }
  const showPicker = ['choose', 'review', 'needs-posting', 'no-requirements'].includes(step)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !confirming && !showUpgrade) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirming, showUpgrade, onClose])

  // Nothing optional pops over a result the person just paid for.
  // (every step: the micro-survey slid in over the free check at 1280 too)
  useEffect(() => {
    markQuiet()
    const t = setInterval(() => markQuiet(), 60_000)
    return () => clearInterval(t)
  }, [])

  // What every call sends about the posting: the listing's text (or the pasted posting / link), its source so
  // the server can tell a teaser from a posting, the job id for the cache key, and the title/employer to score
  // under — never this job's title for a DIFFERENT posting (the server then takes the link's own).
  function postingBody(c: PostingCtx) {
    const who = { job: c.title, jobTitle: c.title, company: c.company }
    return c.pasted
      ? { ...who, jobDescription: c.pasted, postingPasted: true, jobId: c.other ? `${job.id}:other` : job.id }
      : { ...who, jobDescription: job.description || '', jobSource: job.source || null, jobId: job.id }
  }

  function readFrom(c: PostingCtx, d: { matched_requirements?: RequirementRow[]; unsupported_requirements?: RequirementRow[]; posting?: PostingEcho } | null): PostingRead | null {
    if (!c.pasted) return null
    const n = d ? requirementCounts({ matched: d.matched_requirements || [], missing: d.unsupported_requirements || [] }).total : null
    const echo = d?.posting || null
    const f = readFacts({ pasted: c.pasted, server: echo ? { title: echo.title, company: echo.company } : (c.other ? { title: c.title, company: c.company } : null), job: { title: c.title, company: c.company }, requirements: n })
    return f
  }

  // Free: the check + a cache probe. Never spends a credit.
  async function prepare(text: string, c: PostingCtx) {
    setStep('checking'); setError('')
    try {
      const headers = await aiHeaders()
      const body = postingBody(c)
      const [probeRes, diagRes] = await Promise.all([
        fetch('/api/resume', { method: 'POST', headers, body: JSON.stringify({ tool: 'optimize', probe: true, resume: text, ...body }) }),
        fetch('/api/optimizer', { method: 'POST', headers, body: JSON.stringify({ action: 'optimize', resumeText: text, ...body, remoteOk: /remote/i.test(c.pasted || job.description || '') }) }),
      ])
      const probe = await probeRes.json().catch(() => ({})) as OptimizeResult & ApiErr
      const d = await diagRes.json().catch(() => ({})) as FreeDiagnosis & ApiErr
      if (needsSignIn(probeRes.status, probe)) { setStep('signin'); return }
      if (probe.error === 'preview_only' || d.error === 'preview_only') {
        setPostingGone(probe.reason === 'gone' || d.reason === 'gone')
        setPostingLinkFailed(!!(probe.from_link || d.from_link))
        setStep('needs-posting'); return
      }
      setRead(readFrom(c, diagRes.ok ? d : null))
      if (probe.error === 'no_requirements') { setNoReqNote(probe.message || NO_REQUIREMENTS_NOTE); setDiag(diagRes.ok && d.verdict ? d : null); setStep('no-requirements'); return }
      if (probe.error === 'RESUME_CORRUPTED') { setStep('resume-corrupted'); return }
      if (probeRes.ok && probe.cached) { showResult(probe); return }
      setDiag(diagRes.ok && d.verdict ? d : null)
      setStep('choose')
    } catch {
      setStep('choose')
    }
  }

  // A pasted posting (text or link). A link to another site is another posting: the sheet says so.
  function submitPosting(t: string) {
    const host = linkHost(t)
    const other = !!host && !(job.apply_url && sameHost(t, job.apply_url))
    const c: PostingCtx = other
      ? { pasted: t, title: '', company: '', other: true, link: httpHref(/^https?:\/\//i.test(t) ? t : `https://${t}`) }
      : { pasted: t, title: job.title, company: job.company, other: false, link: null }
    setCtx(c); setResult(null); setDiag(null); setPdfBlob(null); setPdfFailed(false)
    void prepare(resumeText, c)
  }
  function correctPosting(v: { title: string; company: string }) {
    const c = { ...ctx, title: v.title, company: v.company }
    setCtx(c)
    void prepare(resumeText, c)
  }

  function showResult(data: OptimizeResult) {
    setResult(data)
    if (!ctx.other) markOptimized(user?.id, job.id)
    setStep('review')
  }

  function pressOptimize() {
    if (pro === true || hasConfirmedCreditUse(user?.id)) void runOptimize()
    else setConfirming(true)
  }

  const refreshCredits = useCallback(async () => {
    if (!isLoggedIn) { setPro(null); setBalance(null); return }
    try {
      const h = await aiHeaders()
      const r = await fetch('/api/user-sync', { method: 'POST', headers: h, body: JSON.stringify({ action: 'get_credits' }) })
      const d = r.ok ? await r.json() : null
      if (d) { setPro(!!d.pro); setBalance(typeof d.balance === 'number' ? d.balance : null) }
    } catch { /* unknown — the upsell stays hidden */ }
  }, [isLoggedIn])
  useEffect(() => { refreshCredits() }, [refreshCredits, user?.id])

  // Pre-build the PDF while the result is read, so the download runs inside the tap (iOS).
  useEffect(() => {
    if (step === 'review' && result && !pdfBlob && !prepping && !pdfFailed) void preparePdf()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, result, pdfBlob, pdfFailed])

  const seenPairs = new Set<string>()
  const realBullets = (result?.optimized_bullets || [])
    .filter(b => !isGuidance(b.original) && !isGuidance(b.optimized))
    .filter(b => { const k = `${b.original.trim().toLowerCase()}→${b.optimized.trim().toLowerCase()}`; if (seenPairs.has(k)) return false; seenPairs.add(k); return true })
  const wordingNotes = (result?.wording_notes || []).slice(0, 3)
  const changeCount = result ? planChangeCount(result) + realBullets.length : 0

  async function runOptimize(fresh = false) {
    setStep('optimizing'); setError('')
    setHp(null); setHpState('idle'); setPdfBlob(null); setPdfFailed(false); setAnswers({})
    try {
      const headers = await aiHeaders()
      const r = await fetch('/api/resume', {
        method: 'POST', headers,
        body: JSON.stringify({ tool: 'optimize', resume: resumeText, ...postingBody(ctx), ...(fresh ? { fresh: true } : {}) }),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({})) as ApiErr
        // An expired session is a sign-in, never the paywall (F2) — checked before credits.
        if (needsSignIn(r.status, e)) { setStep('signin'); return }
        if (outOfCredits(r.status, e)) { setUpgradeReason('credits'); setUpgradeFeature(undefined); setShowUpgrade(true); setStep('choose'); return }
        if (e.error === 'preview_only') { setPostingGone(e.reason === 'gone'); setPostingLinkFailed(!!e.from_link); setStep('needs-posting'); return }
        if (e.error === 'no_requirements') { setNoReqNote(e.message || NO_REQUIREMENTS_NOTE); setStep('no-requirements'); return }
        if (e.error === 'RESUME_CORRUPTED') { setStep('resume-corrupted'); return }
        throw new Error(e.message || 'Could not build your changes. No credit was used — try again.')
      }
      const data = await r.json() as OptimizeResult
      if (data.charged) { window.dispatchEvent(new Event('seen:credits-updated')); void refreshCredits() }
      showResult(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not build your changes — try again.')
      setStep('choose')
    }
  }

  async function runHumanProof() {
    if (!realBullets.length) return
    setHpState('loading'); setError('')
    try {
      const r = await fetch('/api/optimizer', {
        method: 'POST', headers: await aiHeaders(),
        body: JSON.stringify({ action: 'humanize', bullets: realBullets.map(b => b.optimized), jobId: job.id, jobTitle: ctx.title, company: ctx.company, jobDescription: ctx.pasted || job.description || '', resumeText }),
      })
      const data = await r.json().catch(() => ({}))
      if (needsSignIn(r.status, data)) { setStep('signin'); return }
      if (r.status === 403 && !data.locked) { setHpState('error'); return }
      if ((r.status === 402 || data.locked) && (data.pro_required || data.credits_required)) { setHpState('locked'); return }
      if (!r.ok || data.error || !data.package) { setHpState('error'); return }
      window.dispatchEvent(new Event('seen:credits-updated'))
      setHp(data as HumanProofResult)
      setHpState('done')
    } catch { setHpState('error') }
  }

  async function copyText(text: string, key: string) {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1600) } catch { /* ignore */ }
  }

  // "Copy everything": exactly what the result shows that the credit paid for, in the same order (F5).
  function buildPackageText(): string {
    if (!result) return ''
    const L: string[] = []
    L.push(`${ctx.title || 'This posting'}${ctx.company ? ` — ${ctx.company}` : ''}`)
    if (result.verdict?.score != null) L.push(`Fit: ${result.verdict.score}/100${result.verdict.band ? ` (${result.verdict.band})` : ''}`)
    const add = (h: string, rows: string[]) => { if (rows.length) { L.push('', h, ...rows) } }
    add('MOVE UP (no words change)', (result.reorder || []).map(m => `• ${m.role}${m.company ? `, ${m.company}` : ''} — line ${m.from} → ${m.to || 1}: ${m.text}`))
    if (result.summary && !result.summary.kept) add('NEW SUMMARY (from your own facts)', [result.summary.text])
    add('REWORD (use only if it reads right to you)', (result.rewrite_plan || []).map(r => `• ${r.to}`))
    const hpBullets = hp?.package?.bullets?.map(b => b.humanized_text) || []
    add(hpBullets.length ? 'REWORDED BULLETS (HumanProof)' : 'REWORDED BULLETS', hpBullets.length ? hpBullets.map(b => `• ${b}`) : realBullets.map(b => `• ${b.optimized}`))
    add('NUMBERS YOU ADDED', (result.questions || []).map(q => answers[q.id]).filter(Boolean).map(b => `• ${b}`))
    if (result.availability) add('AVAILABILITY LINE (add only if true)', [result.availability.text])
    if (result.application_message) add('MESSAGE TO THE EMPLOYER', [result.application_message])
    return L.join('\n')
  }

  function derivePdfName(): string {
    const cleanName = (resumeText.split(/\r?\n/).map(l => l.trim()).find(Boolean) || '').replace(/[^\w .'-]/g, '').trim()
    const looksLikeName = /^[A-Z][\w.'-]*(\s+[A-Z][\w.'-]*){1,3}$/.test(cleanName)
    return looksLikeName ? `${cleanName} — Resume.pdf` : 'Resume.pdf'
  }

  // Phase A: the PDF is the résumé AS UPLOADED (the button says so). No job title is sent, so nothing is
  // printed under the name that the person never held (F1). Phase B: the applied résumé version goes here.
  async function preparePdf() {
    setPrepping(true)
    try {
      const res = await fetch('/api/resume', {
        method: 'POST', headers: await aiHeaders(),
        body: JSON.stringify({ action: 'download_resume', resume: resumeText }),
      })
      if (!res.ok) { setPdfFailed(true); setPrepping(false); return }
      setPdfBlob(await res.blob())
      setPdfName(derivePdfName())
    } catch { setPdfFailed(true) }
    setPrepping(false)
  }

  function saveBlob() {
    if (!pdfBlob) return
    const url = URL.createObjectURL(pdfBlob)
    const a = document.createElement('a')
    a.href = url; a.download = pdfName
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  }

  // The posting the sheet is about: the listing's own link, or the link pasted for another posting.
  const applyHref = ctx.other ? ctx.link : httpHref(job.apply_url)
  function openPosting() {
    if (!applyHref) return
    if (ctx.other) { window.open(applyHref, '_blank', 'noopener,noreferrer'); return }
    trackApplyClick(job); window.open(applyHref, '_blank', 'noopener,noreferrer')
    onApplied(); onClose()
  }

  async function approveAndSend() {
    setStep('sending')
    const email = user?.email || profile?.email || ''
    try {
      await fetch('/api/resume', {
        method: 'POST', headers: await aiHeaders(),
        body: JSON.stringify({
          action: 'email_analysis', email, co: ctx.company || job.company, role: ctx.title || job.title, jid: job.id, jobUrl: applyHref || undefined,
          bullets: realBullets.map(b => ({ original: b.original, optimized: b.optimized, addresses: b.addresses, note: '' })),
          optimizedBullets: realBullets.map(b => b.optimized),
          humanproofBullets: hp ? hp.package.bullets.map(b => b.humanized_text) : undefined,
          applicationMessage: result?.application_message || undefined,
          fitScore: result?.verdict?.score ?? undefined,
          jobTitle: ctx.title, company: ctx.company,
          resume: resumeText, jobDescription: ctx.pasted || job.description || '',
        }),
      })
    } catch { /* email is best-effort, never blocks the flow */ }
    setStep('done')
  }

  function applyWithoutOptimize() { openPosting() }
  function goTo(href: string) { onClose(); setTimeout(() => afterPendingBack(() => router.push(href)), 0) }

  const head = ctx.other ? (read?.title || ctx.title || (read?.host ? `The posting at ${read.host}` : 'The posting you pasted')) : job.title
  const headCo = ctx.other ? (read?.company || ctx.company) : job.company
  const title = step === 'review' ? 'Your changes for this job'
    : step === 'done' ? 'Sent' : step === 'signin' ? 'Sign in again'
    : 'Optimize for this job'
  const total = result ? requirementCounts({ matched: result.matched_requirements || [], missing: result.unsupported_requirements || [] }).total : 0
  const otherNote = ctx.other ? `This sheet is now about the posting you pasted, not ${job.title}${job.company ? ` · ${job.company}` : ''}.` : undefined
  const readRow = read && (step === 'choose' || step === 'review' || step === 'no-requirements')
    ? <PostingReadRow read={read} note={otherNote} onCorrect={step === 'review' ? undefined : correctPosting} onPasteAnother={step === 'review' ? undefined : () => { setRead(null); setStep('needs-posting'); setPostingGone(false); setPostingLinkFailed(false) }} />
    : null
  const errorBox = error ? <p className={s.err} role="alert"><Icon name="circle-alert" size={16} />{error}</p> : null

  // ── the footer: the screen's one filled action + text links ──
  let foot: React.ReactNode = null
  if (step === 'choose') {
    foot = <>
      <Button variant="primary" size="lg" full data-testid="modal-optimize-btn" onClick={pressOptimize}>Optimize for this job · {priceLabel(RESUME_OPTIMIZE_COST, pro)}</Button>
      {applyHref && <div className={s.links}><button type="button" className={s.textBtn} onClick={applyWithoutOptimize}>{ctx.other ? 'Open this posting' : 'Apply without optimizing · free'}<Icon name="arrow-up-right" size={14} /></button></div>}
    </>
  } else if (step === 'review') {
    foot = <>
      {applyHref
        ? <Button variant="primary" size="lg" full onClick={openPosting} iconRight="arrow-up-right" data-testid="modal-apply">{ctx.other ? 'Open this posting' : 'Apply'}</Button>
        : <Button variant="primary" size="lg" full onClick={() => { onApplied(); onClose() }}>I applied — start tracking</Button>}
      <div className={s.links}>
        <button type="button" className={s.textBtn} data-done={copied === 'pkg' ? '1' : undefined} onClick={() => copyText(buildPackageText(), 'pkg')} data-testid="modal-copy-all">{copied === 'pkg' ? 'Copied' : 'Copy everything'}</button>
        {/* phase-B seam (ResultDownload): today this is the résumé exactly as uploaded */}
        <button type="button" className={s.textBtn} onClick={() => { if (pdfBlob) saveBlob(); else { setPdfFailed(false); void preparePdf() } }} disabled={prepping} data-testid="modal-download">
          <Icon name="download" size={14} />{prepping ? 'Preparing…' : pdfFailed ? 'Retry: your résumé as uploaded' : 'Download your résumé as uploaded'}
        </button>
        <button type="button" className={s.textBtn} onClick={approveAndSend}>Email me this</button>
      </div>
    </>
  } else if (step === 'needs-posting' && !postingGone) {
    foot = applyHref ? <div className={s.links}><button type="button" className={s.textBtn} onClick={applyWithoutOptimize}>Apply without optimizing · free<Icon name="arrow-up-right" size={14} /></button></div> : null
  } else if (step === 'needs-posting' && postingGone) {
    foot = <>
      <Button variant="secondary" size="lg" full icon="search" onClick={() => goTo(similarJobsHref(job))} data-testid="modal-similar">Find open {job.title} jobs</Button>
      {job.company && <div className={s.links}><button type="button" className={s.textBtn} onClick={() => goTo(`/jobs?q=${encodeURIComponent(job.company)}`)}>Find other jobs at {job.company}</button></div>}
    </>
  } else if (step === 'no-requirements') {
    foot = applyHref ? <Button variant="primary" size="lg" full onClick={applyWithoutOptimize} iconRight="arrow-up-right">{ctx.other ? 'Open this posting' : 'Apply without optimizing · free'}</Button> : null
  } else if (step === 'optimizing') {
    foot = applyHref ? <div className={s.links}><button type="button" className={s.textBtn} onClick={applyWithoutOptimize}>Skip — just apply<Icon name="arrow-up-right" size={14} /></button></div> : null
  } else if (step === 'done') {
    foot = <>
      {applyHref
        ? <Button variant="primary" size="lg" full onClick={openPosting} iconRight="arrow-up-right">{ctx.other ? 'Open this posting' : 'Apply'}</Button>
        : <Button variant="primary" size="lg" full onClick={() => { onApplied(); onClose() }}>I applied — start tracking</Button>}
      <div className={s.links}><button type="button" className={s.textBtn} onClick={onClose}>Close — I&apos;ll apply later</button></div>
    </>
  }

  return (
    <>
    {showUpgrade && <UpgradeModal reason={upgradeReason} featureName={upgradeFeature} onClose={() => setShowUpgrade(false)} />}
    {confirming && (
      <CreditConfirmDialog cost={RESUME_OPTIMIZE_COST} action={`optimize your résumé for ${ctx.title || 'this posting'}${ctx.company ? ` at ${ctx.company}` : ''}`}
        onConfirm={() => { setConfirming(false); void runOptimize() }} onCancel={() => setConfirming(false)} />
    )}
    <ModalPortal onBack={onClose}>
    <div className={s.scrim} onClick={onClose}>
      <div ref={sheetRef} role="dialog" aria-modal="true" aria-label={title} className={s.sheet} onClick={e => e.stopPropagation()}>
        <div className={s.head}>
          <div className={s.headText}>
            <h2 className={s.title}>{title}</h2>
            <p className={s.subtitle} data-testid="modal-posting-id">{head}{headCo ? ` · ${headCo}` : ''}</p>
          </div>
          {applyHref && !postingGone && (
            <a href={applyHref} target="_blank" rel="noopener noreferrer" className={s.postLink} data-testid="modal-posting-link" onClick={() => { if (!ctx.other) trackApplyClick(job) }}>
              Posting<Icon name="arrow-up-right" size={14} />
            </a>
          )}
          <button type="button" className={s.close} onClick={onClose} aria-label="Close"><Icon name="x" size={20} /></button>
        </div>

        <div className={s.body} data-sheet-body>
          {showPicker && <ResumePicker list={resumeList} selectedId={resumeId} onPick={r => { void pickResume(r) }} note="Switching re-checks your fit · free" />}
          {showPicker && pickErr && <p className={s.err} role="alert"><Icon name="circle-alert" size={16} />{pickErr}</p>}
          {(step === 'choose' || step === 'review') && <ParseNotice doc={resumeDoc} onPaste={() => goTo(`/resume?company=${encodeURIComponent(job.company)}&role=${encodeURIComponent(job.title)}&reupload=1`)} />}

          {step === 'loading-resume' && <Waiting text="Opening your résumé…" />}
          {step === 'checking' && <Waiting text={ctx.pasted && linkHost(ctx.pasted) ? `Opening ${linkHost(ctx.pasted)} and reading the posting against your résumé…` : `Reading the ${ctx.title || 'posting'}${ctx.company ? ` posting at ${ctx.company}` : ''} against your résumé…`} />}

          {/* ── signin: an expired or missing session — never the paywall (F2) ── */}
          {step === 'signin' && (
            <div className={s.state} data-testid="modal-signin">
              <StateHead icon="lock" title={SIGNIN_EXPIRED_TITLE}><p className={s.p}>{SIGNIN_EXPIRED_TEXT}</p></StateHead>
              <Button variant="primary" size="lg" full href={signInHereHref()} data-testid="modal-signin-link">Sign in again</Button>
            </div>
          )}

          {/* ── needs-posting ── */}
          {step === 'needs-posting' && postingGone && (
            <div className={s.state} data-testid="needs-posting-gone">
              <StateHead icon="circle-x" tone="bad" title="This job was taken down at the source">
                <p className={s.p} data-testid="needs-posting-why">{linkHost(job.apply_url || '') || 'The site Seen got it from'} says {job.title}{job.company ? ` at ${job.company}` : ''} is no longer posted, so there is nothing left to optimize for. No credit was used.</p>
              </StateHead>
              <details className={s.disclose}>
                <summary>I still have the posting</summary>
                <PostingInput onSubmit={submitPosting} submitLabel="Check my fit · free" />
              </details>
            </div>
          )}
          {step === 'needs-posting' && !postingGone && (
            <div className={s.state}>
              <StateHead icon="file-text" tone="caution" title={postingLinkFailed ? 'Seen could not read that link' : 'Seen could not read the full posting'}>
                <p className={s.p} data-testid="needs-posting-why">
                  {postingLinkFailed
                    ? "That site doesn't let Seen read it. Open it, select all of its text, and paste the text here. No credit was used."
                    : `Seen got only a summary of ${job.title}${job.company ? ` at ${job.company}` : ''}${linkHost(job.apply_url || '') ? ` from ${linkHost(job.apply_url || '')}` : ''} — not its requirements. Paste the posting's link or its full text here; the check is free.`}
                </p>
              </StateHead>
              {postingLinkFailed && ctx.link && <a className={s.textBtn} href={ctx.link} target="_blank" rel="noopener noreferrer">Open the link<Icon name="arrow-up-right" size={14} /></a>}
              <PostingInput onSubmit={submitPosting} primary submitLabel="Check my fit · free" autoFocus={false} />
            </div>
          )}

          {/* ── no-requirements ── */}
          {step === 'no-requirements' && (
            <div className={s.state} data-testid="no-requirements">
              {readRow}
              <StateHead icon="file-text" tone="caution" title="Not enough requirements to optimize against">
                {/* the count comes from the rows listed below, never a second number from the refusal (they disagreed: "2" above "1 of 1") */}
                <p className={s.p}>{diag
                  ? (() => { const n = requirementCounts({ matched: diag.matched_requirements, missing: diag.unsupported_requirements }).total; return `Seen could read ${n === 0 ? 'no requirements' : `only ${n} requirement${n === 1 ? '' : 's'}`} in ${ctx.title || 'this posting'}${ctx.company ? ` at ${ctx.company}` : ''} — too few to optimize against. No credit was used.` })()
                  : (noReqNote || NO_REQUIREMENTS_NOTE)}</p>
              </StateHead>
              {diag && <RequirementsView matched={diag.matched_requirements} missing={diag.unsupported_requirements} />}
              <details className={s.disclose}>
                <summary>Have the full posting with its requirements?</summary>
                <PostingInput onSubmit={submitPosting} submitLabel="Check my fit · free" />
              </details>
            </div>
          )}

          {/* ── not-logged-in ── */}
          {step === 'not-logged-in' && (
            <div className={s.state}>
              <StateHead icon="user" title="Sign in to optimize and track"><p className={s.p}>Your fit check is free. Signing in also tracks the application and checks in on day 7, 14 and 30.</p></StateHead>
              <Button variant="primary" size="lg" full onClick={() => { const dest = loginHref(`${window.location.pathname}${window.location.search}`); goTo(dest) }}>Sign in</Button>
              {applyHref && <a href={applyHref} target="_blank" rel="noopener noreferrer" className={s.textBtn} onClick={onClose}>Apply as a guest (not tracked)<Icon name="arrow-up-right" size={14} /></a>}
            </div>
          )}

          {/* ── no-resume ── */}
          {step === 'no-resume' && (
            <div className={s.state}>
              <StateHead icon="file-text" title="Add your résumé first"><p className={s.p}>Seen checks your résumé against {job.title}{job.company ? ` at ${job.company}` : ''}. Upload it once and every job can use it.</p></StateHead>
              <Button variant="primary" size="lg" full onClick={() => goTo(`/resume?company=${encodeURIComponent(job.company)}&role=${encodeURIComponent(job.title)}`)}>Add my résumé</Button>
              {applyHref && <button type="button" className={s.textBtn} onClick={applyWithoutOptimize}>Apply without optimizing · free<Icon name="arrow-up-right" size={14} /></button>}
            </div>
          )}

          {/* ── resume-corrupted (F10) ── */}
          {step === 'resume-corrupted' && (
            <div className={s.state} data-testid="resume-corrupted">
              <StateHead icon="file-text" tone="caution" title="We couldn't read your saved résumé"><p className={s.p}>It didn&apos;t convert to clean text — common with résumés exported or scanned on a phone. Upload it again, or paste its text, and this check runs. Nothing was charged.</p></StateHead>
              <Button variant="primary" size="lg" full onClick={() => goTo(`/resume?company=${encodeURIComponent(job.company)}&role=${encodeURIComponent(job.title)}&reupload=1`)}>Upload or paste my résumé</Button>
              {applyHref && <button type="button" className={s.textBtn} onClick={applyWithoutOptimize}>Apply without optimizing · free<Icon name="arrow-up-right" size={14} /></button>}
            </div>
          )}

          {/* ── choose: the free check ── */}
          {step === 'choose' && (
            <>
              {readRow}
              {errorBox}
              {diag ? (
                <>
                  <VerdictCard verdict={diag.verdict} note="free" />
                  <RequirementsView matched={diag.matched_requirements} missing={diag.unsupported_requirements} />
                  <Checklist constraints={diag.constraints} />
                </>
              ) : <p className={s.fine}>The free check didn&apos;t load. You can still optimize, or close and try again.</p>}
              <div className={s.offer}>
                <h3 className={s.h3}>{pro === true ? 'Optimize' : creditCostLabel(RESUME_OPTIMIZE_COST)}: your changes for this job</h3>
                <p className={s.p} data-testid="modal-offer">{diag ? offerSentence({ ...requirementCounts({ matched: diag.matched_requirements, missing: diag.unsupported_requirements }), title: ctx.title, company: ctx.company, show: displaySkill }) : offerSentence({ shown: [], missing: [], title: ctx.title, company: ctx.company })}</p>
                <p className={s.fine}>You copy the changes you want into your résumé; the file itself is not rewritten yet. Kept for 7 days.</p>
              </div>
            </>
          )}

          {step === 'optimizing' && <Waiting text={`Building your changes for ${ctx.title || 'this posting'}…`} />}

          {/* ── review: the paid result — the work first (F3) ── */}
          {step === 'review' && result && (
            <>
              {errorBox}
              {readRow}
              {result.verdict && (
                <VerdictStrip verdict={result.verdict} total={total}
                  extra={result.cached ? 'already built — no credit used' : result.charged && pro !== true ? `${creditCostLabel(RESUME_OPTIMIZE_COST)} used${balance != null ? ` · ${balance} left` : ''}` : undefined} />
              )}

              <section className={s.section} aria-label="Your changes">
                <h3 className={s.h3} data-testid="change-count">{changeCount === 0 ? 'Nothing to change' : `${changeCount} change${changeCount === 1 ? '' : 's'} for this job`}</h3>
                {changeCount === 0
                  ? <p className={s.p}>{(() => { const c = requirementCounts({ matched: result.matched_requirements || [], missing: result.unsupported_requirements || [] }); const top = c.shown.slice(0, 2).map(r => displaySkill(r.surface)); return `${top.length ? `Your lines for ${top.join(' and ')} already lead their roles` : 'No line of yours needs to move'}, and no summary or wording Seen could build scores higher for ${ctx.title || 'this posting'}.${c.missing.length ? ` The ${c.missing.length} requirement${c.missing.length === 1 ? '' : 's'} below are not on your résumé — only you can add them, and only if they're true.` : ''}` })()}</p>
                  : <PlanChanges plan={result} onAnswer={(id, b) => setAnswers(a => ({ ...a, [id]: b }))} />}
                {result.summary?.kept && changeCount > 0 && <p className={s.fine}>Your own summary stays — it scored higher against this posting than a rewritten one.</p>}
              </section>

              {realBullets.length > 0 && (
                <section className={s.section} aria-label="Reworded bullets">
                  <h3 className={s.h3}>{realBullets.length} of your bullet{realBullets.length === 1 ? '' : 's'}, reworded</h3>
                  <ul className={s.list}>
                    {(hp?.package?.bullets?.length ? hp.package.bullets.map((b, i) => ({ original: realBullets[i]?.original || b.original, optimized: b.humanized_text })) : realBullets).map((b, i) => (
                      <li key={i} className={s.pair}><p className={s.pairBefore}>{b.original}</p><p className={s.pairAfter}>{b.optimized}</p></li>
                    ))}
                  </ul>
                  {hpState === 'idle' && <Button variant="secondary" onClick={runHumanProof}>Check them for your own voice (HumanProof)</Button>}
                  {hpState === 'loading' && <Waiting text="Checking your voice…" />}
                  {hpState === 'error' && <p className={s.fine}>HumanProof didn&apos;t run. The bullets above are ready to use. <button type="button" className={s.textBtn} onClick={runHumanProof}>Retry</button></p>}
                  {hpState === 'locked' && (
                    <div className={s.offer}>
                      <p className={s.p}>HumanProof checks reworded bullets for generic tone. {LOCK_NOTE}</p>
                      <Button variant="secondary" icon="lock" onClick={() => { setUpgradeReason('pro'); setUpgradeFeature('HumanProof'); setShowUpgrade(true) }}>Unlock HumanProof</Button>
                    </div>
                  )}
                  {hpState === 'done' && hp && (
                    <div className={s.hpScore}><div className={s.hpRing} data-tone={tone(hp.humanproof_score)}>{hp.humanproof_score}</div><p className={s.fine}>HumanProof score · {hp.ai_slop_risk} risk of generic wording</p></div>
                  )}
                </section>
              )}

              {result.application_message && (
                <details className={s.disclose} data-testid="modal-message">
                  <summary>Message to the employer</summary>
                  <div className={s.section}>
                    <p className={s.msg}>{result.application_message}</p>
                    <CopyBtn text={result.application_message} label="Copy message" />
                  </div>
                </details>
              )}

              <RequirementsView matched={result.matched_requirements || []} missing={result.unsupported_requirements || []} />
              <Checklist constraints={result.constraints || []} />

              {wordingNotes.length > 0 && (
                <section className={s.section} aria-label="Same thing, different word">
                  <h3 className={s.h3}>Same thing, different word</h3>
                  <ul className={s.list}>{wordingNotes.map((n, i) => <li key={i} className={s.note}>{n}</li>)}</ul>
                </section>
              )}

              {result.cached && (
                <p className={s.ledger}>
                  You optimized this job with this résumé in the last 7 days. {pro === true ? 'Re-running is unlimited with Pro.' : `A re-run costs ${creditCostLabel(RESUME_OPTIMIZE_COST)}.`}{' '}
                  <button type="button" data-testid="modal-rerun" className={s.ledgerBtn} onClick={() => { void runOptimize(true) }}>Re-run with the latest engine</button>
                </p>
              )}
              {pro === false && result.charged && changeCount > 0 && (
                <p className={s.ledger} data-testid="credit-ledger">
                  <button type="button" className={s.ledgerBtn} onClick={() => { setUpgradeReason('generic'); setUpgradeFeature(undefined); setShowUpgrade(true) }}>{PASS_AFTER_WIN}</button>
                </p>
              )}
            </>
          )}

          {step === 'sending' && <Waiting text={`Sending this to ${user?.email || profile?.email || 'your email'}…`} />}

          {step === 'done' && (
            <div className={s.state}>
              <StateHead icon="mail" title="Check your email">
                <p className={s.p}>Your changes and your résumé (as uploaded) are on the way to <b>{user?.email || profile?.email || 'your inbox'}</b>.</p>
              </StateHead>
            </div>
          )}
        </div>

        {foot && <div className={s.foot}>{foot}</div>}
      </div>
    </div>
    </ModalPortal>
    </>
  )
}

