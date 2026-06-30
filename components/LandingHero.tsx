'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { RecentSearchesStore } from '@/lib/stores/RecentSearches'
import { useAuth } from '@/lib/auth'
import { AppStore } from '@/lib/stores/AppStore'

const HERO_LINES: [string, string][] = [
  ["it's not you.",        "they ghost everyone."],
  ["1 in 2 companies",     "never respond."],
  ["they know everything.", "now so do you."],
  ["before you apply,",    "check if they reply."],
  ["not all companies",    "deserve your time."],
  ["124,000 outcomes.",    "zero guesswork."],
  ["see who hires.",       "expose who ghosts."],
  ["applying blind",       "is over."],
]

const JOB_KEYWORDS = ['engineer', 'developer', 'manager', 'analyst', 'designer', 'nurse', 'coordinator', 'specialist', 'director', 'associate', 'assistant', 'recruiter', 'sales', 'marketing', 'accountant', 'therapist', 'technician']

const MAJOR_COMPANIES = [
  'Google', 'Amazon', 'Apple', 'Microsoft', 'Meta', 'Netflix', 'Tesla', 'Uber', 'Lyft', 'Airbnb',
  'Stripe', 'Linear', 'Figma', 'Notion', 'Shopify', 'Salesforce', 'Oracle', 'IBM', 'Coinbase', 'Vercel',
  'Twitter', 'LinkedIn', 'Snap', 'Pinterest', 'Reddit', 'Spotify', 'Dropbox', 'Twilio', 'Datadog', 'Atlassian',
  'Adobe', 'Intuit', 'PayPal', 'Square', 'Robinhood', 'DoorDash', 'Instacart', 'Grubhub', 'Peloton', 'Zoom',
  'Slack', 'HubSpot', 'Zendesk', 'ServiceNow', 'Workday', 'Okta', 'Cloudflare', 'Snowflake', 'MongoDB', 'Palantir',
]

