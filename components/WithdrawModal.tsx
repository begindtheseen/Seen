'use client'

// Withdraw an application from the tracker (owner request 2026-10-18).
//   1. Confirm, with an optional note to the employer (a reason, or a thank-you). For an
//      Apply-on-Seen application the employer is notified in-app and by email.
//   2. Right after — ONLY when the application is at least a week old: why did you withdraw? An
//      optional reason and an optional review of the company. Saved as a first-party report — it
//      counts toward the company's Seen score (api/apply.js withdraw_review). A Day-0 entry has had no
//      hiring process to review, so it skips straight to done (user audit 2026-10-23: a card added by
//      mistake was being walked through a public-review prompt; "Delete" on the card is for those).
//      Both steps are optional to fill in; withdrawing happens in step 1.

import { useEffect, useState } from 'react'
import ModalPortal from '@/components/ModalPortal'
import { useAuth } from '@/lib/auth'
import { WITHDRAW_REASONS, MESSAGE_MAX, REVIEW_MAX } from '@/lib/server/applicationThread.js'
import type { Application } from '@/lib/types'
import { markQuiet } from '@/lib/quietWindow'

type Step = 'confirm' | 'why' | 'done'

const REASONS = Object.entries(WITHDRAW_REASONS as Record<string, string>)
/** The review prompt is offered only once the application is this old. */
export const REVIEW_AFTER_DAYS = 7

