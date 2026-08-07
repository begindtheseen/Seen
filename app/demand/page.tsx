'use client'

import { useState, useEffect, useMemo } from 'react'

interface DemandJob {
  t: string
  n: string
  l: string
  count: number
  di: number
  note: string
}

interface DemandCity {
  city: string
  urg: 'hot' | 'warm' | 'cool'
  src: string
  /** 'live' = computed from Seen's live listings corpus; 'bls' = modeled from the BLS blend. */
  kind?: 'live' | 'bls'
  updated_at?: string | null
  jobs: DemandJob[]
}

function relAgo(iso?: string | null): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const d = Math.floor((Date.now() - t) / 86400000)
  if (d <= 0) return 'today'
  if (d === 1) return 'yesterday'
  if (d < 30) return `${d}d ago`
  return `${Math.floor(d / 30)}mo ago`
}


const URG_CFG = {
  hot:  { label: '🔥 High demand', cls: 'hot' },
  warm: { label: '🌡️ Active market', cls: 'warm' },
  cool: { label: '❄️ Stable', cls: 'cool' },
}

function DemandBar({ di }: { di: number }) {
  const color = di >= 75 ? 'var(--red)' : di >= 55 ? 'var(--amber)' : 'var(--green)'
  return (
    <div style={{ flex: 1, height: 5, background: 'var(--line)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ width: `${di}%`, height: '100%', background: color, borderRadius: 3, transition: 'width .4s ease' }} />
    </div>
  )
}

function diLabel(di: number): { label: string; color: string } {
  if (di >= 80) return { label: 'Critical', color: 'var(--red)' }
  if (di >= 65) return { label: 'High', color: 'var(--amber)' }
  if (di >= 45) return { label: 'Active', color: 'var(--blue)' }
  return { label: 'Moderate', color: 'var(--dim)' }
}

function CityCard({ city }: { city: DemandCity }) {
  const cfg = URG_CFG[city.urg]
  const live = city.kind === 'live'
  return (
    <div className="dcity">
      <div className="dc-hdr">
        <div>
          <div className="dc-city">{city.city}</div>
          {/* Honest vintage chip: live-from-corpus vs modeled-from-BLS — never both as "Live" */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '.45rem', marginTop: '.18rem', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', fontWeight: 700, letterSpacing: '.06em', color: live ? 'var(--green)' : 'var(--blue)', border: `1px solid ${live ? 'rgba(16,185,129,.35)' : 'rgba(99,102,241,.35)'}`, borderRadius: 4, padding: '.08rem .35rem' }}>
              {live ? '● LIVE · Seen listings' : '≈ MODELED · BLS blend'}
            </span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)' }}>
              {city.src}{city.updated_at ? ` · updated ${relAgo(city.updated_at)}` : ''}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexShrink: 0 }}>
          <a
            href="/companies"
            style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--green)', textDecoration: 'none' }}
          >
            Best companies ↗
          </a>
          <span className={`dc-urg ${cfg.cls}`}>{cfg.label}</span>
        </div>
      </div>
      <div className="dc-body">
        {city.jobs.map((job, i) => (
          <div key={i} className="dc-row" title={job.note}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                <div className="dc-job">{job.t}</div>
                <a
                  href={`/jobs?q=${encodeURIComponent(job.t.split('/')[0].trim())}&loc=${encodeURIComponent(city.city)}`}
                  style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--blue)', textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  Find these jobs →
                </a>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginTop: '.25rem' }}>
                <DemandBar di={job.di} />
                <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)', flexShrink: 0 }}>{job.l}</span>
                {(() => { const dl = diLabel(job.di); return <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: dl.color, marginLeft: '.4rem', fontWeight: 700 }}>{dl.label}</span>; })()}
              </div>
            </div>
            {/* Live counts are exact Seen listings; BLS counts are model estimates — say so. */}
            <div className="dc-count" style={{ marginLeft: '.75rem', flexShrink: 0 }} title={live ? `${job.count} live listings on Seen` : 'Estimate modeled from BLS sector data'}>
              {live ? job.count.toLocaleString() : `~${job.count.toLocaleString()}`}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function DemandPage() {
  // null = loading. NO hardcoded fallback dataset: the old one contradicted the DB on every
  // load (its numbers were ~5× the real rows, so the page visibly "shrank" after hydration).
  const [data, setData] = useState<DemandCity[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [blsPeriod, setBlsPeriod] = useState<string | null>(null)
  const [locFilter, setLocFilter] = useState('')
  const [nicheFilter, setNicheFilter] = useState('')
  const [expFilter, setExpFilter] = useState('')
  // Generate-on-miss state: searching a city we don't have triggers live generation from the
  // Seen jobs corpus (geocode → radius → bucket) — cached server-side for everyone after.
  const [genState, setGenState] = useState<'idle' | 'loading' | 'failed'>('idle')
  const [genMsg, setGenMsg] = useState('')

  useEffect(() => {
    fetch('/api/demand')
      .then(r => r.json())
      .then((d: { demand?: DemandCity[]; bls_period?: string }) => {
        setData(d.demand ?? [])
        setBlsPeriod(d.bls_period || null)
      })
      .catch(() => { setData([]); setLoadFailed(true) })
  }, [])

  const generateCity = async () => {
    const q = locFilter.trim()
    if (!q || genState === 'loading') return
    setGenState('loading'); setGenMsg('')
    try {
      const r = await fetch(`/api/demand?city=${encodeURIComponent(q)}`)
      const d = (await r.json()) as { demand?: DemandCity[]; message?: string; city?: string }
      if (d.demand?.length) {
        setData(prev => {
          const others = (prev ?? []).filter(c => !d.demand!.some(n => n.city === c.city))
          return [...d.demand!, ...others]
        })
        if (d.city) setLocFilter(d.city)
        setGenState('idle')
      } else {
        setGenState('failed')
        setGenMsg(d.message || `No live listings found near "${q}" yet.`)
      }
    } catch {
      setGenState('failed'); setGenMsg('Could not reach the demand service — try again.')
    }
  }

  const filtered = useMemo(() => {
    let cities = data ?? []
    const q = locFilter.trim().toLowerCase()
    if (q) {
      // A bare 2-letter query is a STATE code: match the ", ST" suffix — substring matching
      // returned absurdities ("CO" → San Francisco, "AL" → dozens of cities).
      cities = /^[a-z]{2}$/.test(q)
        ? cities.filter(c => c.city.toLowerCase().endsWith(`, ${q}`))
        : cities.filter(c => c.city.toLowerCase().includes(q))
    }
    return cities.map(c => ({
      ...c,
      jobs: c.jobs.filter(j => {
        if (nicheFilter && j.n !== nicheFilter) return false
        if (expFilter && j.l !== expFilter) return false
        return true
      }),
    })).filter(c => c.jobs.length > 0)
  }, [data, locFilter, nicheFilter, expFilter])

  const stats = useMemo(() => {
    const allJobs = filtered.flatMap(c => c.jobs)
    const total = allJobs.reduce((s, j) => s + j.count, 0)
    const entryLevel = allJobs.filter(j => j.l === 'Entry level').reduce((s, j) => s + j.count, 0)
    const avgDI = allJobs.length ? Math.round(allJobs.reduce((s, j) => s + j.di, 0) / allJobs.length) : 0
    return { total, cities: filtered.length, entryLevel, avgDI }
  }, [filtered])

  const selectStyle: React.CSSProperties = {
    background: 'var(--surface)',
    border: '1.5px solid var(--line2)',
    borderRadius: 8,
    padding: '.55rem .9rem',
    color: 'var(--white)',
    fontFamily: 'var(--mono)',
    fontSize: '.7rem',
    outline: 'none',
    cursor: 'pointer',
    flex: 1,
    minWidth: 140,
  }

  return (
    <div className="page-full">
      <div className="demand-page">
        {/* Header */}
        <div className="demand-hdr">
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.22em', color: 'var(--amber)', marginBottom: '.6rem', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 22, height: 1, background: 'var(--amber)', display: 'inline-block' }} />
            Job demand{blsPeriod ? ` · BLS ${blsPeriod}` : ''} + live Seen listings
          </div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: '2rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', marginBottom: '.28rem' }}>
            Where jobs desperately need people
          </h1>
          <p style={{ color: 'var(--sub)', fontSize: '.82rem', fontWeight: 300, marginBottom: '1.5rem', maxWidth: 680 }}>
            Two honest sources, labeled per card: <span style={{ color: 'var(--green)' }}>● LIVE</span> markets computed from real listings on Seen, and <span style={{ color: 'var(--blue)' }}>≈ MODELED</span> markets from the BLS blend. Search any city — if we don&apos;t have it, we generate it from live listings on the spot.
          </p>

          {/* Filters */}
          <div className="demand-filters">
            <input
              type="text"
              placeholder="Filter by city or state..."
              value={locFilter}
              onChange={e => setLocFilter(e.target.value)}
              style={{ ...selectStyle, caretColor: 'var(--blue)' }}
            />
            <select value={nicheFilter} onChange={e => setNicheFilter(e.target.value)} style={selectStyle}>
              <option value="">All industries</option>
              <option value="Tech / Software">Tech / Software</option>
              <option value="Healthcare">Healthcare</option>
              <option value="Logistics / Warehouse">Logistics / Warehouse</option>
              <option value="Finance">Finance</option>
              <option value="Trades / Construction">Trades / Construction</option>
            </select>
            <select value={expFilter} onChange={e => setExpFilter(e.target.value)} style={selectStyle}>
              <option value="">Any level</option>
              <option value="Entry level">Entry level</option>
              <option value="Mid level">Mid level</option>
              <option value="Senior">Senior</option>
            </select>
            {(locFilter || nicheFilter || expFilter) && (
              <button
                onClick={() => { setLocFilter(''); setNicheFilter(''); setExpFilter('') }}
                style={{ background: 'none', border: '1px solid var(--line2)', color: 'var(--muted)', borderRadius: 8, padding: '.55rem .9rem', fontFamily: 'var(--mono)', fontSize: '.7rem', cursor: 'pointer', flexShrink: 0 }}
              >
                ✕ Clear
              </button>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div className="demand-stat-row">
          {[
            { n: stats.total.toLocaleString(), l: 'Total openings tracked' },
            { n: stats.cities, l: 'Markets' },
            { n: stats.entryLevel.toLocaleString(), l: 'Entry-level jobs' },
            { n: `${stats.avgDI}/100`, l: 'Avg demand index' },
          ].map((s, i) => (
            <div key={i} className="dsr">
              <div className="dsr-n">{s.n}</div>
              <div className="dsr-l">{s.l}</div>
            </div>
          ))}
        </div>

        {/* City grid */}
        {data === null ? (
          /* Honest loading skeleton — never a fabricated dataset while we wait */
          <div className="demand-grid">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="dcity" style={{ minHeight: 180, opacity: 0.55 }}>
                <div style={{ height: 12, width: `${58 - i * 6}%`, background: 'var(--line2)', borderRadius: 4, margin: '1rem' }} />
                {[0, 1, 2].map(j => <div key={j} style={{ height: 9, width: `${80 - j * 14}%`, background: 'var(--line)', borderRadius: 4, margin: '.8rem 1rem' }} />)}
              </div>
            ))}
          </div>
        ) : filtered.length > 0 ? (
          <div className="demand-grid">
            {filtered.map(city => (
              <CityCard key={city.city} city={city} />
            ))}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.75rem', lineHeight: 1.7 }}>
            {loadFailed ? (
              <>Couldn&apos;t load demand data just now — refresh to retry.</>
            ) : locFilter.trim().length >= 3 ? (
              /* Generate-on-miss: the searched city isn't tracked yet — build it from live listings */
              <>
                <div style={{ marginBottom: '1rem' }}>&ldquo;{locFilter.trim()}&rdquo; isn&apos;t tracked yet.</div>
                <button
                  onClick={generateCity}
                  disabled={genState === 'loading'}
                  style={{ background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.35)', color: 'var(--green)', borderRadius: 8, padding: '.65rem 1.2rem', fontFamily: 'var(--mono)', fontSize: '.7rem', cursor: genState === 'loading' ? 'wait' : 'pointer' }}
                >
                  {genState === 'loading' ? `Scanning live listings near ${locFilter.trim()}…` : `⚡ Generate demand for “${locFilter.trim()}” from live Seen listings`}
                </button>
                {genState === 'failed' && genMsg && (
                  <div style={{ marginTop: '.9rem', color: 'var(--amber)', fontSize: '.66rem' }}>{genMsg}</div>
                )}
              </>
            ) : (
              <>No markets match your filters. Try clearing them — or type a city to generate its live demand.</>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
