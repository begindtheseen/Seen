'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { JobCache } from '@/lib/stores/JobCache'
import { stableJobId } from '@/lib/jobId'
import { AppStore } from '@/lib/stores/AppStore'
import { RecentSearchesStore } from '@/lib/stores/RecentSearches'
import { useAuth } from '@/lib/auth'
import { aiHeaders } from '@/lib/aiHeaders'
import type { Job } from '@/lib/types'

// In-memory search cache: `${query}|${location}` → { jobs, ts }
const searchCache = new Map<string, { jobs: Job[]; ts: number }>()

export type SortMode = 'transparency' | 'waste' | 'recent'
export type NicheFilter = '' | 'tech' | 'healthcare' | 'retail' | 'logistics' | 'finance' | 'other'
export type LevelFilter = '' | 'entry' | 'mid' | 'senior'
export type TypeFilter = '' | 'Full-time' | 'Part-time' | 'Contract'
export type PostedFilter = '' | '1' | '7' | '30'

export type CoScoreMap = Record<string, { ghost_rate: number; overall_score: number; response_rate?: number }>

export function useJobSearch() {
  const { isLoggedIn, profile } = useAuth()
  const [query, setQuery] = useState('')
  const [location, setLocation] = useState('')
  const autoSearchedRef = useRef(false)
  const [locSuggs, setLocSuggs] = useState<string[]>([])
  const [showLocSuggs, setShowLocSuggs] = useState(false)
  const [gpsLoading, setGpsLoading] = useState(false)
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
  const [recommended, setRecommended] = useState<Job[]>([])
  const [recSkills, setRecSkills] = useState<string[]>([])
  const [recStatus, setRecStatus] = useState<'idle' | 'loading' | 'done'>('idle')
  const [coScores, setCoScores] = useState<CoScoreMap>({})
  const [appliedCos, setAppliedCos] = useState<Set<string>>(new Set())
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
    // Posted-within filter (1/7/30 days). Listings without a posted date are kept —
    // dropping them would blank fresh live-aggregated results that haven't round-tripped
    // the DB yet. (This filter was previously rendered but never applied at all.)
    if (posted) {
      const days = parseInt(posted, 10)
      if (Number.isFinite(days) && days > 0) {
        const cutoff = Date.now() - days * 86400000
        out = out.filter(j => !j.posted_at || new Date(j.posted_at).getTime() >= cutoff)
      }
    }
    return out
  }

  const updateDisplay = useCallback((list: Job[], sortMode: SortMode) => {
    const f = applyFilters(list)
    // Never blank the board: if active filters zero out a non-empty result set, fall
    // back to showing all nearby roles with a note, rather than "No results".
    if (f.length === 0 && list.length > 0) {
      const s = applySort(list, sortMode)
      setFiltered(s)
      setStatusMsg(`No exact filter matches — showing all ${s.length} nearby role${s.length !== 1 ? 's' : ''}`)
      return
    }
    const s = applySort(f, sortMode)
    setFiltered(s)
    setStatusMsg(s.length === 0 ? 'No results. Try a different title or wider radius.' : `${s.length} result${s.length !== 1 ? 's' : ''}`)
  }, [niche, level, jobType, posted]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (jobs.length > 0) updateDisplay(jobs, sort)
  }, [niche, level, jobType, posted, sort]) // eslint-disable-line react-hooks/exhaustive-deps

  // Honor inbound search params — the Demand page links here with ?q=<title>&loc=<city>
  // ("Find these jobs →"). These were silently ignored; the user got the default page.
  // Runs before the GPS/recent-search effects and claims autoSearchedRef so they don't
  // stomp the explicit intent. (window.location avoids the useSearchParams Suspense req.)
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search)
      const urlQ = (sp.get('q') || '').trim().slice(0, 200)
      const urlLoc = (sp.get('loc') || '').trim().slice(0, 200)
      if (urlQ) {
        autoSearchedRef.current = true
        setQuery(urlQ)
        if (urlLoc) setLocation(urlLoc)
        searchJobs(urlQ, urlLoc || undefined)
      }
    } catch {}
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-request GPS on mount; fall back to profile city if GPS denied
  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      requestGpsLocation()
    } else if (profile?.city) {
      setLocation(profile.city)
      if (!autoSearchedRef.current) { autoSearchedRef.current = true; searchJobs(undefined, profile.city) }
    }
    // Pre-load last search from recent history (delayed to not conflict with GPS)
    const t = setTimeout(() => {
      if (!autoSearchedRef.current) {
        try {
          const recent = RecentSearchesStore.get()
          if (recent.length > 0) {
            const last = recent[0]
            setQuery(last.name)
            if (last.loc) setLocation(last.loc)
            autoSearchedRef.current = true
            searchJobs(last.name, last.loc)
          }
        } catch {}
      }
    }, 1200)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Once profile loads, if location still empty, pre-fill and auto-search
  useEffect(() => {
    if (!autoSearchedRef.current && !location.trim() && profile?.city && !gpsLoading) {
      autoSearchedRef.current = true
      setLocation(profile.city)
      searchJobs(undefined, profile.city)
    }
  }, [profile?.city]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch resume-powered recommendations when logged in
  useEffect(() => {
    if (!isLoggedIn) return
    setRecStatus('loading')
    aiHeaders().then(hdrs => fetch('/api/jobs', {
      method: 'POST',
      headers: hdrs,
      body: JSON.stringify({ action: 'recommended' }),
    }))
    .then(r => r.ok ? r.json() : {})
    .then((data: { jobs?: unknown[]; skills?: string[] }) => {
      if (Array.isArray(data.jobs) && data.jobs.length) {
        const raw: Job[] = (data.jobs as Record<string, unknown>[]).map(j => ({
          id: String(j.id || 'rec_' + Math.random().toString(36).slice(2, 8)),
          title: String(j.title || ''),
          company: String(j.company || ''),
          location: String(j.location || 'US'),
          score: Number(j.score) || 65,
          waste: Number(j.waste_score ?? j.waste) || 25,
          level: String(j.level || 'Mid level'),
          type: String(j.type || 'Full-time'),
          source: String(j.source || 'Seen'),
          description: String(j.description || ''),
          salary: j.salary ? String(j.salary) : null,
          apply_url: j.apply_url ? String(j.apply_url) : (j.url ? String(j.url) : null),
        }))
        setRecommended(raw)
        setRecSkills(Array.isArray(data.skills) ? data.skills : [])
      }
    })
    .catch(() => {})
    .finally(() => setRecStatus('done'))
  }, [isLoggedIn]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch ghost rates for BOTH decks' companies — recommended AND search results. The old
  // effect only covered `recommended` (login + résumé required), so the intel badges and
  // hiring-probability strip never rendered on the main searched-jobs swipe deck.
  useEffect(() => {
    const pool = [...recommended, ...jobs]
    if (!pool.length) return
    const cos = [...new Set(pool.map(j => j.company.toLowerCase().trim()).filter(Boolean))].slice(0, 40)
    fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'batch_scores', names: cos }),
    })
      .then(r => r.ok ? r.json() : { scores: {} })
      .then((d: { scores?: CoScoreMap }) => {
        if (d.scores) setCoScores(prev => ({ ...prev, ...d.scores }))
      })
      .catch(() => {})
  }, [recommended, jobs])

  useEffect(() => {
    try {
      const apps = AppStore.loadSync()
      setAppliedCos(new Set(apps.map(a => a.company.toLowerCase().trim())))
    } catch {}
  }, [])

  useEffect(() => {
    if (!profile?.experience || level) return // don't override if user already set it
    const exp = profile.experience.toLowerCase()
    if (exp.includes('entry') || exp.includes('0-1') || exp.includes('junior') || exp.includes('intern')) {
      setLevel('entry')
    } else if (exp.includes('senior') || exp.includes('5+') || exp.includes('lead') || exp.includes('staff') || exp.includes('principal')) {
      setLevel('senior')
    } else if (exp.includes('mid') || exp.includes('2-') || exp.includes('3-') || exp.includes('4-')) {
      setLevel('mid')
    }
  }, [profile?.experience]) // eslint-disable-line react-hooks/exhaustive-deps

  async function requestGpsLocation() {
    if (!navigator.geolocation || location.trim()) return
    setGpsLoading(true)
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000, maximumAge: 300000 })
      )
      const { latitude: lat, longitude: lon } = pos.coords
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`,
        { headers: { 'User-Agent': 'seenjobs.io/1.0', 'Accept-Language': 'en' } }
      )
      if (!r.ok) throw new Error('geocode')
      const geo = await r.json() as { address: Record<string, string> }
      const city = geo.address.city || geo.address.town || geo.address.village || geo.address.county || ''
      const state = geo.address.state || ''
      const loc = city && state ? `${city}, ${state}` : city || state
      if (loc) {
        setLocation(loc)
        if (!autoSearchedRef.current) { autoSearchedRef.current = true; searchJobs(undefined, loc) }
      }
    } catch {
      // GPS failed — fall back to profile city
      if (profile?.city && !autoSearchedRef.current) {
        autoSearchedRef.current = true
        setLocation(profile.city)
        searchJobs(undefined, profile.city)
      }
    }
    finally { setGpsLoading(false) }
  }

  async function searchJobs(queryOverride?: string, locationOverride?: string) {
    const q = (queryOverride ?? query).trim()
    const loc = (locationOverride ?? location).trim()
    if (!q && !loc) {
      setStatusMsg('Enter a job title or location to search.')
      return
    }

    const cacheKey = `${q}|${loc}|${radius}`
    const cached = searchCache.get(cacheKey)
    const CACHE_TTL = 5 * 60 * 1000 // 5 min
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      // Serve cached results immediately, then silently refresh in background
      setJobs(cached.jobs)
      updateDisplay(cached.jobs, sort)
      setStatus('done')
      setStatusMsg(`${cached.jobs.length} result${cached.jobs.length !== 1 ? 's' : ''} (from cache — refreshing…)`)
    } else {
      if (abortRef.current) abortRef.current.abort()
      abortRef.current = new AbortController()
      setStatus('loading')
      setStatusMsg('Searching...')
      if (!cached) { setJobs([]); setFiltered([]) }
    }

    // One automatic retry on a transient failure (cold start, flaky network) before
    // ever showing an error — a single blip should never surface as "Search failed".
    for (let attempt = 0; ; attempt++) {
      try {
        const ctrl = new AbortController()
        abortRef.current = ctrl
        const res = await fetch('/api/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q, location: loc, radius }),
          signal: ctrl.signal,
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json() as { jobs?: unknown[]; results?: unknown[]; widened?: boolean; radius?: number }
        const raw: Job[] = (data.jobs || data.results || []).map((item: unknown) => {
          const j = item as Record<string, unknown>
          const company = String(j.company || j.co || '')
          const title = String(j.title || '')
          const location = String(j.location || j.loc || j.city || loc || 'US')
          const apply_url = j.apply_url ? String(j.apply_url) : (j.url ? String(j.url) : null)
          return {
            // Stable, content-derived id when the API has none — so the same listing
            // keeps the same id across loads and saved listings reliably reopen.
            id: String(j.id || stableJobId({ company, title, location, apply_url })),
            title,
            company,
            location,
            score: Number(j.score) || 65,
            waste: Number(j.waste_score ?? j.waste) || 25,
            level: String(j.level || j.lvl || 'Mid level'),
            type: String(j.type || 'Full-time'),
            source: String(j.source || 'Job board'),
            description: String(j.description || ''),
            salary: j.salary ? String(j.salary) : null,
            apply_url,
            posted_at: j.posted_at ? String(j.posted_at) : null,
          }
        })
        searchCache.set(cacheKey, { jobs: raw, ts: Date.now() })
        JobCache.setMany(raw)
        setJobs(raw)
        updateDisplay(raw, sort)
        setStatus('done')
        // When we had to widen past the requested radius (nothing within it), say so —
        // otherwise nearby-but-outside-radius results look like the radius is broken.
        if (data.widened && loc && raw.length) {
          setStatusMsg(`No jobs within ${data.radius || radius} mi of ${loc} — showing the ${raw.length} nearest matches`)
        }
        if (q) try { RecentSearchesStore.push(q, loc || undefined) } catch {}
        return
      } catch (err) {
        if ((err as Error).name === 'AbortError') return // superseded by a newer search
        if (attempt < 1) { await new Promise(r => setTimeout(r, 1200)); continue }
        setStatus('error')
        setStatusMsg('Search failed. Please try again.')
        return
      }
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

  return {
    // auth passthrough (search machine reacts to these)
    isLoggedIn,
    profile,
    // search inputs
    query, setQuery,
    location, setLocation,
    locSuggs, setLocSuggs,
    showLocSuggs, setShowLocSuggs,
    gpsLoading,
    radius, setRadius,
    // filters + sort
    niche, setNiche,
    level, setLevel,
    jobType, setJobType,
    posted, setPosted,
    sort, setSort,
    hasFilters,
    // results
    filtered,
    status,
    statusMsg,
    // recommendations + company scores
    recommended,
    recSkills,
    recStatus,
    coScores,
    appliedCos,
    // actions
    searchJobs,
    requestGpsLocation,
    clearFilters,
  }
}
