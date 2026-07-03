'use client'

import { useState, useRef, useEffect } from 'react'
import { SavedJobsStore } from '@/lib/stores/SavedJobs'
import { useAuth } from '@/lib/auth'
import type { Job } from '@/lib/types'
import HiringProbability from '@/components/HiringProbability'

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
      <div style={{ textAlign: 'center', padding: '1.5rem 1rem', background: 'rgba(99,102,241,.06)', border: '1px solid rgba(99,102,241,.18)', borderRadius: 14 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '.4rem' }}>Deck cleared</div>
        <div style={{ fontFamily: 'var(--display)', fontSize: '1rem', fontWeight: 700, color: 'var(--white)', letterSpacing: '-.02em', marginBottom: '.3rem' }}>
          You matched {savedCount} job{savedCount !== 1 ? 's' : ''}
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--sub)', marginBottom: '1rem' }}>
          Saved applications are in your tracker
        </div>
        <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <a href="/resume" style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', padding: '.35rem .8rem', background: 'rgba(99,102,241,.15)', border: '1px solid rgba(99,102,241,.35)', borderRadius: 7, color: 'var(--indigo)', textDecoration: 'none' }}>See all matches →</a>
          <button onClick={() => setStack([...jobs])} style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', padding: '.35rem .8rem', background: 'none', border: '1px solid var(--line2)', borderRadius: 7, color: 'var(--dim)', cursor: 'pointer' }}>Replay deck</button>
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

  const scoreRisk = (score: number | null): 'safe' | 'warn' | 'danger' | 'unrated' =>
    score == null ? 'unrated' : score >= 75 ? 'safe' : score >= 50 ? 'warn' : 'danger'
  const scoreColor = (score: number | null) => score == null ? 'var(--dim)' : score >= 75 ? 'var(--green)' : score >= 50 ? 'var(--amber)' : 'var(--red)'
  // Continuous HSL scale: 25→0° (red), 60→60° (yellow), 95→120° (green).
  // A null (unrated) listing gets a neutral desaturated gray — never a colored verdict.
  const scoreHsl = (score: number | null, alpha: number) => {
    if (score == null) return `hsla(0, 0%, 45%, ${alpha})`
    const t = Math.max(0, Math.min(1, (score - 25) / 70))
    const hue = Math.round(t * 120)
    return `hsla(${hue}, 80%, 55%, ${alpha})`
  }
  const scoreGradient = (score: number | null) =>
    `linear-gradient(145deg, ${scoreHsl(score, .15)} 0%, transparent 60%)`
  const scoreBorder = (score: number | null) => scoreHsl(score, .45)
  const scoreGlow = (score: number | null) => scoreHsl(score, .2)
  const scoreStripe = (score: number | null) => scoreHsl(score, .75)

  return (
  <div>
    <div className="swipe-deck" aria-label="Swipe job cards — drag right to save, left to pass" style={{ height: 340 }}>
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
          background: scoreGradient(topJob.score),
          borderColor: scoreBorder(topJob.score),
          boxShadow: `0 8px 32px rgba(0,0,0,.45), 0 0 48px ${scoreGlow(topJob.score)}, inset 0 2px 0 ${scoreStripe(topJob.score)}, inset 0 1px 0 rgba(255,255,255,.08)`,
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
          fontFamily: 'var(--mono)', fontSize: '.75rem', fontWeight: 700,
          color: 'var(--blue)', background: 'rgba(59,130,246,.15)',
          border: '1.5px solid rgba(59,130,246,.5)', borderRadius: 7,
          padding: '.3rem .7rem', pointerEvents: 'none',
          opacity: showUp ? applyBadgeOpacity : 0, transition: 'opacity .1s',
        }}>↑ Apply Now</span>

        {/* Card content */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.75rem', marginBottom: '.6rem' }}>
          <div style={{
            width: 42, height: 42, borderRadius: 10,
            background: `linear-gradient(135deg, ${scoreHsl(topJob.score, .25)}, rgba(255,255,255,.06))`,
            border: `1px solid ${scoreBorder(topJob.score)}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--display)', fontWeight: 800, fontSize: '1.05rem',
            color: scoreHsl(topJob.score, 1), flexShrink: 0,
          }}>
            {(topJob.company || '?')[0].toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--display)', fontSize: '.92rem', fontWeight: 700, color: 'var(--white)', letterSpacing: '-.02em', lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{topJob.title}</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', marginTop: '.12rem' }}>{topJob.company}{topJob.location ? ` · ${topJob.location}` : ''}</div>
          </div>
          <div className={`sring ${scoreRisk(topJob.score)}`} style={{ width: 40, height: 40, flexShrink: 0 }} title={topJob.score == null ? 'Not enough signal in this listing to score it' : undefined}>
            <div className="sring-n" style={{ fontSize: '.8rem' }}>{topJob.score ?? '–'}</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem', marginBottom: '.55rem' }}>
          {topJob.salary && <span style={{ background: 'rgba(16,185,129,.12)', border: '1px solid rgba(16,185,129,.3)', borderRadius: 5, padding: '.17rem .5rem', fontSize: '.6rem', fontFamily: 'var(--mono)', color: 'var(--green)', fontWeight: 600 }}>{topJob.salary}</span>}
          {topJob.type && <span style={{ background: 'rgba(99,102,241,.1)', border: '1px solid rgba(99,102,241,.25)', borderRadius: 5, padding: '.17rem .5rem', fontSize: '.6rem', fontFamily: 'var(--mono)', color: '#a5b4fc' }}>{topJob.type}</span>}
          {topJob.level && <span style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 5, padding: '.17rem .5rem', fontSize: '.6rem', fontFamily: 'var(--mono)', color: 'var(--sub)' }}>{topJob.level}</span>}
        </div>

        {topJob.description && (
          <div style={{ fontFamily: 'var(--body)', fontSize: '.7rem', color: 'var(--muted)', lineHeight: 1.55, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {topJob.description}
          </div>
        )}

        {(() => {
          const sc = coScores?.[topJob.company.toLowerCase()]
          if (!sc || sc.ghost_rate <= 0.3) return null
          const ghostPct = Math.round(sc.ghost_rate * 100)
          const isHigh = sc.ghost_rate > 0.55
          return (
            <div style={{ marginTop: '.45rem', display: 'flex', alignItems: 'center', gap: '.3rem' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: isHigh ? 'var(--red)' : 'var(--amber)', background: isHigh ? 'rgba(239,68,68,.1)' : 'rgba(245,158,11,.1)', border: `1px solid ${isHigh ? 'rgba(239,68,68,.25)' : 'rgba(245,158,11,.25)'}`, borderRadius: 5, padding: '.12rem .4rem' }}>
                {isHigh ? '👻' : '⚠'} {ghostPct}% of applicants never hear back
              </span>
            </div>
          )
        })()}

        {(() => {
          const sc = coScores?.[topJob.company.toLowerCase()]
          if (!sc) return null
          return (
            <HiringProbability
              responseRate={sc.response_rate ?? (sc.overall_score ? sc.overall_score / 100 * 0.45 : 0.20)}
              ghostRate={sc.ghost_rate || 0.55}
              jobLevel={topJob.level}
              compact
            />
          )
        })()}

        <div style={{ position: 'absolute', bottom: '.9rem', left: '1.15rem', right: '1.15rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)' }}>{topJob.source || 'Job board'}</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--dim)' }}>{stack.length} left{savedCount > 0 ? ` · ♡ ${savedCount} saved` : ''}</span>
        </div>
      </div>
    </div>

    {/* Action buttons */}
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '1rem' }}>
      <button
        onClick={() => advance('left')}
        title="Skip"
        style={{ width: 50, height: 50, borderRadius: '50%', border: '1px solid var(--line2)', background: 'var(--card)', color: 'var(--dim)', fontSize: '1.1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)' }}
      >✕</button>
      <button
        onClick={() => advance('up')}
        title="Apply now"
        style={{ width: 62, height: 62, borderRadius: '50%', border: '1px solid rgba(59,130,246,.45)', background: 'rgba(59,130,246,.12)', color: 'var(--blue)', fontSize: '1.35rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}
      >↑</button>
      <button
        onClick={() => advance('right')}
        title="Save"
        style={{ width: 50, height: 50, borderRadius: '50%', border: '1px solid rgba(16,185,129,.45)', background: 'rgba(16,185,129,.12)', color: 'var(--green)', fontSize: '1.1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >♡</button>
    </div>
    <div style={{ textAlign: 'center', marginTop: '.4rem', fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)', letterSpacing: '.04em' }}>
      drag or tap the buttons to decide
    </div>
  </div>
  )
}
