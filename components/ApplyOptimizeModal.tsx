'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useFocusTrap } from '@/lib/hooks/useFocusTrap'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { aiHeaders } from '@/lib/aiHeaders'
import { ResumeStore } from '@/lib/stores/ResumeStore'
import UpgradeModal from './UpgradeModal'
import CreditConfirmDialog from './CreditConfirmDialog'
import { LOCK_NOTE, PASS_AFTER_WIN } from '@/lib/pricing'
import { RESUME_OPTIMIZE_COST, creditCostLabel, dailyResetLabel } from '@/lib/creditRules'
import { hasConfirmedCreditUse } from '@/lib/creditConfirm'
import { trackApplyClick } from '@/lib/trackApply'
import type { Job } from '@/lib/types'
import ModalPortal from '@/components/ModalPortal'
import { uniqueKeywords } from '@/lib/optimizer/rewriteGuard.js'
import { markQuiet } from '@/lib/quietWindow'
import { markOptimized } from '@/lib/optimizedJobs'
import { VerdictCard, WhyYouMatch, MissingList, Checklist, PaidPlanView, type Verdict, type RequirementRow, type ConstraintRow, type PaidPlan } from './optimizer/Verdict'

// The optimizer's price, rendered from the credit rules — the same literal the server charges.
const OPTIMIZE_PRICE = creditCostLabel(RESUME_OPTIMIZE_COST)
// Fallback for the server's 422 no_requirements message (lib/server/optimizePackage.js unoptimizableListing).
const NO_REQUIREMENTS_NOTE = "This listing doesn't list its requirements, so there's nothing to optimize against — no credit used."

interface OptimizeBullet {
  original: string
  optimized: string
  humanized?: string
  addresses: string
}

// The paid package (api/resume.js tool:optimize → lib/server/optimizePackage.js): a strict
// superset of the free diagnosis below.
interface OptimizeResult extends PaidPlan {
  job_priorities: string[]
  optimized_bullets: OptimizeBullet[]
  keywords_added: string[]
  /** Posting words the résumé states differently ("POS" vs "register") — a note, never an edit. */
  wording_notes?: string[]
  stealth?: boolean
  _seenfit_score?: number | null
  verdict?: Verdict
  matched_requirements?: RequirementRow[]
  unsupported_requirements?: RequirementRow[]
  constraints?: ConstraintRow[]
  cached?: boolean
  charged?: boolean
}
// The free diagnosis (api/optimizer.js action:optimize): verdict + matched/missing + checklist.
interface FreeDiagnosis {
  verdict: Verdict
  matched_requirements: RequirementRow[]
  unsupported_requirements: RequirementRow[]
  constraints: ConstraintRow[]
}

// HumanProof "package mode" response (from /api/optimizer action:'humanize' with bullets[]).
interface HpConfirm { text: string; reason: string; placeholder: string }
interface HpItem {
  original: string
  humanized_text: string
  human_signal: number
  confirm_before_using?: HpConfirm[]
  interview_risk_warnings?: { phrase: string; warning: string }[]
}
interface HpPackage {
  bullets: HpItem[]
  application_message: HpItem | null
  carried_warnings: { phrase: string; warning: string }[]
}
interface HumanProofResult {
  package: HpPackage
  humanproof_score: number
  before_score: number
  after_score: number
  ai_slop_risk: 'low' | 'medium' | 'high'
  run_id?: string | null
}

type Step =
  | 'loading-resume'
  | 'checking'
  | 'needs-posting'
  | 'no-requirements'
  | 'not-logged-in'
  | 'no-resume'
  | 'resume-corrupted'
  | 'confirm'
  | 'choose'
  | 'optimizing'
  | 'review'
  | 'sending'
  | 'done'

type HpState = 'idle' | 'loading' | 'done' | 'locked' | 'error'

// A bullet is a real, grounded before→after rewrite unless either side is an additive
// "(…)" guidance placeholder (write-a-new-bullet recommendation) — those are surfaced
// separately as "add before using", never as a confirmed rewrite.
const isGuidance = (s: string) => /^\s*\(/.test(String(s || ''))

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 9000,
  background: 'rgba(0,0,0,.8)', backdropFilter: 'blur(6px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: '1rem',
}

const sheet: React.CSSProperties = {
  width: '100%', maxWidth: 520,
  background: 'var(--surface)',
  border: '1px solid rgba(99,102,241,.22)',
  borderRadius: 20,
  overflow: 'hidden',
  boxShadow: '0 40px 120px rgba(0,0,0,.7), 0 0 80px rgba(99,102,241,.15)',
  maxHeight: '85dvh',
  overflowY: 'auto',
}

const sheetHdr: React.CSSProperties = {
  padding: '.85rem 1.1rem',
  borderBottom: '1px solid var(--line)',
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1,
}

const btnClose: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--dim)',
  cursor: 'pointer', fontSize: '1rem', padding: '.2rem .3rem', lineHeight: 1,
}

const btnPrimary: React.CSSProperties = {
  width: '100%', padding: '.8rem 1rem',
  background: 'linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%)',
  color: '#fff', border: 'none', borderRadius: 10,
  fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.88rem',
  cursor: 'pointer', boxShadow: '0 0 20px rgba(59,130,246,.3)',
}

const btnGhost: React.CSSProperties = {
  width: '100%', padding: '.65rem 1rem',
  background: 'none', border: '1px solid var(--line2)', color: 'var(--muted)',
  borderRadius: 10, fontFamily: 'var(--mono)', fontSize: '.7rem',
  cursor: 'pointer',
}

const btnGreen: React.CSSProperties = {
  width: '100%', padding: '.8rem 1rem',
  background: 'linear-gradient(135deg,rgba(16,185,129,.25),rgba(16,185,129,.12))',
  color: 'var(--green)', border: '1.5px solid rgba(16,185,129,.45)',
  borderRadius: 10, fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.88rem',
  cursor: 'pointer',
}

const kicker: React.CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase',
  letterSpacing: '.08em', color: 'var(--dim)', marginBottom: '.45rem',
}

// Fit score colour: green / amber / NEUTRAL. A low score means the résumé lacks the listing's
// keywords — not an error — so it is never painted red at a non-technical job seeker.
function scoreColor(s: number): string {
  return s >= 70 ? 'var(--green)' : s >= 45 ? 'var(--amber)' : 'var(--sub)'
}

