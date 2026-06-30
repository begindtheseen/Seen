'use client'

// Tracker "Outcome" share card. The 1080×1080 creative is drawn by the shared premium
// kit (lib/cardKit.ts). Rendered through a portal to document.body so a transformed
// ancestor can't trap the fixed backdrop. Maps the tracked Application (events, dates,
// status, platform) into the kit's outcome model — a journey stepper + stat row.

import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { Application } from '@/lib/types'
import { drawOutcomeCard, type OutcomeCardData } from '@/lib/cardKit'

interface Props {
  app: Application
  onClose: () => void
  // Fired once when the card is shared to a destination or downloaded. Used by the
  // tracker→report→share loop to record a light outcome_card_shares analytics row.
  onShared?: (via: string) => void
}

function buildOutcome(app: Application): OutcomeCardData {
  const events = app.events || []
  const appliedMs = events.find(e => e.type === 'application_submitted')?.date || app.appliedAt || Date.now()
  const offerEvt = events.find(e => e.type === 'offer_received')
  const rejEvt = events.find(e => e.type === 'rejected')
  const ghostEvt = events.find(e => e.type === 'ghosted')
  const intEvt = events.find(e => e.type === 'interview_received')
  const outcomeMs = (offerEvt || rejEvt || ghostEvt)?.date || app.updatedAt || Date.now()
  const days = Math.max(0, Math.round((outcomeMs - appliedMs) / 86400000))

  const outcome = (app.status === 'hired' || offerEvt) ? 'hired'
    : (app.status === 'ghosted' || ghostEvt) ? 'ghosted'
    : 'rejected'
  const reachedInterview = !!intEvt
  const word = outcome === 'hired' ? 'HIRED' : outcome === 'ghosted' ? 'GHOSTED' : 'REJECTED'
  const mark = outcome === 'hired' ? '✓' : '✕'

  // Ghosted has no decision date — frame the timeline as "silence", not a verdict day.
  const steps = outcome === 'ghosted'
    ? [
        { label: 'Applied', sub: 'Day 0' },
        { label: 'Interview', sub: reachedInterview ? 'Reached' : 'Not reached' },
        { label: 'Ghosted', sub: `${days}d of silence`, mark },
      ]
    : [
        { label: 'Applied', sub: 'Day 0' },
        { label: 'Interview', sub: reachedInterview ? 'Reached' : 'Not reached' },
        { label: word, sub: `Day ${days}`, mark },
      ]

  const stats = [
    { value: outcome === 'ghosted' ? `${days}d` : `${days}d`, label: outcome === 'ghosted' ? 'No reply for' : 'To decision', color: '#ffffff' },
    { value: reachedInterview ? 'Yes' : 'No', label: 'Reached interview', color: reachedInterview ? '#10b981' : 'rgba(255,255,255,0.85)' },
    { value: app.platform || 'Seen', label: 'Applied via', color: '#ffffff' },
  ]

  return { company: app.company || 'Company', role: app.role, outcome, days, reachedInterview, platform: app.platform, steps, stats }
}

