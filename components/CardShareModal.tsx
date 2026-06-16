'use client'

// Reusable share-card modal: takes a canvas-drawing function and a share text,
// renders the PNG preview, and exposes the same platform/share/download flow the
// outcome card uses. Used by CompanyScoreCard and ListingCard (and available for
// outcome cards) so every share surface behaves identically.

import { useEffect, useRef, useState } from 'react'

interface Props {
  title: string
  subtitle: string
  accent: string
  shareText: string
  fileNameBase: string
  draw: () => Promise<HTMLCanvasElement>
  onClose: () => void
}

export default function CardShareModal({ title, subtitle, accent, shareText, fileNameBase, draw, onClose }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [blob, setBlob] = useState<Blob | null>(null)
  const doneRef = useRef(false)

  useEffect(() => {
    if (doneRef.current) return
    doneRef.current = true
    const run = async () => {
      try {
        await document.fonts.ready
        const canvas = await draw()
        setDataUrl(canvas.toDataURL('image/png'))
        canvas.toBlob(b => { if (b) setBlob(b) }, 'image/png')
      } catch { /* leave preview in loading state */ }
    }
    run()
  }, [draw])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const fileName = () => `${fileNameBase}_${Date.now()}.png`

  function download() {
    if (!dataUrl) return
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = fileName()
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

    if (blob && navigator.share && navigator.canShare?.({ files: [new File([blob], fileName(), { type: 'image/png' })] })) {
      try {
        await navigator.share({ files: [new File([blob], fileName(), { type: 'image/png' })] })
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
