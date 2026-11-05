'use client'

// /demand — hiring demand by metro. Design review 2026-11-02: rebuilt on the /agencies pattern — ink
// labels, outlined status chips with an icon (never a coloured word inside running text), ONE bar colour,
// figures as figures, a sober headline. The data path (GET /api/demand, generate-on-miss, filters, the
// stale notice) is unchanged.
import { useState, useEffect, useMemo } from 'react'
import PageHeader from '@/components/shell/PageHeader'
import Badge, { Chip } from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Icon, { type IconName } from '@/components/ui/Icon'
import StatTile from '@/components/ui/StatTile'
import st from './demand.module.css'

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

// Market status as an outlined ink chip with an icon — demand is a reading, not a good/bad verdict.
const URG_CFG: Record<DemandCity['urg'], { label: string; icon: IconName }> = {
  hot: { label: 'High demand', icon: 'trending-up' },
  warm: { label: 'Active market', icon: 'gauge' },
  cool: { label: 'Stable', icon: 'minus' },
}

// The demand index word: ink, beside the figure, never a colour of its own.
function diWord(di: number): string {
  if (di >= 80) return 'Critical'
  if (di >= 65) return 'High'
  if (di >= 45) return 'Active'
  return 'Moderate'
}

const INDUSTRIES = ['Tech / Software', 'Healthcare', 'Logistics / Warehouse', 'Finance', 'Trades / Construction']
const LEVELS = ['Entry level', 'Mid level', 'Senior']

function CityCard({ city }: { city: DemandCity }) {
  const cfg = URG_CFG[city.urg]
  const live = city.kind === 'live'
  return (
    <article className={st.card}>
      <div className={st.cardHd}>
        <div className={st.cardWho}>
          <div className={st.city}>{city.city}</div>
          <div className={st.chips}>
            {/* Honest vintage chip: live-from-corpus vs modeled-from-BLS — never both as "Live". */}
            {live
              ? <Badge icon="radio">Live · Seen listings</Badge>
              : <Badge icon="chart-column">Modeled · BLS blend</Badge>}
            <Badge icon={cfg.icon}>{cfg.label}</Badge>
            <span className={st.src}>{city.src}{city.updated_at ? ` · updated ${relAgo(city.updated_at)}` : ''}</span>
          </div>
        </div>
        <a href="/companies" className={st.cardLink}>Best companies <Icon name="arrow-up-right" size={14} /></a>
      </div>
      <div className={st.rows}>
        {city.jobs.map((job, i) => (
          <div key={i} className={st.row} title={job.note}>
            <div className={st.rowMain}>
              <div className={st.rowTop}>
                <span className={st.job}>{job.t}</span>
                <a href={`/jobs?q=${encodeURIComponent(job.t.split('/')[0].trim())}&loc=${encodeURIComponent(city.city)}`} className={st.find}>
                  Find these jobs <Icon name="arrow-right" size={14} />
                </a>
              </div>
              <div className={st.rowMeta}>
                <span className={st.track} aria-hidden="true"><span className={st.fill} style={{ width: `${Math.max(2, Math.min(100, job.di))}%` }} /></span>
                <span className={st.level}>{job.di}/100 · {diWord(job.di)} · {job.l}</span>
              </div>
            </div>
            {/* Live counts are exact Seen listings; BLS counts are model estimates — say so. */}
            <div className={st.count} title={live ? `${job.count} live listings on Seen` : 'Estimate modeled from BLS sector data'}>
              {live ? job.count.toLocaleString() : `~${job.count.toLocaleString()}`}
              <span className={st.countSub}>{live ? 'listings' : 'estimated'}</span>
            </div>
          </div>
        ))}
      </div>
    </article>
  )
}

