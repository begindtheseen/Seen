'use client'

// The ONE share modal shell behind every card (OutcomeCard, CompanyScoreCard): a square/story
// toggle, the preview, destination buttons in the site's own type and 44px tap height, the
// hint toast and Skip. Drawing is the caller's (lib/cardKit.ts) — it passes a `draw(canvas,
// format)` and the shell renders each format once, on demand, and caches it. Distribution is
// lib/shareCard.ts, untouched. Rendered through a portal to document.body so a transformed
// ancestor can't trap the fixed backdrop.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useScrollLock } from '@/components/ModalPortal'
import type { CardFormat } from '@/lib/cardKit'
import { shareCardImage, shareHint, type ShareDest } from '@/lib/shareCard'

export interface CardShareModalProps {
  /** Eyebrow text, e.g. "Outcome card" — set in the accent colour. */
  kicker: string
  /** The headline above the preview, e.g. "Your card is ready". */
  title: string
  sub: string
  accent: string
  /** Draws the card for a format. Called after document.fonts.ready. May be async (a grade lookup). */
  draw: (canvas: HTMLCanvasElement, format: CardFormat) => void | Promise<void>
  shareText: string
  shareUrl: string
  fileBase: string
  onClose: () => void
  /** Fired when a share is attempted (destination name) — analytics / report hooks. */
  onShareAttempt?: (dest: ShareDest) => void
  /** Fired when the image actually travelled (method) — analytics. */
  onShared?: (dest: ShareDest, method: string) => void
  onGenerated?: (format: CardFormat) => void
  skipLabel?: string
  /** Something to show under the buttons (an extra note). */
  children?: ReactNode
}

type Rendered = { dataUrl: string; blob: Blob | null }

const DESTS: { dest: ShareDest; label: string; dot: string }[] = [
  { dest: 'linkedin', label: 'Share to LinkedIn', dot: '#0a66c2' },
  { dest: 'twitter', label: 'Share to X', dot: '#ffffff' },
  { dest: 'reddit', label: 'Share to Reddit', dot: '#ff4500' },
  { dest: 'threads', label: 'Threads', dot: '#ffffff' },
]

