'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { aiHeaders } from '@/lib/aiHeaders'
import { ResumeStore } from '@/lib/stores/ResumeStore'
import UpgradeModal from './UpgradeModal'
import { FREE_DAILY_CREDITS } from '@/lib/creditRules'
import ApplicationIntelligencePanel, { type ApplicationIntelligence } from './optimizer/ApplicationIntelligencePanel'
import ErrorBoundary from './ErrorBoundary'
import type { Job } from '@/lib/types'

const CREDIT_WORD = FREE_DAILY_CREDITS === 1 ? 'credit' : 'credits'

interface OptimizeBullet {
  original: string
  optimized: string
  humanized?: string
  addresses: string
}

interface OptimizeResult {
  job_priorities: string[]
  optimized_bullets: OptimizeBullet[]
  keywords_added: string[]
  stealth?: boolean
  _seenfit_score?: number
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
  | 'not-logged-in'
  | 'no-resume'
  | 'resume-corrupted'
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

function scoreColor(s: number): string {
  return s >= 70 ? 'var(--green)' : s >= 45 ? 'var(--amber)' : 'var(--red)'
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
  const [upsellDismissed, setUpsellDismissed] = useState(false)

  // HumanProof sub-flow (runs AFTER SeenFit, inside the review step).
  const [hpState, setHpState] = useState<HpState>('idle')
  const [hp, setHp] = useState<HumanProofResult | null>(null)

  // Application Intelligence V2 — fetched in the background from the free (no-credit) optimize
  // action and shown as a compact "deep match" read-out. Null = not available; render nothing.
  const [aiPkg, setAiPkg] = useState<ApplicationIntelligence | null>(null)

  // Copy + download state. The PDF is pre-built in the BACKGROUND while the user reads
  // their results, so the Apply tap can download + redirect fully in-gesture (iOS blocks
  // both after any await). pdfFailed stops the auto-build from retry-looping on a
  // persistent server error; it resets whenever the bullets change.
  const [copied, setCopied] = useState<string | null>(null)
  const [prepping, setPrepping] = useState(false)
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)
  const [pdfFailed, setPdfFailed] = useState(false)
  const [pdfName, setPdfName] = useState('Seen Resume.pdf')

