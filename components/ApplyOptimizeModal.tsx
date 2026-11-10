'use client'

// The Optimize sheet — the ONE way into the résumé optimizer from a job card, the job drawer and the job
// page (UX audit 2026-11-10, F2–F10/F12/F14). Opening it never charges: it reads the free fit check (the
// one verdict + the one requirement list) and asks whether this exact optimization is already paid for.
// A credit is spent only on the price-tagged button.
//
// Phase B (the finished-résumé contract): the free step is THE fit read (components/optimizer/FitRead) and the
// offer is the probe's own counts; the paid step is a finished résumé (components/optimizer/PaidResult) — the
// changes before → after with their why, the document as a page, and ONE filled button that downloads the
// CURRENT version (accepted changes only) through the Studio export. Blocked and free outcomes say so plainly.

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
import { PASS_AFTER_WIN } from '@/lib/pricing'
import { RESUME_OPTIMIZE_COST, creditCostLabel, priceLabel } from '@/lib/creditRules'
import { hasConfirmedCreditUse } from '@/lib/creditConfirm'
import { trackApplyClick } from '@/lib/trackApply'
import type { Job } from '@/lib/types'
import ModalPortal from '@/components/ModalPortal'
import { loginHref, httpHref } from '@/lib/safeHref.js'
import { afterPendingBack } from '@/lib/nav/urlState'
import { markQuiet } from '@/lib/quietWindow'
import { markOptimized } from '@/lib/optimizedJobs'
import { RequirementsView, Checklist, PlanChanges, CopyBtn, planChangeCount, type Verdict, type RequirementRow, type ConstraintRow, type PaidPlan } from './optimizer/Verdict'
import FitRead, { type Statement, type FieldMatch, type Answer, type Answers } from './optimizer/FitRead'
import { PaidResult, BlockedResult, ResultTopLine, PaidOffer, BuildSteps, usePaidVersion, paidExportFields, type Tailored, type Charge, type Blocked, type ChangeCounts, type Question } from './optimizer/PaidResult'
import { renderText } from '@/lib/resume/engine-client'
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


// What an endpoint said it read (server request in reports/s-screens-a.md — read when present, never guessed).
interface PostingEcho { title?: string; company?: string; source?: string; host?: string }

// The paid package (api/resume.js tool:optimize → lib/server/optimizePackage.js): a strict superset of the free check.
interface OptimizeResult extends Omit<PaidPlan, 'questions'> {
  questions?: Question[]
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
  // phase-B contract (reports/t3-paid.md §1) — feature-detected: an older cached answer has none of these
  statements?: Statement[]
  field_match?: FieldMatch | null
  tailored?: Tailored | null
  charge?: Charge | null
  blocked?: Blocked | null
  change_counts?: ChangeCounts | null
  requirements_listed?: number
  no_gain?: boolean
  note?: string
  cost?: number
  pro?: boolean
}
// The free check (api/optimizer.js action:optimize).
interface FreeDiagnosis {
  verdict: Verdict
  matched_requirements: RequirementRow[]
  unsupported_requirements: RequirementRow[]
  constraints: ConstraintRow[]
  posting?: PostingEcho
  statements?: Statement[]
  field_match?: FieldMatch | null
  requirements_listed?: number
}
type ApiErr = { error?: string; message?: string; reason?: string; from_link?: boolean; credits_required?: boolean; pro_required?: boolean; requirement_count?: number }


type Step =
  | 'loading-resume' | 'checking' | 'needs-posting' | 'no-requirements' | 'not-logged-in' | 'signin'
  | 'no-resume' | 'resume-corrupted' | 'choose' | 'optimizing' | 'review'

