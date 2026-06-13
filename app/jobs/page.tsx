'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Score } from '@/lib/score'
import { SavedJobsStore } from '@/lib/stores/SavedJobs'
import { JobCache } from '@/lib/stores/JobCache'
import { useAuth } from '@/lib/auth'
import type { Job } from '@/lib/types'

type SortMode = 'transparency' | 'waste' | 'recent'
type NicheFilter = '' | 'tech' | 'healthcare' | 'retail' | 'logistics' | 'finance' | 'other'
type LevelFilter = '' | 'entry' | 'mid' | 'senior'
type TypeFilter = '' | 'Full-time' | 'Part-time' | 'Contract'
type PostedFilter = '' | '1' | '7' | '30'

function jobVibes(job: Job): { cls: string; txt: string }[] {
  const vibes: { cls: string; txt: string }[] = []
  const src = (job.source || '').toLowerCase()
  const loc = (job.location || '').toLowerCase()
  const score = job.score || 65
  if (src.includes('greenhouse') || src.includes('lever') || src.includes('workday')) {
    vibes.push({ cls: 'v-g', txt: '✅ Direct ATS' })
  } else if (src.includes('linkedin')) {
    vibes.push({ cls: 'v-b', txt: '💼 LinkedIn' })
  } else if (src.includes('indeed')) {
    vibes.push({ cls: 'v-n', txt: '🔍 Indeed' })
  }
  if (job.salary) vibes.push({ cls: 'v-g', txt: '💰 Salary listed' })
  if (score >= 75) vibes.push({ cls: 'v-g', txt: '✅ High transparency' })
  else if (score < 40) vibes.push({ cls: 'v-r', txt: '⚠️ Low score' })
  if (loc.includes('remote') || (job.type || '').toLowerCase().includes('remote')) {
    vibes.push({ cls: 'v-b', txt: '🏠 Remote' })
  }
  return vibes.slice(0, 3)
}

function ScoreRing({ score }: { score: number }) {
  const risk = Score.risk(score)
  return (
    <div className={`sring ${risk}`} style={{ width: 46, height: 46, flexShrink: 0 }}>
      <div className="sring-n" style={{ fontSize: '.9rem' }}>{score}</div>
      <div className="sring-l">{Score.label(risk)}</div>
    </div>
  )
}

