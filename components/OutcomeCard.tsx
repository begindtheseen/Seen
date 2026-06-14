'use client'

import { useEffect, useState, useRef } from 'react'
import type { Application } from '@/lib/types'

interface CompanyScore {
  overall_score: number
  ghost_rate: number
  avg_wait_days: number
  report_count: number
  risk_level: 'safe' | 'warn' | 'danger'
}

interface Props {
  app: Application
  onClose: () => void
}

function letterGrade(s: number) {
  if (s >= 80) return 'A'; if (s >= 65) return 'B'
  if (s >= 50) return 'C'; if (s >= 35) return 'D'; return 'F'
}

function rrPath(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath()
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r)
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r)
  c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath()
}

async function drawCard(app: Application, sc: CompanyScore | null): Promise<HTMLCanvasElement> {
  const W = 1080, H = 1080, PAD = 72
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const c = canvas.getContext('2d')!

  const events = app.events || []
  const appliedEvt = events.find(e => e.type === 'application_submitted')
  const offerEvt   = events.find(e => e.type === 'offer_received')
  const rejEvt     = events.find(e => e.type === 'rejected')
  const ghostEvt   = events.find(e => e.type === 'ghosted')
  const intEvt     = events.find(e => e.type === 'interview_received')
  const appliedMs  = appliedEvt?.date || app.appliedAt || Date.now()
  const outcomeMs  = (offerEvt || rejEvt || ghostEvt)?.date || app.updatedAt || Date.now()
  const days       = Math.max(1, Math.round((outcomeMs - appliedMs) / 86400000))

  const isHired   = app.status === 'hired' || !!offerEvt
  const isGhosted = app.status === 'ghosted' || !!ghostEvt

  const avgWait   = sc?.avg_wait_days || 28
  const ghostPct  = sc?.ghost_rate != null ? Math.round(sc.ghost_rate * 100) : null
  const rptCount  = sc?.report_count || null
  const grade     = sc ? letterGrade(sc.overall_score) : null
  const gradeEmoji = sc?.risk_level === 'safe' ? '🟢' : sc?.risk_level === 'danger' ? '🔴' : '🟡'
  const pctFaster = isHired && avgWait
    ? Math.min(99, Math.max(5, Math.round(100 * (1 - days / (avgWait * 2)))))
    : null

  const OC    = isHired ? '#10b981' : isGhosted ? '#9ca3af' : '#ef4444'
  const OWORD = isHired ? 'HIRED' : isGhosted ? 'GHOSTED' : 'REJECTED'

  type F = { e: string; t: string }
  let facts: F[]
  if (isHired) {
    facts = [
      { e: '✅', t: 'Offer Received' },
      { e: '⚡', t: `${days} Days to Offer` },
      ...(pctFaster != null && pctFaster > 50 ? [{ e: '🏆', t: `Faster Than ${pctFaster}% of Applicants` }] : []),
      { e: '📊', t: `Average Offer Time: ${avgWait} Days` },
      ...(grade ? [{ e: gradeEmoji, t: `${app.company} Hiring Grade: ${grade}` }] : []),
      ...(rptCount ? [{ e: '📈', t: `Based on ${rptCount.toLocaleString()} Applicant Outcomes` }] : []),
    ].slice(0, 6)
  } else if (isGhosted) {
    facts = [
      { e: '👻', t: `Ghosted After ${days} Days` },
      ...(ghostPct != null ? [{ e: '📊', t: `Ghost Rate at ${app.company}: ${ghostPct}%` }] : []),
      { e: '⏱', t: `Industry Average Response: ${avgWait} Days` },
      ...(grade ? [{ e: gradeEmoji, t: `${app.company} Hiring Grade: ${grade}` }] : []),
      ...(rptCount ? [{ e: '📈', t: `Based on ${rptCount.toLocaleString()} Applicant Outcomes` }] : []),
    ].slice(0, 6)
  } else {
    facts = [
      { e: '❌', t: `Rejected After ${days} Days` },
      { e: '🗓', t: `Reached Interview: ${intEvt ? 'Yes' : 'No'}` },
      { e: '📊', t: `Average Offer Time: ${avgWait} Days` },
      ...(grade ? [{ e: gradeEmoji, t: `${app.company} Hiring Grade: ${grade}` }] : []),
      ...(rptCount ? [{ e: '📈', t: `Based on ${rptCount.toLocaleString()} Applicant Outcomes` }] : []),
    ].slice(0, 6)
  }

  // Background
  c.fillStyle = '#02040a'; c.fillRect(0, 0, W, H)
  // Outcome glow
  const g1 = c.createRadialGradient(W*.5, H*.38, 0, W*.5, H*.38, 520)
  g1.addColorStop(0, OC + '1A'); g1.addColorStop(1, 'rgba(0,0,0,0)')
  c.fillStyle = g1; c.fillRect(0, 0, W, H)
  // Purple corner
  const g2 = c.createRadialGradient(W, 0, 0, W, 0, 440)
  g2.addColorStop(0, 'rgba(124,58,237,0.13)'); g2.addColorStop(1, 'rgba(0,0,0,0)')
  c.fillStyle = g2; c.fillRect(0, 0, W, H)
  // Border
  rrPath(c, 1, 1, W-2, H-2, 24)
  c.strokeStyle = 'rgba(255,255,255,0.06)'; c.lineWidth = 1.5; c.stroke()

  // Eyebrow
  c.font = '600 13px "DM Mono",monospace'; c.fillStyle = 'rgba(255,255,255,0.20)'
  c.textAlign = 'left'; c.textBaseline = 'top'
  c.fillText('SEEN  ·  HIRING OUTCOME', PAD, PAD)
  c.textAlign = 'right'; c.fillText('seenjobs.io', W - PAD, PAD)

  // Company name
  const coY = PAD + 50; let coFs = 58
  c.font = `800 ${coFs}px "Syne",sans-serif`
  while (c.measureText(app.company || 'Company').width > W - PAD*2 && coFs > 32) {
    coFs -= 2; c.font = `800 ${coFs}px "Syne",sans-serif`
  }
  c.fillStyle = '#fff'; c.textAlign = 'left'; c.textBaseline = 'top'
  c.fillText(app.company || 'Company', PAD, coY)

  // Role
  const roleY = coY + coFs + 10
  c.font = '400 21px "DM Mono",monospace'; c.fillStyle = 'rgba(255,255,255,0.42)'
  let dispR = app.role || ''
  while (c.measureText(dispR).width > W - PAD*2 && dispR.length > 4) dispR = dispR.slice(0, -1)
  if (dispR !== (app.role || '')) dispR += '…'
  c.fillText(dispR, PAD, roleY)

  // Divider 1
  const d1Y = roleY + 42
  c.strokeStyle = 'rgba(255,255,255,0.09)'; c.lineWidth = 1
  c.beginPath(); c.moveTo(PAD, d1Y); c.lineTo(W - PAD, d1Y); c.stroke()

  // Outcome word — big
  let oFs = 148; c.font = `800 ${oFs}px "Syne",sans-serif`
  while (c.measureText(OWORD).width > W - PAD*2 && oFs > 80) {
    oFs -= 4; c.font = `800 ${oFs}px "Syne",sans-serif`
  }
  const oY = d1Y + 26
  c.fillStyle = OC; c.textAlign = 'left'; c.textBaseline = 'top'
  c.fillText(OWORD, PAD, oY)

  // Divider 2
  const d2Y = oY + oFs + 22
  c.strokeStyle = 'rgba(255,255,255,0.09)'; c.lineWidth = 1
  c.beginPath(); c.moveTo(PAD, d2Y); c.lineTo(W - PAD, d2Y); c.stroke()

  // Fact list
  const footerDivY = H - 90
  const factStartY = d2Y + 30
  const lineH = Math.min(82, Math.max(52, Math.floor((footerDivY - factStartY) / Math.max(facts.length, 1))))

  for (const [i, f] of facts.entries()) {
    const fy = factStartY + i * lineH + lineH / 2
    const eFs = Math.round(lineH * 0.46)
    c.font = `${eFs}px serif`; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = '#fff'
    c.fillText(f.e, PAD, fy)
    const textX = PAD + eFs + 18
    let tFs = 30
    c.font = `500 ${tFs}px "DM Mono",monospace`; c.fillStyle = 'rgba(255,255,255,0.90)'
    while (c.measureText(f.t).width > W - textX - PAD && tFs > 16) {
      tFs--; c.font = `500 ${tFs}px "DM Mono",monospace`
    }
    c.textBaseline = 'middle'
    c.fillText(f.t, textX, fy)
  }

  // Footer
  c.strokeStyle = 'rgba(255,255,255,0.08)'; c.lineWidth = 1
  c.beginPath(); c.moveTo(PAD, footerDivY); c.lineTo(W - PAD, footerDivY); c.stroke()
  c.font = '400 16px "DM Mono",monospace'; c.fillStyle = 'rgba(255,255,255,0.30)'
  c.textAlign = 'center'; c.textBaseline = 'middle'
  c.fillText('From real applicant outcomes  ·  seenjobs.io', W/2, footerDivY + 28)

  return canvas
}