function LoadingDots() {
  return (
    <div style={{ display: 'flex', gap: 5, justifyContent: 'center', alignItems: 'center', padding: '2.5rem 0' }}>
      {[0, 1, 2].map(i => (
        <div
          key={i}
          style={{
            width: 8, height: 8, borderRadius: '50%',
            background: 'var(--blue)',
            animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
    </div>
  )
}

export default function ApplyOptimizeModal({
  job,
  onClose,
  onApplied,
}: {
  job: Job
  onClose: () => void
  onApplied: () => void
}) {
  const router = useRouter()
  const { isLoggedIn, user, profile } = useAuth()
  const sheetRef = useRef<HTMLDivElement>(null)
  // Tab stays in the sheet (a stacked CreditConfirmDialog/UpgradeModal takes over while it is up);
  // closing returns focus to the Apply button that opened it.
  useFocusTrap(sheetRef, true)
  const [step, setStep] = useState<Step>('loading-resume')
  const [resumeText, setResumeText] = useState('')
  const [result, setResult] = useState<OptimizeResult | null>(null)
  const [error, setError] = useState('')
  const [showUpgrade, setShowUpgrade] = useState(false)
  // 'credits' when the optimize call is blocked at zero balance; 'generic' for the post-win
  // upsell strip; 'pro' for the HumanProof unlock CTA.
  const [upgradeReason, setUpgradeReason] = useState<'credits' | 'generic' | 'pro'>('credits')
  const [upgradeFeature, setUpgradeFeature] = useState<string | undefined>(undefined)
  // null = unknown (don't show upsell yet), true = Pro, false = free.
  const [pro, setPro] = useState<boolean | null>(null)
  // Live balance (daily + purchased) from get_credits, re-read after every paid call so the
  // post-optimize line states the real number, never "1 of your 1 daily credit".
  const [balance, setBalance] = useState<number | null>(null)
  const [upsellDismissed, setUpsellDismissed] = useState(false)

  // HumanProof sub-flow (runs AFTER SeenFit, inside the review step).
  const [hpState, setHpState] = useState<HpState>('idle')
  const [hp, setHp] = useState<HumanProofResult | null>(null)

  // The free diagnosis shown BEFORE any credit is spent (choose step), and the full posting the
  // person pasted when the listing is only a preview (D2).
  const [diag, setDiag] = useState<FreeDiagnosis | null>(null)
  const [posting, setPosting] = useState<string | null>(null)
  const [pasteDraft, setPasteDraft] = useState('')
  // The posting states too few requirements to optimize against: the server refuses it free (422
  // no_requirements) before any credit — this is its message.
  const [noReqNote, setNoReqNote] = useState('')

  // Copy + download state. The PDF is pre-built in the BACKGROUND while the user reads
  // their results, so the Apply tap can download + redirect fully in-gesture (iOS blocks
  // both after any await). pdfFailed stops the auto-build from retry-looping on a
  // persistent server error; it resets whenever the bullets change.
  const [copied, setCopied] = useState<string | null>(null)
  const [prepping, setPrepping] = useState(false)
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)
  const [pdfFailed, setPdfFailed] = useState(false)
  const [pdfName, setPdfName] = useState('Seen Resume.pdf')

  // Opening the modal NEVER charges (2026-10-24 audits, E6/D8: after the first confirmation the
  // card tap charged on mount, with no dialog and no choose step). It reads the free diagnosis and
  // asks the server whether this exact optimization is already paid for (cached 7 days); a credit
  // is spent only when the person presses the price-tagged button below.
  useEffect(() => {
    if (!isLoggedIn) { setStep('not-logged-in'); return }
    ResumeStore.load(user?.id, isLoggedIn).then(data => {
      if (data?.text && data.text.length > 50) {
        setResumeText(data.text)
        prepare(data.text, null)
      } else {
        setStep('no-resume')
      }
    })
  }, [isLoggedIn, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Esc closes the sheet (M9) — unless a stacked dialog is up, which handles its own Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && step !== 'confirm' && !showUpgrade) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, showUpgrade, onClose])

  // While a result is on screen nothing optional pops over it (the micro-survey slid in on top of
  // a result the person had just paid for): hold the quiet window open while the review shows.
  useEffect(() => {
    if (step !== 'review') return
    markQuiet()
    const t = setInterval(() => markQuiet(), 60_000)
    return () => clearInterval(t)
  }, [step])

  // What every call sends about the posting: the listing's text (or the pasted full posting), its
  // source so the server can tell a teaser from a posting, and the job id for the cache key.
  function postingBody(pasted: string | null) {
    return pasted
      ? { jobDescription: pasted, postingPasted: true, jobId: job.id }
      : { jobDescription: job.description || '', jobSource: job.source || null, jobId: job.id }
  }

  // Free: the diagnosis + a cache probe. Never spends a credit.
  async function prepare(text: string, pasted: string | null) {
    setStep('checking'); setError('')
    try {
      const headers = await aiHeaders()
      const [probeRes, diagRes] = await Promise.all([
        fetch('/api/resume', { method: 'POST', headers, body: JSON.stringify({ tool: 'optimize', probe: true, job: job.title, company: job.company, resume: text, ...postingBody(pasted) }) }),
        fetch('/api/optimizer', { method: 'POST', headers, body: JSON.stringify({ action: 'optimize', resumeText: text, jobTitle: job.title, company: job.company, ...postingBody(pasted), remoteOk: /remote/i.test(pasted || job.description || '') }) }),
      ])
      const probe = await probeRes.json().catch(() => ({})) as OptimizeResult & { error?: string; message?: string }
      const d = await diagRes.json().catch(() => ({})) as FreeDiagnosis & { error?: string }
      if (probe.error === 'preview_only' || d.error === 'preview_only') { setStep('needs-posting'); return }
      if (probe.error === 'no_requirements') { setNoReqNote(probe.message || NO_REQUIREMENTS_NOTE); setStep('no-requirements'); return }
      if (probe.error === 'RESUME_CORRUPTED') { setStep('resume-corrupted'); return }
      if (probeRes.ok && probe.cached) { showResult(probe); return }
      setDiag(diagRes.ok && d.verdict ? d : null)
      setStep('choose')
    } catch {
      setStep('choose')
    }
  }

  function showResult(data: OptimizeResult) {
    setResult(data)
    markOptimized(user?.id, job.id)
    setStep('review')
  }

  // The price-tagged button: the first paid action on this account/device is confirmed once.
  function pressOptimize() {
    if (hasConfirmedCreditUse(user?.id)) runOptimize()
    else setStep('confirm')
  }

  // Pro status + live balance — same get_credits signal Nav.tsx uses.
  const refreshCredits = useCallback(async () => {
    if (!isLoggedIn) { setPro(null); setBalance(null); return }
    try {
      const h = await aiHeaders()
      const r = await fetch('/api/user-sync', { method: 'POST', headers: h, body: JSON.stringify({ action: 'get_credits' }) })
      const d = r.ok ? await r.json() : null
      if (d) { setPro(!!d.pro); setBalance(typeof d.balance === 'number' ? d.balance : null) }
    } catch { /* leave unknown — the upsell stays hidden when status is unknown */ }
  }, [isLoggedIn])
  useEffect(() => { refreshCredits() }, [refreshCredits, user?.id])

  // Pre-build the résumé PDF as soon as results are on screen — and again after
  // HumanProof rewrites the bullets (runHumanProof clears pdfBlob) — so the blob is
  // ready before the user taps Apply.
  useEffect(() => {
    if (step === 'review' && result && !pdfBlob && !prepping && !pdfFailed) preparePdf()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, result, hp, pdfBlob, pdfFailed])

  // Derived views over the SeenFit result — grounded, no fabrication. The server already emits
  // one rewrite per source bullet (lib/server/seenfitCompat.js); the dedupe here is the
  // client-side guarantee that the same before/after can never be shown twice.
  const seenPairs = new Set<string>()
  const realBullets = (result?.optimized_bullets || [])
    .filter(b => !isGuidance(b.original) && !isGuidance(b.optimized))
    .filter(b => { const k = `${b.original.trim().toLowerCase()}→${b.optimized.trim().toLowerCase()}`; if (seenPairs.has(k)) return false; seenPairs.add(k); return true })
  const guidanceItems = (result?.optimized_bullets || []).filter(b => isGuidance(b.original) || isGuidance(b.optimized))
  // "Why you match" and "missing" come from the requirement rows (E7) — matched ∩ missing = ∅ by
  // construction on the server; the keyword list is one keyword identity (keywordKey).
  const gaps = uniqueKeywords((result?.unsupported_requirements || []).filter(m => !m.matched && !m.soft).map(m => m.surface)).slice(0, 8)
  const wordingNotes = (result?.wording_notes || []).slice(0, 3)
  const fitScore = result?.verdict ? result.verdict.score : (result?._seenfit_score ?? null)

  async function runOptimize(resumeOverride?: string) {
    const text = resumeOverride ?? resumeText
    setStep('optimizing')
    setError('')
    // Reset any downstream state from a previous pass.
    setHp(null); setHpState('idle'); setPdfBlob(null); setPdfFailed(false)
    try {
      const headers = await aiHeaders()
      const r = await fetch('/api/resume', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tool: 'optimize',
          job: job.title,
          company: job.company,
          resume: text,
          ...postingBody(posting),
        }),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({})) as { error?: string; message?: string; credits_required?: boolean; pro_required?: boolean }
        if (r.status === 402 || e.credits_required || e.pro_required) {
          setUpgradeReason('credits'); setUpgradeFeature(undefined)
          setShowUpgrade(true)
          setStep('choose')
          return
        }
        // A preview-only listing: nothing was charged — ask for the full posting.
        if (e.error === 'preview_only') { setStep('needs-posting'); return }
        // Nothing to optimize against: refused before the credit gate — nothing was charged.
        if (e.error === 'no_requirements') { setNoReqNote(e.message || NO_REQUIREMENTS_NOTE); setStep('no-requirements'); return }
        // Saved résumé couldn't be read (often a phone PDF that didn't convert to clean text).
        // Route to a clear recovery step instead of dead-ending on a raw error code.
        if (e.error === 'RESUME_CORRUPTED') { setStep('resume-corrupted'); return }
        throw new Error(e.error || `Error ${r.status}`)
      }
      const data = await r.json() as OptimizeResult
      if (data.charged) {
        // Optimize consumed a credit server-side — refresh the Nav balance and our own.
        window.dispatchEvent(new Event('seen:credits-updated'))
        refreshCredits()
      }
      showResult(data)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Optimization failed — try again'
      setError(msg)
      setStep('choose')
    }
  }

  // ── HumanProof: chain the optimized bullets through the deterministic humanizer ──
  async function runHumanProof() {
    if (!realBullets.length) return
    setHpState('loading'); setError('')
    try {
      const headers = await aiHeaders()
      const r = await fetch('/api/optimizer', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'humanize',
          bullets: realBullets.map(b => b.optimized),
          // Carry SeenFit's "add a real detail" guidance forward so it's never laundered away.
          warnings: guidanceItems.map(g => ({ phrase: g.addresses, warning: `Add a bullet with a real detail for: ${g.addresses}` })),
          jobId: job.id,
          jobTitle: job.title,
          company: job.company,
          jobDescription: job.description || '',
          resumeText,
        }),
      })
      if (r.status === 403) { setHpState('error'); return }
      const data = await r.json().catch(() => ({}))
      if ((r.status === 402 || data.locked) && (data.pro_required || data.credits_required)) {
        setHpState('locked')
        return
      }
      if (!r.ok || data.error || !data.package) { setHpState('error'); return }
      window.dispatchEvent(new Event('seen:credits-updated'))
      setHp(data as HumanProofResult)
      setHpState('done')
      // Bullets changed — invalidate the pre-built PDF so the auto-build effect
      // rebuilds it with the humanized versions.
      setPdfBlob(null); setPdfFailed(false)
    } catch {
      setHpState('error')
    }
  }

  // Final bullets = humanized when available, else the SeenFit-optimized ones.
  function finalBullets(): string[] {
    if (hp?.package?.bullets?.length) return hp.package.bullets.map(b => b.humanized_text)
    return realBullets.map(b => b.optimized)
  }
  function applicationMessage(): string {
    return hp?.package?.application_message?.humanized_text || ''
  }
  // Confirm-before-using items: HumanProof's carried warnings win (they re-flag the optimized
  // text); otherwise fall back to SeenFit's "add a real detail" guidance. Never presented as
  // confirmed content.
  function confirmItems(): string[] {
    if (hp?.package) {
      const carried = (hp.package.carried_warnings || []).map(w => w.warning).filter(Boolean)
      const perItem = hp.package.bullets.flatMap(b => (b.confirm_before_using || []).map(c => c.text))
      const msg = (hp.package.application_message?.confirm_before_using || []).map(c => c.text)
      return Array.from(new Set([...carried, ...perItem, ...msg])).filter(Boolean)
    }
    return guidanceItems.map(g => `Add a bullet with a real detail for: ${g.addresses}`)
  }

  async function copyText(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(null), 1600)
    } catch { /* ignore */ }
  }

  function buildPackageText(): string {
    const lines: string[] = []
    lines.push(`${job.title} — ${job.company}`)
    if (fitScore != null) lines.push(`SeenFit match: ${fitScore}/100`)
    lines.push('')
    lines.push('OPTIMIZED BULLETS' + (hp ? ' (HumanProof)' : ''))
    for (const b of finalBullets()) lines.push(`• ${b}`)
    const msg = applicationMessage()
    if (msg) { lines.push(''); lines.push('APPLICATION MESSAGE'); lines.push(msg) }
    const conf = confirmItems()
    if (conf.length) {
      lines.push('')
      lines.push('CONFIRM BEFORE USING — only include if true, fill in the real detail first:')
      for (const c of conf) lines.push(`⚠ ${c}`)
    }
    return lines.join('\n')
  }

  function derivePdfName(): string {
    const cleanName = (resumeText.split(/\r?\n/).map(l => l.trim()).find(Boolean) || '').replace(/[^\w .'-]/g, '').trim()
    const cleanRole = (job.title || '').replace(/[^\w .,'/&-]/g, '').trim()
    const looksLikeName = /^[A-Z][\w.'-]*(\s+[A-Z][\w.'-]*){1,3}$/.test(cleanName)
    return looksLikeName && cleanRole ? `${cleanName} — ${cleanRole} Resume.pdf`
      : looksLikeName ? `${cleanName} — Resume.pdf`
      : cleanRole ? `${cleanRole} Resume.pdf`
      : 'Seen Resume.pdf'
  }

  // Step 1 of the two-step download: build the PDF (async) and hold the blob. Keeping the
  // network work OUT of the final save gesture lets the actual save run in-gesture on iOS.
  async function preparePdf() {
    setPrepping(true); setError('')
    try {
      const res = await fetch('/api/resume', {
        method: 'POST',
        // Auth header lets the server identify Pro users → clean, unwatermarked résumé.
        // Signed-out callers send no token and get the free-tier "seenjobs.io" footer.
        headers: await aiHeaders(),
        body: JSON.stringify({
          action: 'download_resume',
          resume: resumeText,
          job: job.title,
          company: job.company,
          jobDescription: job.description || '',
          // Optimized package appendix — additive, never edits the résumé body.
          optimizedBullets: realBullets.map(b => b.optimized),
          humanproofBullets: hp ? hp.package.bullets.map(b => b.humanized_text) : undefined,
          confirmWarnings: confirmItems(),
          applicationMessage: applicationMessage() || undefined,
          fitScore: fitScore ?? undefined,
          jobTitle: job.title,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        setError(d.error || 'Could not build your résumé PDF. Try again.')
        setPdfFailed(true)
        setPrepping(false)
        return
      }
      const blob = await res.blob()
      setPdfBlob(blob)
      setPdfName(derivePdfName())
    } catch {
      setError('Could not build your résumé PDF. Please try again.')
      setPdfFailed(true)
    }
    setPrepping(false)
  }

  // Step 2: save the already-built blob — runs synchronously inside the click gesture.
  async function saveBlob() {
    if (!pdfBlob) return
    const file = new File([pdfBlob], pdfName, { type: 'application/pdf' })
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean; share?: (d: { files: File[]; title?: string }) => Promise<void> }
    if (nav.canShare && nav.canShare({ files: [file] }) && nav.share) {
      try { await nav.share({ files: [file], title: pdfName }); return } catch { /* fall through to anchor */ }
    }
    const url = URL.createObjectURL(pdfBlob)
    const a = document.createElement('a')
    a.href = url; a.download = pdfName
    document.body.appendChild(a); a.click(); a.remove()
    // Deferred revoke — some browsers cancel the download if the URL dies immediately.
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  }

  // One tap: the optimized résumé downloads to the device, the original listing opens,
  // and tracking starts. EVERYTHING here is synchronous — an await before the download
  // or window.open would leave the tap gesture and iOS would block both. The anchor
  // method (not the share sheet) keeps the download silent so the redirect wins focus.
  function handleApplyNow() {
    if (pdfBlob) {
      const url = URL.createObjectURL(pdfBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = pdfName
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    }
    if (job.apply_url) { trackApplyClick(job); window.open(job.apply_url, '_blank', 'noopener,noreferrer') }
    onApplied()
    onClose()
  }

  async function approveAndSend() {
    setStep('sending')
    const email = user?.email || profile?.email || ''
    // Send the final (humanized-or-optimized) bullets + application message + confirm items so
    // the emailed PDF matches what the user reviewed here.
    const bullets = realBullets.map(b => ({ original: b.original, optimized: b.optimized, addresses: b.addresses, note: '' }))

    try {
      const headers = await aiHeaders()
      await fetch('/api/resume', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'email_analysis',
          email,
          co: job.company,
          role: job.title,
          jid: job.id,
          jobUrl: job.apply_url,
          bullets,
          keywords: gaps,
          // Optimized-package fields (additive appendix in the emailed PDF).
          optimizedBullets: realBullets.map(b => b.optimized),
          humanproofBullets: hp ? hp.package.bullets.map(b => b.humanized_text) : undefined,
          confirmWarnings: confirmItems(),
          applicationMessage: applicationMessage() || undefined,
          fitScore: fitScore ?? undefined,
          jobTitle: job.title,
          company: job.company,
          // Base résumé + JD so the server can build the complete, submittable PDF.
          resume: resumeText,
          jobDescription: job.description || '',
        }),
      })
    } catch (_) {
      // email is best-effort, never block the flow
    }
    setStep('done')
  }

  // FREE: open the posting (new tab) and hand off to the tracker checkpoint — no credit.
  function applyWithoutOptimize() {
    if (job.apply_url) { trackApplyClick(job); window.open(job.apply_url, '_blank', 'noopener,noreferrer') }
    onApplied()
    onClose()
  }

  const title = step === 'done'
    ? '🎉 You\'re ready to apply'
    : step === 'review'
    ? 'Your Application Intelligence'
    : step === 'optimizing' ? 'Optimizing your resume…'
    : step === 'sending' ? 'Sending to your email…'
    : 'Optimize for this job'

  return (
    <>
    {showUpgrade && <UpgradeModal reason={upgradeReason} featureName={upgradeFeature} onClose={() => setShowUpgrade(false)} />}
    {step === 'confirm' && (
      <CreditConfirmDialog
        cost={RESUME_OPTIMIZE_COST}
        action={`optimize your résumé for ${job.title} at ${job.company}`}
        onConfirm={() => runOptimize()}
        onCancel={() => setStep('choose')}
      />
    )}
    <ModalPortal>
    <div style={overlay} onClick={onClose}>
      <div ref={sheetRef} role="dialog" aria-modal="true" aria-label={title} style={sheet} onClick={e => e.stopPropagation()}>
        {/* Header — the job posting link lives here so it is visible above the fold on every step. */}
        <div style={sheetHdr}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--display)', fontSize: '.88rem', fontWeight: 700, color: 'var(--white)' }}>
              {title}
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', color: 'var(--muted)', marginTop: '.1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {job.title} · {job.company}
            </div>
            {job.apply_url && (
              <a href={job.apply_url} target="_blank" rel="noopener noreferrer" data-testid="modal-posting-link"
                onClick={() => trackApplyClick(job)}
                style={{ display: 'inline-block', marginTop: '.3rem', fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--green)', textDecoration: 'none' }}>
                Open the job posting ↗
              </a>
            )}
          </div>
          <button style={btnClose} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="ai-safe-bottom" style={{ paddingTop: '1.1rem', paddingLeft: '1.1rem', paddingRight: '1.1rem', minHeight: 240 }}>

          {/* ── loading-resume / checking (free) / confirm (the dialog sits above) ── */}
          {(step === 'loading-resume' || step === 'checking' || step === 'confirm') && <LoadingDots />}

          {/* ── needs-posting: the listing is only a teaser — nothing was charged (D2) ── */}
          {step === 'needs-posting' && (
            <div className="ai-stack">
              <div style={{ background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.22)', borderRadius: 10, padding: '.8rem .95rem' }}>
                <div style={{ fontFamily: 'var(--display)', fontWeight: 800, color: 'var(--white)', fontSize: '.88rem', marginBottom: '.3rem' }}>This listing only has a summary</div>
                <div style={{ fontSize: 'var(--fs-72)', color: 'var(--sub)', lineHeight: 1.6 }}>
                  Seen only holds a short preview of this posting, so there is nothing real to optimize against — and no credit was used. Open the posting, copy its full text, and paste it here.
                </div>
              </div>
              <label style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: 'var(--fs-58)', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                Full job posting
                <textarea autoComplete="off" data-testid="posting-paste" value={pasteDraft} onChange={e => setPasteDraft(e.target.value)} rows={7} placeholder="Paste the whole posting: duties, requirements, schedule…"
                  style={{ display: 'block', width: '100%', marginTop: '.35rem', background: 'var(--surface)', border: '1.5px solid var(--line2)', borderRadius: 8, padding: '.65rem .8rem', color: 'var(--white)', fontFamily: 'var(--mono)', fontSize: '.8rem', lineHeight: 1.55, boxSizing: 'border-box', textTransform: 'none', letterSpacing: 0 }} />
              </label>
              <button style={{ ...btnPrimary, opacity: pasteDraft.trim().length < 200 ? 0.55 : 1 }} disabled={pasteDraft.trim().length < 200}
                onClick={() => { const t = pasteDraft.trim(); setPosting(t); prepare(resumeText, t) }}>
                Check this posting · free
              </button>
              <button style={btnGhost} onClick={applyWithoutOptimize}>Apply ↗ without optimizing · free</button>
            </div>
          )}

          {/* ── no-requirements: the posting states too few requirements — refused free, no credit ── */}
          {step === 'no-requirements' && (
            <div className="ai-stack" data-testid="no-requirements">
              <div style={{ background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.22)', borderRadius: 10, padding: '.8rem .95rem' }}>
                <div style={{ fontFamily: 'var(--display)', fontWeight: 800, color: 'var(--white)', fontSize: '.88rem', marginBottom: '.3rem' }}>Nothing to optimize against</div>
                <div style={{ fontSize: 'var(--fs-72)', color: 'var(--sub)', lineHeight: 1.6 }}>{noReqNote || NO_REQUIREMENTS_NOTE}</div>
              </div>
              <label style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: 'var(--fs-58)', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                Have the full posting with its requirements? Paste it
                <textarea autoComplete="off" value={pasteDraft} onChange={e => setPasteDraft(e.target.value)} rows={6} placeholder="Paste the whole posting: duties, requirements, schedule…"
                  style={{ display: 'block', width: '100%', marginTop: '.35rem', background: 'var(--surface)', border: '1.5px solid var(--line2)', borderRadius: 8, padding: '.65rem .8rem', color: 'var(--white)', fontFamily: 'var(--mono)', fontSize: '.8rem', lineHeight: 1.55, boxSizing: 'border-box', textTransform: 'none', letterSpacing: 0 }} />
              </label>
              <button style={{ ...btnPrimary, opacity: pasteDraft.trim().length < 200 ? 0.55 : 1 }} disabled={pasteDraft.trim().length < 200}
                onClick={() => { const t = pasteDraft.trim(); setPosting(t); prepare(resumeText, t) }}>
                Check this posting · free
              </button>
              <button style={btnGhost} onClick={applyWithoutOptimize}>Apply ↗ without optimizing · free</button>
            </div>
          )}

          {/* ── not-logged-in ── */}
          {step === 'not-logged-in' && (
            <>
              <div style={{ textAlign: 'center', padding: '.5rem 0 1.25rem' }}>
                <div style={{ fontSize: '2rem', marginBottom: '.75rem' }}>👋</div>
                <div style={{ fontFamily: 'var(--display)', fontSize: '1rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.35rem' }}>Sign in to apply &amp; track</div>
                <div style={{ fontSize: '.82rem', color: 'var(--sub)', lineHeight: 1.7, marginBottom: '1.25rem' }}>
                  Track responses, get ghost-risk warnings, and receive day-7/14/30 check-ins.
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                <button style={btnPrimary} onClick={() => { onClose(); router.push('/login') }}>Sign in to apply →</button>
                {job.apply_url && (
                  <a
                    href={job.apply_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: 'block', textAlign: 'center', ...btnGhost, textDecoration: 'none' } as React.CSSProperties}
                    onClick={onClose}
                  >
                    Apply ↗ as a guest (not tracked)
                  </a>
                )}
              </div>
            </>
          )}

          {/* ── no-resume ── */}
          {step === 'no-resume' && (
            <>
              <div style={{ textAlign: 'center', padding: '.5rem 0 1rem' }}>
                <div style={{ fontSize: '2rem', marginBottom: '.75rem' }}>📄</div>
                <div style={{ fontFamily: 'var(--display)', fontSize: '.95rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.35rem' }}>Upload your resume first</div>
                <div style={{ fontSize: '.8rem', color: 'var(--sub)', lineHeight: 1.7, marginBottom: '1.25rem' }}>
                  Seen needs your resume to rewrite bullets for this specific role.
                  Takes 30 seconds — upload once, optimized for every job.
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                <button
                  style={btnPrimary}
                  onClick={() => {
                    onClose()
                    router.push(`/resume?company=${encodeURIComponent(job.company)}&role=${encodeURIComponent(job.title)}`)
                  }}
                >
                  Upload resume + optimize →
                </button>
                <button style={btnGhost} onClick={applyWithoutOptimize}>Apply ↗ without optimizing · free</button>
              </div>
            </>
          )}

          {/* ── resume-corrupted (saved résumé couldn't be read — recover by re-uploading/pasting) ── */}
          {step === 'resume-corrupted' && (
            <>
              <div style={{ textAlign: 'center', padding: '.5rem 0 1rem' }}>
                <div style={{ fontSize: '2rem', marginBottom: '.75rem' }}>📄</div>
                <div style={{ fontFamily: 'var(--display)', fontSize: '.95rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.35rem' }}>We couldn&apos;t read your saved resume</div>
                <div style={{ fontSize: '.8rem', color: 'var(--sub)', lineHeight: 1.7, marginBottom: '1.25rem' }}>
                  It didn&apos;t convert to clean text — this is common with resumes exported or scanned on a phone.
                  Re-upload it (or paste the text) and you&apos;re good to go. Takes 30 seconds.
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                <button
                  style={btnPrimary}
                  onClick={() => {
                    onClose()
                    router.push(`/resume?company=${encodeURIComponent(job.company)}&role=${encodeURIComponent(job.title)}&reupload=1`)
                  }}
                >
                  Re-upload or paste resume →
                </button>
                <button style={btnGhost} onClick={applyWithoutOptimize}>Apply ↗ without optimizing · free</button>
              </div>
            </>
          )}

          {/* ── choose ── */}
          {step === 'choose' && (
            <>
              {/* The free diagnosis first — the same verdict the paid result opens with. */}
              {diag && (
                <div className="ai-stack" style={{ marginBottom: '1rem' }}>
                  <VerdictCard verdict={diag.verdict} note="free" />
                  <WhyYouMatch matched={diag.matched_requirements} limit={4} />
                  <MissingList missing={diag.unsupported_requirements} limit={6} />
                </div>
              )}
              <div style={{ background: 'rgba(99,102,241,.07)', border: '1px solid rgba(99,102,241,.18)', borderRadius: 10, padding: '.8rem .95rem', marginBottom: '1rem' }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-52)', textTransform: 'uppercase', letterSpacing: '.1em', color: '#818cf8', fontWeight: 700, marginBottom: '.45rem' }}>What {OPTIMIZE_PRICE} adds — kept for 7 days</div>
                {[
                  'Which of your bullets should lead each job for this posting',
                  'Number questions — your answer writes the bullet',
                  'An availability line built from this posting’s schedule',
                  'A summary for this job, built only from your own facts',
                  'Wording proposals you accept one by one, and HumanProof',
                ].map(t => (
                  <div key={t} style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-62)', color: 'rgba(165,180,252,.85)', marginBottom: '.22rem' }}>• {t}</div>
                ))}
              </div>

              {error && (
                <div style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 8, padding: '.6rem .85rem', marginBottom: '.75rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--red)' }}>
                  {error}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                <button style={btnPrimary} data-testid="modal-optimize-btn" onClick={pressOptimize}>
                  Optimize for this job · {OPTIMIZE_PRICE}
                </button>
                <button style={btnGhost} onClick={applyWithoutOptimize}>
                  Apply ↗ without optimizing · free
                </button>
              </div>
            </>
          )}

          {/* ── optimizing ── */}
          {step === 'optimizing' && (
            <div style={{ textAlign: 'center', paddingBottom: '1rem' }}>
              <LoadingDots />
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.7rem', color: 'var(--sub)', marginBottom: '.75rem' }}>
                Scoring your fit and rewriting bullets for this role…
              </div>
              <button style={{ background: 'none', border: 'none', color: 'var(--dim)', fontFamily: 'var(--mono)', fontSize: '.62rem', cursor: 'pointer', textDecoration: 'underline' }} onClick={applyWithoutOptimize}>
                Skip — just apply ↗
              </button>
            </div>
          )}

          {/* ── review ── */}
          {step === 'review' && result && (
            <div className="ai-stack">
              {error && (
                <div style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 8, padding: '.6rem .85rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--red)' }}>
                  {error}
                </div>
              )}

              {/* ONE verdict (score or none, band, one sentence; the hard gate first). */}
              {result.verdict && (
                <VerdictCard verdict={result.verdict} cached={!!result.cached}
                  note={result.stealth ? 'written in your own voice — nothing invented' : 'grounded in your real résumé — nothing invented'} />
              )}

              {/* Why you match — from the matched requirements and their evidence (E7). */}
              <WhyYouMatch matched={result.matched_requirements || []} />
              <MissingList missing={result.unsupported_requirements || []} />
              <Checklist constraints={result.constraints || []} />

              {/* The paid work: availability line, moves, number questions, summary, proposals. */}
              <PaidPlanView plan={result} />

              {/* Wording the posting uses for something the résumé already says another way. A note
                  for the person, never an edit to their bullet (the old "POS (cashier) system"). */}
              {wordingNotes.length > 0 && (
                <div>
                  <div style={kicker}>Same thing, different word</div>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
                    {wordingNotes.map((n, i) => (
                      <li key={i} style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--sub)', lineHeight: 1.55, overflowWrap: 'anywhere' }}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Safe improvements (before/after) */}
              {realBullets.length > 0 && (
                <div>
                  <div style={kicker}>Safe improvements — {realBullets.length} of your own bullet{realBullets.length !== 1 ? 's' : ''}, nothing invented</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
                    {realBullets.map((b, i) => (
                      <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 10, overflow: 'hidden' }}>
                        <div style={{ padding: '.55rem .75rem', borderBottom: '1px solid var(--line)' }}>
                          <div style={{ fontFamily: 'var(--mono)', fontSize: '.46rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--dim)', marginBottom: '.28rem' }}>Before</div>
                          <div style={{ fontSize: '.72rem', color: 'var(--muted)', lineHeight: 1.55, overflowWrap: 'anywhere' }}>{b.original}</div>
                        </div>
                        <div style={{ padding: '.55rem .75rem' }}>
                          <div style={{ fontFamily: 'var(--mono)', fontSize: '.46rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--green)', marginBottom: '.28rem' }}>After · {b.addresses}</div>
                          <div style={{ fontSize: '.72rem', color: 'var(--white)', lineHeight: 1.55, fontWeight: 500, overflowWrap: 'anywhere' }}>{b.optimized}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Add-before-using (clearly marked — never presented as a confirmed rewrite) */}
              {guidanceItems.length > 0 && (
                <div>
                  <div style={{ ...kicker, color: 'var(--amber)' }}>Needs a real detail from you — add only if true</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
                    {guidanceItems.map((g, i) => (
                      <div key={i} style={{ background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 8, padding: '.55rem .75rem', fontSize: '.72rem', color: 'var(--sub)', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
                        Write a bullet for <strong style={{ color: 'var(--white)' }}>{g.addresses}</strong> — only include it if it reflects real work, and attach a real number.
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── HumanProof step ── */}
              {realBullets.length > 0 && (
              <div style={{ borderTop: '1px solid var(--line)', paddingTop: '.9rem' }}>
                {hpState === 'idle' && (
                  <div style={{ background: 'var(--gdim)', border: '1px solid var(--line)', borderRadius: 12, padding: '.95rem 1rem' }}>
                    <div style={{ fontFamily: 'var(--display)', fontWeight: 800, color: 'var(--white)', fontSize: '.85rem', marginBottom: '.25rem' }}>Make it sound human</div>
                    <p style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--sub)', lineHeight: 1.55, marginBottom: '.75rem' }}>
                      HumanProof removes generic AI tone and keeps your bullets specific, natural, and interview-defensible — no unsupported claims.
                    </p>
                    <button style={btnGreen} onClick={runHumanProof}>Run HumanProof →</button>
                  </div>
                )}

                {hpState === 'loading' && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.6rem', padding: '1rem', background: 'var(--gdim)', border: '1px solid var(--line)', borderRadius: 12 }}>
                    <div className="spinner" /><span style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--sub)' }}>Making it sound real…</span>
                  </div>
                )}

                {hpState === 'error' && (
                  <div style={{ textAlign: 'center', padding: '.5rem 0' }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '.66rem', color: 'var(--muted)', marginBottom: '.5rem' }}>Couldn&apos;t run HumanProof. Your optimized bullets above are ready to use.</div>
                    <button onClick={runHumanProof} style={{ ...btnGhost, width: 'auto', padding: '.4rem 1rem' }}>Retry</button>
                  </div>
                )}

                {hpState === 'locked' && (
                  <div style={{ background: 'var(--gdim)', border: '1px solid var(--line2)', borderRadius: 12, padding: '1.1rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.3rem', marginBottom: '.4rem' }}>🔒</div>
                    <div style={{ fontFamily: 'var(--display)', fontWeight: 800, color: 'var(--white)', fontSize: '.9rem', marginBottom: '.4rem' }}>
                      Your application is optimized. Now make it sound real.
                    </div>
                    <p style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--sub)', lineHeight: 1.6, marginBottom: '.9rem' }}>
                      Unlock HumanProof so it sounds specific &amp; natural, stays interview-defensible, and carries no unsupported claims.
                    </p>
                    <button
                      onClick={() => { setUpgradeReason('pro'); setUpgradeFeature('HumanProof'); setShowUpgrade(true) }}
                      style={{ ...btnGreen, width: 'auto', padding: '.65rem 1.4rem' }}
                    >
                      Unlock HumanProof
                    </button>
                    <p style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', color: 'var(--muted)', lineHeight: 1.6, margin: '.6rem 0 0' }}>{LOCK_NOTE}</p>
                  </div>
                )}

                {hpState === 'done' && hp && (
                  <div className="ai-stack">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                      <div style={{ flexShrink: 0, width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `3px solid ${scoreColor(hp.humanproof_score)}` }}>
                        <span style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.85rem', color: scoreColor(hp.humanproof_score) }}>{hp.humanproof_score}</span>
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontFamily: 'var(--display)', fontWeight: 800, color: 'var(--white)', fontSize: '.82rem' }}>HumanProof score</div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)' }}>{hp.ai_slop_risk} AI-slop risk · specific, natural, interview-defensible</div>
                      </div>
                    </div>
                    <div>
                      <div style={kicker}>Humanized bullets</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
                        {hp.package.bullets.map((b, i) => (
                          <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '.6rem .75rem', fontSize: '.72rem', color: 'var(--sub)', lineHeight: 1.55, overflowWrap: 'anywhere' }}>{b.humanized_text}</div>
                        ))}
                      </div>
                    </div>
                    {confirmItems().length > 0 && (
                      <div>
                        <div style={{ ...kicker, color: 'var(--amber)' }}>⚠ Confirm before using</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
                          {confirmItems().map((c, i) => (
                            <div key={i} style={{ background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 8, padding: '.5rem .7rem', fontSize: '.7rem', color: 'var(--sub)', lineHeight: 1.5, overflowWrap: 'anywhere' }}>{c}</div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              )}

              {/* Post-win ledger line — the REAL balance, the real reset, then the upsell. */}
              {result.cached && (
                <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-60)', color: 'var(--green)', lineHeight: 1.5 }}>
                  No credit used — you optimized this job with this résumé in the last 7 days. A new résumé or a new posting costs {OPTIMIZE_PRICE}.
                </div>
              )}
              {pro === false && !upsellDismissed && result.charged && (
                <div data-testid="credit-ledger" style={{ display: 'flex', alignItems: 'center', gap: '.6rem', background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.25)', borderRadius: 8, padding: '.5rem .6rem .5rem .85rem' }}>
                  <button
                    onClick={() => { setUpgradeReason('generic'); setUpgradeFeature(undefined); setShowUpgrade(true) }}
                    style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--body)', fontSize: '.66rem', color: 'var(--sub)', lineHeight: 1.5 }}
                  >
                    {OPTIMIZE_PRICE} used{balance != null ? ` · ${balance} left` : ''} · {dailyResetLabel()} · <span style={{ color: '#a5b4fc', fontWeight: 700 }}>{PASS_AFTER_WIN}</span>
                  </button>
                  <button
                    onClick={() => setUpsellDismissed(true)}
                    aria-label="Dismiss"
                    style={{ background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', fontSize: '.8rem', lineHeight: 1, padding: '.1rem .2rem', flexShrink: 0 }}
                  >✕</button>
                </div>
              )}

              {/* Apply actions — the optimized résumé downloads to the device in the same
                  tap, then the original listing opens (owner decision 2026-07-10: download
                  is the primary path; email is an option). */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                <button
                  style={{ ...btnPrimary, opacity: prepping ? 0.7 : 1, cursor: prepping ? 'wait' : 'pointer' }}
                  onClick={handleApplyNow}
                  disabled={prepping}
                >
                  {prepping
                    ? 'Preparing your resume…'
                    : pdfBlob
                      ? (job.apply_url ? '⬇ Apply — your resume downloads first →' : '⬇ Download resume & start tracking')
                      : (job.apply_url ? 'Apply online →' : 'I applied — start tracking')}
                </button>
                {pdfFailed && (
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)', textAlign: 'center' }}>
                    Couldn&apos;t build the PDF — Apply still works, or retry / email below.
                  </div>
                )}
                <div className="ai-btn-row" style={{ display: 'flex', gap: '.5rem' }}>
                  <button
                    onClick={() => copyText(buildPackageText(), 'pkg')}
                    style={{ flex: 1, padding: '.65rem .5rem', background: 'var(--raised)', border: '1px solid var(--line2)', color: copied === 'pkg' ? 'var(--green)' : 'var(--sub)', borderRadius: 9, fontFamily: 'var(--mono)', fontSize: '.66rem', cursor: 'pointer' }}
                  >
                    {copied === 'pkg' ? '✓ Copied' : 'Copy package'}
                  </button>
                  {pdfBlob ? (
                    <button
                      onClick={saveBlob}
                      style={{ flex: 1, padding: '.65rem .5rem', background: 'var(--raised)', border: '1px solid var(--line2)', color: 'var(--sub)', borderRadius: 9, fontFamily: 'var(--mono)', fontSize: '.66rem', cursor: 'pointer' }}
                    >
                      ⬇ Save PDF
                    </button>
                  ) : (
                    <button
                      onClick={() => { setPdfFailed(false); preparePdf() }}
                      disabled={prepping}
                      style={{ flex: 1, padding: '.65rem .5rem', background: 'var(--raised)', border: '1px solid var(--line2)', color: 'var(--sub)', borderRadius: 9, fontFamily: 'var(--mono)', fontSize: '.66rem', cursor: prepping ? 'not-allowed' : 'pointer', opacity: prepping ? 0.6 : 1 }}
                    >
                      {prepping ? 'Building…' : '⬇ Save PDF'}
                    </button>
                  )}
                  <button
                    onClick={approveAndSend}
                    style={{ flex: 1, padding: '.65rem .5rem', background: 'var(--raised)', border: '1px solid var(--line2)', color: 'var(--sub)', borderRadius: 9, fontFamily: 'var(--mono)', fontSize: '.66rem', cursor: 'pointer' }}
                  >
                    ✉ Email it
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── sending ── */}
          {step === 'sending' && (
            <div style={{ textAlign: 'center', paddingBottom: '1rem' }}>
              <LoadingDots />
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.7rem', color: 'var(--sub)' }}>
                Sending your optimized resume to {user?.email || profile?.email || 'your email'}…
              </div>
            </div>
          )}

          {/* ── done ── */}
          {step === 'done' && (
            <>
              <div style={{ textAlign: 'center', padding: '.5rem 0 1.25rem' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '.75rem' }}>✉️</div>
                <div style={{ fontFamily: 'var(--display)', fontSize: '1rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.4rem' }}>
                  Check your email
                </div>
                <div style={{ fontSize: '.78rem', color: 'var(--sub)', lineHeight: 1.7 }}>
                  Your optimized resume is on its way to{' '}
                  <span style={{ color: 'var(--white)', fontWeight: 600 }}>{user?.email || profile?.email || 'your inbox'}</span>.
                  Open it, then apply with your new bullets.
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
                {job.apply_url ? (
                  <a
                    href={job.apply_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: 'block', textDecoration: 'none' }}
                    onClick={() => { onApplied(); onClose() }}
                  >
                    <div style={{ ...btnPrimary, textAlign: 'center' }}>
                      Apply Online →
                    </div>
                  </a>
                ) : (
                  <button style={btnPrimary} onClick={() => { onApplied(); onClose() }}>
                    I Applied — Start Tracking →
                  </button>
                )}

                {job.apply_url && (
                  <button
                    style={btnGreen}
                    onClick={() => { onApplied(); onClose() }}
                  >
                    I Applied — Start Tracking →
                  </button>
                )}

                <button style={btnGhost} onClick={onClose}>
                  Close — I'll apply later
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
    </ModalPortal>
    </>
  )
}