function JobCard({ job, index, onSaveToggle, onOpen }: { job: Job; index: number; onSaveToggle: (id: string) => void; onOpen: (id: string) => void }) {
  const risk = Score.risk(job.score)
  const wl = Score.wasteLabel(job.waste)
  const vibes = jobVibes(job)
  const [saved, setSaved] = useState(() => SavedJobsStore.isSaved(job.id))
  const logoLetter = (job.company || '?')[0].toUpperCase()

  function toggleSave(e: React.MouseEvent) {
    e.stopPropagation()
    if (saved) {
      SavedJobsStore.remove(job.id, false)
      setSaved(false)
    } else {
      SavedJobsStore.save({ id: job.id, co: job.company, title: job.title, city: job.location, score: job.score }, false)
      setSaved(true)
    }
    onSaveToggle(job.id)
  }

  return (
    <div className={`jlc ${risk}`} style={{ animation: `fadeUp .4s ${Math.min(index, 12) * 0.06}s ease both` }}>
      <div
        className="jlc-top"
        onClick={() => onOpen(job.id)}
        role="button"
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(job.id) } }}
        style={{ cursor: 'pointer' }}
      >
        <div className="jrc-logo">{logoLetter}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="jlc-title">{job.title}</div>
          <div className="jlc-co">{job.company}</div>
          <div className="jlc-loc">📍 {job.location}</div>
        </div>
        <ScoreRing score={job.score} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '.35rem', flexWrap: 'wrap', margin: '.35rem 0' }}>
        <span className={`${wl.cls} waste-badge`}>{wl.txt}</span>
        {job.waste >= 55 && (
          <span className="vibe v-r" style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--red)', animation: 'pulse 1.2s infinite', display: 'inline-block', flexShrink: 0 }} />
            👻 high ghost risk
          </span>
        )}
        {vibes.map((v, i) => (
          <span key={i} className={`vibe ${v.cls}`}>{v.txt}</span>
        ))}
      </div>

      {job.description && (
        <div style={{ fontSize: '.72rem', color: 'var(--muted)', margin: '.25rem 0', lineHeight: 1.55 }}>
          {job.description.slice(0, 120)}...
        </div>
      )}

      <div className="jlc-meta">
        <span className="jlc-mi">{job.type || 'Full-time'}</span>
        <span className="jlc-mi">·</span>
        <span className="jlc-mi">{job.level}</span>
        {job.salary && <><span className="jlc-mi">·</span><span className="jlc-sal">{job.salary}</span></>}
        <span className="jlc-mi">·</span>
        <span className="jlc-mi" style={{ color: 'var(--blue)' }}>{job.source || 'Job board'}</span>
      </div>

      <div className="jlc-actions">
        <button
          className="jlc-save"
          data-saved={saved ? '1' : '0'}
          onClick={toggleSave}
          aria-label={saved ? 'Unsave' : 'Save'}
        >
          {saved ? '♥' : '♡'}
        </button>
        {job.apply_url ? (
          <a href={job.apply_url} target="_blank" rel="noopener noreferrer" className="jlc-apply" onClick={e => e.stopPropagation()}>
            Apply &amp; Optimize →
          </a>
        ) : (
          <button className="jlc-apply">Apply &amp; Optimize →</button>
        )}
      </div>

      <button
        onClick={() => onOpen(job.id)}
        style={{ display: 'block', width: '100%', textAlign: 'center', background: 'none', border: 'none', borderTop: '1px solid var(--line)', marginTop: '.6rem', paddingTop: '.6rem', fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--green)', cursor: 'pointer' }}
      >
        View details + AI insights →
      </button>
    </div>
  )
}

