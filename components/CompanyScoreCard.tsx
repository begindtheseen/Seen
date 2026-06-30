'use client'

// Company "Hiring Grade" share card. The 1080×1080 creative is drawn by the shared
// premium kit (lib/cardKit.ts) used by the outcome card too. The modal is rendered
// through a portal to document.body so a transformed/animated ancestor on the company
// page can't trap the fixed backdrop (that was the "background bleeds through" bug).

import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { drawCompanyCard, type CompanyCardData } from '@/lib/cardKit'
import { shareCardImage, shareHint, type ShareDest } from '@/lib/shareCard'

export interface CompanyScoreCardData {
  company: string
  industry?: string
  overall_score: number
  ghost_rate: number      // 0–1
  response_rate: number   // 0–1
  avg_wait_days: number
  waste: number           // 0–100
  report_count: number
  risk?: 'safe' | 'warn' | 'danger'
  tags?: string[]
}

function letterGrade(s: number) {
  if (s >= 90) return 'A+'; if (s >= 85) return 'A'; if (s >= 80) return 'A-'
  if (s >= 77) return 'B+'; if (s >= 73) return 'B'; if (s >= 70) return 'B-'
  if (s >= 67) return 'C+'; if (s >= 63) return 'C'; if (s >= 60) return 'C-'
  if (s >= 55) return 'D+'; if (s >= 50) return 'D'; if (s >= 45) return 'D-'
  return 'F'
}

export default function CompanyScoreCard({ data, shareUrl, onClose, onShared }: { data: CompanyScoreCardData; shareUrl?: string; onClose: () => void; onShared?: (via: string) => void }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [mounted, setMounted] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const doneRef = useRef(false)

  // The unfurl URL: the company page (which has a dynamic OG image) when known,
  // else the root site. Pasting this into Reddit/X/etc renders an image preview card.
  const unfurlUrl = shareUrl
    || `https://seenjobs.io/company/${(data.company || '').toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-')}`

  const score = Math.round(data.overall_score || 0)
  const risk = data.risk ?? (score >= 70 ? 'safe' : score >= 40 ? 'warn' : 'danger')
  const OC = risk === 'safe' ? '#10b981' : risk === 'danger' ? '#ef4444' : '#f59e0b'
  const grade = letterGrade(score)
  const shareText = risk === 'danger'
    ? `${data.company} scores ${score}/100 (${grade}) on Seen — ${Math.round((data.ghost_rate || 0) * 100)}% ghost rate. Research before you apply.`
    : risk === 'warn'
    ? `${data.company} scores ${score}/100 (${grade}) on Seen. Know before you apply.`
    : `${data.company} scores ${score}/100 (${grade}) on Seen — strong hiring process.`

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (doneRef.current) return
    doneRef.current = true
    const run = async () => {
      try {
        await document.fonts.ready
        const canvas = document.createElement('canvas')
        const payload: CompanyCardData = {
          company: data.company || 'Company',
          grade,
          overall_score: score,
          ghost_rate: data.ghost_rate,
          response_rate: data.response_rate,
          avg_wait_days: data.avg_wait_days,
          waste: data.waste,
          report_count: data.report_count,
          risk,
        }
        drawCompanyCard(canvas, payload)
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

  async function share(dest: ShareDest) {
    try { onShared?.(dest) } catch { /* never block the share UX */ }
    const fileName = `seen_grade_${(data.company || 'c').replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.png`
    const result = await shareCardImage({ blob, dataUrl, fileName, text: shareText, url: unfurlUrl, dest })
    const msg = shareHint(result, dest)
    if (msg) {
      setHint(msg)
      // Clipboard/unfurl paths keep the modal open so the user can read the hint
      // and complete the post; native/download/cancel close as before.
      return
    }
    if (dest !== 'download') setTimeout(onClose, 400)
  }

  if (!mounted) return null

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(4,5,12,0.985)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '1.5rem 1.25rem 2.5rem', overflowY: 'auto' }}>
      <div style={{ width: '100%', maxWidth: 480 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: OC, textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 600 }}>Grade {grade} — {data.company}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', padding: '.2rem .4rem' }}>✕ close</button>
        </div>

        <div style={{ fontFamily: 'var(--display)', fontSize: '1.15rem', fontWeight: 800, color: '#fff', marginBottom: '.2rem', letterSpacing: '-.02em' }}>Your grade card is ready</div>
        <div style={{ fontFamily: 'var(--body)', fontSize: '.78rem', color: 'rgba(255,255,255,0.45)', marginBottom: '1.1rem', lineHeight: 1.6 }}>Share this company&apos;s hiring grade — help the next applicant know before they apply.</div>

        {dataUrl ? (
          <img src={dataUrl} alt="Grade card" style={{ width: '100%', borderRadius: 16, boxShadow: `0 24px 80px rgba(0,0,0,0.9), 0 0 60px ${OC}22`, marginBottom: '1rem', display: 'block' }} />
        ) : (
          <div style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: 16, background: '#0c0f1a', border: `1px solid ${OC}22`, marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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

        {hint && (
          <div role="status" style={{ display: 'flex', alignItems: 'center', gap: '.5rem', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.35)', color: '#a7f3d0', fontFamily: 'var(--body)', fontSize: '.72rem', lineHeight: 1.5, padding: '.6rem .75rem', borderRadius: 9, marginBottom: '.7rem' }}>
            <span style={{ flexShrink: 0 }}>📋</span>
            <span>{hint}</span>
          </div>
        )}

        <button onClick={onClose} style={{ background: 'none', border: 'none', width: '100%', fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'rgba(255,255,255,0.25)', cursor: 'pointer', padding: '.5rem', textAlign: 'center' }}>Skip</button>
      </div>
    </div>,
    document.body,
  )
}
