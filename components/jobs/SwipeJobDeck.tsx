'use client'

import { useState, useRef, useEffect } from 'react'
import { SavedJobsStore } from '@/lib/stores/SavedJobs'
import { useAuth } from '@/lib/auth'
import type { Job } from '@/lib/types'
import HiringProbability from '@/components/HiringProbability'
import { displayCompanyName } from '@/lib/companyDisplay'
import { displayPay } from '@/lib/jobs/pay.js'
import { roleSnippet, isDescriptionPreview } from '@/lib/jobs/descriptionText.js'
import { displayLocation } from '@/lib/jobs/displayLocation.js'
import ListingScoreRing from '@/components/jobs/ListingScoreRing'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import m from './SwipeJobDeck.module.css'

// ── SwipeJobDeck ──────────────────────────────────────────────────────────────

export default function SwipeJobDeck({ jobs, onOpen, onDismiss, onSave, onApply, coScores }: {
  jobs: Job[]
  onOpen: (job: Job) => void
  onDismiss: () => void
  onSave?: () => void
  onApply?: (job: Job) => void
  coScores?: Record<string, {ghost_rate: number; overall_score: number; response_rate?: number}>
}) {
  const [stack, setStack] = useState<Job[]>(() => [...jobs])
  const [deltaX, setDeltaX] = useState(0)
  const [deltaY, setDeltaY] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [flyDir, setFlyDir] = useState<'left' | 'right' | 'up' | null>(null)
  const [savedCount, setSavedCount] = useState(0)
  const startXRef = useRef(0)
  const startYRef = useRef(0)
  const deltaYRef = useRef(0)
  const hasMoved = useRef(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const { isLoggedIn } = useAuth()

  // Keep stack in sync when jobs prop changes (e.g. initial load)
  useEffect(() => { setStack([...jobs]) }, [jobs])

  const topJob = stack[0] ?? null
  const secondJob = stack[1] ?? null
  const thirdJob = stack[2] ?? null

  const badgeOpacity = Math.min(1, Math.abs(deltaX) / 80)
  const applyBadgeOpacity = Math.min(1, Math.abs(deltaY) / 80)
  const showLeft = deltaX < -40
  const showRight = deltaX > 40
  const showUp = deltaY < -30 && Math.abs(deltaX) < 80

  // Swipe-right is the "♡ Save" gesture — it must add to Saved Jobs (same as the
  // list-view heart), not create a tracker application. (Apply is the up-swipe.)
  function saveJob(job: Job) {
    SavedJobsStore.save(job, isLoggedIn)
  }

  function advance(dir: 'left' | 'right' | 'up') {
    if (!topJob) return
    if (dir === 'right') {
      saveJob(topJob)
      setSavedCount(c => c + 1)
      onSave?.()
    }
    if (dir === 'up') {
      onApply?.(topJob)
    }
    setFlyDir(dir)
    setTimeout(() => {
      setStack(prev => {
        const next = prev.slice(1)
        if (next.length === 0) onDismiss()
        return next
      })
      setFlyDir(null)
      setDeltaX(0)
      setDeltaY(0)
      deltaYRef.current = 0
      setIsDragging(false)
    }, 300)
  }

  function onPointerStart(clientX: number, clientY: number) {
    if (flyDir) return
    startXRef.current = clientX
    startYRef.current = clientY
    hasMoved.current = false
    setIsDragging(true)
    setDeltaX(0)
    setDeltaY(0)
    deltaYRef.current = 0
  }

  function onPointerMove(clientX: number, clientY: number) {
    if (!isDragging || flyDir) return
    const dx = clientX - startXRef.current
    const dy = clientY - startYRef.current
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) hasMoved.current = true
    setDeltaX(dx)
    setDeltaY(dy)
    deltaYRef.current = dy
  }

  function onPointerEnd() {
    if (!isDragging || flyDir) return
    if (!hasMoved.current && topJob) {
      setIsDragging(false)
      setDeltaX(0)
      setDeltaY(0)
      deltaYRef.current = 0
      onOpen(topJob)
      return
    }
    const dy = deltaYRef.current
    if (dy < -80 && Math.abs(deltaX) < 80) {
      advance('up')
    } else if (Math.abs(deltaX) > 80) {
      advance(deltaX > 0 ? 'right' : 'left')
    } else {
      if (cardRef.current) cardRef.current.classList.add('snap-back')
      setDeltaX(0)
      setDeltaY(0)
      deltaYRef.current = 0
      setIsDragging(false)
      setTimeout(() => {
        if (cardRef.current) cardRef.current.classList.remove('snap-back')
      }, 350)
    }
  }

  // Mouse event handlers
  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    onPointerStart(e.clientX, e.clientY)

    function onMouseMove(ev: MouseEvent) { onPointerMove(ev.clientX, ev.clientY) }
    function onMouseUp() {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      onPointerEnd()
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  // Touch event handlers
  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0]
    onPointerStart(t.clientX, t.clientY)
  }

  function onTouchMove(e: React.TouchEvent) {
    const t = e.touches[0]
    onPointerMove(t.clientX, t.clientY)
  }

  function onTouchEnd() { onPointerEnd() }

  if (stack.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '24px 16px', background: 'var(--surface-1)', border: '1px solid var(--border-2)', borderRadius: 'var(--r-card)' }}>
        <div className="ui-eyebrow" style={{ marginBottom: 8 }}>Deck cleared</div>
        <div className="tnum" style={{ fontFamily: 'var(--body)', fontSize: 'var(--fs-lead)', fontWeight: 600, color: 'var(--text-1)', letterSpacing: '-.02em', marginBottom: 4 }}>
          You matched {savedCount} job{savedCount !== 1 ? 's' : ''}
        </div>
        <div style={{ fontFamily: 'var(--body)', fontSize: 'var(--fs-sm)', color: 'var(--text-3)', marginBottom: 16 }}>
          Right-swiped jobs are in your Saved list
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Button size="sm" variant="secondary" href="/saved" iconRight="arrow-right">Open saved jobs</Button>
          <Button size="sm" variant="ghost" onClick={() => setStack([...jobs])} icon="refresh-cw">Replay deck</Button>
        </div>
      </div>
    )
  }

  // Top card transform
  let topTransform = ''
  let topOpacity = 1
  if (flyDir === 'left') {
    topTransform = 'translateX(-120%) rotate(-18deg)'
    topOpacity = 0
  } else if (flyDir === 'right') {
    topTransform = 'translateX(120%) rotate(18deg)'
    topOpacity = 0
  } else if (flyDir === 'up') {
    topTransform = 'translateY(-130%) scale(0.9)'
    topOpacity = 0
  } else if (isDragging) {
    topTransform = `translate(${deltaX}px, ${Math.min(0, deltaY)}px) rotate(${deltaX * 0.05}deg)`
  }

  // Second card scale animates toward 1.0 as user drags
  const dragProgress = Math.min(1, Math.abs(deltaX) / 80)
  const secondScale = 0.96 + dragProgress * 0.04
  const secondY = 8 - dragProgress * 8

  // The card is a plain surface (DESIGN.md §2): the score is the ring, never a glow, a tinted border or a
  // tinted avatar — a hue that existed nowhere else (design review 2026-11-02).
  const surface = { background: 'var(--surface-1)', border: '1px solid var(--border-2)', boxShadow: 'var(--sh-raised)' }

  return (
  <div>
    <div className={`swipe-deck ${m.deck}`} aria-label="Swipe job cards — drag right to save, left to pass">
      {/* Third peek card */}
      {thirdJob && (
        <div className="swipe-peek" style={{ transform: 'scale(0.92) translateY(16px)', transformOrigin: 'bottom center', zIndex: 1 }} />
      )}
      {/* Second peek card */}
      {secondJob && (
        <div className="swipe-peek" style={{ transform: `scale(${secondScale}) translateY(${secondY}px)`, transformOrigin: 'bottom center', zIndex: 2, transition: isDragging ? 'none' : 'transform .2s ease' }} />
      )}
      {/* Top card */}
      <div
        ref={cardRef}
        className="swipe-card"
        style={{
          transform: topTransform, opacity: topOpacity, zIndex: 3,
          transition: flyDir ? 'transform .3s ease, opacity .3s ease' : undefined,
          ...surface,
        }}
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* PASS badge */}
        <span className="swipe-badge swipe-badge-l" style={{ opacity: showLeft ? badgeOpacity : 0 }}>✕ Pass</span>
        {/* SAVE badge */}
        <span className="swipe-badge swipe-badge-r" style={{ opacity: showRight ? badgeOpacity : 0 }}>♡ Save</span>
        {/* APPLY badge (up swipe) */}
        <span style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          fontFamily: 'var(--body)', fontSize: 'var(--fs-meta)', fontWeight: 600,
          color: 'var(--accent)', background: 'var(--accent-tint)',
          border: '1px solid var(--accent-line)', borderRadius: 'var(--r-chip)',
          padding: '.25rem .75rem', pointerEvents: 'none',
          opacity: showUp ? applyBadgeOpacity : 0, transition: 'opacity .1s',
        }}>↑ Apply Now</span>

        {/* Card content */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.75rem', marginBottom: '.5rem' }}>
          <div style={{
            width: 40, height: 40, borderRadius: 'var(--r-control)',
            background: 'var(--surface-2)', border: '1px solid var(--border-2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--body)', fontWeight: 600, fontSize: 'var(--fs-ui)',
            color: 'var(--text-2)', flexShrink: 0,
          }}>
            {(displayCompanyName(topJob.company) || '?')[0].toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--body)', fontSize: 'var(--fs-body)', fontWeight: 600, color: 'var(--text-1)', letterSpacing: '-.02em', lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{topJob.title}</div>
            <div style={{ fontFamily: 'var(--body)', fontSize: 'var(--fs-sm)', color: 'var(--text-3)', marginTop: 2 }}>{displayCompanyName(topJob.company)}{topJob.location ? ` · ${displayLocation(topJob.location)}` : ''}</div>
          </div>
          <ListingScoreRing score={topJob.score} size={40} />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.25rem', marginBottom: '.5rem' }}>
          {[displayPay(topJob), topJob.type, topJob.level].filter(Boolean).map(f => (
            <span key={String(f)} className="tnum" style={{ border: '1px solid var(--border-2)', borderRadius: 'var(--r-chip)', padding: '4px 8px', fontSize: 'var(--fs-sm)', fontFamily: 'var(--body)', color: 'var(--text-2)' }}>{f}</span>
          ))}
        </div>

        {/* The first thing the posting says about the ROLE — not the employer's mission paragraph
            that 302 SpaceX rows share (lib/jobs/descriptionText.js roleSnippet). */}
        {topJob.description && (
          <div className={m.excerpt}>
            {roleSnippet(topJob.description, topJob.company, topJob.title, 440)}
            {isDescriptionPreview(topJob) && <span style={{ color: 'var(--text-4)' }}> (preview — full posting on the employer&apos;s site)</span>}
          </div>
        )}

        {(() => {
          const sc = coScores?.[topJob.company.toLowerCase()]
          if (!sc || sc.ghost_rate <= 0.3) return null
          const ghostPct = Math.round(sc.ghost_rate * 100)
          const isHigh = sc.ghost_rate > 0.55
          return (
            <div style={{ marginTop: '.5rem', display: 'flex', alignItems: 'center', gap: '.25rem' }}>
              <span className="tnum" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'var(--body)', fontSize: 'var(--fs-sm)', color: isHigh ? 'var(--bad-text)' : 'var(--caution-text)', background: isHigh ? 'var(--bad-tint)' : 'var(--caution-tint)', border: `1px solid ${isHigh ? 'var(--bad-line)' : 'var(--caution-line)'}`, borderRadius: 'var(--r-chip)', padding: '2px 8px' }}>
                <Icon name={isHigh ? 'ghost' : 'triangle-alert'} size={12} /> {ghostPct}% of applicants never hear back
              </span>
            </div>
          )
        })()}

        {(() => {
          const sc = coScores?.[topJob.company.toLowerCase()]
          if (!sc) return null
          return (
            <HiringProbability
              responseRate={sc.response_rate ?? null}
              ghostRate={sc.ghost_rate ?? null}
              jobLevel={topJob.level}
              compact
            />
          )
        })()}

        <div style={{ position: 'absolute', bottom: '1rem', left: '1.25rem', right: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontFamily: 'var(--body)', fontSize: 'var(--fs-meta)', color: 'var(--text-3)' }}>{topJob.source || 'Job board'}</span>
          <span className="tnum" style={{ fontFamily: 'var(--body)', fontSize: 'var(--fs-meta)', color: 'var(--text-3)' }}>{stack.length} left{savedCount > 0 ? ` · ♡ ${savedCount} saved` : ''}</span>
        </div>
      </div>
    </div>

    {/* Action buttons: Skip · Apply · Save — outlined, the accent on Apply only (SwipeJobDeck.module.css). */}
    <div className={m.actions}>
      <button type="button" onClick={() => advance('left')} title="Skip" aria-label="Skip" className={m.btn}>✕</button>
      <button type="button" onClick={() => advance('up')} title="Apply now" aria-label="Apply now" className={`${m.btn} ${m.btnMain}`}>↑</button>
      <button type="button" onClick={() => advance('right')} title="Save" aria-label="Save" className={m.btn}>♡</button>
    </div>
    <div className={m.hint}>drag or tap the buttons to decide</div>
  </div>
  )
}