export default function OutcomeCard({ app, onClose, onShared }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [mounted, setMounted] = useState(false)
  const doneRef = useRef(false)

  const status = (app.status || 'ghosted') as 'hired' | 'rejected' | 'ghosted'
  const OC = status === 'hired' ? '#10b981' : status === 'ghosted' ? '#ef4444' : '#ef4444'
  const days = Math.max(1, Math.round((app.updatedAt - app.appliedAt) / 86400000))
  const outcomeWord = status === 'hired' ? 'got an offer' : status === 'ghosted' ? 'got ghosted' : 'got rejected'
  const shareText = `Tracked my ${app.company} application on Seen — ${outcomeWord} after ${days} days. Check any company's ghost rate at seenjobs.io`

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (doneRef.current) return
    doneRef.current = true
    const run = async () => {
      try {
        await document.fonts.ready
        const canvas = document.createElement('canvas')
        drawOutcomeCard(canvas, buildOutcome(app))
        setDataUrl(canvas.toDataURL('image/png'))
        canvas.toBlob(b => { if (b) setBlob(b) }, 'image/png')
      } catch { /* leave preview in loading state */ }
    }
    run()
  }, [app]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  function download() {
    if (!dataUrl) return
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `seen_${status}_${(app.company || 'company').replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.png`
    a.click()
  }

  async function share(dest: 'reddit' | 'threads' | 'twitter' | 'linkedin' | 'download') {
    try { onShared?.(dest) } catch { /* never block the share UX */ }
    if (dest === 'reddit') {
      window.open(`https://www.reddit.com/r/cscareerquestions/submit?type=image&title=${encodeURIComponent(shareText)}`, '_blank', 'noopener')
    } else if (dest === 'threads') {
      window.open(`https://www.threads.net/intent/post?text=${encodeURIComponent(shareText)}`, '_blank', 'noopener')
    } else if (dest === 'twitter') {
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`, '_blank', 'noopener')
    } else if (dest === 'linkedin') {
      window.open(`https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(shareText)}`, '_blank', 'noopener')
    }

    const fileName = `seen_${status}_${(app.company || 'c').replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.png`
    if (blob && navigator.share && navigator.canShare?.({ files: [new File([blob], fileName, { type: 'image/png' })] })) {
      try {
        await navigator.share({ files: [new File([blob], fileName, { type: 'image/png' })] })
      } catch (e) {
        if ((e as Error).name !== 'AbortError') download()
      }
    } else if (dest === 'download') {
      download()
    }

    if (dest !== 'download') setTimeout(onClose, 400)
  }

  if (!mounted) return null

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(4,5,12,0.985)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '1.5rem 1.25rem 2.5rem', overflowY: 'auto' }}>
      <div style={{ width: '100%', maxWidth: 480 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: OC, textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 600 }}>
            {status} — {app.company}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', padding: '.2rem .4rem' }}>✕ close</button>
        </div>

        <div style={{ fontFamily: 'var(--display)', fontSize: '1.15rem', fontWeight: 800, color: '#fff', marginBottom: '.2rem', letterSpacing: '-.02em' }}>Your outcome card is ready</div>
        <div style={{ fontFamily: 'var(--body)', fontSize: '.78rem', color: 'rgba(255,255,255,0.45)', marginBottom: '1.1rem', lineHeight: 1.6 }}>Share your experience — help the next applicant know what to expect.</div>

        {dataUrl ? (
          <img src={dataUrl} alt="Outcome card" style={{ width: '100%', borderRadius: 16, boxShadow: `0 24px 80px rgba(0,0,0,0.9), 0 0 60px ${OC}22`, marginBottom: '1rem', display: 'block' }} />
        ) : (
          <div style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: 16, background: '#0c0f1a', border: `1px solid ${OC}22`, marginBottom: '1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '.85rem' }}>
            <div style={{ fontFamily: 'var(--display)', fontSize: '3rem', fontWeight: 800, color: OC, opacity: .7 }}>{app.company[0]?.toUpperCase()}</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'rgba(255,255,255,0.2)', letterSpacing: '.1em' }}>Generating your card…</div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '.5rem', marginBottom: '.5rem' }}>
          <button onClick={() => share('linkedin')} style={{ background: 'rgba(10,102,194,0.15)', border: '1px solid rgba(10,102,194,0.4)', color: '#60a5fa', fontFamily: 'var(--mono)', fontSize: '.65rem', fontWeight: 600, padding: '.7rem .6rem', borderRadius: 9, cursor: 'pointer' }}>in · LinkedIn</button>
          <button onClick={() => share('twitter')} style={{ background: 'rgba(29,161,242,0.1)', border: '1px solid rgba(29,161,242,0.3)', color: 'rgba(150,210,255,0.9)', fontFamily: 'var(--mono)', fontSize: '.65rem', fontWeight: 600, padding: '.7rem .6rem', borderRadius: 9, cursor: 'pointer' }}>𝕏 · Twitter</button>
          <button onClick={() => share('reddit')} style={{ background: 'rgba(255,69,0,0.15)', border: '1px solid rgba(255,69,0,0.4)', color: '#ff6314', fontFamily: 'var(--mono)', fontSize: '.65rem', fontWeight: 600, padding: '.7rem .6rem', borderRadius: 9, cursor: 'pointer' }}>Reddit</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.5rem', marginBottom: '.7rem' }}>
          <button onClick={() => share('threads')} style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.18)', color: '#fff', fontFamily: 'var(--mono)', fontSize: '.65rem', fontWeight: 600, padding: '.7rem .9rem', borderRadius: 9, cursor: 'pointer' }}>Threads</button>
          <button onClick={() => share('download')} disabled={!dataUrl} style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)', color: 'rgba(180,180,255,0.85)', fontFamily: 'var(--mono)', fontSize: '.65rem', padding: '.7rem .9rem', borderRadius: 9, cursor: dataUrl ? 'pointer' : 'not-allowed', opacity: dataUrl ? 1 : 0.5 }}>↓ Save Image</button>
        </div>

        <button onClick={onClose} style={{ background: 'none', border: 'none', width: '100%', fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'rgba(255,255,255,0.25)', cursor: 'pointer', padding: '.5rem', textAlign: 'center' }}>Skip — don&apos;t share</button>
      </div>
    </div>,
    document.body,
  )
}
