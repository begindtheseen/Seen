'use client'

// Job-listing share card — built on the EXACT same generator as the outcome card
// (components/OutcomeCard.tsx): self-contained 1080×1080 canvas + the same share modal.
// No shared kit — parity with the proven outcome card.

import { useEffect, useState, useRef } from 'react'

export interface ListingCardData {
  title: string
  company: string
  location: string
  level?: string
  type?: string
  score: number        // company hiring grade for this listing
  waste?: number
  whatTheyWant?: string[]
  insiderTip?: string
}

function letterGrade(s: number) {
  if (s >= 90) return 'A+'; if (s >= 85) return 'A'; if (s >= 80) return 'A-'
  if (s >= 77) return 'B+'; if (s >= 73) return 'B'; if (s >= 70) return 'B-'
  if (s >= 67) return 'C+'; if (s >= 63) return 'C'; if (s >= 60) return 'C-'
  if (s >= 55) return 'D+'; if (s >= 50) return 'D'; if (s >= 45) return 'D-'
  return 'F'
}

function rrPath(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath()
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r)
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r)
  c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath()
}

async function drawCard(d: ListingCardData): Promise<HTMLCanvasElement> {
  const W = 1080, H = 1080, PAD = 72
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const c = canvas.getContext('2d')!

  const score = Math.round(d.score || 0)
  const risk = score >= 70 ? 'safe' : score >= 40 ? 'warn' : 'danger'
  const OC = risk === 'safe' ? '#10b981' : risk === 'danger' ? '#ef4444' : '#f59e0b'
  const gradeEmoji = risk === 'safe' ? '🟢' : risk === 'danger' ? '🔴' : '🟡'
  const grade = letterGrade(score)

  const facts: { e: string; t: string }[] = []
  for (const w of (d.whatTheyWant || []).slice(0, 3)) facts.push({ e: '🎯', t: w })
  if (d.insiderTip) facts.push({ e: '💡', t: d.insiderTip })
  facts.push({ e: gradeEmoji, t: `Seen Hiring Grade: ${grade} (${score}/100)` })
  if (!facts.length) facts.push({ e: '🔎', t: 'Check ghost risk + response rate before applying.' })
  const factList = facts.slice(0, 6)

  // Background
  c.fillStyle = '#02040a'; c.fillRect(0, 0, W, H)
  const g1 = c.createRadialGradient(W * .5, H * .38, 0, W * .5, H * .38, 520)
  g1.addColorStop(0, OC + '1A'); g1.addColorStop(1, 'rgba(0,0,0,0)')
  c.fillStyle = g1; c.fillRect(0, 0, W, H)
  const g2 = c.createRadialGradient(W, 0, 0, W, 0, 440)
  g2.addColorStop(0, 'rgba(124,58,237,0.13)'); g2.addColorStop(1, 'rgba(0,0,0,0)')
  c.fillStyle = g2; c.fillRect(0, 0, W, H)
  rrPath(c, 1, 1, W - 2, H - 2, 24)
  c.strokeStyle = 'rgba(255,255,255,0.06)'; c.lineWidth = 1.5; c.stroke()

  // Eyebrow
  c.font = '600 13px "DM Mono",monospace'; c.fillStyle = 'rgba(255,255,255,0.20)'
  c.textAlign = 'left'; c.textBaseline = 'top'
  c.fillText('SEEN  ·  JOB LISTING', PAD, PAD)
  c.textAlign = 'right'; c.fillText('seenjobs.io', W - PAD, PAD)

  // Title — fit down, then ellipsize so a long role never overflows.
  const titleY = PAD + 50; let tFs = 56
  c.font = `800 ${tFs}px "Syne",sans-serif`
  while (c.measureText(d.title || 'Role').width > W - PAD * 2 && tFs > 34) {
    tFs -= 2; c.font = `800 ${tFs}px "Syne",sans-serif`
  }
  let title = d.title || 'Role'
  while (c.measureText(title).width > W - PAD * 2 && title.length > 4) title = title.slice(0, -1)
  if (title !== (d.title || 'Role')) title = title.replace(/[\s,]+$/, '') + '…'
  c.fillStyle = '#fff'; c.textAlign = 'left'; c.textBaseline = 'top'
  c.fillText(title, PAD, titleY)

  // Company · location subline
  const subY = titleY + tFs + 10
  c.font = '400 21px "DM Mono",monospace'; c.fillStyle = 'rgba(255,255,255,0.42)'
  let sub = `${d.company}${d.location ? '  ·  ' + d.location : ''}`
  while (c.measureText(sub).width > W - PAD * 2 && sub.length > 4) sub = sub.slice(0, -1)
  c.fillText(sub, PAD, subY)

  // Divider 1
  const d1Y = subY + 42
  c.strokeStyle = 'rgba(255,255,255,0.09)'; c.lineWidth = 1
  c.beginPath(); c.moveTo(PAD, d1Y); c.lineTo(W - PAD, d1Y); c.stroke()

  // Big grade headline (like the outcome word)
  const HEAD = `${grade}  ·  ${score}/100`
  let oFs = 138; c.font = `800 ${oFs}px "Syne",sans-serif`
  while (c.measureText(HEAD).width > W - PAD * 2 && oFs > 72) {
    oFs -= 4; c.font = `800 ${oFs}px "Syne",sans-serif`
  }
  const oY = d1Y + 26
  c.fillStyle = OC; c.textAlign = 'left'; c.textBaseline = 'top'
  c.fillText(HEAD, PAD, oY)

  // Divider 2
  const d2Y = oY + oFs + 22
  c.strokeStyle = 'rgba(255,255,255,0.09)'; c.lineWidth = 1
  c.beginPath(); c.moveTo(PAD, d2Y); c.lineTo(W - PAD, d2Y); c.stroke()

  // Fact list
  const footerDivY = H - 90
  const factStartY = d2Y + 30
  const lineH = Math.min(82, Math.max(52, Math.floor((footerDivY - factStartY) / Math.max(factList.length, 1))))
  for (const [i, f] of factList.entries()) {
    const fy = factStartY + i * lineH + lineH / 2
    const eFs = Math.round(lineH * 0.46)
    c.font = `${eFs}px serif`; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = '#fff'
    c.fillText(f.e, PAD, fy)
    const textX = PAD + eFs + 18
    let fFs = 30
    c.font = `500 ${fFs}px "DM Mono",monospace`; c.fillStyle = 'rgba(255,255,255,0.90)'
    while (c.measureText(f.t).width > W - textX - PAD && fFs > 16) {
      fFs--; c.font = `500 ${fFs}px "DM Mono",monospace`
    }
    let ft = f.t
    while (c.measureText(ft).width > W - textX - PAD && ft.length > 4) ft = ft.slice(0, -1)
    if (ft !== f.t) ft = ft.replace(/[\s,]+$/, '') + '…'
    c.textBaseline = 'middle'
    c.fillText(ft, textX, fy)
  }

  // Footer
  c.strokeStyle = 'rgba(255,255,255,0.08)'; c.lineWidth = 1
  c.beginPath(); c.moveTo(PAD, footerDivY); c.lineTo(W - PAD, footerDivY); c.stroke()
  c.font = '400 16px "DM Mono",monospace'; c.fillStyle = 'rgba(255,255,255,0.30)'
  c.textAlign = 'center'; c.textBaseline = 'middle'
  c.fillText('Job intel from Seen  ·  seenjobs.io', W / 2, footerDivY + 28)

  return canvas
}

