'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { JobCache } from '@/lib/stores/JobCache'
import { stableJobId } from '@/lib/jobId'
import { AppStore } from '@/lib/stores/AppStore'
import { RecentSearchesStore } from '@/lib/stores/RecentSearches'
import { useAuth } from '@/lib/auth'
import { aiHeaders } from '@/lib/aiHeaders'
import type { Job } from '@/lib/types'
import { isGradeableScore } from '@/lib/gradeGate'
import { sortByPriority, isMatch } from '@/lib/server/jobPriority.js'
import { searchQueryString, readSearchQuery } from '@/lib/jobs/searchUrl.js'

// In-memory search cache: `${query}|${location}|${radius}` → the page as it was shown (rows, whether
// the server has more, and the honest note/label it carried), so a repeat of the same search — Enter
// right after the auto-search, Back from a listing — is served without a second request.
interface CachedSearch { jobs: Job[]; ts: number; hasMore: boolean; pages: number; notice: string | null; label: string | null }
const searchCache = new Map<string, CachedSearch>()
// A repeat inside this window is answered from the cache alone (no background refresh).
const FRESH_MS = 30 * 1000

// ── Sticky search location (Indeed-style) ────────────────────────────────────────────────
// A location the user chose or searched persists across reloads/navigation so GPS/auto-fill
// can never stomp it. Device-local; CLEARED on sign-out (added to SESSION_LOCAL_KEYS in
// lib/auth.tsx) so one account's location can't bleed into the next person on a shared device.
const LOC_KEY = 'seen_job_location_v1'

function readStoredLocation(): string {
  try { return (localStorage.getItem(LOC_KEY) || '').trim() } catch { return '' }
}

// Persist ONLY explicit location choices (typing, picking a suggestion, GPS resolve). Auto-
// seeding from the profile HOME or a recent search deliberately does NOT persist here, so the
// home stays dynamic (re-read from the profile each visit) until the user actually changes it.
function writeStoredLocation(v: string): void {
  try {
    const t = (v || '').trim()
    if (t) localStorage.setItem(LOC_KEY, t)
    else localStorage.removeItem(LOC_KEY)
  } catch { /* ignore quota/private-mode */ }
}

// Industry ("niche") matching for the jobs filter. The old version keyword-matched the TITLE
// ONLY against a tiny list (retail = "retail|store|cashier|food|restaurant|barista"), so the bulk
// of real listings — "Server", "Crew Member", "Line Cook", "Sales Associate", "Team Member" —
// matched nothing and the board fell back to "No exact filter matches — showing all N roles",
// which reads as a broken filter. Now we match title + company + description across a real-world
// keyword set per industry, and "other" is a true negation (jobs in none of the known industries).
// Short/ambiguous tokens (a bare "it", "tech") are deliberately excluded so description text
// doesn't false-match everything.
const NICHE_PATTERNS: Record<string, RegExp> = {
  tech: /engineer|developer|software|programmer|\bdev\b|devops|\bdata\b|front[- ]?end|back[- ]?end|full[- ]?stack|web dev|cloud|cyber|\bqa\b|machine learning|\bml\b|\bai\b|\bsre\b|architect|sysadmin|database|analytics|technolog/i,
  healthcare: /nurs|\brn\b|\blpn\b|\bcna\b|doctor|physician|health|medical|\bmedic\b|pharmac|clinic|caregiv|care\s?giver|therap|dental|patient|hospital|\baide\b|phlebot|radiolog|surgical|behavioral|assisted living|home care/i,
  retail: /retail|\bstore\b|\bshop\b|cashier|sales assoc|merchandis|stock(er|ing| assoc)?|\bfood\b|restaurant|barista|\bserver\b|waiter|waitress|\bcook\b|kitchen|\bchef\b|\bcrew\b|team member|host(ess)?|bartend|\bdeli\b|grocery|fast[- ]?food|caf[eé]\b|coffee|dishwash|busser|shift (lead|superv|manager)|key\s?holder|hospitality|catering|concession|drive[- ]?thru|cafeteria|dietary|fry cook|line cook/i,
  logistics: /driver|warehouse|logistic|supply chain|\bdelivery\b|courier|forklift|\bloader\b|\bpicker\b|\bpacker\b|shipping|receiving|\bfreight\b|dispatch|fulfillment|distribution|material handler|\bcdl\b|\btruck\b|\broute\b|\bmover\b/i,
  finance: /financ|accounting|accountant|bookkeep|\banalyst\b|banker|\bbank\b|insurance|teller|underwrit|actuar|\baudit|\btax\b|payroll|\bcredit\b|investment|\bloan\b|mortgage|controller|billing/i,
}