export default function WithdrawModal({ app, onClose, onWithdrawn }: {
  app: Application
  onClose: () => void
  /** Called once the withdrawal is saved, so the tracker can reload. */
  onWithdrawn: () => void
}) {
  const { token } = useAuth()
  const isSeen = app.seenApply === true
  // Applicants never reply on Seen: once the employer has written, a withdrawal goes without a note
  // (the server enforces the same rule — lib/server/applicationThread.js applicantMayNote).
  const employerWrote = (app.messages || []).some(m => m.from === 'employer')
  const canNote = isSeen && !employerWrote
  const reviewable = Date.now() - app.appliedAt >= REVIEW_AFTER_DAYS * 86400000
  const [step, setStep] = useState<Step>('confirm')
  const [message, setMessage] = useState('')
  const [reason, setReason] = useState('')
  const [review, setReview] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [notified, setNotified] = useState(false)
  const [counted, setCounted] = useState<boolean | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  async function call(body: Record<string, unknown>) {
    const t = await token()
    const r = await fetch('/api/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      body: JSON.stringify(body),
    })
    const d = await r.json().catch(() => ({})) as Record<string, unknown>
    return { ok: r.ok && d.ok === true, d }
  }

  async function withdraw() {
    setErr(''); setBusy(true)
    try {
      const { ok, d } = await call({ action: 'withdraw', application_id: app.id, message: canNote ? message : undefined })
      if (!ok) { setErr(String(d.error || 'Could not withdraw — please try again')); return }
      setNotified(d.employer_notified === true)
      markQuiet() // a withdrawal is a weighty moment — no micro-survey for two minutes (lib/quietWindow)
      onWithdrawn()
      setStep(reviewable ? 'why' : 'done')
    } catch { setErr('Could not withdraw — please try again') } finally { setBusy(false) }
  }

  async function sendReview() {
    setErr(''); setBusy(true)
    try {
      const { ok, d } = await call({ action: 'withdraw_review', application_id: app.id, reason: reason || undefined, review: review || undefined })
      if (!ok) { setErr(String(d.error || 'Could not save — please try again')); return }
      setCounted(d.counted === true)
      onWithdrawn()
      setStep('done')
    } catch { setErr('Could not save — please try again') } finally { setBusy(false) }
  }

  const label: React.CSSProperties = { fontFamily: 'var(--mono)', fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.09em', color: 'var(--dim)', margin: '.9rem 0 .4rem' }
  const area: React.CSSProperties = { width: '100%', boxSizing: 'border-box', minHeight: 84, resize: 'vertical', background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 9, padding: '.6rem .7rem', color: 'var(--white)', fontFamily: 'var(--body)', fontSize: '.82rem', lineHeight: 1.5 }
  const primary: React.CSSProperties = { flex: 1, minHeight: 44, padding: '.65rem 1rem', borderRadius: 9, border: 'none', background: 'var(--blue)', color: '#fff', fontWeight: 700, fontSize: '.82rem', cursor: busy ? 'wait' : 'pointer', opacity: busy ? .7 : 1 }
  const ghost: React.CSSProperties = { minHeight: 44, padding: '.65rem 1rem', borderRadius: 9, border: '1px solid var(--line2)', background: 'none', color: 'var(--sub)', fontSize: '.82rem', cursor: 'pointer' }

  let content
  if (step === 'confirm') {
    content = (
      <>
        <p style={{ fontSize: '.84rem', color: 'var(--sub)', lineHeight: 1.6, margin: '.6rem 0 0' }}>
          Your tracker will show this application as withdrawn.{isSeen ? ` ${app.company} will be told you withdrew.` : ''}
        </p>
        {canNote && (
          <>
            <div style={label}>Message to {app.company} (optional)</div>
            <textarea value={message} onChange={e => setMessage(e.target.value)} maxLength={MESSAGE_MAX} placeholder="A reason, or a quick thank-you — they’ll see it with your application." style={area} />
          </>
        )}
        {err && <div role="alert" style={{ color: 'var(--red)', fontSize: '.75rem', marginTop: '.6rem' }}>{err}</div>}
        <div style={{ display: 'flex', gap: '.5rem', marginTop: '1rem' }}>
          <button type="button" onClick={onClose} style={ghost} disabled={busy}>Keep it</button>
          <button type="button" onClick={withdraw} style={{ ...primary, background: 'var(--red)' }} disabled={busy}>{busy ? 'Withdrawing…' : 'Withdraw application'}</button>
        </div>
      </>
    )
  } else if (step === 'why') {
    content = (
      <>
        <p style={{ fontSize: '.84rem', color: 'var(--sub)', lineHeight: 1.6, margin: '.6rem 0 0' }}>
          Withdrawn{notified ? ` — ${app.company} has been told` : ''}. Why did you withdraw? <span style={{ color: 'var(--muted)' }}>Optional.</span>
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem', marginTop: '.7rem' }}>
          {REASONS.map(([code, text]) => (
            <button key={code} type="button" aria-pressed={reason === code} onClick={() => setReason(r => (r === code ? '' : code))}
              style={{ minHeight: 40, padding: '.38rem .7rem', borderRadius: 999, fontSize: '.72rem', cursor: 'pointer', border: `1px solid ${reason === code ? 'var(--blue)' : 'var(--line2)'}`, background: reason === code ? 'rgba(59,130,246,.12)' : 'none', color: reason === code ? 'var(--white)' : 'var(--sub)' }}>
              {text}
            </button>
          ))}
        </div>
        <div style={label}>Review {app.company} (optional)</div>
        <textarea value={review} onChange={e => setReview(e.target.value)} maxLength={REVIEW_MAX} placeholder="How was their hiring process? Did they reply, how fast, how were you treated?" style={area} />
        <div style={{ fontSize: '.68rem', color: 'var(--muted)', lineHeight: 1.5, marginTop: '.4rem' }}>
          Shared anonymously on {app.company}’s Seen page and counted in their hiring score, along with what your tracker shows happened.
        </div>
        {err && <div role="alert" style={{ color: 'var(--red)', fontSize: '.75rem', marginTop: '.6rem' }}>{err}</div>}
        <div style={{ display: 'flex', gap: '.5rem', marginTop: '1rem' }}>
          <button type="button" onClick={onClose} style={ghost} disabled={busy}>Skip</button>
          <button type="button" onClick={sendReview} style={primary} disabled={busy || (!reason && !review.trim())}>{busy ? 'Saving…' : 'Share'}</button>
        </div>
      </>
    )
  } else {
    content = (
      <>
        <p style={{ fontSize: '.86rem', color: 'var(--sub)', lineHeight: 1.6, margin: '.6rem 0 0' }}>
          {counted === null
            ? `Withdrawn${notified ? ` — ${app.company} has been told` : ''}. Nothing was filed about ${app.company}; the card stays in your tracker as withdrawn.`
            : counted ? `Thanks — it now counts toward ${app.company}’s Seen score.` : 'Thanks — it’s saved. It will count once it clears our duplicate check.'}
        </p>
        <div style={{ display: 'flex', marginTop: '1rem' }}>
          <button type="button" onClick={onClose} style={primary}>Done</button>
        </div>
      </>
    )
  }

  return (
    <ModalPortal>
      <div onClick={() => { if (!busy) onClose() }} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(2,4,10,.90)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 1rem', overflowY: 'auto' }}>
        <div role="dialog" aria-modal="true" aria-label={`Withdraw from ${app.role} at ${app.company}`} onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 16, padding: '1.25rem 1.25rem 1.4rem', boxShadow: '0 30px 90px rgba(0,0,0,.6)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.75rem' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--red)' }}>{step === 'confirm' ? 'Withdraw application' : 'Withdrawn'}</div>
              <div style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: '1.05rem', color: 'var(--white)', marginTop: '.2rem' }}>{app.role}</div>
              <div style={{ fontSize: '.78rem', color: 'var(--sub)' }}>{app.company}</div>
            </div>
            <button type="button" onClick={onClose} disabled={busy} aria-label="Close" style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 8, width: 44, height: 44, color: 'var(--muted)', cursor: 'pointer', flexShrink: 0 }}>✕</button>
          </div>
          {content}
        </div>
      </div>
    </ModalPortal>
  )
}
