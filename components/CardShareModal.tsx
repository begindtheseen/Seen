'use client'

// Reusable share-card modal: takes a canvas-drawing function (parameterised by
// platform FORMAT) and a share text, renders a preview, and exposes per-app share
// targets — each producing an image sized for that app — plus a native Share sheet
// and a Save option.

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { FormatKey } from '@/lib/cards/cardKit'

interface Props {
  title: string
  subtitle: string
  accent: string
  shareText: string
  fileNameBase: string
  draw: (format: FormatKey) => Promise<HTMLCanvasElement>
  onClose: () => void
}

type Dest = 'instagram' | 'facebook' | 'threads' | 'reddit' | 'share' | 'download'

// Each app's optimal image format + (desktop fallback) web compose intent.
const APP: Record<Exclude<Dest, 'share' | 'download'>, { label: string; emoji: string; size: string; format: FormatKey; intent?: (t: string) => string; bg: string; border: string; color: string }> = {
  instagram: { label: 'Instagram', emoji: '📸', size: '4:5', format: 'portrait', bg: 'rgba(225,48,108,0.13)', border: 'rgba(225,48,108,0.4)', color: '#f472b6' },
  threads: { label: 'Threads', emoji: '@', size: '4:5', format: 'portrait', intent: t => `https://www.threads.net/intent/post?text=${encodeURIComponent(t + '\n\nseenjobs.io')}`, bg: 'rgba(255,255,255,0.07)', border: 'rgba(255,255,255,0.2)', color: '#fff' },
  facebook: { label: 'Facebook', emoji: 'f', size: '1:1', format: 'square', intent: () => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent('https://seenjobs.io')}`, bg: 'rgba(24,119,242,0.14)', border: 'rgba(24,119,242,0.4)', color: '#60a5fa' },
  reddit: { label: 'Reddit', emoji: '🔴', size: '1:1', format: 'square', intent: t => `https://www.reddit.com/submit?type=image&title=${encodeURIComponent(t)}`, bg: 'rgba(255,69,0,0.15)', border: 'rgba(255,69,0,0.4)', color: '#ff6314' },
}

export default function CardShareModal({ title, subtitle, accent, shareText, fileNameBase, draw, onClose }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState<Dest | null>(null)
  const doneRef = useRef(false)

  useEffect(() => {
    if (doneRef.current) return
    doneRef.current = true
    ;(async () => {
      try {
        await document.fonts.ready
        const canvas = await draw('square')
        setDataUrl(canvas.toDataURL('image/png'))
      } catch { /* leave preview in loading state */ }
    })()
  }, [draw])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const fileName = (fmt: FormatKey) => `${fileNameBase}_${fmt}_${Date.now()}.png`

  async function renderBlob(format: FormatKey): Promise<Blob | null> {
    try {
      await document.fonts.ready
      const canvas = await draw(format)
      return await new Promise<Blob | null>(res => canvas.toBlob(b => res(b), 'image/png'))
    } catch { return null }
  }

  function downloadBlob(blob: Blob, fmt: FormatKey) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = fileName(fmt); a.click()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }

  // Try the native share sheet with the image file; fall back to opening the app's
  // web compose intent (desktop) and downloading the correctly-sized image.
  async function go(dest: Dest) {
    if (busy) return
    setBusy(dest)
    try {
      const format: FormatKey = dest === 'instagram' || dest === 'threads' ? 'portrait' : 'square'
      const blob = await renderBlob(format)
      const file = blob ? new File([blob], fileName(format), { type: 'image/png' }) : null

      if (dest === 'download') {
        if (blob) downloadBlob(blob, format)
        return
      }

      // Native share (best on mobile): opens the OS sheet so the user posts the
      // correctly-sized image straight into the app they pick.
      if (file && typeof navigator !== 'undefined' && navigator.share && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], text: dest === 'share' ? shareText : shareText + '\n\nseenjobs.io' })
          setTimeout(onClose, 300)
          return
        } catch (e) {
          if ((e as Error).name === 'AbortError') return
        }
      }

      // Desktop / no-share-API fallback: open the compose intent + download the image.
      const intent = dest !== 'share' ? APP[dest].intent?.(shareText) : undefined
      if (intent) window.open(intent, '_blank', 'noopener')
      if (blob) downloadBlob(blob, format)
      if (dest !== 'share') setTimeout(onClose, 400)
    } finally {
      setBusy(null)
    }
  }

  const btn = (extra: CSSProperties): CSSProperties => ({
    fontFamily: 'var(--mono)', fontSize: '.65rem', fontWeight: 600, padding: '.7rem .6rem',
    borderRadius: 9, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, ...extra,
  })
  const appBtn = (k: Exclude<Dest, 'share' | 'download'>) => {
    const a = APP[k]
    return (
      <button key={k} onClick={() => go(k)} disabled={!!busy} style={btn({ background: a.bg, border: `1px solid ${a.border}`, color: a.color, opacity: busy ? 0.6 : 1 })}>
        <span>{a.emoji} {a.label}</span>
        <span style={{ fontSize: '.5rem', opacity: 0.6, fontWeight: 400 }}>{busy === k ? 'preparing…' : a.size}</span>
      </button>
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(2,4,10,0.97)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '1.5rem 1.25rem 2.5rem', overflowY: 'auto' }}>
      <div style={{ width: '100%', maxWidth: 480 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: accent, textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 600 }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', padding: '.2rem .4rem' }}>✕ close</button>
        </div>

        <div style={{ fontFamily: 'var(--display)', fontSize: '1.15rem', fontWeight: 800, color: '#fff', marginBottom: '.2rem', letterSpacing: '-.02em' }}>Your share card is ready</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'rgba(255,255,255,0.35)', marginBottom: '1.1rem', lineHeight: 1.7 }}>{subtitle}</div>

        {dataUrl ? (
          <img src={dataUrl} alt="Share card" style={{ width: '100%', borderRadius: 12, boxShadow: `0 24px 80px rgba(0,0,0,0.9), 0 0 60px ${accent}22`, marginBottom: '1rem', display: 'block' }} />
        ) : (
          <div style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: 12, background: '#0c0f1a', border: `1px solid ${accent}22`, marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'rgba(255,255,255,0.2)', letterSpacing: '.1em' }}>Generating your card…</div>
          </div>
        )}

        <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '.4rem' }}>Share — sized for each app</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.5rem', marginBottom: '.5rem' }}>
          {appBtn('instagram')}
          {appBtn('threads')}
          {appBtn('facebook')}
          {appBtn('reddit')}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.5rem', marginBottom: '.7rem' }}>
          <button onClick={() => go('share')} disabled={!!busy} style={{ background: accent + '22', border: `1px solid ${accent}66`, color: '#fff', fontFamily: 'var(--mono)', fontSize: '.65rem', fontWeight: 600, padding: '.7rem .9rem', borderRadius: 9, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>↗ Share…</button>
          <button onClick={() => go('download')} disabled={!!busy} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.8)', fontFamily: 'var(--mono)', fontSize: '.65rem', padding: '.7rem .9rem', borderRadius: 9, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>↓ Save image</button>
        </div>

        <button onClick={onClose} style={{ background: 'none', border: 'none', width: '100%', fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'rgba(255,255,255,0.25)', cursor: 'pointer', padding: '.5rem', textAlign: 'center' }}>Skip</button>
      </div>
    </div>
  )
}