// True if a job belongs to the selected industry. 'other' = matches none of the known industries.
function matchesNiche(job: Job, niche: string): boolean {
  const hay = `${job.title || ''} ${job.company || ''} ${job.description || ''} ${job.source || ''}`.toLowerCase()
  if (niche === 'other') return !Object.values(NICHE_PATTERNS).some(re => re.test(hay))
  const re = NICHE_PATTERNS[niche]
  return re ? re.test(hay) : true
}

// Parse a score/waste value from the API into a real number, or null when absent — we never
// fabricate a default (e.g. the old `|| 65`). The API now always sends an earned number for
// live listings; null is the honest "unrated" fallback for anything malformed or legacy.
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

// 'best' = the server's query relevance (title match > role-family match > description), with the
// transparency score as the tiebreak. It is the default: the live audit (2026-10-23) found
// "customer service · Phoenix" opening with a PwC Director because the page re-sorted the server's
// relevance order by transparency score. The other three stay as explicit choices.
export type SortMode = 'best' | 'transparency' | 'waste' | 'recent'
// A search result as the API serves it: `relevance` (server rank for the typed query) and
// `in_radius` (false = a fill-in from further away / remote, which never sorts above an in-radius row).
// `related` (false = an opening that only shares a word with the search — listed under "Other openings").
export interface SearchJob extends Job { relevance?: number | null; in_radius?: boolean; related?: boolean }
export type RecReason = 'no_resume' | 'no_signal' | 'no_city' | 'no_matches' | 'unavailable' | null
export type NicheFilter = '' | 'tech' | 'healthcare' | 'retail' | 'logistics' | 'finance' | 'other'
export type LevelFilter = '' | 'entry' | 'mid' | 'senior'
export type TypeFilter = '' | 'Full-time' | 'Part-time' | 'Contract'
export type PostedFilter = '' | '1' | '7' | '30'

// Company intel for job cards. ONLY gradeable companies (≥5 real reports — lib/gradeGate.ts) are
// ever put in this map, so every consumer can trust these numbers are earned verdicts.
export type CoScoreMap = Record<string, { ghost_rate: number; overall_score: number; response_rate?: number }>

// API listing → the page's Job shape. Module-level so the search and its silent top-up refresh
// map identically.
function toJobs(items: unknown[], loc: string): SearchJob[] {
  return items.map((item: unknown) => {
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
      score: numOrNull(j.score),
      waste: numOrNull(j.waste_score ?? j.waste),
      // '' = the title says nothing about level; never a default label (the old 'Mid level').
      level: String(j.level || j.lvl || ''),
      relevance: numOrNull(j.relevance),
      in_radius: j.in_radius !== false,
      related: j.related !== false,
      type: String(j.type || 'Full-time'),
      source: String(j.source || 'Job board'),
      description: String(j.description || ''),
      salary: j.salary ? String(j.salary) : null,
      apply_url,
      posted_at: j.posted_at ? String(j.posted_at) : null,
      featured: !!j.featured,
      // Without these the "Posted on Seen" badge, its search-priority tier (applySort →
      // sortByPriority) and the Apply-on-Seen buttons never reach the page.
      employer_posted: !!j.employer_posted,
      company_match: !!j.company_match,
      apply_mode: j.apply_mode === 'seen' || j.apply_mode === 'both' ? j.apply_mode : 'external',
    }
  })
}