export default function OutcomeCard({ app, onClose }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [blob, setBlob] = useState<Blob | null>(null)
  const doneRef = useRef(false)

  const status  = (app.status || 'ghosted') as 'hired' | 'rejected' | 'ghosted'
  const OC      = status === 'hired' ? '#10b981' : status === 'ghosted' ? '#9ca3af' : '#ef4444'
  const OL      = status === 'hired' ? '🎉 HIRED' : status === 'ghosted' ? '👻 GHOSTED' : '❌ REJECTED'
  const days    = Math.max(1, Math.round((app.updatedAt - app.appliedAt) / 86400000))
  const shareText = {
    hired:    `Got an offer from ${app.company} after ${days} days. Tracked my whole job search on Seen.`,
    ghosted:  `${app.company} ghosted me after ${days} days. Full timeline tracked on Seen.`,
    rejected: `Rejected by ${app.company} after ${days} days. Keeping the search going. Tracked on Seen.`,
  }[status]

  useEffect(() => {
    if (doneRef.current) return
    doneRef.current = true

    const run = async () => {
      // Fetch company score — abort after 1.5s so card still generates fast
      let sc: CompanyScore | null = null
      try {
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), 1500)
        const r = await fetch('/api/reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: app.company }),
          signal: ctrl.signal,
        })
        clearTimeout(t)
        const d = await r.json()
        if (d.score) sc = d.score as CompanyScore
      } catch { /* timeout or network — proceed without score */ }

      await document.fonts.ready
      const canvas = await drawCard(app, sc)
      const url = canvas.toDataURL('image/png')
      setDataUrl(url)
      canvas.toBlob(b => { if (b) setBlob(b) }, 'image/png')
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

  async function share(dest: 'reddit' | 'threads' | 'twitter' | 'download') {
    if (dest === 'reddit') {
      window.open(`https://www.reddit.com/r/cscareerquestions/submit?type=image&title=${encodeURIComponent(shareText)}`, '_blank', 'noopener')
    } else if (dest === 'threads') {
      window.open(`https://www.threads.net/intent/post?text=${encodeURIComponent(shareText + '\n\nseenjobs.io')}`, '_blank', 'noopener')
    } else if (dest === 'twitter') {
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText + '\n\nseenjobs.io')}`, '_blank', 'noopener')
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

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(2,4,10,0.97)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '1.5rem 1.25rem 2.5rem', overflowY: 'auto',
      }}
    >
      <div style={{ width: '100%', maxWidth: 480 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: OC, textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 600 }}>
            {OL} — {app.company}
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', padding: '.2rem .4rem' }}
          >✕ close</button>
        </div>

        <div style={{ fontFamily: 'var(--display)', fontSize: '1.15rem', fontWeight: 800, color: '#fff', marginBottom: '.2rem', letterSpacing: '-.02em' }}>
          Your outcome card is ready
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'rgba(255,255,255,0.35)', marginBottom: '1.1rem', lineHeight: 1.7 }}>
          Share your experience — help the next applicant know what to expect.
        </div>

        {/* Card preview */}
        {dataUrl ? (
          <img
            src={dataUrl}
            alt="Outcome card"
            style={{ width: '100%', borderRadius: 12, boxShadow: `0 24px 80px rgba(0,0,0,0.9), 0 0 60px ${OC}22`, marginBottom: '1rem', display: 'block' }}
          />
        ) : (
          <div style={{
            width: '100%', aspectRatio: '1 / 1', borderRadius: 12,
            background: '#0c0f1a', border: `1px solid ${OC}22`,
            marginBottom: '1rem', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: '.85rem',
          }}>
            <div style={{ fontFamily: 'var(--display)', fontSize: '3rem', fontWeight: 800, color: OC, opacity: .7 }}>
              {app.company[0]?.toUpperCase()}
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'rgba(255,255,255,0.2)', letterSpacing: '.1em' }}>
              Generating your card…
            </div>
          </div>
        )}

        {/* Share buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.55rem', marginBottom: '.7rem' }}>
          <button onClick={() => share('reddit')}
            style={{ background: 'rgba(255,69,0,0.15)', border: '1px solid rgba(255,69,0,0.4)', color: '#ff6314', fontFamily: 'var(--mono)', fontSize: '.68rem', fontWeight: 600, padding: '.75rem .9rem', borderRadius: 9, cursor: 'pointer' }}>
            🔴 Reddit
          </button>
          <button onClick={() => share('threads')}
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.18)', color: '#fff', fontFamily: 'var(--mono)', fontSize: '.68rem', fontWeight: 600, padding: '.75rem .9rem', borderRadius: 9, cursor: 'pointer' }}>
            🧵 Threads
          </button>
          <button onClick={() => share('twitter')}
            style={{ background: 'rgba(29,161,242,0.1)', border: '1px solid rgba(29,161,242,0.3)', color: 'rgba(150,210,255,0.9)', fontFamily: 'var(--mono)', fontSize: '.68rem', fontWeight: 600, padding: '.75rem .9rem', borderRadius: 9, cursor: 'pointer' }}>
            𝕏 Twitter / X
          </button>
          <button onClick={() => share('download')} disabled={!dataUrl}
            style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)', color: 'rgba(180,180,255,0.85)', fontFamily: 'var(--mono)', fontSize: '.68rem', padding: '.75rem .9rem', borderRadius: 9, cursor: dataUrl ? 'pointer' : 'not-allowed', opacity: dataUrl ? 1 : 0.5 }}>
            ↓ Save Image
          </button>
        </div>

        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', width: '100%', fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'rgba(255,255,255,0.25)', cursor: 'pointer', padding: '.5rem', textAlign: 'center' }}
        >
          Skip — don&apos;t share
        </button>

      </div>
    </div>
  )
}
