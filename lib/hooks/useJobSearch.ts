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
import { replaceSearchKeepingPlaces } from '@/lib/nav/urlState'
import { radiusNotice, leadIds } from '@/lib/jobs/radiusNotice.js'
import { matchesNiche } from '@/lib/jobs/jobFilters.js'

// In-memory search cache: `${query}|${location}|${radius}` → the page as it was shown (rows, whether
// the server has more, and the honest note/label it carried), so a repeat of the same search — Enter
// right after the auto-search, Back from a listing — is served without a second request.
interface CachedSearch { jobs: Job[]; ts: number; hasMore: boolean; pages: number; notice: string | null; label: string | null; area?: AreaInfo | null; problem?: AreaProblem | null; cursor?: string | null }

// An area search (a place, no title — api/jobs.js handleAreaSearch): what the server counted.
export interface AreaInfo {
  /** Listings (one per location) in the area. */
  total: number
  /** Jobs = cards: one per employer + title, however many locations it lists. */
  jobsTotal: number
  remoteTotal: number
  label: string
  kind: 'point' | 'state' | 'county' | 'remote'
  radius: number | null
  includeRemote: boolean
  wider: { radius: number; total: number } | null
  complete: boolean
  /** What was typed in the place box for this search. */
  typed: string
  /** Set when the server read a misspelling as a place ("Tuscon AZ" → Tucson, AZ): what the person typed. */
  understood?: string | null
  sort: 'nearest' | 'recent'
}
// An area search the server could not run as asked: an unknown / foreign / ambiguous place, "near me" with no
// position, or Remote with no title.
export interface AreaProblem { message: string; suggestions: string[]; reason: string | null; needTitle?: boolean }

/** The results header for an area search: exactly what is listed. */
export function areaStatus(a: AreaInfo): string {
  const n = a.total
  const j = Math.min(a.jobsTotal || n, n)
  const fmt = (x: number) => x.toLocaleString('en-US')
  // One number per thing: cards are jobs; a job open in several places counts each place as a location.
  const jobs = j < n ? `${fmt(j)} job${j === 1 ? '' : 's'} (${fmt(n)} locations)` : `${fmt(n)} job${n === 1 ? '' : 's'}`
  if (a.kind === 'remote') return `${fmt(n)} remote job${n === 1 ? '' : 's'} in the US · newest first`
  const where = a.kind !== 'point' ? `in ${a.label}` : `within ${a.radius} mile${a.radius === 1 ? '' : 's'} of ${a.label}`
  if (!n) return `No jobs ${where}`
  const remote = a.includeRemote && a.remoteTotal ? ` · including ${fmt(a.remoteTotal)} remote listing${a.remoteTotal === 1 ? '' : 's'}` : ''
  const partial = a.complete ? '' : ' found so far — still counting'
  return `${jobs} ${where}${remote}${partial} · ${a.kind !== 'point' || a.sort === 'recent' ? 'newest first' : 'nearest first'}`
}
const searchCache = new Map<string, CachedSearch>()
// The last few searches also live in this tab's sessionStorage, so Back from a listing, a company
// page or the employer's site (a full page load, which empties the Map) shows the SAME list at once —
// the Indeed behaviour — instead of a fresh search that reshuffles it (owner 2026-11-01).
const SESSION_SEARCH_KEY = 'seen_search_cache_v1'
const SESSION_SEARCHES = 3
// A search restored from the URL (Back, reload) is shown as it was for this long without a refetch.
const RESTORE_MS = 30 * 60 * 1000
function readSessionSearches(): Record<string, CachedSearch> {
  try { return JSON.parse(sessionStorage.getItem(SESSION_SEARCH_KEY) || '{}') || {} } catch { return {} }
}
function persistSearch(key: string, entry: CachedSearch) {
  try {
    const all = readSessionSearches()
    all[key] = entry
    const keys = Object.keys(all).sort((a, b) => all[b].ts - all[a].ts)
    for (const k of keys.slice(SESSION_SEARCHES)) delete all[k]
    try { sessionStorage.setItem(SESSION_SEARCH_KEY, JSON.stringify(all)) }
    catch { sessionStorage.setItem(SESSION_SEARCH_KEY, JSON.stringify({ [key]: entry })) } // quota: keep the newest only
  } catch { /* storage unavailable — the in-memory cache still works */ }
}
function cacheSearch(key: string, entry: CachedSearch) {
  searchCache.set(key, entry)
  persistSearch(key, entry)
}
function cachedSearch(key: string): CachedSearch | undefined {
  const hit = searchCache.get(key)
  if (hit) return hit
  const stored = readSessionSearches()[key]
  if (stored && Array.isArray(stored.jobs)) { searchCache.set(key, stored); return stored }
  return undefined
}
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

