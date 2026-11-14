'use client'

/**
 * "Hiring now" on a start guide: position chips, a place + distance, and a level, tailored to the field by the
 * guide's `listings` config. Every rule (which searches a position runs, which rows belong, the level, the count
 * and empty lines, the URL params) is lib/start/listingFilters.js; this component only fetches and renders.
 *
 *  - The filters live in the URL (?pos=&loc=&r=&lvl=, replaced in place — lib/nav/urlState.ts), so a shared link
 *    opens filtered. Defaults are never written.
 *  - Searches are POST /api/jobs { query, location, radius } (an empty location is nationwide); answers are kept in
 *    memory for the session per query|place|distance, a newer filter change cancels an older one (AbortController),
 *    and a burst of taps is coalesced (120 ms).
 *  - Only rows the search counts as a match, with a Seen listing page, are shown; nothing is ever invented — no rows
 *    → the honest empty line with one way out (a wider distance, all positions, any level).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type { Job } from '@/lib/types'
import { JobCache } from '@/lib/stores/JobCache'
import { readParam, replaceParam } from '@/lib/nav/urlState'
import LocationInput from '@/components/ui/LocationInput'
import Icon from '@/components/ui/Icon'
import {
  LEVELS, bodyKey, countLine, emptyState, filterParams, parseFilterState, pickRows, requestBodies, seeAllHref,
} from '@/lib/start/listingFilters.js'
import st from './guide.module.css'

type Position = { id: string; label: string }
export type ListingsConfig = {
  defaultRadius: string
  radii: string[]
  levelMode: string
  levelLabels: Record<string, string>
  levelWords: Record<string, string>
  positions: Position[]
  [k: string]: unknown
}
type State = { pos: string; loc: string; r: string; lvl: string }
type Row = Record<string, unknown>
type View =
  | { status: 'loading' }
  | { status: 'done'; rows: Row[]; total: number }
  | { status: 'error' }

const DEADLINE_MS = 15000
const DEBOUNCE_MS = 120
const IN_FLIGHT = 4 // at most four searches at once (an "All trades" pass runs eight)
const answers = new Map<string, unknown>() // session cache: one answer per query|place|distance

async function fetchAnswer(body: { query: string; location: string; radius: string }, signal: AbortSignal): Promise<unknown> {
  const key = bodyKey(body)
  if (answers.has(key)) return answers.get(key)
  const ctrl = new AbortController()
  const stop = () => ctrl.abort()
  signal.addEventListener('abort', stop)
  const timer = setTimeout(stop, DEADLINE_MS)
  try {
    const res = await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal })
    if (!res.ok) return null
    const data = await res.json()
    answers.set(key, data)
    return data
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', stop)
  }
}

async function fetchAll(bodies: Array<{ query: string; location: string; radius: string }>, signal: AbortSignal) {
  const out: unknown[] = new Array(bodies.length).fill(null)
  let next = 0
  const worker = async () => { while (next < bodies.length && !signal.aborted) { const i = next++; out[i] = await fetchAnswer(bodies[i], signal) } }
  await Promise.all(Array.from({ length: Math.min(IN_FLIGHT, bodies.length) }, worker))
  return out
}

// API row → the Job shape the listing page reads from the session cache (same fields useJobSearch maps).
function toJob(r: Row): Job {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    id: String(r.id),
    title: String(r.title || ''),
    company: String(r.company || ''),
    location: String(r.location || ''),
    score: num(r.score),
    waste: num(r.waste_score ?? r.waste),
    level: String(r.level || ''),
    type: String(r.type || 'Full-time'),
    source: String(r.source || 'Job board'),
    description: String(r.description || ''),
    salary: r.salary ? String(r.salary) : null,
    apply_url: r.apply_url ? String(r.apply_url) : (r.url ? String(r.url) : null),
    posted_at: r.posted_at ? String(r.posted_at) : null,
    employer_posted: r.employer_posted === true,
    trains_beginners: r.trains_beginners === true,
  }
}

export default function ListingFinder({ config, id }: { config: ListingsConfig; id: string }) {
  const first: State = { pos: config.positions[0].id, loc: '', r: config.defaultRadius, lvl: 'any' }
  const [state, setState] = useState<State>(first)
  const [draft, setDraft] = useState('')
  const [ready, setReady] = useState(false)
  const [view, setView] = useState<View>({ status: 'loading' })
  const [shown, setShown] = useState<Job[]>([])
  const [retry, setRetry] = useState(0)
  const stateRef = useRef(state)
  stateRef.current = state

  // The filters a shared link carries, read once on mount (the server HTML renders the defaults).
  useEffect(() => {
    const qs = ['pos', 'loc', 'r', 'lvl'].map((k) => [k, readParam(k)]).filter(([, v]) => v)
    const s = parseFilterState(new URLSearchParams(qs).toString(), config) as State
    setState(s)
    setDraft(s.loc)
    setReady(true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback((patch: Partial<State>) => {
    const next = { ...stateRef.current, ...patch }
    if (patch.loc === '') next.r = config.defaultRadius // a distance means nothing without a place
    if (patch.loc !== undefined) setDraft(patch.loc)
    setState(next)
    const p = filterParams(next, config) as Record<string, string | null>
    for (const k of ['pos', 'loc', 'r', 'lvl']) replaceParam(k, p[k])
  }, [config])

  const bodies = useMemo(() => requestBodies(config, state) as Array<{ query: string; location: string; radius: string }>, [config, state])
  const key = bodies.map(bodyKey).join('\n')

  // Search: a pass per filter state (the answers come from the session cache when a search already ran, so a level
  // change only re-picks the rows). Rows already shown stay, dimmed, while a newer pass runs.
  const [pending, setPending] = useState(false)
  useEffect(() => {
    if (!ready) return
    const ctrl = new AbortController()
    const s = state
    setPending(true)
    const timer = setTimeout(() => {
      fetchAll(bodies, ctrl.signal).then((got) => {
        if (ctrl.signal.aborted) return
        setPending(false)
        if (got.every((a) => a === null)) { setView({ status: 'error' }); return }
        const { rows, total } = pickRows(config, s, got) as { rows: Row[]; total: number }
        setShown(rows.map(toJob))
        setView({ status: 'done', rows, total })
      })
    }, DEBOUNCE_MS)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [ready, key, state.pos, state.lvl, retry]) // eslint-disable-line react-hooks/exhaustive-deps
  const updating = pending && view.status === 'done'

  const pos = config.positions
  const levelLabel = config.levelLabels
  const empty = view.status === 'done' && view.rows.length === 0 ? emptyState(config, state) as { line: string; action: { label: string; patch: Partial<State> } | null } : null

  return (
    <div className={st.finder} data-testid="guide-listings">
      <div className={st.filters}>
        <div className={st.fGroup} role="group" aria-labelledby={`${id}-pos`}>
          <p className={st.fLabel} id={`${id}-pos`}>Position</p>
          <div className={st.chipRow}>
            {pos.map((p) => (
              <button key={p.id} type="button" className={`ui-chip ${st.fChip}`} aria-pressed={state.pos === p.id} onClick={() => update({ pos: p.id })} data-pos={p.id}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className={st.fRow}>
          <div className={st.fLoc}>
            <label className={st.fLabel} htmlFor={`${id}-loc`}>Location</label>
            <div className={st.locBox}>
              <LocationInput
                id={`${id}-loc`}
                className={`ui-input ${st.locInput}`}
                placeholder="Anywhere"
                value={draft}
                allowRemote={false}
                maxLength={80}
                enterKeyHint="search"
                onChange={setDraft}
                onCommit={(v) => { if (v.trim() !== stateRef.current.loc) update({ loc: v.trim() }) }}
              />
              {draft ? (
                <button type="button" className={st.locClear} aria-label="Clear location (search nationwide)" onClick={() => update({ loc: '' })}>
                  <Icon name="x" size={16} />
                </button>
              ) : null}
            </div>
          </div>
          <div className={st.fRadius}>
            <label className={st.fLabel} htmlFor={`${id}-r`}>Distance</label>
            <select
              id={`${id}-r`}
              className="ui-input"
              value={state.r}
              disabled={!state.loc || !/,/.test(state.loc)}
              title={!state.loc ? 'Pick a place to search by distance' : undefined}
              onChange={(e) => update({ r: e.target.value })}
            >
              {config.radii.map((r) => <option key={r} value={r}>{r} mi</option>)}
            </select>
          </div>
          <div className={st.fLevel}>
            <label className={st.fLabel} htmlFor={`${id}-lvl`}>Level</label>
            <select id={`${id}-lvl`} className="ui-input" value={state.lvl} onChange={(e) => update({ lvl: e.target.value })}>
              {LEVELS.map((l) => <option key={l} value={l}>{levelLabel[l]}</option>)}
            </select>
          </div>
        </div>
      </div>

      <p className={st.count} role="status" aria-live="polite" data-testid="guide-count">
        {view.status === 'loading' ? 'Finding listings…'
          : view.status === 'error' ? ''
          : updating ? 'Updating…'
          : view.rows.length ? countLine(config, state, view.rows.length, view.total) : ''}
      </p>

      {view.status === 'loading' ? (
        <ul className={st.rows} aria-hidden>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <li key={i} className={st.skRow}>
              <div className={`sk ${st.skLine}`} />
              <div className={`sk ${st.skLine2}`} />
            </li>
          ))}
        </ul>
      ) : view.status === 'error' ? (
        <div className={st.empty} data-testid="guide-listings-error">
          <p className={st.emptyText}>Listings could not load right now.</p>
          <button type="button" className={st.textBtn} onClick={() => { setView({ status: 'loading' }); setRetry((n) => n + 1) }}>Try again</button>
        </div>
      ) : empty ? (
        <div className={st.empty} data-testid="guide-listings-empty">
          <p className={st.emptyText}>{empty.line}</p>
          {empty.action ? <button type="button" className={st.textBtn} onClick={() => update(empty.action!.patch)}>{empty.action.label}</button> : null}
        </div>
      ) : (
        <ul className={`${st.rows}${updating ? ' ' + st.rowsDim : ''}`} aria-label="Matching listings" aria-busy={updating}>
          {shown.map((j) => (
            <li key={j.id} className={st.row}>
              <Link href={`/jobs/${encodeURIComponent(j.id)}`} prefetch={false} className={st.rowLink} onClick={() => JobCache.set(j)}>
                <span className={st.rowMain}>
                  <span className={st.rowTitle}>{j.title}</span>
                  <span className={st.rowMeta}>
                    {[j.company, j.location.replace(/,\s*(United States|USA|US)$/i, '')].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {j.trains_beginners && <span className={st.tag}>Paid training</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link href={seeAllHref(config, state)} prefetch={false} className={st.seeAll} data-testid="guide-see-all">
        See all in job search <Icon name="arrow-right" size={14} />
      </Link>
    </div>
  )
}