export default function JobsPage() {
  const router = useRouter()
  const { isLoggedIn } = useAuth()
  const [query, setQuery] = useState('')
  const [location, setLocation] = useState('')
  const [radius, setRadius] = useState('25')
  const [niche, setNiche] = useState<NicheFilter>('')
  const [level, setLevel] = useState<LevelFilter>('')
  const [jobType, setJobType] = useState<TypeFilter>('')
  const [posted, setPosted] = useState<PostedFilter>('')
  const [sort, setSort] = useState<SortMode>('transparency')
  const [jobs, setJobs] = useState<Job[]>([])
  const [filtered, setFiltered] = useState<Job[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [statusMsg, setStatusMsg] = useState('Enter a search above →')
  const [saveVersion, setSaveVersion] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  const hasFilters = !!(niche || level || jobType || posted)

  function applySort(list: Job[], mode: SortMode): Job[] {
    const copy = [...list]
    if (mode === 'waste') return copy.sort((a, b) => a.waste - b.waste)
    if (mode === 'recent') return copy // preserve server order (most recent first)
    return copy.sort((a, b) => b.score - a.score) // transparency
  }

  function applyFilters(list: Job[]): Job[] {
    let out = list
    if (niche) out = out.filter(j => {
      const src = (j.source || '').toLowerCase()
      const title = (j.title || '').toLowerCase()
      if (niche === 'tech') return src.includes('tech') || title.match(/engineer|developer|software|data|devops|product/i) !== null
      if (niche === 'healthcare') return title.match(/nurse|doctor|health|medical|pharmacy|clinical/i) !== null
      if (niche === 'retail') return title.match(/retail|store|cashier|food|restaurant|barista/i) !== null
      if (niche === 'logistics') return title.match(/driver|warehouse|logistics|supply|delivery/i) !== null
      if (niche === 'finance') return title.match(/finance|accounting|analyst|banker|insurance/i) !== null
      return true
    })
    if (level) out = out.filter(j => (j.level || '').toLowerCase().includes(level))
    if (jobType) out = out.filter(j => j.type === jobType)
    return out
  }

  const updateDisplay = useCallback((list: Job[], sortMode: SortMode) => {
    const f = applyFilters(list)
    const s = applySort(f, sortMode)
    setFiltered(s)
    setStatusMsg(s.length === 0 ? 'No results. Try a different title or wider radius.' : `${s.length} result${s.length !== 1 ? 's' : ''}`)
  }, [niche, level, jobType, posted]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (jobs.length > 0) updateDisplay(jobs, sort)
  }, [niche, level, jobType, posted, sort]) // eslint-disable-line react-hooks/exhaustive-deps

  async function searchJobs() {
    if (!query.trim() && !location.trim()) {
      setStatusMsg('Enter a job title or location to search.')
      return
    }
    if (abortRef.current) abortRef.current.abort()
    abortRef.current = new AbortController()
    setStatus('loading')
    setStatusMsg('Searching...')
    setJobs([])
    setFiltered([])

    try {
      // POST {query, location, radius} — matches api/jobs.js (POST-only, reads body.query).
      // Filters (niche/level/type/posted) + sort are applied client-side in updateDisplay.
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), location: location.trim(), radius }),
        signal: abortRef.current.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { jobs?: unknown[]; results?: unknown[] }
      const raw: Job[] = (data.jobs || data.results || []).map((item: unknown) => {
        const j = item as Record<string, unknown>
        return {
        id: String(j.id || 'srch_' + Math.random().toString(36).slice(2, 8)),
        title: String(j.title || ''),
        company: String(j.company || j.co || ''),
        location: String(j.location || j.loc || j.city || location || 'US'),
        score: Number(j.score) || 65,
        waste: Number(j.waste_score ?? j.waste) || 25,
        level: String(j.level || j.lvl || 'Mid level'),
        type: String(j.type || 'Full-time'),
        source: String(j.source || 'Job board'),
        description: String(j.description || ''),
        salary: j.salary ? String(j.salary) : null,
          apply_url: j.apply_url ? String(j.apply_url) : (j.url ? String(j.url) : null),
        }
      })
      JobCache.setMany(raw)
      setJobs(raw)
      updateDisplay(raw, sort)
      setStatus('done')
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setStatus('error')
      setStatusMsg('Search failed. Please try again.')
    }
  }

  function clearFilters() {
    setNiche('')
    setLevel('')
    setJobType('')
    setPosted('')
    setFiltered(applySort(jobs, sort))
    setStatusMsg(jobs.length > 0 ? `${jobs.length} result${jobs.length !== 1 ? 's' : ''}` : 'Enter a search above →')
  }

  function handleSaveToggle() {
    setSaveVersion(v => v + 1)
  }

  const inputStyle: React.CSSProperties = {
    flex: 1, minWidth: 160,
    background: 'var(--surface)',
    border: '1.5px solid var(--line2)',
    borderRadius: 8,
    padding: '.62rem .9rem',
    color: 'var(--white)',
    fontFamily: 'var(--body)',
    fontSize: '.875rem',
    outline: 'none',
    caretColor: 'var(--blue)',
  }

  const selectStyle: React.CSSProperties = {
    background: 'var(--card)',
    border: '1px solid var(--line2)',
    borderRadius: 6,
    padding: '.33rem .68rem',
    fontFamily: 'var(--mono)',
    fontSize: '.68rem',
    color: 'var(--sub)',
    outline: 'none',
    cursor: 'pointer',
  }

  return (
    <div className="page-full">
      <div className="jpage">
        <div className="jpage-hdr">
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.22em', color: 'var(--green)', marginBottom: '.6rem', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 22, height: 1, background: 'var(--green)', display: 'inline-block', flexShrink: 0 }} />
            Job search · transparency-first
          </div>
          <h1>Open positions</h1>
          <p>Sorted by transparency. Every listing shows waste risk, process score, and vibe tags — not just salary and location.</p>

          {/* Search bar */}
          <div style={{ display: 'flex', gap: '.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Job title or role..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && searchJobs()}
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="City or state..."
              value={location}
              onChange={e => setLocation(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && searchJobs()}
              style={inputStyle}
            />
            <select value={radius} onChange={e => setRadius(e.target.value)} style={selectStyle}>
              <option value="10">10 mi</option>
              <option value="25">25 mi</option>
              <option value="50">50 mi</option>
              <option value="100">100 mi</option>
              <option value="0">Remote</option>
            </select>
            <button
              onClick={searchJobs}
              disabled={status === 'loading'}
              style={{
                background: 'linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%)',
                color: '#fff', border: 'none', borderRadius: 8,
                padding: '.62rem 1.25rem',
                fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.85rem',
                cursor: status === 'loading' ? 'not-allowed' : 'pointer',
                opacity: status === 'loading' ? 0.6 : 1,
                boxShadow: '0 0 20px rgba(59,130,246,0.3)',
              }}
            >
              {status === 'loading' ? 'Searching...' : 'Search →'}
            </button>
          </div>

          {/* Filter bar */}
          <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginTop: '.6rem', alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--muted)' }}>Filter:</span>
            <select value={niche} onChange={e => setNiche(e.target.value as NicheFilter)} style={selectStyle}>
              <option value="">Any industry</option>
              <option value="tech">Tech / Software</option>
              <option value="healthcare">Healthcare</option>
              <option value="retail">Retail / Food Service</option>
              <option value="logistics">Logistics / Warehouse</option>
              <option value="finance">Finance</option>
              <option value="other">Other</option>
            </select>
            <select value={level} onChange={e => setLevel(e.target.value as LevelFilter)} style={selectStyle}>
              <option value="">Any level</option>
              <option value="entry">Entry level</option>
              <option value="mid">Mid level</option>
              <option value="senior">Senior</option>
            </select>
            <select value={jobType} onChange={e => setJobType(e.target.value as TypeFilter)} style={selectStyle}>
              <option value="">Any type</option>
              <option value="Full-time">Full-time</option>
              <option value="Part-time">Part-time</option>
              <option value="Contract">Contract</option>
            </select>
            <select value={posted} onChange={e => setPosted(e.target.value as PostedFilter)} style={selectStyle}>
              <option value="">Any time</option>
              <option value="1">Last 24 hours</option>
              <option value="7">Last week</option>
              <option value="30">Last month</option>
            </select>
            {hasFilters && (
              <button onClick={clearFilters} style={{ background: 'none', border: '1px solid var(--line2)', color: 'var(--muted)', borderRadius: 6, padding: '.28rem .68rem', fontFamily: 'var(--mono)', fontSize: '.62rem', cursor: 'pointer' }}>
                ✕ Clear
              </button>
            )}
          </div>
        </div>

        {/* Results header */}
        <div className="jtb">
          <div className="jct">{statusMsg}</div>
          <select
            className="jss"
            value={sort}
            onChange={e => setSort(e.target.value as SortMode)}
          >
            <option value="transparency">By transparency</option>
            <option value="waste">Lowest waste risk</option>
            <option value="recent">Most recent</option>
          </select>
        </div>

        {/* Results list */}
        {filtered.length > 0 ? (
          <div className="jlist" key={saveVersion}>
            {filtered.map((job, i) => (
              <JobCard key={job.id} job={job} index={i} onSaveToggle={handleSaveToggle} onOpen={id => router.push(`/jobs/${encodeURIComponent(id)}`)} />
            ))}
          </div>
        ) : status === 'idle' ? (
          <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.75rem' }}>
            Search for jobs above to get started.
          </div>
        ) : status === 'loading' ? (
          <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.75rem' }}>
            <div style={{ marginBottom: '.75rem', fontSize: '1.5rem' }}>🔍</div>
            Searching across the web...
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.75rem' }}>
            No results found. Try a different title or wider radius.
          </div>
        )}
      </div>
    </div>
  )
}