// Which posting the sheet is about. `other` = a link to a DIFFERENT posting was pasted in this job's sheet:
// the header follows what was read and nothing is sent under this job's title (UX audit F8 — a Saxbys link was
// scored as "Sales Associate · Petco").
interface PostingCtx { pasted: string | null; title: string; company: string; other: boolean; link: string | null }


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
  const { isLoggedIn, user } = useAuth()
  const sheetRef = useRef<HTMLDivElement>(null)
  useFocusTrap(sheetRef, true)
  const [step, setStep] = useState<Step>('loading-resume')
  const [resumeText, setResumeText] = useState('')
  const { list: resumeList } = useResumeList(isLoggedIn, user?.id)
  const [resumeId, setResumeId] = useState<string | null>(null)
  const [pickErr, setPickErr] = useState('')
  const [result, setResult] = useState<OptimizeResult | null>(null)
  const [probe, setProbe] = useState<OptimizeResult | null>(null)
  const [error, setError] = useState('')
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [upgradeReason, setUpgradeReason] = useState<'credits' | 'generic' | 'pro'>('credits')
  const [pro, setPro] = useState<boolean | null>(null)
  const [balance, setBalance] = useState<number | null>(null)
  const [diag, setDiag] = useState<FreeDiagnosis | null>(null)
  const [ctx, setCtx] = useState<PostingCtx>({ pasted: null, title: job.title, company: job.company, other: false, link: null })
  const [read, setRead] = useState<PostingRead | null>(null)
  const [postingGone, setPostingGone] = useState(false)
  const [postingLinkFailed, setPostingLinkFailed] = useState(false)
  const [noReqNote, setNoReqNote] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  // the person's Yes / No / Skip on what only they can say — kept on this device for this job, sent with the build as
  // `confirmed` (the server decides what to do with it; the screen never writes it into the résumé)
  // user-scoped and swept on sign-out (lib/sessionLocalKeys.js); a signed-out visitor never reaches this step, and
  // nothing is stored without an account (no guest key to carry into the next person's)
  const answersKey = user?.id ? `seen_confirm_v1:${user.id}:${job.id}` : ''
  // stored as { answers: { id: yes|no|skip }, lines: { id: the candidate line answered } } (round-2 shape: a bare map)
  type Stored = { answers: Answers; lines: Record<string, string> }
  const readStored = (): Stored => { if (!answersKey) return { answers: {}, lines: {} }; try { const v = JSON.parse(localStorage.getItem(answersKey) || '{}'); return v && v.answers ? { answers: v.answers, lines: v.lines || {} } : { answers: v || {}, lines: {} } } catch { return { answers: {}, lines: {} } } }
  const [stored, setStored] = useState<Stored>(readStored)
  const answers = stored.answers
  const confirmedOf = (st: Stored) => Object.entries(st.answers).filter(([, a]) => a !== 'skip').map(([statementId, answer]) => ({ statementId, answer, ...(st.lines[statementId] ? { line: st.lines[statementId] } : {}) }))
  const confirmed = confirmedOf(stored)
  // An answer is sent and the SERVER is asked again (free check + probe); the rows show what it sends back — a Yes it
  // did not accept leaves the question standing (x-integration "Confirmations": `{ statementId, answer, line? }` in,
  // statements changed by an answer come back `by: 'you'`).
  const onAnswer = (id: string, a: Answer | null, line?: string) => {
    const n: Stored = { answers: { ...stored.answers }, lines: { ...stored.lines } }
    if (a) n.answers[id] = a; else delete n.answers[id]
    if (a && line) n.lines[id] = line; else if (!a) delete n.lines[id]
    setStored(n)
    if (answersKey) { try { localStorage.setItem(answersKey, JSON.stringify(n)) } catch { /* storage unavailable */ } }
    if (a !== 'skip') void reask(confirmedOf(n))
  }
  // the downloadable version: built from the CURRENT document (accepted changes only), pre-built so the
  // download runs inside the tap (iOS); keyed by the document so a toggle never serves a stale file
  const [pdf, setPdf] = useState<{ key: string; blob: Blob } | null>(null)
  const [pdfState, setPdfState] = useState<'idle' | 'building' | 'failed'>('idle')
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
    setResult(null); setDiag(null); setProbe(null); setPdf(null)
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
  function postingBody(c: PostingCtx, conf = confirmed) {
    const who = { job: c.title, jobTitle: c.title, company: c.company, ...(conf.length ? { confirmed: conf } : {}) }
    return c.pasted
      ? { ...who, jobDescription: c.pasted, postingPasted: true, jobId: c.other ? `${job.id}:other` : job.id }
      : { ...who, jobDescription: job.description || '', jobSource: job.source || null, jobId: job.id }
  }

  function readFrom(c: PostingCtx, d: { posting?: PostingEcho; requirement_count?: number; verdict?: Verdict } | null): PostingRead | null {
    if (!c.pasted) return null
    // the server's ONE count when it sends it (requirements_listed); else the rows it listed
    // the same count the fit read and the build steps use: the reader's statements when sent (not promises), else
    // the server's one listed count — never two different numbers on one screen
    // the server's ONE count (requirement_count, the verdict's); a client count never reaches the screen
    const rc = d ? ((d as { requirement_count?: number }).requirement_count ?? (d as { verdict?: Verdict }).verdict?.requirement_count) : null
    const n = typeof rc === 'number' ? rc : null
    const echo = d?.posting || null
    return readFacts({ pasted: c.pasted, server: echo ? { title: echo.title, company: echo.company } : (c.other ? { title: c.title, company: c.company } : null), job: { title: c.title, company: c.company }, requirements: n })
  }

  // Free: the check + a cache probe (which builds the package and says what a credit would do). Never charges.
  async function prepare(text: string, c: PostingCtx) {
    setStep('checking'); setError(''); setProbe(null)
    try {
      const headers = await aiHeaders()
      const body = postingBody(c)
      const [probeRes, diagRes] = await Promise.all([
        fetch('/api/resume', { method: 'POST', headers, body: JSON.stringify({ tool: 'optimize', probe: true, resume: text, ...body }) }),
        fetch('/api/optimizer', { method: 'POST', headers, body: JSON.stringify({ action: 'optimize', resumeText: text, ...body, remoteOk: /remote/i.test(c.pasted || job.description || '') }) }),
      ])
      const pr = await probeRes.json().catch(() => ({})) as OptimizeResult & ApiErr
      const d = await diagRes.json().catch(() => ({})) as FreeDiagnosis & ApiErr
      if (needsSignIn(probeRes.status, pr)) { setStep('signin'); return }
      if (pr.error === 'preview_only' || d.error === 'preview_only') {
        setPostingGone(pr.reason === 'gone' || d.reason === 'gone')
        setPostingLinkFailed(!!(pr.from_link || d.from_link))
        setStep('needs-posting'); return
      }
      setRead(readFrom(c, diagRes.ok ? d : null))
      if (pr.error === 'no_requirements') { setNoReqNote(pr.message || NO_REQUIREMENTS_NOTE); setDiag(diagRes.ok && d.verdict ? d : null); setStep('no-requirements'); return }
      if (pr.error === 'RESUME_CORRUPTED') { setStep('resume-corrupted'); return }
      // already built for this job + résumé in the last 7 days: the result comes back, no credit
      if (probeRes.ok && pr.cached) { showResult(pr); return }
      if (probeRes.ok) setProbe(pr)
      setDiag(diagRes.ok && d.verdict ? d : null)
      setStep('choose')
    } catch {
      setStep('choose')
    }
  }

  // Re-ask the server with the person's answers — quietly: the step and the scroll stay; only the verdict, the
  // statements and the offer are replaced by what comes back. Never charges.
  async function reask(conf: typeof confirmed) {
    if (!resumeText) return
    try {
      const headers = await aiHeaders()
      const body = postingBody(ctx, conf)
      const [pr, dr] = await Promise.all([
        step === 'choose' ? fetch('/api/resume', { method: 'POST', headers, body: JSON.stringify({ tool: 'optimize', probe: true, resume: resumeText, ...body }) }) : Promise.resolve(null),
        fetch('/api/optimizer', { method: 'POST', headers, body: JSON.stringify({ action: 'optimize', resumeText, ...body, remoteOk: /remote/i.test(ctx.pasted || job.description || '') }) }),
      ])
      const d = dr.ok ? await dr.json() as FreeDiagnosis : null
      if (d && d.verdict) setDiag(d)
      if (pr && pr.ok) { const p = await pr.json() as OptimizeResult; if (!p.cached && (p.charge || p.change_counts)) setProbe(p) }
    } catch { /* the rows keep the last answer the server gave */ }
  }

  // A pasted posting (text or link). A link to another site is another posting: the sheet says so.
  function submitPosting(t: string) {
    const host = linkHost(t)
    const other = !!host && !(job.apply_url && sameHost(t, job.apply_url))
    const c: PostingCtx = other
      ? { pasted: t, title: '', company: '', other: true, link: httpHref(/^https?:\/\//i.test(t) ? t : `https://${t}`) }
      : { pasted: t, title: job.title, company: job.company, other: false, link: null }
    setCtx(c); setResult(null); setDiag(null); setPdf(null)
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

  // The probe said this build costs nothing (or the person is Pro): no confirm dialog for a free build.
  const buildIsFree = !!probe && probe.cost === 0
  function pressOptimize() {
    if (pro === true || buildIsFree || hasConfirmedCreditUse(user?.id)) void runOptimize()
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

  async function runOptimize(fresh = false) {
    setStep('optimizing'); setError(''); setPdf(null)
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
        if (outOfCredits(r.status, e)) { setUpgradeReason('credits'); setShowUpgrade(true); setStep('choose'); return }
        if (e.error === 'preview_only') { setPostingGone(e.reason === 'gone'); setPostingLinkFailed(!!e.from_link); setStep('needs-posting'); return }
        if (e.error === 'no_requirements') { setNoReqNote(e.message || NO_REQUIREMENTS_NOTE); setStep('no-requirements'); return }
        if (e.error === 'RESUME_CORRUPTED') { setStep('resume-corrupted'); return }
        throw new Error(e.message || 'Could not build your version. No credit was used — try again.')
      }
      const data = await r.json() as OptimizeResult
      if (data.charged) { window.dispatchEvent(new Event('seen:credits-updated')); void refreshCredits() }
      showResult(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not build your version — try again.')
      setStep('choose')
    }
  }

  async function copyText(text: string, key: string) {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1600) } catch { /* ignore */ }
  }

  // ── the person's version: the server's finished résumé + their toggles and answers (kept for this tab) ──
  const tailored = result && !result.blocked && result.tailored && result.tailored.doc ? result.tailored : null
  const version = usePaidVersion(tailored, user?.id ? `${user.id}:${job.id}:${ctx.pasted ? 'p' : 'l'}:${resumeText.length}` : '')
  const docKey = version.doc ? JSON.stringify(version.doc) : ''
  const fileBase = (() => {
    const n = String(version.doc?.basics?.name || '').replace(/[^\w .'-]/g, '').trim()
    return /^[A-Za-z][\w.'-]*(\s+[A-Za-z][\w.'-]*){1,3}$/.test(n) ? `${n} - Resume` : 'Resume'
  })()

  async function exportVersion(format: 'pdf' | 'docx'): Promise<Blob | null> {
    if (!version.doc) return null
    const res = await fetch('/api/resume', { method: 'POST', headers: await aiHeaders(), body: JSON.stringify({ action: 'export', doc: version.doc, format, ...paidExportFields(tailored) }) })
    if (!res.ok) return null
    return await res.blob()
  }
  // pre-build the PDF of the current version (debounced: a toggle re-builds once the person pauses)
  useEffect(() => {
    if (step !== 'review' || !version.doc) return
    if (pdf && pdf.key === docKey) return
    let live = true
    const t = setTimeout(async () => {
      setPdfState('building')
      try { const b = await exportVersion('pdf'); if (!live) return; if (b) { setPdf({ key: docKey, blob: b }); setPdfState('idle') } else setPdfState('failed') } catch { if (live) setPdfState('failed') }
    }, 500)
    return () => { live = false; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, docKey])

  function saveBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = name
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  }
  async function downloadPdf() {
    if (pdf && pdf.key === docKey) { saveBlob(pdf.blob, `${fileBase}.pdf`); return }
    setPdfState('building')
    const b = await exportVersion('pdf').catch(() => null)
    if (b) { setPdf({ key: docKey, blob: b }); setPdfState('idle'); saveBlob(b, `${fileBase}.pdf`) } else setPdfState('failed')
  }
  async function downloadDocx() {
    const b = await exportVersion('docx').catch(() => null)
    if (b) saveBlob(b, `${fileBase}.docx`); else setError('The Word file did not build — try the PDF, or try again.')
  }

  // The posting the sheet is about: the listing's own link, or the link pasted for another posting.
  const applyHref = ctx.other ? ctx.link : httpHref(job.apply_url)
  function openPosting() {
    if (!applyHref) return
    if (ctx.other) { window.open(applyHref, '_blank', 'noopener,noreferrer'); return }
    trackApplyClick(job); window.open(applyHref, '_blank', 'noopener,noreferrer')
    onApplied(); onClose()
  }

  function applyWithoutOptimize() { openPosting() }
  function goTo(href: string) { onClose(); setTimeout(() => afterPendingBack(() => router.push(href)), 0) }
  const matchedJobsHref = '/jobs'
  // jobs in the person's OWN field: their latest job title, as written on the résumé
  const latestTitle = (resumeDoc?.experience || []).map((e) => String((e as { displayTitle?: string }).displayTitle || e.title || '')).find((t) => t && t.split(/\s+/).length <= 6) || ''
  const fieldJobsHref = latestTitle ? `/jobs?q=${encodeURIComponent(latestTitle)}` : ''
  const fieldLabel = latestTitle ? `Find ${latestTitle} jobs` : ''

  const head = ctx.other ? (read?.title || ctx.title || (read?.host ? `The posting at ${read.host}` : 'The posting you pasted')) : job.title
  const headCo = ctx.other ? (read?.company || ctx.company) : job.company
  const blocked = (result && result.blocked) || (step === 'choose' && probe && probe.blocked) || null
  const title = step === 'review' ? (blocked ? 'Why nothing was changed' : tailored ? 'Your résumé for this job' : 'Your changes for this job')
    : step === 'signin' ? 'Sign in again'
    : 'Optimize for this job'
  const otherNote = ctx.other ? `This sheet is now about the posting you pasted, not ${job.title}${job.company ? ` · ${job.company}` : ''}.` : undefined
  const readRow = read && (step === 'choose' || step === 'review' || step === 'no-requirements')
    ? <PostingReadRow read={read} note={otherNote} onCorrect={step === 'review' ? undefined : correctPosting} onPasteAnother={step === 'review' ? undefined : () => { setRead(null); setStep('needs-posting'); setPostingGone(false); setPostingLinkFailed(false) }} />
    : null
  const errorBox = error ? <p className={s.err} role="alert"><Icon name="circle-alert" size={16} />{error}</p> : null
  const cost = creditCostLabel(RESUME_OPTIMIZE_COST)

  // Real steps, real counts — only numbers the server returned (requirements_listed, statement statuses, the change list).
  const steps = useMemo(() => {
    if (!result || !tailored) return [] as string[]
    const out: string[] = []
    // one source for both counts: the reader's statements (the same rows the fit read lists); else the one listed count
    const rc = (result as { requirement_count?: number }).requirement_count ?? result.verdict?.requirement_count
    const st = (result.statements || []).filter((x) => x.kind !== 'promise' && x.display !== false)
    const proved = st.filter((x) => x.status === 'shown' || x.status === 'partly').length
    const asks = st.filter((x) => x.status === 'cannot_tell').length
    if (typeof rc === 'number') out.push(`Read the posting: ${rc} requirement${rc === 1 ? '' : 's'}`)
    if (proved) out.push(`Found your own line for ${proved} of the things it asks`)
    if (asks) out.push(`Left ${asks} for you to answer — hours, lifting and the like`)
    const built = (tailored.changes || []).filter((c) => c.type !== 'format' && c.type !== 'heading').length
    out.push(built ? `Built ${built} change${built === 1 ? '' : 's'} to your résumé` : 'Found nothing worth changing in your lines')
    const qn = (result.questions || []).length
    if (qn) out.push(`Kept ${Math.min(3, qn)} question${Math.min(3, qn) === 1 ? '' : 's'} only you can answer`)
    return out
  }, [result, tailored])

  // ── the footer: the screen's one filled action + text links ──
  let foot: React.ReactNode = null
  if (step === 'choose' && blocked) {
    foot = <>
      <Button variant="secondary" size="lg" full icon="search" onClick={() => goTo(matchedJobsHref)} data-testid="modal-matched">Jobs matched to your résumé</Button>
      {applyHref && <div className={s.links}><button type="button" className={s.textBtn} onClick={applyWithoutOptimize}>{ctx.other ? 'Open this posting' : 'Apply anyway'}<Icon name="arrow-up-right" size={14} /></button></div>}
    </>
  } else if (step === 'choose') {
    foot = <>
      <Button variant="primary" size="lg" full data-testid="modal-optimize-btn" onClick={pressOptimize}>{buildIsFree ? 'Build my version · free' : `Build my version · ${priceLabel(RESUME_OPTIMIZE_COST, pro)}`}</Button>
      {applyHref && <div className={s.links}><button type="button" className={s.textBtn} onClick={applyWithoutOptimize}>{ctx.other ? 'Open this posting' : 'Apply without changes · free'}<Icon name="arrow-up-right" size={14} /></button></div>}
    </>
  } else if (step === 'review' && tailored) {
    foot = <>
      <Button variant="primary" size="lg" full icon="download" onClick={() => { void downloadPdf() }} disabled={pdfState === 'building' && !pdf} data-testid="modal-download">
        {pdfState === 'building' && !(pdf && pdf.key === docKey) ? 'Preparing your PDF…' : pdfState === 'failed' ? 'Try the download again' : 'Download this version'}
      </Button>
      <div className={s.links}>
        <button type="button" className={s.textBtn} onClick={() => { void downloadDocx() }} data-testid="modal-docx">Word (.docx)</button>
        <button type="button" className={s.textBtn} data-done={copied === 'pkg' ? '1' : undefined} onClick={() => version.doc && copyText(renderText(version.doc), 'pkg')} data-testid="modal-copy-all">{copied === 'pkg' ? 'Copied' : 'Copy text'}</button>
        {applyHref && <button type="button" className={s.textBtn} onClick={openPosting} data-testid="modal-apply">{ctx.other ? 'Open this posting' : 'Apply'}<Icon name="arrow-up-right" size={14} /></button>}
      </div>
    </>
  } else if (step === 'review' && blocked) {
    foot = <>
      <Button variant="secondary" size="lg" full icon="search" onClick={() => goTo(matchedJobsHref)}>Jobs matched to your résumé</Button>
      {applyHref && <div className={s.links}><button type="button" className={s.textBtn} onClick={openPosting} data-testid="modal-apply">{ctx.other ? 'Open this posting' : 'Apply anyway'}<Icon name="arrow-up-right" size={14} /></button></div>}
    </>
  } else if (step === 'review') {
    foot = <>
      {applyHref
        ? <Button variant="primary" size="lg" full onClick={openPosting} iconRight="arrow-up-right" data-testid="modal-apply">{ctx.other ? 'Open this posting' : 'Apply'}</Button>
        : <Button variant="primary" size="lg" full onClick={() => { onApplied(); onClose() }}>I applied — start tracking</Button>}
    </>
  } else if (step === 'needs-posting' && !postingGone) {
    foot = applyHref ? <div className={s.links}><button type="button" className={s.textBtn} onClick={applyWithoutOptimize}>Apply without changes · free<Icon name="arrow-up-right" size={14} /></button></div> : null
  } else if (step === 'needs-posting' && postingGone) {
    foot = <>
      <Button variant="secondary" size="lg" full icon="search" onClick={() => goTo(similarJobsHref(job))} data-testid="modal-similar">Find open {job.title} jobs</Button>
      {job.company && <div className={s.links}><button type="button" className={s.textBtn} onClick={() => goTo(`/jobs?q=${encodeURIComponent(job.company)}`)}>Find other jobs at {job.company}</button></div>}
    </>
  } else if (step === 'no-requirements') {
    foot = applyHref ? <Button variant="primary" size="lg" full onClick={applyWithoutOptimize} iconRight="arrow-up-right">{ctx.other ? 'Open this posting' : 'Apply without changes · free'}</Button> : null
  } else if (step === 'optimizing') {
    foot = applyHref ? <div className={s.links}><button type="button" className={s.textBtn} onClick={applyWithoutOptimize}>Skip — just apply<Icon name="arrow-up-right" size={14} /></button></div> : null
  }

  // the legacy plan (an answer with no `tailored` document — never charged for a document it cannot give)
  const legacyCount = result && !tailored && !blocked ? planChangeCount(result as unknown as PaidPlan) : 0

  return (
    <>
    {showUpgrade && <UpgradeModal reason={upgradeReason} onClose={() => setShowUpgrade(false)} />}
    {confirming && (
      <CreditConfirmDialog cost={RESUME_OPTIMIZE_COST} action={`rebuild your résumé for ${ctx.title || 'this posting'}${ctx.company ? ` at ${ctx.company}` : ''}`}
        onConfirm={() => { setConfirming(false); void runOptimize() }} onCancel={() => setConfirming(false)} />
    )}
    <ModalPortal onBack={onClose}>
    <div className={s.scrim} onClick={onClose}>
      <div ref={sheetRef} role="dialog" aria-modal="true" aria-label={title} className={s.sheet} data-wide={step === 'review' && tailored ? '1' : undefined} onClick={e => e.stopPropagation()}>
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
          {(step === 'choose' || step === 'review') && <ParseNotice doc={resumeDoc} onPaste={() => goTo(`/resume?company=${encodeURIComponent(job.company)}&role=${encodeURIComponent(job.title)}&reupload=1`)} studioHref="/resume/studio" />}

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
                {/* the server's sentence names its own count; the rows below are the same reading */}
                <p className={s.p}>{noReqNote || NO_REQUIREMENTS_NOTE}</p>
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
              {applyHref && <button type="button" className={s.textBtn} onClick={applyWithoutOptimize}>Apply without changes · free<Icon name="arrow-up-right" size={14} /></button>}
            </div>
          )}

          {/* ── resume-corrupted (F10) ── */}
          {step === 'resume-corrupted' && (
            <div className={s.state} data-testid="resume-corrupted">
              <StateHead icon="file-text" tone="caution" title="We couldn't read your saved résumé"><p className={s.p}>It didn&apos;t convert to clean text — common with résumés exported or scanned on a phone. Upload it again, or paste its text, and this check runs. Nothing was charged.</p></StateHead>
              <Button variant="primary" size="lg" full onClick={() => goTo(`/resume?company=${encodeURIComponent(job.company)}&role=${encodeURIComponent(job.title)}&reupload=1`)}>Upload or paste my résumé</Button>
              {applyHref && <button type="button" className={s.textBtn} onClick={applyWithoutOptimize}>Apply without changes · free<Icon name="arrow-up-right" size={14} /></button>}
            </div>
          )}

          {/* ── choose: THE fit read (free) + what a credit does for THIS job (the probe's counts) ── */}
          {step === 'choose' && (
            <>
              {readRow}
              {errorBox}
              {blocked
                ? <>
                    {diag && <FitRead data={diag} note="free" compact brief />}
                    <BlockedResult b={blocked} jobsHref={matchedJobsHref} showLink={false} fieldHref={fieldJobsHref} fieldLabel={fieldLabel} />
                  </>
                : <>
                    {diag
                      ? <>
                          <FitRead data={diag} note="free" answers={answers} onAnswer={onAnswer} />
                          {!diag.statements?.length && <Checklist constraints={diag.constraints} />}
                        </>
                      : <p className={s.fine}>The free check didn&apos;t load. You can still optimize, or close and try again.</p>}
                    <PaidOffer probe={probe} price={pro === true ? 'Pro' : cost}
                      fallback={diag ? offerSentence({ ...requirementCounts({ matched: diag.matched_requirements, missing: diag.unsupported_requirements }), title: ctx.title, company: ctx.company, show: displaySkill }) : offerSentence({ shown: [], missing: [], title: ctx.title, company: ctx.company })} />
                  </>}
            </>
          )}

          {step === 'optimizing' && <Waiting text={`Rebuilding your résumé for ${ctx.title || 'this posting'}…`} />}

          {/* ── review: a blocked answer — no changes, no questions, no message ── */}
          {step === 'review' && result && blocked && (
            <>
              {readRow}
              <ResultTopLine charge={result.charge} charged={!!result.charged} cached={!!result.cached} pro={pro} balance={balance} cost={cost} />
              <BlockedResult b={blocked} jobsHref={matchedJobsHref} showLink={false} fieldHref={fieldJobsHref} fieldLabel={fieldLabel} />
              <FitRead data={result} compact brief />
            </>
          )}

          {/* ── review: the finished résumé ── */}
          {step === 'review' && result && tailored && (
            <>
              {errorBox}
              {readRow}
              <ResultTopLine charge={result.charge || tailored.charge} charged={!!result.charged} cached={!!result.cached} pro={pro} balance={balance} cost={cost} vis={tailored.visibility || null} />
              <BuildSteps steps={steps} />
              <PaidResult t={tailored} questions={result.questions || []} v={version} />
              {result.availability && (
                <section className={s.section} aria-label="Availability line">
                  <h3 className={s.h3}>A line about when you can work</h3>
                  {result.availability.conflict && <p className={s.fine}><Icon name="triangle-alert" size={14} label="Conflict" /> {result.availability.conflict}</p>}
                  <p className={s.msg}>{result.availability.text}</p>
                  <p className={s.fine}>{result.availability.why}</p>
                  <CopyBtn text={result.availability.text} label="Copy the line" />
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
              <FitRead data={diag && diag.statements ? diag : result} compact answers={answers} onAnswer={onAnswer} />
              {result.cached && (
                <p className={s.ledger}>
                  You built this version with this résumé in the last 7 days. {pro === true ? 'Rebuilding is unlimited with Pro.' : `A rebuild costs ${cost}.`}{' '}
                  <button type="button" data-testid="modal-rerun" className={s.ledgerBtn} onClick={() => { void runOptimize(true) }}>Rebuild with the latest engine</button>
                </p>
              )}
              {pro === false && result.charged && (
                <p className={s.ledger} data-testid="credit-ledger">
                  <button type="button" className={s.ledgerBtn} onClick={() => { setUpgradeReason('generic'); setShowUpgrade(true) }}>{PASS_AFTER_WIN}</button>
                </p>
              )}
            </>
          )}

          {/* ── review: an older answer with no document (feature-detected) ── */}
          {step === 'review' && result && !tailored && !blocked && (
            <>
              {errorBox}
              {readRow}
              <section className={s.section} aria-label="Your changes">
                <h3 className={s.h3} data-testid="change-count">{legacyCount === 0 ? 'Nothing to change' : `${legacyCount} change${legacyCount === 1 ? '' : 's'} for this job`}</h3>
                {legacyCount > 0 && <PlanChanges plan={result as unknown as PaidPlan} />}
              </section>
              {result.application_message && (
                <details className={s.disclose} data-testid="modal-message">
                  <summary>Message to the employer</summary>
                  <div className={s.section}><p className={s.msg}>{result.application_message}</p><CopyBtn text={result.application_message} label="Copy message" /></div>
                </details>
              )}
              <FitRead data={result} compact answers={answers} onAnswer={onAnswer} />
            </>
          )}
        </div>

        {foot && <div className={s.foot}>{foot}</div>}
      </div>
    </div>
    </ModalPortal>
    </>
  )
}