const US_CITIES = [
  'New York, NY', 'Los Angeles, CA', 'Chicago, IL', 'Houston, TX', 'Phoenix, AZ',
  'Philadelphia, PA', 'San Antonio, TX', 'San Diego, CA', 'Dallas, TX', 'San Jose, CA',
  'Austin, TX', 'Seattle, WA', 'Denver, CO', 'Boston, MA', 'Atlanta, GA',
  'Miami, FL', 'Portland, OR', 'Las Vegas, NV', 'Minneapolis, MN', 'Nashville, TN',
  'San Francisco, CA', 'Washington, DC', 'Baltimore, MD', 'Charlotte, NC', 'Raleigh, NC',
  'Pittsburgh, PA', 'Detroit, MI', 'Sacramento, CA', 'Salt Lake City, UT', 'New Orleans, LA',
]

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
  const { isLoggedIn } = useAuth()
  const [heroIdx, setHeroIdx] = useState(0)
  const [query, setQuery] = useState('')
  const [location, setLocation] = useState('')
  const [recentSearches, setRecentSearches] = useState<Array<{ name: string; loc?: string }>>([])
  const [userStats, setUserStats] = useState<{ active: number; ghosted: number; avgScore: number } | null>(null)

  // Company autocomplete state (T1-11)
  const [companySuggs, setCompanySuggs] = useState<string[]>([])
  const [showCompSuggs, setShowCompSuggs] = useState(false)

  // Location autocomplete state (T1-12)
  const [locSuggs, setLocSuggs] = useState<string[]>([])
  const [showLocSuggs, setShowLocSuggs] = useState(false)

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

    if (decodeRafRef.current !== null) {
      cancelAnimationFrame(decodeRafRef.current)
      decodeRafRef.current = null
    }

    const LOCK_CADENCE = abbreviated ? 30 : 45
    el.textContent = ''

    // Split into word and space tokens. Each word gets an inline-block wrapper so the
    // browser breaks lines only between words, never mid-character during the animation.
    const items: { span: HTMLSpanElement; target: string; locked: boolean; lockAt: number }[] = []
    let charIdx = 0
    text.split(/(\s+)/).forEach(token => {
      if (!token) return
      if (/^\s/.test(token)) {
        const sp = document.createElement('span')
        sp.style.cssText = 'display:inline;white-space:pre'
        sp.textContent = token
        el.appendChild(sp)
        items.push({ span: sp, target: token, locked: true, lockAt: 0 })
      } else {
        const wordEl = document.createElement('span')
        wordEl.style.cssText = 'display:inline-block;white-space:nowrap'
        el.appendChild(wordEl)
        token.split('').forEach(ch => {
          const sp = document.createElement('span')
          sp.style.cssText = 'display:inline-block;white-space:pre'
          sp.textContent = WORD_POOL[Math.floor(Math.random() * WORD_POOL.length)]
          sp.style.webkitTextFillColor = 'rgba(196,181,253,.55)'
          wordEl.appendChild(sp)
          items.push({ span: sp, target: ch, locked: false, lockAt: charIdx++ * LOCK_CADENCE })
        })
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

  // Load personalized stats from AppStore on mount
  useEffect(() => {
    try {
      const apps = AppStore.loadSync()
      if (!apps.length) return
      const active = apps.filter(a => a.status === 'active').length
      const ghosted = apps.filter(a => a.status === 'ghosted').length
      const scores = apps.map(a => (a as { score?: number }).score).filter((s): s is number => typeof s === 'number')
      const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0
      setUserStats({ active, ghosted, avgScore })
    } catch {}
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

  // Handle query change — update company suggestions (T1-11)
  const handleQueryChange = (val: string) => {
    setQuery(val)
    if (val.trim().length >= 2) {
      const lower = val.trim().toLowerCase()
      const isJobKw = JOB_KEYWORDS.some(k => lower.includes(k))
      if (!isJobKw) {
        const matches = MAJOR_COMPANIES.filter(c =>
          c.toLowerCase().startsWith(lower) || c.toLowerCase().includes(lower)
        )
        setCompanySuggs(matches)
        setShowCompSuggs(matches.length > 0)
      } else {
        setShowCompSuggs(false)
      }
    } else {
      setShowCompSuggs(false)
    }
  }

  // Handle location change — update city suggestions (T1-12)
  const handleLocationChange = (val: string) => {
    setLocation(val)
    if (val.trim().length >= 2) {
      const lower = val.trim().toLowerCase()
      const matches = US_CITIES.filter(c =>
        c.toLowerCase().startsWith(lower) || c.toLowerCase().includes(lower)
      )
      setLocSuggs(matches)
      setShowLocSuggs(matches.length > 0)
    } else {
      setShowLocSuggs(false)
    }
  }

  // Suppress unused variable warning — heroIdx used to key renders
  void heroIdx
  void phase
  void line2Idx

  return (
    <div style={{ position: 'relative', zIndex: 2, flex: 1, display: 'flex', alignItems: 'center', overflow: 'hidden', padding: '2rem 0 1rem' }}>
      <div className="l-grid">

        {/* LEFT COLUMN */}
        <div className="hero-left" style={{ containerType: 'inline-size' }}>
          {/* Kicker pill */}
          <div className="hl-pill" style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', color: 'var(--blue)', fontFamily: 'var(--mono)', fontSize: '.63rem', padding: '.25rem .85rem', borderRadius: 100, marginBottom: '1.75rem', animation: 'fadeUp .5s ease both' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--blue)', animation: 'pulse 2s infinite', display: 'inline-block' }} />
            real ghost rates · 124,000+ verified outcomes · free
          </div>

          {/* Rotating headline */}
          <div className="hl-headline" style={{ animation: 'fadeUp .5s .06s ease both' }}>
            <div
              id="rotatingHero"
              className={swept ? 'swept' : ''}
              style={{ height: 'clamp(115px,18vw,200px)', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start', overflow: 'hidden' }}
            >
              <h1 className="hero-h1" style={{ fontFamily: 'var(--display)', fontWeight: 800, lineHeight: 1.06, letterSpacing: '-.04em', color: 'var(--white)', margin: 0, width: '100%', textAlign: 'left' }}>
                {/* Line 1: word-slam animated spans */}
                <span
                  ref={line1Ref}
                  id="heroLine1"
                  style={{ display: 'block' }}
                >
                  {line1Nodes}
                </span>
                {/* Line 2: slot-machine decode (managed imperatively via ref) */}
                <span
                  ref={line2Ref}
                  id="heroLine2"
                  className="grad-text"
                  style={{ display: 'block', fontStyle: 'italic' }}
                />
              </h1>
            </div>
          </div>

          {/* Personalized stats — shown when user has tracked applications */}
          {userStats && (
            <div className="hl-userstats" style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', padding: '.75rem 1rem', background: 'rgba(99,102,241,.06)', border: '1px solid rgba(99,102,241,.18)', borderRadius: 10, marginBottom: '.85rem' }}>
              <div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Your active apps</div>
                <div style={{ fontFamily: 'var(--display)', fontSize: '1.3rem', fontWeight: 700, color: 'var(--white)', lineHeight: 1 }}>{userStats.active}</div>
              </div>
              {userStats.ghosted > 0 && (
                <div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Ghosted</div>
                  <div style={{ fontFamily: 'var(--display)', fontSize: '1.3rem', fontWeight: 700, color: 'var(--muted)', lineHeight: 1 }}>{userStats.ghosted}</div>
                </div>
              )}
              <div style={{ marginLeft: 'auto' }}>
                <a href="/tracker" style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--indigo)', textDecoration: 'none' }}>View tracker →</a>
              </div>
            </div>
          )}

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
          <div className="hl-search" style={{ marginBottom: '1rem', animation: 'fadeUp .5s .18s ease both', position: 'relative' }}>
            {/* Wrap search-wrap in position:relative so dropdowns position correctly */}
            <div style={{ position: 'relative' }}>
              <div className="search-wrap">
                <div className="search-row">
                  {/* Company search field */}
                  <div className="search-field">
                    <span className="search-field-icon">🔍</span>
                    <input
                      className="search-inp"
                      type="text"
                      placeholder="Company or job title..."
                      autoComplete="off"
                      value={query}
                      onChange={e => handleQueryChange(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && doSearch()}
                      onBlur={() => setTimeout(() => setShowCompSuggs(false), 150)}
                    />
                  </div>
                  {/* Location field wrapped for dropdown positioning */}
                  <div style={{ position: 'relative', display: 'flex', flex: '0 0 auto' }}>
                    <div className="search-loc-row" style={{ display: 'flex', flex: '0 0 auto' }}>
                      <div className="search-loc">
                        <span style={{ color: 'var(--muted)', fontSize: '.8rem', flexShrink: 0 }}>📍</span>
                        <input
                          className="loc-inp"
                          type="text"
                          placeholder="City or zip"
                          autoComplete="off"
                          value={location}
                          onChange={e => handleLocationChange(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && doSearch()}
                          onBlur={() => setTimeout(() => setShowLocSuggs(false), 150)}
                        />
                      </div>
                      <button className="search-btn" onClick={doSearch}>Check →</button>
                    </div>
                    {/* Location autocomplete dropdown (T1-12) */}
                    {showLocSuggs && locSuggs.length > 0 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 8, maxHeight: 200, overflowY: 'auto', backdropFilter: 'blur(12px)', backgroundColor: '#0c0f1a' }}>
                        {locSuggs.map(city => (
                          <div
                            key={city}
                            style={{ padding: '.4rem .8rem', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '.72rem', color: 'var(--white)' }}
                            onMouseDown={() => { setLocation(city); setShowLocSuggs(false) }}
                          >
                            {city}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {/* Company autocomplete dropdown (T1-11) */}
              {showCompSuggs && companySuggs.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 8, maxHeight: 200, overflowY: 'auto', backdropFilter: 'blur(12px)', backgroundColor: '#0c0f1a' }}>
                  {companySuggs.map(co => (
                    <div
                      key={co}
                      style={{ padding: '.4rem .8rem', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '.72rem', color: 'var(--white)' }}
                      onMouseDown={() => {
                        setQuery(co)
                        setShowCompSuggs(false)
                        router.push(`/company/${co.toLowerCase().replace(/\s+/g, '-')}`)
                      }}
                    >
                      {co}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Recent searches */}
          {recentSearches.length > 0 && (
            <div className="hl-recent" style={{ display: 'block', marginBottom: '.55rem', animation: 'fadeUp .5s .2s ease both' }}>
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

          {/* Ghost surge strip (T2-19) */}
          <div className="hl-ghost" style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.9rem', flexWrap: 'wrap', animation: 'fadeUp .5s .2s ease both' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--red)', display: 'flex', alignItems: 'center', gap: '.35rem', flexShrink: 0 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--red)', animation: 'pulse 1.2s infinite', display: 'inline-block' }} />
              Ghost surge
            </span>
            {['Amazon', 'Deloitte', 'Oracle', 'Indeed', 'IBM'].map(co => (
              <a key={co} href={`/company/${co.toLowerCase()}`} style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--red)', borderRadius: 5, padding: '.15rem .5rem', textDecoration: 'none', transition: 'background .15s' }}>
                {co}
              </a>
            ))}
          </div>

          {/* Quick tags */}
          <div className="hl-quick" style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginBottom: '1.6rem', flexWrap: 'wrap', animation: 'fadeUp .5s .22s ease both' }}>
            {QUICK_TAGS.map(t => (
              <button key={t.label} className="vtag" onClick={() => quickSearch(t.label, t.loc)}>
                {t.label} <span className={`vtag-grade ${t.cls}`}>{t.grade}</span>
              </button>
            ))}
          </div>

          {/* CTAs */}
          <div className="hl-ctas" style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', animation: 'fadeUp .5s .28s ease both' }}>
            <button className="btn btn-green btn-lg" onClick={() => router.push('/login')} style={{ fontSize: '.88rem', padding: '.78rem 1.85rem' }}>
              Check who actually responds →
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

interface VerdictRow { company: string; score: number; risk: string; reports: number }

const FALLBACK_VERDICTS: VerdictRow[] = [
  { company: 'Stripe', score: 91, risk: 'safe', reports: 2847 },
  { company: 'Amazon', score: 18, risk: 'danger', reports: 15203 },
  { company: 'Linear', score: 88, risk: 'safe', reports: 412 },
  { company: 'Deloitte', score: 34, risk: 'danger', reports: 6721 },
  { company: 'Shopify', score: 79, risk: 'safe', reports: 1893 },
  { company: 'Google', score: 62, risk: 'warn', reports: 9423 },
  { company: 'Meta', score: 22, risk: 'danger', reports: 11892 },
  { company: 'Notion', score: 84, risk: 'safe', reports: 731 },
  { company: 'Palantir', score: 29, risk: 'danger', reports: 3201 },
]

const AGO = ['just now', '1m ago', '2m ago', '4m ago', '6m ago', '9m ago', '14m ago', '21m ago', '31m ago']

function VerdictFeed() {
  const [clock, setClock] = useState('')
  const [pool, setPool] = useState<VerdictRow[]>([])
  const [visible, setVisible] = useState<Array<VerdictRow & { ts: string; key: number }>>([])
  const poolRef = useRef<VerdictRow[]>([])
  const idxRef = useRef(0)
  const keyRef = useRef(0)

  // UTC clock
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      const hh = String(now.getUTCHours()).padStart(2, '0')
      const mm = String(now.getUTCMinutes()).padStart(2, '0')
      const ss = String(now.getUTCSeconds()).padStart(2, '0')
      setClock(`${hh}:${mm}:${ss} UTC`)
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])

  // Fetch real company leaderboard data
  useEffect(() => {
    fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'leaderboard' }),
    })
      .then(r => r.json())
      .then((d: { companies?: Array<{ name: string; score: { overall_score: number; risk_level: string; report_count: number } }> }) => {
        if (d.companies && d.companies.length >= 3) {
          const rows: VerdictRow[] = d.companies.map(c => ({
            company: c.name,
            score: Math.round(c.score.overall_score),
            risk: c.score.risk_level,
            reports: c.score.report_count,
          }))
          setPool(rows)
        } else {
          setPool(FALLBACK_VERDICTS)
        }
      })
      .catch(() => setPool(FALLBACK_VERDICTS))
  }, [])

  // Once we have pool data, build initial visible list and start ticker
  useEffect(() => {
    if (!pool.length) return
    const shuffled = [...pool].sort(() => Math.random() - 0.5)
    poolRef.current = shuffled
    idxRef.current = 0

    const initial = shuffled.slice(0, 9).map((v, i) => ({ ...v, ts: AGO[i] || `${30 + i * 5}m ago`, key: keyRef.current++ }))
    setVisible(initial)
    idxRef.current = 9

    const ticker = setInterval(() => {
      const next = poolRef.current[idxRef.current % poolRef.current.length]
      idxRef.current++
      const newKey = keyRef.current++
      setVisible(prev => [{ ...next, ts: 'just now', key: newKey }, ...prev.slice(0, 8)])
    }, 3800)
    return () => clearInterval(ticker)
  }, [pool])

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
        {(visible.length ? visible : FALLBACK_VERDICTS.map((v, i) => ({ ...v, ts: AGO[i] || '', key: i }))).map((v) => (
          <a key={v.key} className="vfeed-row" href={`/company/${v.company.toLowerCase().replace(/\s+/g, '-')}`} style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '.85rem' }}>
            <div className="vfeed-grade" style={{ color: v.risk === 'safe' ? 'var(--green)' : v.risk === 'warn' ? 'var(--amber)' : 'var(--red)' }}>
              {v.score >= 80 ? 'A' : v.score >= 65 ? 'B' : v.score >= 50 ? 'C' : v.score >= 35 ? 'D' : 'F'}
            </div>
            <div className="vfeed-info">
              <div className="vfeed-co">{v.company}</div>
              <div className="vfeed-detail">{v.reports.toLocaleString()} reports</div>
            </div>
            <div className="vfeed-ts">{v.ts}</div>
          </a>
        ))}
      </div>
      <div className="vfeed-foot">Updated from community reports</div>
    </div>
  )
}