export default function ListingCard({ data, onClose }: { data: ListingCardData; onClose: () => void }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [blob, setBlob] = useState<Blob | null>(null)
  const doneRef = useRef(false)

  const score = Math.round(data.score || 0)
  const risk = score >= 70 ? 'safe' : score >= 40 ? 'warn' : 'danger'
  const OC = risk === 'safe' ? '#10b981' : risk === 'danger' ? '#ef4444' : '#f59e0b'
  const grade = letterGrade(score)
  const shareText = `${data.title} at ${data.company}${data.location ? ' (' + data.location + ')' : ''} — Seen hiring grade ${grade} (${score}/100). Know before you apply.`

  useEffect(() => {
    if (doneRef.current) return
    doneRef.current = true
    const run = async () => {
      try {
        await document.fonts.ready
        const canvas = await drawCard(data)
        setDataUrl(canvas.toDataURL('image/png'))
        canvas.toBlob(b => { if (b) setBlob(b) }, 'image/png')
      } catch { /* leave preview in loading state */ }
    }
    run()
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  function download() {
    if (!dataUrl) return
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `seen_listing_${(data.company || 'company').replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.png`
    a.click()
  }

  async function share(dest: 'reddit' | 'threads' | 'twitter' | 'linkedin' | 'download') {
    if (dest === 'reddit') {
      window.open(`https://www.reddit.com/submit?type=image&title=${encodeURIComponent(shareText)}`, '_blank', 'noopener')
    } else if (dest === 'threads') {
      window.open(`https://www.threads.net/intent/post?text=${encodeURIComponent(shareText + '\n\nseenjobs.io')}`, '_blank', 'noopener')
    } else if (dest === 'twitter') {
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText + '\n\nseenjobs.io')}`, '_blank', 'noopener')
    } else if (dest === 'linkedin') {
      window.open(`https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(shareText + '\n\nseenjobs.io')}`, '_blank', 'noopener')
    }

    const fileName = `seen_listing_${(data.company || 'c').replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.png`
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
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(2,4,10,0.97)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '1.5rem 1.25rem 2.5rem', overflowY: 'auto' }}>
      <div style={{ width: '100%', maxWidth: 480 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: OC, textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 600 }}>{data.title} — {data.company}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', padding: '.2rem .4rem' }}>✕ close</button>
        </div>

        <div style={{ fontFamily: 'var(--display)', fontSize: '1.15rem', fontWeight: 800, color: '#fff', marginBottom: '.2rem', letterSpacing: '-.02em' }}>Your share card is ready</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'rgba(255,255,255,0.35)', marginBottom: '1.1rem', lineHeight: 1.7 }}>Share this listing with its Seen hiring grade and intel.</div>

        {dataUrl ? (
          <img src={dataUrl} alt="Share card" style={{ width: '100%', borderRadius: 12, boxShadow: `0 24px 80px rgba(0,0,0,0.9), 0 0 60px ${OC}22`, marginBottom: '1rem', display: 'block' }} />
        ) : (
          <div style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: 12, background: '#0c0f1a', border: `1px solid ${OC}22`, marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'rgba(255,255,255,0.2)', letterSpacing: '.1em' }}>Generating your card…</div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '.5rem', marginBottom: '.5rem' }}>
          <button onClick={() => share('linkedin')} style={{ background: 'rgba(10,102,194,0.15)', border: '1px solid rgba(10,102,194,0.4)', color: '#60a5fa', fontFamily: 'var(--mono)', fontSize: '.65rem', fontWeight: 600, padding: '.7rem .6rem', borderRadius: 9, cursor: 'pointer' }}>💼 LinkedIn</button>
          <button onClick={() => share('twitter')} style={{ background: 'rgba(29,161,242,0.1)', border: '1px solid rgba(29,161,242,0.3)', color: 'rgba(150,210,255,0.9)', fontFamily: 'var(--mono)', fontSize: '.65rem', fontWeight: 600, padding: '.7rem .6rem', borderRadius: 9, cursor: 'pointer' }}>𝕏 Twitter</button>
          <button onClick={() => share('reddit')} style={{ background: 'rgba(255,69,0,0.15)', border: '1px solid rgba(255,69,0,0.4)', color: '#ff6314', fontFamily: 'var(--mono)', fontSize: '.65rem', fontWeight: 600, padding: '.7rem .6rem', borderRadius: 9, cursor: 'pointer' }}>🔴 Reddit</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.5rem', marginBottom: '.7rem' }}>
          <button onClick={() => share('threads')} style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.18)', color: '#fff', fontFamily: 'var(--mono)', fontSize: '.65rem', fontWeight: 600, padding: '.7rem .9rem', borderRadius: 9, cursor: 'pointer' }}>🧵 Threads</button>
          <button onClick={() => share('download')} disabled={!dataUrl} style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)', color: 'rgba(180,180,255,0.85)', fontFamily: 'var(--mono)', fontSize: '.65rem', padding: '.7rem .9rem', borderRadius: 9, cursor: dataUrl ? 'pointer' : 'not-allowed', opacity: dataUrl ? 1 : 0.5 }}>↓ Save Image</button>
        </div>

        <button onClick={onClose} style={{ background: 'none', border: 'none', width: '100%', fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'rgba(255,255,255,0.25)', cursor: 'pointer', padding: '.5rem', textAlign: 'center' }}>Skip</button>
      </div>
    </div>
  )
}