  useEffect(() => {
    if (!isLoggedIn) { setStep('not-logged-in'); return }
    ResumeStore.load(user?.id, isLoggedIn).then(data => {
      if (data?.text && data.text.length > 50) {
        setResumeText(data.text)
        // Skip the choose step — user already picked "Apply & Optimize"
        runOptimize(data.text)
      } else {
        setStep('no-resume')
      }
    })
  }, [isLoggedIn, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pro status for the post-win upsell — same get_credits signal Nav.tsx uses.
  useEffect(() => {
    if (!isLoggedIn) { setPro(null); return }
    let cancelled = false
    aiHeaders()
      .then(h => fetch('/api/user-sync', { method: 'POST', headers: h, body: JSON.stringify({ action: 'get_credits' }) }))
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d) setPro(!!d.pro) })
      .catch(() => { /* leave pro null — upsell stays hidden when status is unknown */ })
    return () => { cancelled = true }
  }, [isLoggedIn, user?.id])

  // Pre-build the résumé PDF as soon as results are on screen — and again after
  // HumanProof rewrites the bullets (runHumanProof clears pdfBlob) — so the blob is
  // ready before the user taps Apply.
  useEffect(() => {
    if (step === 'review' && result && !pdfBlob && !prepping && !pdfFailed) preparePdf()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, result, hp, pdfBlob, pdfFailed])

  // Derived views over the SeenFit result — grounded, no fabrication.
  const realBullets = (result?.optimized_bullets || []).filter(b => !isGuidance(b.original) && !isGuidance(b.optimized))
  const guidanceItems = (result?.optimized_bullets || []).filter(b => isGuidance(b.original) || isGuidance(b.optimized))
  const matchReasons = Array.from(new Set(realBullets.map(b => b.addresses).filter(Boolean))).slice(0, 6)
  const gaps = (result?.keywords_added || []).slice(0, 8)
  const fitScore = result?._seenfit_score != null ? Math.round(Number(result._seenfit_score)) : null

  async function runOptimize(resumeOverride?: string) {
    const text = resumeOverride ?? resumeText
    setStep('optimizing')
    setError('')
    // Reset any downstream state from a previous pass.
    setHp(null); setHpState('idle'); setPdfBlob(null); setPdfFailed(false); setAiPkg(null)
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
          jobDescription: job.description || '',
        }),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({})) as { error?: string; credits_required?: boolean; pro_required?: boolean }
        if (r.status === 402 || e.credits_required || e.pro_required) {
          setUpgradeReason('credits'); setUpgradeFeature(undefined)
          setShowUpgrade(true)
          setStep('choose')
          return
        }
        // Saved résumé couldn't be read (often a phone PDF that didn't convert to clean text).
        // Route to a clear recovery step instead of dead-ending on a raw error code.
        if (e.error === 'RESUME_CORRUPTED') { setStep('resume-corrupted'); return }
        throw new Error(e.error || `Error ${r.status}`)
      }
      const data = await r.json() as OptimizeResult
      // Optimize consumed a credit server-side — refresh the Nav balance.
      window.dispatchEvent(new Event('seen:credits-updated'))
      setResult(data)
      setStep('review')
      // Fire-and-forget the richer V2 deep-match read-out (free, no extra credit).
      loadV2(text)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Optimization failed — try again'
      setError(msg)
      setStep('choose')
    }
  }

  // ── Application Intelligence V2 — background, best-effort, never blocks the flow ──
  async function loadV2(text: string) {
    try {
      const r = await fetch('/api/optimizer', {
        method: 'POST',
        headers: await aiHeaders(),
        body: JSON.stringify({
          action: 'optimize',
          resumeText: text,
          jobId: job.id,
          jobTitle: job.title,
          company: job.company,
          jobDescription: job.description || '',
          remoteOk: /remote/i.test(job.description || ''),
        }),
      })
      if (!r.ok) return
      const data = await r.json().catch(() => ({})) as { application_intelligence?: ApplicationIntelligence | null }
      if (data.application_intelligence) setAiPkg(data.application_intelligence)
    } catch { /* V2 read-out is a bonus — never surface an error */ }
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
    if (job.apply_url) window.open(job.apply_url, '_blank', 'noopener,noreferrer')
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

  function applyWithoutOptimize() {
    if (job.apply_url) window.open(job.apply_url, '_blank', 'noopener,noreferrer')
    onApplied()
    onClose()
  }

  const title = step === 'done'
    ? '🎉 You\'re ready to apply'
    : step === 'review'
    ? 'Your Application Intelligence'
    : step === 'optimizing' ? 'Optimizing your resume…'
    : step === 'sending' ? 'Sending to your email…'
    : 'Apply & Optimize'

  return (
    <>
    {showUpgrade && <UpgradeModal reason={upgradeReason} featureName={upgradeFeature} onClose={() => setShowUpgrade(false)} />}
    <div style={overlay} onClick={onClose}>
      <div style={sheet} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={sheetHdr}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--display)', fontSize: '.88rem', fontWeight: 700, color: 'var(--white)' }}>
              {title}
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', color: 'var(--muted)', marginTop: '.1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {job.title} · {job.company}
            </div>
          </div>
          <button style={btnClose} onClick={onClose}>✕</button>
        </div>

        <div className="ai-safe-bottom" style={{ paddingTop: '1.1rem', paddingLeft: '1.1rem', paddingRight: '1.1rem', minHeight: 240 }}>

          {/* ── loading-resume ── */}
          {step === 'loading-resume' && <LoadingDots />}

          {/* ── not-logged-in ── */}
          {step === 'not-logged-in' && (
            <>
              <div style={{ textAlign: 'center', padding: '.5rem 0 1.25rem' }}>
                <div style={{ fontSize: '2rem', marginBottom: '.75rem' }}>👋</div>
                <div style={{ fontFamily: 'var(--display)', fontSize: '1rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.35rem' }}>Sign in to apply &amp; track</div>
                <div style={{ fontSize: '.82rem', color: 'var(--sub)', lineHeight: 1.7, marginBottom: '1.25rem' }}>
                  Track responses, get ghost alerts, and receive day-7/14/30 check-ins.
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
                    Continue as guest (not tracked)
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
                <button style={btnGhost} onClick={applyWithoutOptimize}>Apply without optimizing</button>
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
                <button style={btnGhost} onClick={applyWithoutOptimize}>Apply without optimizing</button>
              </div>
            </>
          )}

          {/* ── choose ── */}
          {step === 'choose' && (
            <>
              <div style={{ background: 'rgba(99,102,241,.07)', border: '1px solid rgba(99,102,241,.18)', borderRadius: 10, padding: '.8rem .95rem', marginBottom: '1rem' }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.1em', color: '#818cf8', fontWeight: 700, marginBottom: '.45rem' }}>When you optimize first</div>
                {[
                  '🎯 SeenFit scores your résumé against this exact role',
                  '🔑 Surfaces the keywords their ATS scans for',
                  '🗣 HumanProof makes it read real & interview-ready',
                  '📧 Emailed résumé + one-click back to your tracker',
                ].map(t => (
                  <div key={t} style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'rgba(165,180,252,.85)', marginBottom: '.22rem' }}>{t}</div>
                ))}
              </div>

              {error && (
                <div style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 8, padding: '.6rem .85rem', marginBottom: '.75rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--red)' }}>
                  {error}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                <button style={btnPrimary} onClick={() => runOptimize()}>
                  🧠 Optimize &amp; Apply · 1 credit
                </button>
                <button style={btnGhost} onClick={applyWithoutOptimize}>
                  Apply without optimizing
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
                Skip — just apply directly
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

              {/* Fit score */}
              {fitScore != null && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '.85rem', background: 'var(--gdim)', border: '1px solid var(--line)', borderRadius: 12, padding: '.9rem 1rem' }}>
                  <div style={{ flexShrink: 0, width: 52, height: 52, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `3px solid ${scoreColor(fitScore)}` }}>
                    <span style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: '1.15rem', color: scoreColor(fitScore) }}>{fitScore}</span>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--display)', fontWeight: 800, color: 'var(--white)', fontSize: '.9rem' }}>SeenFit match</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', lineHeight: 1.5 }}>
                      {result.stealth ? '🗣 Human Voice applied — sounds like you, every keyword kept' : 'Grounded in your real résumé — nothing invented'}
                    </div>
                  </div>
                </div>
              )}

              {/* Top matches */}
              {matchReasons.length > 0 && (
                <div>
                  <div style={kicker}>Why you match</div>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
                    {matchReasons.map((m, i) => (
                      <li key={i} className="ai-trunc" style={{ display: 'flex', gap: '.5rem', fontSize: '.75rem', color: 'var(--sub)', lineHeight: 1.5 }}>
                        <span style={{ color: 'var(--green)', flexShrink: 0 }}>✓</span><span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{m}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Gaps */}
              {gaps.length > 0 && (
                <div>
                  <div style={kicker}>Add if you genuinely have it</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem' }}>
                    {gaps.map(k => (
                      <span key={k} style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: 'var(--red)', borderRadius: 5, padding: '.18rem .55rem', fontFamily: 'var(--mono)', fontSize: '.62rem', maxWidth: '100%', overflowWrap: 'anywhere' }}>{k}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Safe improvements (before/after) */}
              {realBullets.length > 0 && (
                <div>
                  <div style={kicker}>Safe improvements — {realBullets.length} bullet{realBullets.length !== 1 ? 's' : ''}, grounded in your résumé</div>
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
                  <div style={{ ...kicker, color: 'var(--amber)' }}>⚠ Add before using — needs a real detail from you</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
                    {guidanceItems.map((g, i) => (
                      <div key={i} style={{ background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 8, padding: '.55rem .75rem', fontSize: '.72rem', color: 'var(--sub)', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
                        Write a bullet for <strong style={{ color: 'var(--white)' }}>{g.addresses}</strong> — only include it if it reflects real work, and attach a real number.
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Application Intelligence V2 — compact deep-match read-out (background-loaded) */}
              {aiPkg && (
                <div style={{ borderTop: '1px solid var(--line)', paddingTop: '.9rem' }}>
                  <div style={{ ...kicker, color: 'var(--indigo)' }}>Deep match analysis</div>
                  <ErrorBoundary label="deep-dive-compact"><ApplicationIntelligencePanel pkg={aiPkg} compact /></ErrorBoundary>
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

              {/* Post-win upsell */}
              {pro === false && !upsellDismissed && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.25)', borderRadius: 8, padding: '.5rem .6rem .5rem .85rem' }}>
                  <button
                    onClick={() => { setUpgradeReason('generic'); setUpgradeFeature(undefined); setShowUpgrade(true) }}
                    style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--body)', fontSize: '.66rem', color: 'var(--sub)', lineHeight: 1.5 }}
                  >
                    That used 1 of your {FREE_DAILY_CREDITS} daily {CREDIT_WORD} · <span style={{ color: '#a5b4fc', fontWeight: 700 }}>Pro removes the cap →</span>
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
                <button style={btnGhost} onClick={() => runOptimize()}>← Re-optimize</button>
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
    </>
  )
}
