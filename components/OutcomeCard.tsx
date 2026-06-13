'use client'

import { useEffect, useRef } from 'react'
import type { Application } from '@/lib/types'

interface Props {
  app: Application
  onClose: () => void
}

function getDaysElapsed(from: number, to: number) {
  return Math.max(1, Math.round((to - from) / 86400000))
}

export default function OutcomeCard({ app, onClose }: Props) {
  const cardRef = useRef<HTMLDivElement>(null)

  const status = app.status as 'hired' | 'rejected' | 'ghosted'
  const resolvedAt = app.updatedAt ?? Date.now()
  const days = getDaysElapsed(app.appliedAt, resolvedAt)

  const COLOR = status === 'hired' ? '#10b981' : status === 'ghosted' ? '#9ca3af' : '#ef4444'
  const LABEL = status === 'hired' ? '🎉 HIRED' : status === 'ghosted' ? '👻 GHOSTED' : '❌ REJECTED'
  const appliedStr = new Date(app.appliedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  const shareText = status === 'hired'
    ? `Just got hired at ${app.company} for ${app.role} after ${days} days! Tracked it all on Seen 🎉`
    : status === 'ghosted'
    ? `${app.company} ghosted me after ${days} days of waiting for ${app.role}. Tracked on Seen 👻`
    : `Rejected from ${app.company} (${app.role}) after ${days} days. Keeping the search going. Tracked on Seen`

  const shareUrl = 'https://tryseen.io'

  const shareReddit = () => {
    const url = `https://www.reddit.com/submit?title=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`
    window.open(url, '_blank', 'noopener')
  }
  const shareTwitter = () => {
    const url = `https://x.com/intent/tweet?text=${encodeURIComponent(shareText + ' ' + shareUrl)}`
    window.open(url, '_blank', 'noopener')
  }
  const shareThreads = () => {
    const url = `https://www.threads.net/intent/post?text=${encodeURIComponent(shareText + ' ' + shareUrl)}`
    window.open(url, '_blank', 'noopener')
  }

  const downloadCard = async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 600
    canvas.height = 315
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Background
    ctx.fillStyle = '#0a0a0f'
    ctx.fillRect(0, 0, 600, 315)

    // Accent line
    ctx.fillStyle = COLOR
    ctx.fillRect(0, 0, 4, 315)

    // Status badge
    ctx.fillStyle = COLOR + '22'
    roundRect(ctx, 24, 24, 100, 28, 6)
    ctx.fill()
    ctx.fillStyle = COLOR
    ctx.font = 'bold 11px monospace'
    ctx.fillText(LABEL, 34, 42)

    // Company
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 28px system-ui, -apple-system, sans-serif'
    ctx.fillText(app.company.slice(0, 28), 24, 105)

    // Role
    ctx.fillStyle = '#9ca3af'
    ctx.font = '16px system-ui, -apple-system, sans-serif'
    ctx.fillText((app.role || '').slice(0, 48), 24, 133)

    // Stats
    ctx.fillStyle = '#374151'
    roundRect(ctx, 24, 160, 170, 60, 8)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 22px monospace'
    ctx.fillText(`${days}`, 44, 195)
    ctx.fillStyle = '#6b7280'
    ctx.font = '11px monospace'
    ctx.fillText('DAYS', 44, 212)

    ctx.fillStyle = '#374151'
    roundRect(ctx, 206, 160, 170, 60, 8)
    ctx.fill()
    ctx.fillStyle = '#9ca3af'
    ctx.font = '11px monospace'
    ctx.fillText('APPLIED', 226, 178)
    ctx.fillStyle = '#e5e7eb'
    ctx.font = 'bold 13px monospace'
    ctx.fillText(appliedStr, 226, 200)

    // Branding
    ctx.fillStyle = '#374151'
    ctx.font = '11px monospace'
    ctx.fillText('Tracked on Seen — tryseen.io', 24, 295)

    const link = document.createElement('a')
    link.download = `seen-${status}-${app.company.replace(/\s+/g, '-').toLowerCase()}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.85)', backdropFilter: 'blur(6px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Card preview */}
      <div
        ref={cardRef}
        style={{ width: '100%', maxWidth: 480, background: '#0a0a0f', border: `1px solid ${COLOR}33`, borderLeft: `4px solid ${COLOR}`, borderRadius: 14, padding: '1.5rem 1.75rem', marginBottom: '1.25rem', position: 'relative', overflow: 'hidden' }}
      >
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', fontWeight: 700, color: COLOR, marginBottom: '.75rem', textTransform: 'uppercase', letterSpacing: '.1em' }}>{LABEL}</div>
        <div style={{ fontFamily: 'var(--display)', fontSize: '1.5rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', marginBottom: '.25rem' }}>{app.company}</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.78rem', color: 'var(--sub)', marginBottom: '1.25rem' }}>{app.role}</div>
        <div style={{ display: 'flex', gap: '.75rem' }}>
          <div style={{ background: 'var(--raised)', border: '1px solid var(--line)', borderRadius: 8, padding: '.6rem .9rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--white)' }}>{days}</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em' }}>days</div>
          </div>
          <div style={{ background: 'var(--raised)', border: '1px solid var(--line)', borderRadius: 8, padding: '.6rem .9rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', fontWeight: 600, color: 'var(--sub)' }}>{appliedStr}</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em' }}>applied</div>
          </div>
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)', marginTop: '1rem' }}>Tracked on Seen · tryseen.io</div>
      </div>

      {/* Share buttons */}
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', justifyContent: 'center', marginBottom: '.85rem' }}>
        <button onClick={shareReddit} className="btn btn-ghost" style={{ fontSize: '.72rem', gap: '.35rem' }}>
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path d="M10 0C4.478 0 0 4.478 0 10s4.478 10 10 10 10-4.478 10-10S15.522 0 10 0zm5.93 10a1.25 1.25 0 00-2.5 0c0 .69.56 1.25 1.25 1.25S15.93 10.69 15.93 10zM7.5 9.375a.625.625 0 100-1.25.625.625 0 000 1.25zm5 0a.625.625 0 100-1.25.625.625 0 000 1.25zM10 13.125c-1.31 0-2.5-.625-2.5-.625s.625 1.875 2.5 1.875 2.5-1.875 2.5-1.875-1.19.625-2.5.625z"/></svg>
          Reddit
        </button>
        <button onClick={shareTwitter} className="btn btn-ghost" style={{ fontSize: '.72rem' }}>✕ Twitter/X</button>
        <button onClick={shareThreads} className="btn btn-ghost" style={{ fontSize: '.72rem' }}>@ Threads</button>
        <button onClick={downloadCard} className="btn btn-ghost" style={{ fontSize: '.72rem' }}>⬇ Save image</button>
      </div>

      <button onClick={onClose} style={{ background: 'none', border: 'none', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--muted)', cursor: 'pointer' }}>
        Close
      </button>
    </div>
  )
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}
