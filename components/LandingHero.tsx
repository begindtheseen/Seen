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

export default function LandingHero() {
  const router = useRouter()
  const [heroIdx, setHeroIdx] = useState(0)
  const [query, setQuery] = useState('')
  const [location, setLocation] = useState('')
  const [recentSearches, setRecentSearches] = useState<Array<{ name: string; loc?: string }>>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    setRecentSearches(RecentSearchesStore.get())
    timerRef.current = setInterval(() => {
      setHeroIdx(i => (i + 1) % HERO_LINES.length)
    }, 4800)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
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

  const lines = HERO_LINES[heroIdx]

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
            <div style={{ height: 'clamp(92px,13vw,150px)', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start', overflow: 'hidden' }}>
              <h1 style={{ fontFamily: 'var(--display)', fontSize: 'clamp(1.7rem,9.6cqw,3.9rem)', fontWeight: 800, lineHeight: 1.06, letterSpacing: '-.04em', color: 'var(--white)', margin: 0, width: '100%', textAlign: 'left' }}>
                <span className="hero-line-in" key={`l1-${heroIdx}`} style={{ display: 'block', whiteSpace: 'nowrap' }}>{lines[0]}</span>
                <span className="hero-line-in grad-text" key={`l2-${heroIdx}`} style={{ display: 'block', whiteSpace: 'nowrap', fontStyle: 'italic', animationDelay: '.06s' }}>{lines[1]}</span>
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
