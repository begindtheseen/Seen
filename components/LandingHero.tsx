'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { RecentSearchesStore } from '@/lib/stores/RecentSearches'

const HERO_LINES: [string, string][] = [
  ['know before',        'you apply.'],
  ['does this company',  'actually respond?'],
  ['see who ghosts.',    'see who hires.'],
  ['check the score.',   'skip the waste.'],
  ['your time matters.', 'spend it wisely.'],
  ['the hiring data',    'companies hide.'],
  ['stop guessing.',     'start knowing.'],
  ['47,000+ companies.', 'all scored. free.'],
]

const JOB_KEYWORDS = ['engineer', 'developer', 'manager', 'analyst', 'designer', 'nurse', 'coordinator', 'specialist', 'director', 'associate', 'assistant', 'recruiter', 'sales', 'marketing', 'accountant', 'therapist', 'technician']

const QUICK_TAGS = [
  { label: 'Amazon', loc: 'Seattle, WA', grade: 'F', cls: 'danger' },
  { label: 'Stripe', loc: '', grade: 'A', cls: 'safe' },
  { label: 'Meta', loc: 'Menlo Park, CA', grade: 'F', cls: 'danger' },
]

const WORD_POOL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')

// Build word spans for line 1 — alternating in-l / in-r per word
function buildWordSpans(text: string, staggerStep: number): React.ReactNode[] {
  const parts = text.split(/(\s+)/)
  let wordIdx = 0
  return parts.map((part, i) => {
    if (!part) return null
    const isSpace = /^\s+$/.test(part)
    if (isSpace) {
      return <span key={i} className="hw" style={{ opacity: 1 }}>{part}</span>
    }
    const dir = wordIdx % 2 === 0 ? 'in-l' : 'in-r'
    const delay = (wordIdx * staggerStep).toFixed(0)
    wordIdx++
    return <span key={i} className={`hw ${dir}`} style={{ animationDelay: `${delay}ms` }}>{part}</span>
  })
}

type Phase = 'idle' | 'exiting' | 'entering'