export default function CardShareModal(p: CardShareModalProps) {
  const [mounted, setMounted] = useState(false)
  const [format, setFormat] = useState<CardFormat>('square')
  const [rendered, setRendered] = useState<Partial<Record<CardFormat, Rendered>>>({})
  const [hint, setHint] = useState<string | null>(null)
  const inFlight = useRef<Set<CardFormat>>(new Set())
  const { draw, onGenerated } = p

  useEffect(() => { setMounted(true) }, [])

  const render = useCallback(async (fmt: CardFormat) => {
    if (inFlight.current.has(fmt)) return
    inFlight.current.add(fmt)
    try {
      await document.fonts.ready
      const canvas = document.createElement('canvas')
      await draw(canvas, fmt)
      const dataUrl = canvas.toDataURL('image/png')
      const blob = await new Promise<Blob | null>(res => canvas.toBlob(b => res(b), 'image/png'))
      setRendered(r => ({ ...r, [fmt]: { dataUrl, blob } }))
      onGenerated?.(fmt)
    } catch {
      inFlight.current.delete(fmt) // allow a retry on the next toggle
    }
  }, [draw, onGenerated])

  useEffect(() => { if (mounted && !rendered[format]) void render(format) }, [mounted, format, rendered, render])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [p])

  useScrollLock(mounted)

  const current = rendered[format]

  async function share(dest: ShareDest) {
    try { p.onShareAttempt?.(dest) } catch { /* never block the share UX */ }
    const fileName = `seen_${p.fileBase}_${format}_${Date.now()}.png`
    const result = await shareCardImage({ blob: current?.blob ?? null, dataUrl: current?.dataUrl ?? null, fileName, text: p.shareText, url: p.shareUrl, dest })
    // Method reflects how the image actually travelled: native share sheet, clipboard copy,
    // plain download, or the destination whose composer/unfurl we opened.
    // 'cancelled'/'noop' means nothing was shared — don't count those.
    if (result !== 'cancelled' && result !== 'noop') {
      const method = dest === 'download' ? 'download' : result === 'native' ? 'native_share' : result === 'clipboard+open' ? 'copy' : dest
      try { p.onShared?.(dest, method) } catch { /* analytics never blocks */ }
    }
    const msg = shareHint(result, dest)
    if (msg) { setHint(msg); return } // clipboard/unfurl paths keep the modal open to read the hint
    if (dest !== 'download') setTimeout(p.onClose, 400)
  }

  if (!mounted) return null

  const btn: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.5rem', minHeight: 44,
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10,
    color: '#f9fafb', fontFamily: 'var(--body)', fontSize: 'var(--fs-sm)', fontWeight: 600, padding: '0 .9rem', cursor: 'pointer',
  }
  const segBase: React.CSSProperties = {
    minHeight: 44, padding: '0 1rem', borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: 'var(--body)',
    fontSize: 'var(--fs-sm)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '.45rem', background: 'transparent', color: 'rgba(255,255,255,0.55)',
  }
  const segOn: React.CSSProperties = { ...segBase, background: 'rgba(255,255,255,0.1)', color: '#fff' }

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(4,5,12,0.985)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '1.25rem 1rem 2.5rem', overflowY: 'auto' }}>
      <div style={{ width: '100%', maxWidth: 520 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.9rem', minHeight: 44 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontFamily: 'var(--body)', fontSize: 'var(--fs-meta)', fontWeight: 600, color: p.accent, letterSpacing: '.01em' }}>
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: p.accent, display: 'inline-block' }} />
            {p.kicker}
          </div>
          <button type="button" onClick={p.onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontFamily: 'var(--body)', fontSize: 'var(--fs-sm)', fontWeight: 500, color: 'rgba(255,255,255,0.55)', cursor: 'pointer', minHeight: 44, padding: '0 .5rem' }}>Close</button>
        </div>

        <div style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-h3)', fontWeight: 800, color: '#fff', marginBottom: '.25rem', letterSpacing: '-.02em', lineHeight: 1.1 }}>{p.title}</div>
        <div style={{ fontFamily: 'var(--body)', fontSize: 'var(--fs-ui)', color: 'rgba(255,255,255,0.6)', marginBottom: '1rem', lineHeight: 1.55 }}>{p.sub}</div>

        <div role="tablist" aria-label="Card format" style={{ display: 'inline-flex', gap: 2, padding: 3, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, marginBottom: '.9rem' }}>
          <button type="button" role="tab" aria-selected={format === 'square'} onClick={() => setFormat('square')} style={format === 'square' ? segOn : segBase}>
            <span aria-hidden style={{ width: 12, height: 12, border: '1.5px solid currentColor', borderRadius: 3, display: 'inline-block' }} />Square
          </button>
          <button type="button" role="tab" aria-selected={format === 'story'} onClick={() => setFormat('story')} style={format === 'story' ? segOn : segBase}>
            <span aria-hidden style={{ width: 8, height: 14, border: '1.5px solid currentColor', borderRadius: 2, display: 'inline-block' }} />Story
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
          {current ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current.dataUrl} alt={`${p.kicker} preview`} style={{ display: 'block', width: format === 'story' ? 'auto' : '100%', maxWidth: '100%', maxHeight: format === 'story' ? '54vh' : undefined, borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)', boxShadow: `0 30px 90px rgba(0,0,0,0.85), 0 0 80px ${p.accent}1f` }} />
          ) : (
            <div style={{ width: format === 'story' ? 'min(100%, 54vh * 9 / 16)' : '100%', aspectRatio: format === 'story' ? '9 / 16' : '1 / 1', borderRadius: 14, background: '#0c0f1a', border: `1px solid ${p.accent}22`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontFamily: 'var(--body)', fontSize: 'var(--fs-sm)', color: 'rgba(255,255,255,0.45)' }}>Drawing your card…</div>
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.5rem', marginBottom: '.5rem' }}>
          {DESTS.map(d => (
            <button key={d.dest} type="button" onClick={() => share(d.dest)} style={btn}>
              <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: d.dot, display: 'inline-block', flexShrink: 0 }} />{d.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => share('download')} disabled={!current} style={{ ...btn, width: '100%', marginBottom: '.75rem', background: current ? `${p.accent}1f` : 'rgba(255,255,255,0.04)', border: `1px solid ${current ? `${p.accent}66` : 'rgba(255,255,255,0.08)'}`, opacity: current ? 1 : 0.6, cursor: current ? 'pointer' : 'not-allowed' }}>
          Save image
        </button>

        {hint && (
          <div role="status" style={{ display: 'flex', alignItems: 'flex-start', gap: '.55rem', background: 'rgba(255,255,255,0.06)', border: `1px solid ${p.accent}55`, color: '#e5e7eb', fontFamily: 'var(--body)', fontSize: 'var(--fs-sm)', lineHeight: 1.5, padding: '.65rem .8rem', borderRadius: 10, marginBottom: '.75rem' }}>
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: p.accent, display: 'inline-block', flexShrink: 0, marginTop: 6 }} />
            <span>{hint}</span>
          </div>
        )}

        {p.children}

        <button type="button" onClick={p.onClose} style={{ background: 'none', border: 'none', width: '100%', fontFamily: 'var(--body)', fontSize: 'var(--fs-sm)', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', minHeight: 44, textAlign: 'center' }}>{p.skipLabel || 'Skip'}</button>
      </div>
    </div>,
    document.body,
  )
}