export default function DemandPage() {
  // null = loading. NO hardcoded fallback dataset: the old one contradicted the DB on every
  // load (its numbers were ~5× the real rows, so the page visibly "shrank" after hydration).
  const [data, setData] = useState<DemandCity[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [blsPeriod, setBlsPeriod] = useState<string | null>(null)
  const [fresh, setFresh] = useState<{ stale: boolean; updatedAt: string | null; lastRefresh: { status?: string; created_at?: string } | null }>({ stale: false, updatedAt: null, lastRefresh: null })
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
      .then((d: { demand?: DemandCity[]; bls_period?: string; bls_stale?: boolean; generated_at?: string; last_refresh?: { status?: string; created_at?: string } | null }) => {
        setData(d.demand ?? [])
        setBlsPeriod(d.bls_period || null)
        setFresh({ stale: !!d.bls_stale, updatedAt: d.generated_at || null, lastRefresh: d.last_refresh || null })
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

  const anyLive = (data ?? []).some(c => c.kind === 'live')
  // "~" whenever any shown city is modeled: those totals are estimates, not counted listings.
  const modeled = filtered.some(c => c.kind !== 'live')
  const approx = (n: number) => (modeled ? `~${n.toLocaleString()}` : n.toLocaleString())
  const anyFilter = !!(locFilter || nicheFilter || expFilter)

  return (
    <div className="page-full">
      <div className={st.wrap}>
        <PageHeader
          eyebrow={<>Hiring demand{blsPeriod ? ` · BLS ${blsPeriod}` : ''}{anyLive ? ' · live Seen listings' : ' · modeled'}</>}
          title="Hiring demand by metro"
          crumbLabel="Hiring demand"
          sub="Which roles are hiring where, from two sources each card names: markets counted from live listings on Seen, and markets modeled from BLS sector data. Search a city — one we don't track yet is built from live listings on the spot."
        />

        <div className={st.filters} role="search">
          <div className={st.field}>
            <Icon name="search" size={18} className={st.fieldIcon} />
            <label htmlFor="demand-loc" className="sr-only">Filter by city or state</label>
            <input
              id="demand-loc"
              autoComplete="off"
              type="text"
              className={`ui-input ${st.input}`}
              placeholder="City or state"
              value={locFilter}
              onChange={e => setLocFilter(e.target.value)}
            />
          </div>
          <div className={st.chipRow} role="group" aria-label="Industry">
            <span className={st.chipLbl}>Industry</span>
            <Chip selected={nicheFilter === ''} onClick={() => setNicheFilter('')}>All</Chip>
            {INDUSTRIES.map(n => <Chip key={n} selected={nicheFilter === n} onClick={() => setNicheFilter(n)}>{n}</Chip>)}
          </div>
          <div className={st.chipRow} role="group" aria-label="Level">
            <span className={st.chipLbl}>Level</span>
            <Chip selected={expFilter === ''} onClick={() => setExpFilter('')}>Any</Chip>
            {LEVELS.map(l => <Chip key={l} selected={expFilter === l} onClick={() => setExpFilter(l)}>{l}</Chip>)}
            {anyFilter && <Chip icon="x" onClick={() => { setLocFilter(''); setNicheFilter(''); setExpFilter('') }}>Clear</Chip>}
          </div>
        </div>

        {/* Freshness, said out loud: the BLS blend is refreshed monthly by cron; when that has not
            happened for 65+ days the data is stale and the page says so instead of hiding it. */}
        {fresh.stale && (
          <div className={st.stale} role="note">
            <Icon name="triangle-alert" size={16} />
            <span>Stale: modeled figures last refreshed {fresh.updatedAt ? relAgo(fresh.updatedAt) : 'a while ago'}{blsPeriod ? ` (BLS ${blsPeriod})` : ''}. Treat them as a vintage, not a live reading.</span>
          </div>
        )}

        <div className={st.stats}>
          <StatTile label={modeled ? 'Openings (modeled)' : 'Openings tracked'} value={approx(stats.total)} />
          <StatTile label="Markets" value={stats.cities} instant />
          <StatTile label={modeled ? 'Entry-level (modeled)' : 'Entry-level jobs'} value={approx(stats.entryLevel)} />
          <StatTile label="Avg demand index" value={`${stats.avgDI}/100`} />
        </div>

        {data === null ? (
          /* Honest loading skeleton — never a fabricated dataset while we wait */
          <div className={st.grid} aria-label="Loading demand data" role="status">
            {[0, 1, 2, 3].map(i => <div key={i} className={`sk ${st.sk}`} />)}
          </div>
        ) : filtered.length > 0 ? (
          <div className={st.grid}>
            {filtered.map(city => <CityCard key={city.city} city={city} />)}
          </div>
        ) : (
          <div className={st.empty}>
            {loadFailed ? (
              <p>Couldn&apos;t load demand data just now — refresh to retry.</p>
            ) : locFilter.trim().length >= 3 ? (
              /* Generate-on-miss: the searched city isn't tracked yet — build it from live listings */
              <>
                <p>&ldquo;{locFilter.trim()}&rdquo; isn&apos;t tracked yet.</p>
                <Button variant="primary" icon="zap" onClick={generateCity} loading={genState === 'loading'}>
                  {genState === 'loading' ? `Scanning live listings near ${locFilter.trim()}…` : `Build demand for “${locFilter.trim()}” from live listings`}
                </Button>
                {genState === 'failed' && genMsg && <p role="alert">{genMsg}</p>}
              </>
            ) : (
              <p>No markets match your filters. Clear them, or type a city to build its live demand.</p>
            )}
          </div>
        )}

        <p className={st.fine}>
          Live markets count open listings on Seen by role family. Modeled markets are estimates from the BLS sector blend, marked &ldquo;~&rdquo;. The demand index (0–100) is a bounded model: for live markets it weighs how fresh and how many the listings are and whether pay is shown; for modeled markets it comes from BLS sector data. It is a model, not a count of people hiring.
        </p>
      </div>
    </div>
  )
}