export default function LandingHero() {
  const router = useRouter()
  const [heroIdx, setHeroIdx] = useState(0)
  const [query, setQuery] = useState('')
  const [location, setLocation] = useState('')
  const [recentSearches, setRecentSearches] = useState<Array<{ name: string; loc?: string }>>([])

  // Animation state
  const [phase, setPhase] = useState<Phase>('entering')
  // line1Words tracks the currently-rendered word spans (so we can animate them out)
  const [line1Nodes, setLine1Nodes] = useState<React.ReactNode[]>(() => buildWordSpans(HERO_LINES[0][0], 70))
  // line2Content is the text displayed in line 2 (updated after exit animation)
  const [line2Idx, setLine2Idx] = useState(0)
  // swept state for heroSweep shimmer
  const [swept, setSwept] = useState(false)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const decodeRafRef = useRef<number | null>(null)
  const heroIdxRef = useRef(0)
  const line2Ref = useRef<HTMLSpanElement>(null)
  const reducedMotion = useRef(false)

  // Decode line2 using rAF slot-machine animation
  const decodeLine2 = useCallback((text: string, abbreviated: boolean, onDone?: () => void) => {
    const el = line2Ref.current
    if (!el) { onDone?.(); return }

    // Cancel any running decode
    if (decodeRafRef.current !== null) {
      cancelAnimationFrame(decodeRafRef.current)
      decodeRafRef.current = null
    }

    const LOCK_CADENCE = abbreviated ? 30 : 45
    const chars = text.split('')

    // Build span elements inside the DOM node directly (imperative for rAF perf)
    el.textContent = ''
    const items: { span: HTMLSpanElement; target: string; locked: boolean; lockAt: number }[] = chars.map((ch) => {
      const span = document.createElement('span')
      span.style.cssText = 'display:inline-block;white-space:pre'
      const isSpace = ch === ' '
      if (isSpace) {
        span.textContent = ' '
      } else {
        span.textContent = WORD_POOL[Math.floor(Math.random() * WORD_POOL.length)]
        span.style.webkitTextFillColor = 'rgba(196,181,253,.55)'
      }
      el.appendChild(span)
      return { span, target: ch, locked: isSpace, lockAt: isSpace ? 0 : chars.indexOf(ch) * LOCK_CADENCE }
    })

    // Recalculate lockAt properly (indexOf is wrong for repeated chars) — rebuild
    let charWordIdx = 0
    chars.forEach((ch, i) => {
      if (ch !== ' ') {
        items[i].lockAt = charWordIdx * LOCK_CADENCE
        charWordIdx++
      }
    })

    let t0: number | null = null
    let lastCycleIdx = -1

    function tick(ts: number) {
      if (!t0) t0 = ts
      const elapsed = ts - t0
      const cycleIdx = Math.floor(elapsed / 50)
      if (cycleIdx !== lastCycleIdx) {
        lastCycleIdx = cycleIdx
        items.forEach(item => {
          if (item.locked) return
          if (elapsed >= item.lockAt) {
            item.locked = true
            item.span.textContent = item.target
            item.span.style.webkitTextFillColor = '#10b981'
            item.span.style.textShadow = '0 0 18px rgba(16,185,129,.6)'
            setTimeout(() => {
              item.span.style.webkitTextFillColor = ''
              item.span.style.textShadow = ''
            }, 80)
          } else {
            item.span.textContent = WORD_POOL[Math.floor(Math.random() * WORD_POOL.length)]
          }
        })
      }
      if (items.every(it => it.locked)) {
        decodeRafRef.current = null
        if (onDone) setTimeout(onDone, 80)
      } else {
        decodeRafRef.current = requestAnimationFrame(tick)
      }
    }
    decodeRafRef.current = requestAnimationFrame(tick)
  }, [])

  // Animate line1 words out (they keep their in-l/in-r direction for exit)
  const exitLine1 = useCallback((line1El: HTMLElement) => {
    const words = line1El.querySelectorAll<HTMLElement>('.hw:not([style*="opacity: 1"]):not([style*="opacity:1"])')
    words.forEach((w, i) => {
      const isRight = w.classList.contains('in-r')
      w.style.setProperty('--exit-dir', isRight ? '.4em' : '-.4em')
      w.style.animationDelay = `${i * 40}ms`
      w.classList.remove('in-l', 'in-r')
      w.classList.add('out')
    })
  }, [])

  const line1Ref = useRef<HTMLSpanElement>(null)

  // Trigger a rotation: exit → swap content → enter
  const doRotation = useCallback(() => {
    if (reducedMotion.current) {
      // Simplified fallback for prefers-reduced-motion
      const nextIdx = (heroIdxRef.current + 1) % HERO_LINES.length
      heroIdxRef.current = nextIdx
      setHeroIdx(nextIdx)
      setLine1Nodes(buildWordSpans(HERO_LINES[nextIdx][0], 55))
      setLine2Idx(nextIdx)
      return
    }

    setPhase('exiting')
    // Exit line1 words
    if (line1Ref.current) {
      exitLine1(line1Ref.current)
    }
    // Fade out line2
    if (line2Ref.current) {
      line2Ref.current.style.transition = 'opacity .2s ease'
      line2Ref.current.style.opacity = '0'
    }

    setTimeout(() => {
      const nextIdx = (heroIdxRef.current + 1) % HERO_LINES.length
      heroIdxRef.current = nextIdx
      setHeroIdx(nextIdx)

      // Reset line2 opacity then decode new text
      if (line2Ref.current) {
        line2Ref.current.style.transition = ''
        line2Ref.current.style.opacity = ''
      }

      // Set new line1 nodes
      setLine1Nodes(buildWordSpans(HERO_LINES[nextIdx][0], 55))
      setPhase('entering')

      // Decode new line2
      decodeLine2(HERO_LINES[nextIdx][1], true, undefined)
    }, 240)
  }, [exitLine1, decodeLine2])

  // Initial mount: run intro animation sequence
  useEffect(() => {
    reducedMotion.current = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false

    if (reducedMotion.current) {
      // Simple rotation without word-slam
      timerRef.current = setInterval(doRotation, 4800)
      return () => { if (timerRef.current) clearInterval(timerRef.current) }
    }

    setRecentSearches(RecentSearchesStore.get())

    // Build initial line1
    setLine1Nodes(buildWordSpans(HERO_LINES[0][0], 70))
    setPhase('entering')

    // After last line1 word stagger, start line2 decode
    const line1Words = HERO_LINES[0][0].trim().split(/\s+/).length
    const decodeDelay = line1Words * 70 + 120

    const decodeTimeout = setTimeout(() => {
      decodeLine2(HERO_LINES[0][1], false, () => {
        // Shimmer sweep after first decode
        setSwept(true)
        setTimeout(() => setSwept(false), 750)

        // Start rotation cycle
        clearInterval(timerRef.current ?? undefined)
        timerRef.current = setInterval(doRotation, 4800)
      })
    }, decodeDelay)

    return () => {
      clearTimeout(decodeTimeout)
      if (timerRef.current) clearInterval(timerRef.current)
      if (decodeRafRef.current !== null) cancelAnimationFrame(decodeRafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep recentSearches in sync (separate from animation effect)
  useEffect(() => {
    setRecentSearches(RecentSearchesStore.get())
  }, [])

  const doSearch = useCallback(() => {
    const q = query.trim()
    const l = location.trim()
    if (!q) return
    const isJobSearch = JOB_KEYWORDS.some(k => q.toLowerCase().includes(k)) || (q.split(' ').length > 1 && !!l)
    if (isJobSearch) {
      router.push(`/jobs?q=${encodeURIComponent(q)}&loc=${encodeURIComponent(l)}`)
    } else {
      RecentSearchesStore.push(q, l)
      setRecentSearches(RecentSearchesStore.get())
      router.push(`/company/${encodeURIComponent(q.toLowerCase().replace(/\s+/g, '-'))}`)
    }
  }, [query, location, router])

  const quickSearch = (name: string, loc: string) => {
    RecentSearchesStore.push(name, loc)
    setRecentSearches(RecentSearchesStore.get())
    router.push(`/company/${encodeURIComponent(name.toLowerCase().replace(/\s+/g, '-'))}`)
  }

  // Suppress unused variable warning — heroIdx used to key renders
  void heroIdx
  void phase
  void line2Idx

  return (
    <div style={{ position: 'relative', zIndex: 2, flex: 1, display: 'flex', alignItems: 'center', overflow: 'hidden', padding: '2rem 0 1rem' }}>
      <div className="l-grid">

        {/* LEFT COLUMN */}
        <div style={{ containerType: 'inline-size' }}>
          {/* Kicker pill */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', color: 'var(--blue)', fontFamily: 'var(--mono)', fontSize: '.63rem', padding: '.25rem .85rem', borderRadius: 100, marginBottom: '1.75rem', animation: 'fadeUp .5s ease both' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--blue)', animation: 'pulse 2s infinite', display: 'inline-block' }} />
            47,000+ companies scored · updated live
          </div>

          {/* Rotating headline */}
          <div style={{ animation: 'fadeUp .5s .06s ease both' }}>
            <div
              id="rotatingHero"
              className={swept ? 'swept' : ''}
              style={{ height: 'clamp(92px,13vw,150px)', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start', overflow: 'hidden' }}
            >
              <h1 style={{ fontFamily: 'var(--display)', fontSize: 'clamp(1.7rem,9.6cqw,3.9rem)', fontWeight: 800, lineHeight: 1.06, letterSpacing: '-.04em', color: 'var(--white)', margin: 0, width: '100%', textAlign: 'left' }}>
                {/* Line 1: word-slam animated spans */}
                <span
                  ref={line1Ref}
                  id="heroLine1"
                  style={{ display: 'block', whiteSpace: 'nowrap' }}
                >
                  {line1Nodes}
                </span>
                {/* Line 2: slot-machine decode (managed imperatively via ref) */}
                <span
                  ref={line2Ref}
                  id="heroLine2"
                  className="grad-text"
                  style={{ display: 'block', whiteSpace: 'nowrap', fontStyle: 'italic' }}
                />
              </h1>
            </div>
          </div>

          {/* Stat strip */}
          <div className="hstat-strip">
            <div><span className="hstat-n">47K+</span><div className="hstat-l">Companies scored</div></div>
            <div className="hstat-div" />
            <div><span className="hstat-n">124K+</span><div className="hstat-l">Real reports</div></div>
            <div className="hstat-div" />
            <div><span className="hstat-n" style={{ color: 'var(--red)' }}>47%</span><div className="hstat-l">Avg ghost rate</div></div>
            <div className="hstat-div" />
            <div><span className="hstat-n" style={{ color: 'var(--green)' }}>Free</span><div className="hstat-l">Forever</div></div>
          </div>

          {/* Search */}
          <div style={{ marginBottom: '1rem', animation: 'fadeUp .5s .18s ease both', position: 'relative' }}>
            <div className="search-wrap">
              <div className="search-row">
                <div className="search-field">
                  <span className="search-field-icon">🔍</span>
                  <input
                    className="search-inp"
                    type="text"
                    placeholder="Company or job title..."
                    autoComplete="off"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && doSearch()}
                  />
                </div>
                <div className="search-loc-row" style={{ display: 'flex', flex: '0 0 auto' }}>
                  <div className="search-loc">
                    <span style={{ color: 'var(--muted)', fontSize: '.8rem', flexShrink: 0 }}>📍</span>
                    <input
                      className="loc-inp"
                      type="text"
                      placeholder="City or zip"
                      autoComplete="off"
                      value={location}
                      onChange={e => setLocation(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && doSearch()}
                    />
                  </div>
                  <button className="search-btn" onClick={doSearch}>Check →</button>
                </div>
              </div>
            </div>
          </div>

          {/* Recent searches */}
          {recentSearches.length > 0 && (
            <div style={{ display: 'block', marginBottom: '.55rem', animation: 'fadeUp .5s .2s ease both' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'rgba(255,255,255,.25)', marginBottom: '.35rem' }}>Recent</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
                {recentSearches.map((r, i) => (
                  <button key={i} className="qtag" style={{ fontSize: '.58rem', padding: '.2rem .55rem', opacity: .75 }} onClick={() => quickSearch(r.name, r.loc || '')}>
                    ↩ {r.name}{r.loc ? ` · ${r.loc}` : ''}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Quick tags */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginBottom: '1.6rem', flexWrap: 'wrap', animation: 'fadeUp .5s .22s ease both' }}>
            {QUICK_TAGS.map(t => (
              <button key={t.label} className="vtag" onClick={() => quickSearch(t.label, t.loc)}>
                {t.label} <span className={`vtag-grade ${t.cls}`}>{t.grade}</span>
              </button>
            ))}
          </div>

          {/* CTAs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', animation: 'fadeUp .5s .28s ease both' }}>
            <button className="btn btn-green btn-lg" onClick={() => router.push('/login')} style={{ fontSize: '.88rem', padding: '.78rem 1.85rem' }}>
              Protect your job search →
            </button>
            <button onClick={() => router.push('/jobs')} style={{ background: 'none', border: 'none', fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'rgba(255,255,255,.38)', cursor: 'pointer', padding: '.2rem 0', transition: 'color .15s', letterSpacing: '.02em' }}>
              browse jobs →
            </button>
          </div>
        </div>

        {/* RIGHT COLUMN — verdict feed */}
        <div className="vfeed-panel" style={{ animation: 'fadeUp .6s .3s ease both' }}>
          <VerdictFeed />
        </div>

      </div>
    </div>
  )
}

function VerdictFeed() {
  const [clock, setClock] = useState('')
  const [verdicts] = useState([
    { company: 'Stripe', score: 91, risk: 'safe', reports: 2847 },
    { company: 'Amazon', score: 18, risk: 'danger', reports: 15203 },
    { company: 'Linear', score: 88, risk: 'safe', reports: 412 },
    { company: 'Deloitte', score: 34, risk: 'danger', reports: 6721 },
    { company: 'Shopify', score: 79, risk: 'safe', reports: 1893 },
  ])

  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setClock(now.toUTCString().split(' ').slice(4).join(' ').split(' ')[0] + ' UTC')
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="vfeed-inner">
      <div className="vfeed-hdr">
        <div className="vfeed-hdr-l">
          <span className="vfeed-live" />
          Recent verdicts
        </div>
        <div className="vfeed-clock">{clock}</div>
      </div>
      <div className="vfeed-list">
        {verdicts.map((v, i) => (
          <div key={i} className="vfeed-row">
            <div className="vfeed-co">{v.company}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexShrink: 0 }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', fontWeight: 600, color: v.risk === 'safe' ? 'var(--green)' : v.risk === 'warn' ? 'var(--amber)' : 'var(--red)' }}>{v.score}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)' }}>{v.reports.toLocaleString()} reports</span>
            </div>
          </div>
        ))}
      </div>
      <div className="vfeed-foot">Updated from community reports</div>
    </div>
  )
}