// Industry ("niche") matching is lib/jobs/jobFilters.js — the same rule the area search applies on the server.

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
export type SortMode = 'best' | 'transparency' | 'waste' | 'recent' | 'nearest'
// A search result as the API serves it: `relevance` (server rank for the typed query) and
// `in_radius` (false = a fill-in from further away / remote, which never sorts above an in-radius row).
// `related` (false = an opening that only shares a word with the search — listed under "Other openings").
export interface SearchJob extends Job { relevance?: number | null; in_radius?: boolean; related?: boolean; distance_miles?: number | null; distance_by?: string | null; near_place?: string | null; remote?: boolean }
export type RecReason = 'no_resume' | 'no_signal' | 'no_city' | 'no_matches' | 'no_direction' | 'unavailable' | null
/** The résumé's current title gives no direction to match on (api/jobs.js `no_direction`). */
export type RecNoDirection = { title: string; company: string | null } | null
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
      // Area search: how far the listing is from the searched place, measured by lib/geo/radius.js.
      distance_miles: typeof j.distance_miles === 'number' ? j.distance_miles : null,
      distance_by: typeof j.distance_by === 'string' ? j.distance_by : null,
      near_place: typeof j.near_place === 'string' ? j.near_place : null,
      remote: j.remote === true,
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
  const [pay, setPay] = useState(false) // only listings that show pay
  // Area search: include the remote listings based in the area (off by default — remote is not "in" a place).
  const [includeRemote, setIncludeRemote] = useState(false)
  const [area, setArea] = useState<AreaInfo | null>(null)
  const [areaProblem, setAreaProblem] = useState<AreaProblem | null>(null)
  const areaRef = useRef<AreaInfo | null>(null)
  const cursorRef = useRef<string | null>(null)
  const pendingTriesRef = useRef<Record<string, number>>({})
  // The device position from the 📍 button, with the label it resolved to: an area search for that label is
  // centred on the person, not on their town's middle.
  const gpsRef = useRef<{ label: string; lat: number; lng: number } | null>(null)
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
  const [recNoDirection, setRecNoDirection] = useState<RecNoDirection>(null)
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
  // The last fresh result per query|place, to tell a radius change that returned the very same rows apart from one that did not.
  const lastResultRef = useRef<{ key: string; radius: string; ids: string } | null>(null)
  const jobsRef = useRef(jobs); jobsRef.current = jobs
  const filtersRef = useRef({ niche, level, jobType, posted, pay }); filtersRef.current = { niche, level, jobType, posted, pay }
  const includeRemoteRef = useRef(includeRemote); includeRemoteRef.current = includeRemote
  // The last COMMITTED search (Enter / Search / a pick / a link) — what the URL shows and "Show more"
  // continues. The debounced auto-search never commits.
  const committedRef = useRef<{ q: string; loc: string; radius: string } | null>(null)
  // The committed query as state, for what the page shows about the search that ran (the company card).
  const [committedQuery, setCommittedQuery] = useState('')
  // The search key a request is in flight for — a second call for the same search is dropped.
  const inflightKeyRef = useRef<string | null>(null)
  // A radius set FROM the URL on load: its state change must not re-run the search it came with.
  const urlRadiusRef = useRef<string | null>(null)

  const hasFilters = !!(niche || level || jobType || posted || pay)

  // The committed search (+ current sort and filters) as the page URL: shareable, survives a reload,
  // and Back from a listing lands on it (lib/jobs/searchUrl.js). replaceState — no history entry per
  // search, no navigation, no re-render.
  function writeUrl(over: { radius?: string } = {}) {
    const c = committedRef.current
    if (!c || typeof window === 'undefined') return
    const f = filtersRef.current
    const qs = searchQueryString({ q: c.q, loc: c.loc, radius: over.radius ?? c.radius, sort: sortRef.current, niche: f.niche, level: f.level, type: f.jobType, posted: f.posted, pay: f.pay, remote: !c.q && includeRemoteRef.current })
    replaceSearchKeepingPlaces(qs)
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
    if (pay) out = out.filter(j => !!j.salary)
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
    // An area search is filtered, counted and ordered by the server (the count is what can be paged through).
    if (areaRef.current) {
      setFiltered(list)
      setStatusMsg(areaStatus(areaRef.current))
      return
    }
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
  }, [niche, level, jobType, posted, pay]) // eslint-disable-line react-hooks/exhaustive-deps
  // Latest sort + filters for the delayed top-up refresh (its timer outlives the render it was set in).
  const sortRef = useRef(sort); sortRef.current = sort
  const updateDisplayRef = useRef(updateDisplay); updateDisplayRef.current = updateDisplay
  // A pending top-up refresh never fires after the page unmounts.
  useEffect(() => () => { if (topupTimerRef.current) clearTimeout(topupTimerRef.current) }, [])

  useEffect(() => {
    // An area search applies filters, sort and the remote toggle on the server → run it again.
    const c = committedRef.current
    if (c && !c.q && searchedOnceRef.current) { void searchJobs('', c.loc, { radius: c.radius }); return }
    if (jobs.length > 0) updateDisplay(jobs, sort)
    writeUrl() // a filter or sort change after a committed search is part of the shareable URL
  }, [niche, level, jobType, posted, pay, sort, includeRemote]) // eslint-disable-line react-hooks/exhaustive-deps

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
        if (u.pay) setPay(true)
        filtersRef.current = { niche: u.niche as NicheFilter, level: u.level as LevelFilter, jobType: u.type as TypeFilter, posted: u.posted as PostedFilter, pay: u.pay }
        searchJobs(u.q, u.loc || '', { radius: u.radius, restore: true })
      } else if (u.loc) {
        // A place with no title is a search: every job in that area (a shared /jobs?loc=… link, Back, reload,
        // or the homepage box with only the place filled).
        autoSearchedRef.current = true
        setLocation(u.loc)
        if (u.radius !== radiusRef.current) { urlRadiusRef.current = u.radius; setRadius(u.radius) }
        if (u.sort === 'recent') { sortRef.current = 'recent'; setSort('recent') }
        if (u.niche) setNiche(u.niche as NicheFilter)
        if (u.level) setLevel(u.level as LevelFilter)
        if (u.type) setJobType(u.type as TypeFilter)
        if (u.posted) setPosted(u.posted as PostedFilter)
        if (u.pay) setPay(true)
        if (u.remote) { includeRemoteRef.current = true; setIncludeRemote(true) }
        filtersRef.current = { niche: u.niche as NicheFilter, level: u.level as LevelFilter, jobType: u.type as TypeFilter, posted: u.posted as PostedFilter, pay: u.pay }
        searchJobs('', u.loc, { radius: u.radius, restore: true })
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
      searchJobs(undefined, stored, { auto: true })
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
        searchJobs(undefined, profile.city, { auto: true })
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
    if (!isLoggedIn) { setRecHasResume(null); setRecReason(null); setRecNoDirection(null); setRecCity(null); setRecCitySource(null); return }
    setRecStatus('loading')
    setRecHasResume(null)
    setRecReason(null)
    aiHeaders().then(hdrs => fetch('/api/jobs', {
      method: 'POST',
      headers: hdrs,
      body: JSON.stringify({ action: 'recommended' }),
    }))
    .then(r => r.ok ? r.json() : {})
    .then((data: { jobs?: unknown[]; skills?: string[]; has_resume?: boolean | null; reason?: RecReason; city?: string | null; city_source?: 'profile' | 'resume' | null; no_direction?: { title?: unknown; company?: unknown } | null }) => {
      if (typeof data.has_resume === 'boolean') setRecHasResume(data.has_resume)
      setRecReason(data.reason ?? null)
      // feature-detected: an older API sends no `no_direction`
      const nd = data.no_direction && typeof data.no_direction.title === 'string' && data.no_direction.title.trim() ? { title: data.no_direction.title.trim(), company: typeof data.no_direction.company === 'string' && data.no_direction.company.trim() ? data.no_direction.company.trim() : null } : null
      setRecNoDirection(nd)
      setRecCity(typeof data.city === 'string' && data.city ? data.city : null)
      setRecCitySource(data.city_source === 'resume' || data.city_source === 'profile' ? data.city_source : null)
      if (Array.isArray(data.jobs) && data.jobs.length) {
        const raw: Array<Job & { match_reason: string | null; match_note: string | null; summary_only: boolean }> = (data.jobs as Record<string, unknown>[]).map(j => ({
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
          // Why this job matched the résumé (the server's sentence), shown under each row by ResumeMatches.
          match_reason: j.match_reason ? String(j.match_reason) : null,
          match_note: j.match_note ? String(j.match_note) : null,
          // A teaser listing (the posting's summary only): the rail says so under the match.
          summary_only: Boolean(j.summary_only),
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

  // `force`: the person asked for it ("Use my location" after "near me") — run even with text in the box, and search.
  async function requestGpsLocation(force = false) {
    if (!navigator.geolocation || (!force && location.trim())) return
    setGpsLoading(true)
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000, maximumAge: 300000 })
      )
      const { latitude: lat, longitude: lon } = pos.coords
      gpsRef.current = null
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
        gpsRef.current = { label: loc, lat, lng: lon }
        setLocation(loc)
        if (force || !autoSearchedRef.current) { autoSearchedRef.current = true; searchJobs(undefined, loc) }
      }
    } catch {
      // GPS failed — fall back to profile HOME (not persisted; home stays dynamic).
      if (profile?.city && !autoSearchedRef.current) {
        autoSearchedRef.current = true
        setLocationRaw(profile.city)
        searchJobs(undefined, profile.city, { auto: true })
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
  async function searchJobs(queryOverride?: string, locationOverride?: string, opts: { radius?: string; commit?: boolean; restore?: boolean; auto?: boolean } = {}) {
    const q = (queryOverride ?? queryRef.current).trim()
    const loc = (locationOverride ?? locationRef.current).trim()
    const rad = opts.radius ?? radiusRef.current
    const commit = opts.commit !== false
    if (!q) {
      // A place alone lists every job in that area. A seeded location on page load (stored / profile city)
      // only pre-fills the box — the person asks for the search.
      if (opts.auto) return
      if (!loc) { setStatusMsg('Type a job title, a place, or both.'); return }
      return searchArea(loc, rad, { commit, restore: opts.restore })
    }
    if (areaRef.current || areaProblem) { areaRef.current = null; setArea(null); setAreaProblem(null) }
    if (sortRef.current === 'nearest') { sortRef.current = 'best'; setSort('best') }
    searchedOnceRef.current = true
    const cacheKey = `${q}|${loc}|${rad}`
    if (commit) { committedRef.current = { q, loc, radius: rad }; setCommittedQuery(q); writeUrl({ radius: rad }) }
    if (inflightKeyRef.current === cacheKey) return // the same search is already on its way
    const cached = cachedSearch(cacheKey)
    // The result the person is looking at NOW, for the "same listings at 50 mi as at 25 mi" comparison —
    // captured before anything below shows a cached page for this radius (which would compare the new
    // page with itself and say nothing: the round-3 "cached 25 → 50, identical rows, no notice").
    const prevShown = lastResultRef.current
    const showCached = (c: CachedSearch, refreshing: boolean) => {
      if (abortRef.current) abortRef.current.abort() // drop any older in-flight search
      inflightKeyRef.current = null
      pagesRef.current = c.pages
      hasMoreRef.current = c.hasMore; setHasMore(c.hasMore)
      JobCache.setMany(c.jobs) // an open listing (?job=) is looked up here after a full page load
      const ids = leadIds(c.jobs)
      lastResultRef.current = { key: `${q}|${loc}`, radius: rad, ids }
      setJobs(c.jobs)
      updateDisplayRef.current(c.jobs, sortRef.current)
      setStatus('done')
      // The note the page carried, else the radius comparison against what was shown before (lib/jobs/radiusNotice.js).
      setNotice(c.notice ?? radiusNotice({ q, loc, radius: rad, total: c.jobs.length, inRadius: null, prev: prevShown, ids }))
      if (c.label) setStatusMsg(c.label)
      else if (refreshing) setStatusMsg(`${c.jobs.length} result${c.jobs.length !== 1 ? 's' : ''} (from cache — refreshing…)`)
    }
    // Back to a search (or a reload of it) shows the list exactly as it was — same rows, same order,
    // every "Show more" page — for RESTORE_MS; a NEW search of the same words keeps the 30 s rule.
    if (cached && Date.now() - cached.ts < (opts.restore ? RESTORE_MS : FRESH_MS)) {
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
        type SearchResponse = { jobs?: unknown[]; results?: unknown[]; widened?: boolean; fallback?: 'outside_radius' | 'unrelated' | 'remote_thin' | null; radius?: number | null; location?: string; topup?: string | null; in_radius?: number | null; has_more?: boolean }
        const data = await res.json() as SearchResponse
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
        // The note itself — "Only N within R mi", or "Same listings lead at 50 mi as at 25 mi" when a radius change
        // brought back the very same leading rows — is ONE helper (lib/jobs/radiusNotice.js), so the cached path and
        // the top-up refresh below say exactly the same thing.
        const placeSearch = !!loc && data.location !== 'remote' && rad !== '0'
        const noteFor = (d: SearchResponse, rows: Job[]) => radiusNotice({
          q, loc: placeSearch ? loc : '', radius: String(d.radius || rad), total: rows.length,
          inRadius: typeof d.in_radius === 'number' ? d.in_radius : null, fallback: d.fallback ?? null, prev: prevShown, ids: leadIds(rows),
        })
        let label: string | null = null
        if (raw.length && data.fallback === 'unrelated') {
          label = `No matches for "${q}" — showing ${raw.length} other opening${raw.length !== 1 ? 's' : ''}${placeSearch ? ` near ${loc}` : ''}`
        } else if (raw.length && data.fallback === 'remote_thin') {
          label = `Few remote matches for "${q}" — also showing roles that aren't marked remote`
        }
        const note = noteFor(data, raw)
        lastResultRef.current = { key: `${q}|${loc}`, radius: rad, ids: leadIds(raw) }
        if (label) setStatusMsg(label)
        setNotice(note)
        cacheSearch(cacheKey, { jobs: raw, ts: Date.now(), hasMore: more, pages: 1, notice: note, label })
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
              const d2 = await r2.json() as SearchResponse
              const fresh = toJobs(d2.jobs || [], loc)
              if (seq !== searchSeqRef.current || pagesRef.current > 1 || fresh.length <= raw.length) return
              const more2 = d2.has_more === true
              hasMoreRef.current = more2; setHasMore(more2)
              // The note is recomputed for the rows now shown and set again — the refresh must never leave the
              // page without the sentence it had a moment ago (round 3: "present at 1.6 s, absent at 3 s").
              const note2 = noteFor(d2, fresh)
              cacheSearch(cacheKey, { jobs: fresh, ts: Date.now(), hasMore: more2, pages: 1, notice: note2, label })
              JobCache.setMany(fresh)
              lastResultRef.current = { key: `${q}|${loc}`, radius: rad, ids: leadIds(fresh) }
              setJobs(fresh)
              updateDisplayRef.current(fresh, sortRef.current)
              setNotice(note2)
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

  // ── Area search: a place, no title ──────────────────────────────────────────────────────────
  // Every job Seen holds within the radius (api/jobs.js handleAreaSearch): the server filters, counts and orders
  // (nearest or newest), and "Show more" continues from its cursor — so the count is what can be paged through.
  function areaBody(loc: string, rad: string, cursor: string | null) {
    const f = filtersRef.current
    const gps = gpsRef.current && gpsRef.current.label === loc ? gpsRef.current : null
    return {
      query: '', location: loc, radius: rad, sort: sortRef.current === 'recent' ? 'recent' : 'nearest',
      include_remote: includeRemoteRef.current, niche: f.niche, level: f.level, type: f.jobType, posted: f.posted, pay: f.pay,
      ...(gps ? { lat: gps.lat, lng: gps.lng } : {}), ...(cursor ? { cursor } : {}),
    }
  }
  // A search with no device position is the same for everyone → a GET the edge can cache for two minutes.
  function areaRequest(body: Record<string, unknown>, authToken: string | null, signal?: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = authToken ? { Authorization: `Bearer ${authToken}` } : {}
    if (body.lat == null) {
      const p = new URLSearchParams({ action: 'area', loc: String(body.location), r: String(body.radius), sort: String(body.sort) })
      for (const [k, v] of [['remote', body.include_remote ? '1' : ''], ['pay', body.pay ? '1' : ''], ['niche', body.niche], ['level', body.level], ['type', body.type], ['posted', body.posted], ['cursor', body.cursor]] as const) {
        if (v) p.set(k, String(v))
      }
      return fetch(`/api/jobs?${p.toString()}`, { headers, signal })
    }
    return fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal })
  }
  function areaKey(loc: string, rad: string) {
    const f = filtersRef.current
    return `|${loc}|${rad}|${sortRef.current === 'recent' ? 'recent' : 'nearest'}|${includeRemoteRef.current ? 'r' : ''}|${f.niche}|${f.level}|${f.jobType}|${f.posted}|${f.pay ? 'p' : ''}`
  }
  type AreaResponse = {
    jobs?: unknown[]; total?: number; jobs_total?: number; remote_total?: number; include_remote?: boolean; has_more?: boolean; next_cursor?: string | null
    area?: { kind: 'point' | 'state' | 'county' | 'remote'; label: string; radius: number | null } | null; understood?: string; wider?: { radius: number; total: number } | null
    complete?: boolean; pending?: boolean; unplaced?: { reason: string | null; suggestions: string[] }; message?: string; need_title?: boolean
  }
  function showArea(c: CachedSearch) {
    pagesRef.current = c.pages
    cursorRef.current = c.cursor ?? null
    hasMoreRef.current = c.hasMore; setHasMore(c.hasMore)
    areaRef.current = c.area ?? null
    setArea(c.area ?? null)
    setAreaProblem(c.problem ?? null)
    JobCache.setMany(c.jobs)
    setJobs(c.jobs)
    // A misspelling read as a place says so, every time the list is shown.
    setNotice(c.area?.understood ? `Showing jobs near ${c.area.label} — you typed “${c.area.understood}”.` : null)
    if (c.area) updateDisplayRef.current(c.jobs, sortRef.current)
    else { setFiltered([]); setStatusMsg(c.problem?.message || '') }
    setStatus('done')
  }
  async function searchArea(loc: string, rad: string, { commit = true, restore = false, silent = false }: { commit?: boolean; restore?: boolean; silent?: boolean } = {}) {
    searchedOnceRef.current = true
    if (sortRef.current !== 'recent' && sortRef.current !== 'nearest') { sortRef.current = 'nearest'; setSort('nearest') }
    const key = areaKey(loc, rad)
    if (commit) { committedRef.current = { q: '', loc, radius: rad }; setCommittedQuery(''); writeUrl({ radius: rad }) }
    if (inflightKeyRef.current === key) return
    const cached = cachedSearch(key)
    if (cached && Date.now() - cached.ts < (restore ? RESTORE_MS : FRESH_MS)) {
      ++searchSeqRef.current
      if (topupTimerRef.current) { clearTimeout(topupTimerRef.current); topupTimerRef.current = null }
      if (abortRef.current) abortRef.current.abort()
      inflightKeyRef.current = null
      showArea(cached)
      return
    }
    const seq = ++searchSeqRef.current
    if (topupTimerRef.current) { clearTimeout(topupTimerRef.current); topupTimerRef.current = null }
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    inflightKeyRef.current = key
    // A "still counting" re-ask keeps the rows on screen; a new search clears them.
    if (!silent) {
      setStatus('loading'); setStatusMsg('Searching...'); setNotice(null)
      hasMoreRef.current = false; setHasMore(false)
      setJobs([]); setFiltered([])
    }
    let authToken: string | null = null
    if (isLoggedIn) { try { authToken = await token() } catch { /* anonymous bucket */ } }
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await areaRequest(areaBody(loc, rad, null), authToken, ctrl.signal)
        if (seq !== searchSeqRef.current) return
        if (res.status === 429) { inflightKeyRef.current = null; setStatus('error'); notifyFast(); return }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const d = await res.json() as AreaResponse
        if (seq !== searchSeqRef.current) return
        inflightKeyRef.current = null
        const rows = toJobs(d.jobs || [], loc)
        const entry: CachedSearch = d.area
          ? {
              jobs: rows, ts: Date.now(), hasMore: d.has_more === true, pages: 1, notice: null, label: null, cursor: d.next_cursor ?? null, problem: null,
              area: { total: d.total ?? rows.length, jobsTotal: d.jobs_total ?? d.total ?? rows.length, remoteTotal: d.remote_total ?? 0, label: d.area.label, kind: d.area.kind, radius: d.area.radius, includeRemote: d.include_remote === true, wider: d.wider ?? null, complete: d.complete !== false, typed: loc, understood: d.understood || null, sort: sortRef.current === 'recent' ? 'recent' : 'nearest' },
            }
          : { jobs: [], ts: Date.now(), hasMore: false, pages: 1, notice: null, label: null, cursor: null, area: null,
              problem: { message: d.message || 'That place could not be searched.', suggestions: d.unplaced?.suggestions || [], reason: d.unplaced?.reason ?? null, needTitle: d.need_title === true } }
        // The server answered with what it had read in its time budget and is still reading this area: show it as
        // "so far" and ask again in a few seconds (the server finishes in the background and caches the whole area).
        if (d.pending && entry.area) {
          entry.area.complete = false
          showArea(entry)
          if ((pendingTriesRef.current[key] = (pendingTriesRef.current[key] || 0) + 1) <= 8) {
            topupTimerRef.current = setTimeout(() => { if (seq === searchSeqRef.current) { inflightKeyRef.current = null; void searchArea(loc, rad, { commit: false, silent: true }) } }, 5000)
          }
          return
        }
        delete pendingTriesRef.current[key]
        cacheSearch(key, entry)
        showArea(entry)
        return
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        if (attempt < 1) { await new Promise(r => setTimeout(r, 1200)); continue }
        inflightKeyRef.current = null
        setStatus('error'); setStatusMsg('Search failed. Please try again.')
        return
      }
    }
  }
  async function loadMoreArea(c: { loc: string; radius: string }) {
    const key = areaKey(c.loc, c.radius)
    const seq = searchSeqRef.current
    const have = jobsRef.current
    setLoadingMore(true)
    try {
      let authToken: string | null = null
      if (isLoggedIn) { try { authToken = await token() } catch { /* anonymous bucket */ } }
      const res = await areaRequest(areaBody(c.loc, c.radius, cursorRef.current), authToken)
      if (!res.ok || seq !== searchSeqRef.current) { if (res.status === 429) notifyFast(); return }
      const d = await res.json() as AreaResponse
      if (seq !== searchSeqRef.current) return
      const ids = new Set(have.map(j => j.id))
      const all = [...have, ...toJobs(d.jobs || [], c.loc).filter(j => !ids.has(j.id))]
      pagesRef.current += 1
      cursorRef.current = d.next_cursor ?? null
      const more = d.has_more === true && !!cursorRef.current
      hasMoreRef.current = more; setHasMore(more)
      const prev = cachedSearch(key)
      cacheSearch(key, { jobs: all, ts: Date.now(), hasMore: more, pages: pagesRef.current, notice: null, label: null, cursor: cursorRef.current, area: prev?.area ?? areaRef.current, problem: null })
      JobCache.setMany(all)
      setJobs(all)
      updateDisplayRef.current(all, sortRef.current)
    } catch { /* the button stays; a tap retries */ } finally {
      setLoadingMore(false)
    }
  }

  // "Show 60 more": the next page of the COMMITTED search. The server returns the best 60 matches
  // this page does not already show (`exclude`), so nothing repeats; merged, re-sorted, cached.
  async function loadMore() {
    const c = committedRef.current
    if (!c || loadingMore || !hasMoreRef.current) return
    if (!c.q) return loadMoreArea(c)
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
      const prev = cachedSearch(key)
      cacheSearch(key, { jobs: all, ts: Date.now(), hasMore: more, pages: pagesRef.current, notice: prev?.notice ?? null, label: prev?.label ?? null })
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
    setPay(false)
    if (areaRef.current) return // the area search re-runs on the filter change
    setFiltered(applySort(jobs, sort))
    setStatusMsg(jobs.length > 0 ? `${jobs.length} result${jobs.length !== 1 ? 's' : ''}` : 'Enter a search above →')
  }

  // The error state's Retry: re-run the same query and location (the inputs still hold them).
  function retrySearch() {
    const k = queryRef.current.trim() ? `${queryRef.current.trim()}|${locationRef.current.trim()}|${radiusRef.current}` : areaKey(locationRef.current.trim(), radiusRef.current)
    searchCache.delete(k)
    try { const all = readSessionSearches(); delete all[k]; sessionStorage.setItem(SESSION_SEARCH_KEY, JSON.stringify(all)) } catch { /* ignore */ }
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
    pay, setPay,
    sort, setSort,
    hasFilters,
    // area search (a place, no title)
    area,
    areaProblem,
    includeRemote, setIncludeRemote,
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
    recNoDirection,
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