export function useJobSearch() {
  const { isLoggedIn, profile, token, ready } = useAuth()
  const [query, setQuery] = useState('')
  const [location, setLocationRaw] = useState('')
  // Persisting setter — used for the user's EXPLICIT choices (the page's location input and
  // suggestion picks, plus a resolved GPS location). Auto-seeds (home / recent / stored) use
  // setLocationRaw directly so they don't get re-persisted as a fresh explicit choice.
  const setLocation = useCallback((v: string) => { setLocationRaw(v); writeStoredLocation(v) }, [])
  const autoSearchedRef = useRef(false)
  const searchedOnceRef = useRef(false) // a real search has run → a radius change should re-search
  const [gpsLoading, setGpsLoading] = useState(false)
  const [radius, setRadius] = useState('25')
  const [niche, setNiche] = useState<NicheFilter>('')
  const [level, setLevel] = useState<LevelFilter>('')
  const [jobType, setJobType] = useState<TypeFilter>('')
  const [posted, setPosted] = useState<PostedFilter>('')
  const [sort, setSort] = useState<SortMode>('best')
  const [jobs, setJobs] = useState<Job[]>([])
  const [filtered, setFiltered] = useState<Job[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [statusMsg, setStatusMsg] = useState('Enter a search above →')
  // The honest location note for the current page ("Only 6 within 25 mi …"); null = nothing to say.
  const [notice, setNotice] = useState<string | null>(null)
  const [recommended, setRecommended] = useState<Job[]>([])
  const [recSkills, setRecSkills] = useState<string[]>([])
  const [recStatus, setRecStatus] = useState<'idle' | 'loading' | 'done'>('idle')
  // Whether the account has a résumé on file (from the rail's response); null = unknown.
  const [recHasResume, setRecHasResume] = useState<boolean | null>(null)
  // Why the rail is empty ('no_city' → the page asks for a city) and the city it matched near.
  const [recReason, setRecReason] = useState<RecReason>(null)
  const [recCity, setRecCity] = useState<string | null>(null)
  // Where the rail's city came from: the profile, or the résumé's own contact line.
  const [recCitySource, setRecCitySource] = useState<'profile' | 'resume' | null>(null)
  const [coScores, setCoScores] = useState<CoScoreMap>({})
  const [appliedCos, setAppliedCos] = useState<Set<string>>(new Set())
  const abortRef = useRef<AbortController | null>(null)
  // Bumped by every new search, so a pending silent top-up refresh for an older search is dropped.
  const searchSeqRef = useRef(0)
  const topupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Paging ("Show 60 more"): whether the server holds more matches, and the page count loaded.
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const hasMoreRef = useRef(false); hasMoreRef.current = hasMore
  const pagesRef = useRef(1)
  // Latest inputs for timers and handlers that outlive their render (the debounced auto-search used to
  // read the location from the render it was scheduled in — audit L3: a location typed meanwhile was
  // sent as ""). searchJobs reads these, never the closure.
  const queryRef = useRef(query); queryRef.current = query
  const locationRef = useRef(location); locationRef.current = location
  const radiusRef = useRef(radius); radiusRef.current = radius
  const jobsRef = useRef(jobs); jobsRef.current = jobs
  const filtersRef = useRef({ niche, level, jobType, posted }); filtersRef.current = { niche, level, jobType, posted }
  // The last COMMITTED search (Enter / Search / a pick / a link) — what the URL shows and "Show more"
  // continues. The debounced auto-search never commits.
  const committedRef = useRef<{ q: string; loc: string; radius: string } | null>(null)
  // The committed query as state, for what the page shows about the search that ran (the company card).
  const [committedQuery, setCommittedQuery] = useState('')
  // The search key a request is in flight for — a second call for the same search is dropped.
  const inflightKeyRef = useRef<string | null>(null)
  // A radius set FROM the URL on load: its state change must not re-run the search it came with.
  const urlRadiusRef = useRef<string | null>(null)

  const hasFilters = !!(niche || level || jobType || posted)

  // The committed search (+ current sort and filters) as the page URL: shareable, survives a reload,
  // and Back from a listing lands on it (lib/jobs/searchUrl.js). replaceState — no history entry per
  // search, no navigation, no re-render.
  function writeUrl(over: { radius?: string } = {}) {
    const c = committedRef.current
    if (!c || typeof window === 'undefined') return
    const f = filtersRef.current
    const qs = searchQueryString({ q: c.q, loc: c.loc, radius: over.radius ?? c.radius, sort: sortRef.current, niche: f.niche, level: f.level, type: f.jobType, posted: f.posted })
    const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
    if (next !== `${window.location.pathname}${window.location.search}`) {
      try { window.history.replaceState(null, '', next) } catch { /* ignore */ }
    }
  }

  function applySort(list: Job[], mode: SortMode): Job[] {
    const copy = [...list] as SearchJob[]
    const score = (j: Job) => j.score ?? -Infinity // unrated (null) sorts to the end, never treated as 0
    if (mode === 'waste') copy.sort((a, b) => (a.waste ?? Infinity) - (b.waste ?? Infinity))
    else if (mode === 'recent') copy.sort((a, b) => (Date.parse(b.posted_at || '') || 0) - (Date.parse(a.posted_at || '') || 0)) // newest first, undated last
    else if (mode === 'transparency') copy.sort((a, b) => score(b) - score(a))
    else copy.sort((a, b) => ((b.relevance ?? 0) - (a.relevance ?? 0)) || (score(b) - score(a))) // best match: server relevance, score tiebreak
    // Every mode then keeps in-radius rows ahead of the far-away/remote fill-ins, and Featured and
    // posted-on-Seen listings first within each (stable) — lib/server/jobPriority.js.
    return sortByPriority(copy)
  }

  function applyFilters(list: Job[]): Job[] {
    let out = list
    if (niche) out = out.filter(j => matchesNiche(j, niche))
    if (level) out = out.filter(j => (j.level || '').toLowerCase().includes(level))
    if (jobType) out = out.filter(j => j.type === jobType)
    // "Added to Seen" within 1/7/30 days (posted_at = the row's created_at). Every search row carries
    // it since the instant-response search (2026-10-17) serves stored rows only, so a row with no date
    // is NOT counted as recent — "Last 24 hours" never shows an undated listing as new.
    if (posted) {
      const days = parseInt(posted, 10)
      if (Number.isFinite(days) && days > 0) {
        const cutoff = Date.now() - days * 86400000
        out = out.filter(j => !!j.posted_at && new Date(j.posted_at).getTime() >= cutoff)
      }
    }
    return out
  }

  const updateDisplay = useCallback((list: Job[], sortMode: SortMode) => {
    const f = applyFilters(list)
    // Filters that match nothing say so (the chips stay lit, so the fix is obvious) instead of
    // silently showing every row under an active filter.
    if (f.length === 0 && list.length > 0) {
      setFiltered([])
      // The date filter is the usual culprit — say how fresh the newest listing actually is.
      const newest = posted ? Math.max(0, ...list.map(j => Date.parse(j.posted_at || '') || 0)) : 0
      const onlyDate = posted && !niche && !level && !jobType
      setStatusMsg(onlyDate && newest
        ? `None of these were added to Seen in the ${posted === '1' ? 'last 24 hours' : posted === '7' ? 'last week' : 'last month'} — the newest arrived ${new Date(newest).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' })}.`
        : 'No listings match these filters — clear one to see the rest.')
      return
    }
    const s = applySort(f, sortMode)
    setFiltered(s)
    // Matches and other openings are counted apart (the list shows them apart); "+" when the server
    // holds more ("Show 60 more").
    const nMatch = s.filter(isMatch).length
    const nOther = s.length - nMatch
    const plus = hasMoreRef.current ? '+' : ''
    setStatusMsg(s.length === 0 ? 'No results. Try a different title or wider radius.'
      : nMatch > 0 && nOther > 0 ? `${nMatch}${plus} match${nMatch !== 1 ? 'es' : ''} · ${nOther} other opening${nOther !== 1 ? 's' : ''}`
      : nMatch === 0 ? `No matches for "${committedRef.current?.q || ''}" — ${nOther} other opening${nOther !== 1 ? 's' : ''}`
      : `${s.length}${plus} result${s.length !== 1 ? 's' : ''}`)
  }, [niche, level, jobType, posted]) // eslint-disable-line react-hooks/exhaustive-deps
  // Latest sort + filters for the delayed top-up refresh (its timer outlives the render it was set in).
  const sortRef = useRef(sort); sortRef.current = sort
  const updateDisplayRef = useRef(updateDisplay); updateDisplayRef.current = updateDisplay
  // A pending top-up refresh never fires after the page unmounts.
  useEffect(() => () => { if (topupTimerRef.current) clearTimeout(topupTimerRef.current) }, [])

  useEffect(() => {
    if (jobs.length > 0) updateDisplay(jobs, sort)
    writeUrl() // a filter or sort change after a committed search is part of the shareable URL
  }, [niche, level, jobType, posted, sort]) // eslint-disable-line react-hooks/exhaustive-deps

  // Radius is a SERVER-side geo filter (the DB does the bbox scan) — it can't be applied to the
  // already-loaded listings client-side like niche/level/type. So changing the radius dropdown
  // must RE-RUN the search with the current query+location; otherwise it silently does nothing to
  // the visible results ("radius doesn't work"). Only fires after the first real search, and the
  // 5-min client cache is keyed on radius so distinct radii don't serve each other's stale page.
  useEffect(() => {
    // The radius a shared link carried arrives with its own search — not a second one.
    if (urlRadiusRef.current !== null) {
      const fromUrl = urlRadiusRef.current
      urlRadiusRef.current = null
      if (fromUrl === radius) return
    }
    if (searchedOnceRef.current) searchJobs(undefined, undefined, { radius })
  }, [radius]) // eslint-disable-line react-hooks/exhaustive-deps

  // Honor inbound search params — the Demand page links here with ?q=<title>&loc=<city>
  // ("Find these jobs →"). These were silently ignored; the user got the default page.
  // Runs before the GPS/recent-search effects and claims autoSearchedRef so they don't
  // stomp the explicit intent. (window.location avoids the useSearchParams Suspense req.)
  // The page's own committed searches are written to the URL too (writeUrl: ?q=&loc=&r=&sort= and the
  // filters), so a reload, a shared link or Back from a listing restores the whole search.
  useEffect(() => {
    try {
      const u = readSearchQuery(window.location.search)
      if (u.q) {
        autoSearchedRef.current = true
        setQuery(u.q)
        if (u.loc) setLocation(u.loc)
        if (u.radius !== radiusRef.current) { urlRadiusRef.current = u.radius; setRadius(u.radius) }
        if (u.sort !== 'best') { sortRef.current = u.sort as SortMode; setSort(u.sort as SortMode) }
        if (u.niche) setNiche(u.niche as NicheFilter)
        if (u.level) setLevel(u.level as LevelFilter)
        if (u.type) setJobType(u.type as TypeFilter)
        if (u.posted) setPosted(u.posted as PostedFilter)
        filtersRef.current = { niche: u.niche as NicheFilter, level: u.level as LevelFilter, jobType: u.type as TypeFilter, posted: u.posted as PostedFilter }
        searchJobs(u.q, u.loc || '', { radius: u.radius })
      } else if (u.loc) {
        // A city with no title (the homepage box with only "City or remote" filled): pre-fill the
        // location and wait for a title — a search needs one. Claims the seed so nothing stomps it.
        autoSearchedRef.current = true
        setLocation(u.loc)
      }
    } catch {}
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Initial location seed + auto-search. Runs AFTER the URL-params effect above (which has
  // already claimed autoSearchedRef for an explicit ?q link — do NOT reorder). Gated on
  // `ready` so we act with correct knowledge of logged-in state + a loaded profile. Priority
  // (Indeed-style location behavior):
  //   1) a location the user previously CHOSE/searched (LOC_KEY) — survives reloads; GPS
  //      never stomps it.
  //   2) signed-in: the profile HOME location as a pre-fill (re-runs when profile loads late).
  //   3) signed-out: the last recent search (restores query + loc) — also a "set" location.
  //   4) nothing — the browser location prompt is asked ONLY when the person taps 📍 (requestGpsLocation).
  //      It used to fire on load for a first visit, so a Google landing met a permission prompt before
  //      any results (conversion audit 2026-10-24); same for a signed-in account with no city on file.
  useEffect(() => {
    if (!ready) return                     // wait until logged-in state + profile are known
    if (autoSearchedRef.current) return    // an explicit ?q search already ran
    if (location.trim()) return            // user already typed a location — respect it

    // 1) A previously chosen/searched location wins over everything auto — and over GPS.
    const stored = readStoredLocation()
    if (stored) {
      autoSearchedRef.current = true
      setLocationRaw(stored)
      searchJobs(undefined, stored)
      return
    }

    // 2) Signed-in → the profile HOME city wins. `ready` flips before the profile row arrives
    //    (lib/auth.tsx loads it after the session), so we wait for the row (profile is a dep) rather
    //    than fall through while a home city may still be incoming. No city on file → the 📍 button.
    if (isLoggedIn) {
      if (!profile) return
      if (profile.city) {
        autoSearchedRef.current = true
        setLocationRaw(profile.city)
        searchJobs(undefined, profile.city)
      }
      return
    }

    // 3) Signed-out with a recent search (no stored choice) → restore its LOCATION only; this
    //    counts as a previously-set location, so GPS won't fire over it. The query is NOT re-run:
    //    the store also holds homepage company lookups ("Walmart" → /company/walmart), so the old
    //    auto-search opened /jobs with a stale "Walmart" results page (live audit 2026-10-23).
    try {
      const recent = RecentSearchesStore.get()
      if (recent.length > 0) {
        autoSearchedRef.current = true
        if (recent[0].loc) setLocationRaw(recent[0].loc)
        return
      }
    } catch {}
    // 4) Nothing stored anywhere → no prompt; the 📍 button asks when tapped.
  }, [ready, isLoggedIn, profile === null, profile?.city]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch resume-powered recommendations when logged in
  useEffect(() => {
    if (!isLoggedIn) { setRecHasResume(null); setRecReason(null); setRecCity(null); setRecCitySource(null); return }
    setRecStatus('loading')
    setRecHasResume(null)
    setRecReason(null)
    aiHeaders().then(hdrs => fetch('/api/jobs', {
      method: 'POST',
      headers: hdrs,
      body: JSON.stringify({ action: 'recommended' }),
    }))
    .then(r => r.ok ? r.json() : {})
    .then((data: { jobs?: unknown[]; skills?: string[]; has_resume?: boolean | null; reason?: RecReason; city?: string | null; city_source?: 'profile' | 'resume' | null }) => {
      if (typeof data.has_resume === 'boolean') setRecHasResume(data.has_resume)
      setRecReason(data.reason ?? null)
      setRecCity(typeof data.city === 'string' && data.city ? data.city : null)
      setRecCitySource(data.city_source === 'resume' || data.city_source === 'profile' ? data.city_source : null)
      if (Array.isArray(data.jobs) && data.jobs.length) {
        const raw: Job[] = (data.jobs as Record<string, unknown>[]).map(j => ({
          id: String(j.id || 'rec_' + Math.random().toString(36).slice(2, 8)),
          title: String(j.title || ''),
          company: String(j.company || ''),
          location: String(j.location || 'US'),
          score: numOrNull(j.score),
          waste: numOrNull(j.waste_score ?? j.waste),
          level: String(j.level || ''),
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
      .then((d: { scores?: Record<string, { ghost_rate?: number | null; overall_score?: number | null; response_rate?: number | null; gradeable?: boolean | null; first_party_report_count?: number | null }> }) => {
        if (!d.scores) return
        // Grade gate: drop ungraded companies (verdict fields null below the bar) so no card shows a
        // ghost-rate badge or hiring probability built from too few reports.
        const graded: CoScoreMap = {}
        for (const [k, v] of Object.entries(d.scores)) {
          if (isGradeableScore(v) && typeof v.ghost_rate === 'number') {
            graded[k] = { ghost_rate: v.ghost_rate, overall_score: v.overall_score, ...(typeof v.response_rate === 'number' ? { response_rate: v.response_rate } : {}) }
          }
        }
        setCoScores(prev => ({ ...prev, ...graded }))
      })
      .catch(() => {})
  }, [recommended, jobs])

  useEffect(() => {
    try {
      const apps = AppStore.loadSync()
      // Keys are job ids and apply URLs — "Applied" means THIS listing, not any listing at the company.
      setAppliedCos(new Set(apps.flatMap(a => [a.jobId, a.jobUrl].filter((k): k is string => !!k))))
    } catch {}
  }, [])

  // Suggest a level chip from the profile ONCE — and only if at least one loaded listing carries that
  // level (level is inferred from titles and is mostly "Mid level", so a "senior" chip emptied the board).
  const levelSuggestedRef = useRef(false)
  useEffect(() => {
    if (!profile?.experience || level || levelSuggestedRef.current || !jobs.length) return
    const exp = profile.experience.toLowerCase()
    const want = (exp.includes('entry') || exp.includes('0-1') || exp.includes('junior') || exp.includes('intern')) ? 'entry'
      : (exp.includes('senior') || exp.includes('5+') || exp.includes('lead') || exp.includes('staff') || exp.includes('principal')) ? 'senior'
      : (exp.includes('mid') || exp.includes('2-') || exp.includes('3-') || exp.includes('4-')) ? 'mid' : ''
    if (!want) return
    levelSuggestedRef.current = true
    if (jobs.some(j => (j.level || '').toLowerCase().includes(want))) setLevel(want as LevelFilter)
  }, [profile?.experience, jobs]) // eslint-disable-line react-hooks/exhaustive-deps

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
        // A resolved GPS location IS an explicit "set" — persist it (via the wrapper) so it
        // survives reloads and GPS won't re-fire over it next visit.
        setLocation(loc)
        if (!autoSearchedRef.current) { autoSearchedRef.current = true; searchJobs(undefined, loc) }
      }
    } catch {
      // GPS failed — fall back to profile HOME (not persisted; home stays dynamic).
      if (profile?.city && !autoSearchedRef.current) {
        autoSearchedRef.current = true
        setLocationRaw(profile.city)
        searchJobs(undefined, profile.city)
      }
    }
    finally { setGpsLoading(false) }
  }

  /**
   * Run a search. `commit` (default true) = an explicit search the person asked for: it becomes the
   * page URL and what "Show more" continues. The debounced auto-search passes commit:false. A second
   * call for a search already in flight, or one answered < 30 s ago, sends no request (audit L2: Enter
   * right after the auto-search fired the same POST twice and flashed the results).
   */
  async function searchJobs(queryOverride?: string, locationOverride?: string, opts: { radius?: string; commit?: boolean } = {}) {
    const q = (queryOverride ?? queryRef.current).trim()
    const loc = (locationOverride ?? locationRef.current).trim()
    const rad = opts.radius ?? radiusRef.current
    const commit = opts.commit !== false
    if (!q) {
      setStatusMsg('Enter a job title to search.')
      return
    }
    searchedOnceRef.current = true
    const cacheKey = `${q}|${loc}|${rad}`
    if (commit) { committedRef.current = { q, loc, radius: rad }; setCommittedQuery(q); writeUrl({ radius: rad }) }
    if (inflightKeyRef.current === cacheKey) return // the same search is already on its way
    const cached = searchCache.get(cacheKey)
    const showCached = (c: CachedSearch, refreshing: boolean) => {
      if (abortRef.current) abortRef.current.abort() // drop any older in-flight search
      inflightKeyRef.current = null
      pagesRef.current = c.pages
      hasMoreRef.current = c.hasMore; setHasMore(c.hasMore)
      setJobs(c.jobs)
      updateDisplayRef.current(c.jobs, sortRef.current)
      setStatus('done')
      setNotice(c.notice)
      if (c.label) setStatusMsg(c.label)
      else if (refreshing) setStatusMsg(`${c.jobs.length} result${c.jobs.length !== 1 ? 's' : ''} (from cache — refreshing…)`)
    }
    if (cached && Date.now() - cached.ts < FRESH_MS) {
      ++searchSeqRef.current // a pending top-up refresh for an older search is dropped
      if (topupTimerRef.current) { clearTimeout(topupTimerRef.current); topupTimerRef.current = null }
      showCached(cached, false)
      return
    }
    const seq = ++searchSeqRef.current
    if (topupTimerRef.current) { clearTimeout(topupTimerRef.current); topupTimerRef.current = null }
    setNotice(null)

    const CACHE_TTL = 5 * 60 * 1000 // 5 min
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      // Serve cached results immediately, then silently refresh in background
      showCached(cached, true)
    } else {
      if (abortRef.current) abortRef.current.abort()
      abortRef.current = new AbortController()
      setStatus('loading')
      setStatusMsg('Searching...')
      hasMoreRef.current = false; setHasMore(false)
      if (!cached) { setJobs([]); setFiltered([]) }
    }
    inflightKeyRef.current = cacheKey
    const done = () => { if (inflightKeyRef.current === cacheKey && seq === searchSeqRef.current) inflightKeyRef.current = null }

    // Send the signed-in user's token so the server rate-buckets PER USER, not per shared
    // IP — this is what lets several people on one WiFi (or a whole CGNAT carrier) search
    // at the same time without starving each other. Anonymous users fall back to IP.
    let authToken: string | null = null
    if (isLoggedIn) { try { authToken = await token() } catch { /* anonymous bucket */ } }

    // One automatic retry on a transient failure (cold start, flaky network) before
    // ever showing an error — a single blip should never surface as "Search failed".
    for (let attempt = 0; ; attempt++) {
      try {
        const ctrl = new AbortController()
        abortRef.current = ctrl
        const res = await fetch('/api/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
          body: JSON.stringify({ query: q, location: loc, radius: rad }),
          signal: ctrl.signal,
        })
        if (res.status === 429) {
          // The abuse ceiling (not a normal condition since search became tiered). Say what
          // it is instead of a generic failure — and don't burn the retry on it.
          done()
          setStatus('error')
          setStatusMsg('You’re searching very fast — give it a few seconds and try again.')
          return
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json() as { jobs?: unknown[]; results?: unknown[]; widened?: boolean; fallback?: 'outside_radius' | 'unrelated' | 'remote_thin' | null; radius?: number | null; location?: string; topup?: string | null; in_radius?: number | null; has_more?: boolean }
        if (seq !== searchSeqRef.current) return // a newer search took over
        done()
        const raw: Job[] = toJobs(data.jobs || data.results || [], loc)
        const more = data.has_more === true
        pagesRef.current = 1
        hasMoreRef.current = more; setHasMore(more)
        JobCache.setMany(raw)
        setJobs(raw)
        updateDisplayRef.current(raw, sortRef.current)
        setStatus('done')
        // Say exactly what the server did when it could not fill the page from matches:
        //  unrelated   → nothing matched the title at all; these are other openings (never "matches")
        //  remote_thin → few remote matches; non-remote roles fill the rest
        // For a place search the server counts the rows inside the radius (`in_radius`) and serves
        // them first; the note says how many — never "no jobs within 25 mi" above six Phoenix rows.
        const placeSearch = !!loc && data.location !== 'remote' && rad !== '0'
        const inR = typeof data.in_radius === 'number' ? data.in_radius : null
        let label: string | null = null
        let note: string | null = null
        if (raw.length && data.fallback === 'unrelated') {
          label = `No matches for "${q}" — showing ${raw.length} other opening${raw.length !== 1 ? 's' : ''}${placeSearch ? ` near ${loc}` : ''}`
        } else if (raw.length && data.fallback === 'remote_thin') {
          label = `Few remote matches for "${q}" — also showing roles that aren't marked remote`
        } else if (raw.length && placeSearch && inR !== null && inR < raw.length) {
          const r = data.radius || rad
          note = inR === 0
            ? `No ${q} jobs within ${r} mi of ${loc} — showing the nearest and remote ones`
            : `Only ${inR} within ${r} mi of ${loc} — the rest are further away or remote`
        }
        if (label) setStatusMsg(label)
        setNotice(note)
        searchCache.set(cacheKey, { jobs: raw, ts: Date.now(), hasMore: more, pages: 1, notice: note, label })
        if (q) try { RecentSearchesStore.push(q, loc || undefined) } catch {}
        // The server answered instantly from our corpus and is pulling more listings in the
        // background (topup:'pending'). Re-read once, silently — no spinner, sort kept — and merge
        // in anything new. Dropped if a newer search starts first or more pages were loaded.
        if (data.topup === 'pending') {
          topupTimerRef.current = setTimeout(async () => {
            if (seq !== searchSeqRef.current || pagesRef.current > 1) return
            try {
              const r2 = await fetch('/api/jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
                body: JSON.stringify({ query: q, location: loc, radius: rad, db_only: true }),
              })
              if (!r2.ok || seq !== searchSeqRef.current || pagesRef.current > 1) return
              const d2 = await r2.json() as { jobs?: unknown[]; has_more?: boolean }
              const fresh = toJobs(d2.jobs || [], loc)
              if (seq !== searchSeqRef.current || pagesRef.current > 1 || fresh.length <= raw.length) return
              const more2 = d2.has_more === true
              hasMoreRef.current = more2; setHasMore(more2)
              searchCache.set(cacheKey, { jobs: fresh, ts: Date.now(), hasMore: more2, pages: 1, notice: note, label })
              JobCache.setMany(fresh)
              setJobs(fresh)
              updateDisplayRef.current(fresh, sortRef.current)
            } catch { /* keep the first page */ }
          }, 4000)
        }
        return
      } catch (err) {
        if ((err as Error).name === 'AbortError') return // superseded by a newer search
        if (attempt < 1) { await new Promise(r => setTimeout(r, 1200)); continue }
        done()
        setStatus('error')
        setStatusMsg('Search failed. Please try again.')
        return
      }
    }
  }

  // "Show 60 more": the next page of the COMMITTED search. The server returns the best 60 matches
  // this page does not already show (`exclude`), so nothing repeats; merged, re-sorted, cached.
  async function loadMore() {
    const c = committedRef.current
    if (!c || loadingMore || !hasMoreRef.current) return
    const key = `${c.q}|${c.loc}|${c.radius}`
    const seq = searchSeqRef.current
    const have = jobsRef.current
    setLoadingMore(true)
    try {
      let authToken: string | null = null
      if (isLoggedIn) { try { authToken = await token() } catch { /* anonymous bucket */ } }
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify({ query: c.q, location: c.loc, radius: c.radius, offset: pagesRef.current * 60, exclude: have.map(j => j.id) }),
      })
      if (!res.ok || seq !== searchSeqRef.current) { if (res.status === 429) notifyFast(); return }
      const data = await res.json() as { jobs?: unknown[]; has_more?: boolean }
      if (seq !== searchSeqRef.current) return
      const ids = new Set(have.map(j => j.id))
      const added = toJobs(data.jobs || [], c.loc).filter(j => !ids.has(j.id))
      const all = [...have, ...added]
      pagesRef.current += 1
      const more = data.has_more === true && added.length > 0
      hasMoreRef.current = more; setHasMore(more)
      const prev = searchCache.get(key)
      searchCache.set(key, { jobs: all, ts: Date.now(), hasMore: more, pages: pagesRef.current, notice: prev?.notice ?? null, label: prev?.label ?? null })
      JobCache.setMany(all)
      setJobs(all)
      updateDisplayRef.current(all, sortRef.current)
    } catch { /* the button stays; a tap retries */ } finally {
      setLoadingMore(false)
    }
  }
  function notifyFast() { setStatusMsg('You’re searching very fast — give it a few seconds and try again.') }

  function clearFilters() {
    setNiche('')
    setLevel('')
    setJobType('')
    setPosted('')
    setFiltered(applySort(jobs, sort))
    setStatusMsg(jobs.length > 0 ? `${jobs.length} result${jobs.length !== 1 ? 's' : ''}` : 'Enter a search above →')
  }

  // The error state's Retry: re-run the same query and location (the inputs still hold them).
  function retrySearch() {
    searchCache.delete(`${queryRef.current.trim()}|${locationRef.current.trim()}|${radiusRef.current}`)
    inflightKeyRef.current = null
    void searchJobs()
  }

  return {
    // auth passthrough (search machine reacts to these)
    isLoggedIn,
    profile,
    // search inputs
    query, setQuery,
    location, setLocation,
    committedQuery,
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
    notice,
    // recommendations + company scores
    recommended,
    recSkills,
    recStatus,
    recHasResume,
    recReason,
    recCity,
    recCitySource,
    coScores,
    appliedCos,
    // paging
    hasMore,
    loadingMore,
    loadMore,
    // actions
    searchJobs,
    retrySearch,
    requestGpsLocation,
    clearFilters,
  }
}
