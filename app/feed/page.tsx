'use client'

import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { AppStore } from '@/lib/stores/AppStore'
import { isPublicDiscussion, reportDate, reportSourceBadge, reportSourceLink } from '@/lib/reportSource'
import ReportSourceLink from '@/components/ReportSourceLink'
import PageHeader from '@/components/shell/PageHeader'
import Icon, { type IconName } from '@/components/ui/Icon'
import { displayCompanyName, displayPlatform } from '@/lib/companyDisplay'
import { collapseByCompany } from '@/lib/reports/feedFilter.js'
import { replaceParam, readParam, useScrollMemory } from '@/lib/nav/urlState'

type Filter = 'all' | 'ghosted' | 'rejected' | 'interviewing' | 'hired'

interface FeedReport {
  id: string
  role?: string
  outcome: string
  ghost_stage?: string
  rounds?: number
  report_text?: string
  platform?: string
  /** How the row arrived (direct_submission, external_import, …) — the provenance badge keys on it. */
  trust_reason?: string | null
  created_at: string
  experience_level?: string
  company_name?: string
  /** Later rows of the same company folded into this card (one card per company per page). */
  more_from_company?: number
}

// One stroke icon per outcome (components/ui/Icon.tsx) — never an emoji, which the OS paints in its own
// colour font.
const OUTCOME_LABELS: Record<string, { icon: IconName; label: string; cls: string }> = {
  ghosted:      { icon: 'ghost', label: 'Ghosted', cls: 'outcome-ghosted' },
  autoreject:   { icon: 'bot', label: 'Auto-rejected', cls: 'outcome-autoreject' },
  rejected:     { icon: 'handshake', label: 'Rejected with feedback', cls: 'outcome-autoreject' },
  human:        { icon: 'message-square', label: 'Got a response', cls: 'outcome-human' },
  interview:    { icon: 'calendar', label: 'Interviewing', cls: 'outcome-human' },
  interviewing: { icon: 'calendar', label: 'Interviewing', cls: 'outcome-human' },
  hired:        { icon: 'circle-check', label: 'Hired / Offer', cls: 'outcome-hired' },
  offer:        { icon: 'circle-check', label: 'Got an offer', cls: 'outcome-hired' },
  waiting:      { icon: 'hourglass', label: 'Waiting', cls: '' },
}

const FILTERS: { key: Filter; label: string; icon?: IconName }[] = [
  { key: 'all', label: 'All' },
  { key: 'interviewing', label: 'Interviewing', icon: 'phone' },
  { key: 'ghosted', label: 'Ghosted', icon: 'ghost' },
  { key: 'rejected', label: 'Rejected', icon: 'circle-x' },
  { key: 'hired', label: 'Hired', icon: 'party-popper' },
]
// The active chip is an outlined accent state (DESIGN.md §2: colour on states, no filled chip); the
// filled var(--blue) in globals' .feed-filter-btn.active fails contrast on white text.
const ACTIVE_CHIP = { background: 'var(--accent-tint)', borderColor: 'var(--accent-line)', color: 'var(--accent)' } as const

const PAGE_SIZE = 15

// What this tab last showed per filter (rows + where "Load more" stands), so Back from a company page
// lands on the same rows. The feed is public, so the copy is not per user.
type FeedSnap = { rows: FeedReport[]; offset: number; hasMore: boolean; total: number; pages: number; t: number }
const FEED_CACHE_KEY = 'seen_feed_v1'
const FEED_REFRESH_AFTER = 3 * 60 * 1000  // older than this: shown, then refreshed in the background
const FEED_DROP_AFTER = 30 * 60 * 1000    // older than this: not shown
const FEED_MAX_ROWS = 150
function readFeedSnap(f: Filter): FeedSnap | null {
  try {
    const all = JSON.parse(sessionStorage.getItem(FEED_CACHE_KEY) || '{}') as Record<string, FeedSnap>
    const snap = all?.[f]
    if (!snap || !Array.isArray(snap.rows) || typeof snap.t !== 'number' || Date.now() - snap.t > FEED_DROP_AFTER) return null
    return snap
  } catch { return null }
}
function writeFeedSnap(f: Filter, snap: FeedSnap) {
  try {
    const all = (JSON.parse(sessionStorage.getItem(FEED_CACHE_KEY) || '{}') || {}) as Record<string, FeedSnap>
    all[f] = { ...snap, rows: snap.rows.slice(0, FEED_MAX_ROWS) }
    sessionStorage.setItem(FEED_CACHE_KEY, JSON.stringify(all))
  } catch { /* ignore */ }
}
const isFilter = (v: string): v is Filter => FILTERS.some(f => f.key === v)

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function FeedPage() {
  const [filter, setFilter] = useState<Filter>('all')
  const [reports, setReports] = useState<FeedReport[]>([])
  const [offset, setOffset] = useState(0)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [appliedCos, setAppliedCos] = useState<Set<string>>(new Set())
  // Pages read for the current filter (1 after the first load); a background refresh only replaces
  // a single first page, never rows the person paged into.
  const [pages, setPages] = useState(0)
  // Which filter the rows on screen belong to (only those are saved).
  const [rowsFor, setRowsFor] = useState<Filter | null>(null)
  const [hydrated, setHydrated] = useState(false)
  // The filter on screen and how many pages it shows, for answers that arrive after a switch.
  const wantRef = useRef<Filter>('all')
  const pagesRef = useRef(0)
  pagesRef.current = pages

  const loadFeed = useCallback(async (newFilter: Filter, newOffset: number, append = false, silent = false) => {
    if (!silent) { if (newOffset === 0) setLoading(true); else setLoadingMore(true) }
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'feed',
          outcome: newFilter === 'all' ? undefined : newFilter,
          offset: newOffset,
          limit: PAGE_SIZE,
        }),
      })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { reports?: FeedReport[]; total?: number; next_offset?: number; has_more?: boolean }
      // A late answer for another filter, or a background refresh after "Load more", is dropped.
      if (newFilter !== wantRef.current || (silent && pagesRef.current > 1)) return
      // One card per company per page: a run of ten Albertsons imports becomes one card with "+9 more".
      const rows = collapseByCompany(data.reports || []) as FeedReport[]
      setTotal(data.total || 0)
      // The server reads a wider window than it returns, so the next page starts where it stopped.
      setOffset(typeof data.next_offset === 'number' ? data.next_offset : newOffset + PAGE_SIZE)
      setHasMore(data.has_more ?? ((typeof data.next_offset === 'number' ? data.next_offset : newOffset + PAGE_SIZE) < (data.total || 0)))
      setReports(prev => append ? [...prev, ...rows] : rows)
      setPages(p => append ? p + 1 : 1)
      setRowsFor(newFilter)
    } catch {
      if (newFilter !== wantRef.current) return
      if (!append && !silent) { setReports([]); setHasMore(false); setPages(0); setRowsFor(null) }
    }
    setLoading(false)
    setLoadingMore(false)
  }, [])

  useEffect(() => {
    try {
      const apps = AppStore.loadSync()
      setAppliedCos(new Set(apps.map(a => a.company.toLowerCase().trim())))
    } catch {}
  }, [])

  // The filter lives in the URL (?filter=) so Back brings it back. Read before the first paint.
  // Show this tab's saved rows for a filter, or load them. A saved copy older than a few minutes is
  // refreshed in the background, and only while it is a single first page.
  const showFilter = useCallback((f: Filter) => {
    wantRef.current = f
    setLoadingMore(false)
    const snap = readFeedSnap(f)
    if (snap) {
      setReports(snap.rows); setOffset(snap.offset); setHasMore(snap.hasMore); setTotal(snap.total); setPages(snap.pages)
      setRowsFor(f)
      setLoading(false)
      if (Date.now() - snap.t > FEED_REFRESH_AFTER && snap.pages <= 1) void loadFeed(f, 0, false, true)
      return
    }
    setOffset(0)
    void loadFeed(f, 0, false)
  }, [loadFeed])

  // The filter lives in the URL (?filter=) so Back brings it back. Read (and the saved rows shown)
  // before the first paint, so Back has no loading flash.
  useLayoutEffect(() => {
    const p = readParam('filter')
    const f: Filter = isFilter(p) ? p : 'all'
    setFilter(f)
    showFilter(f)
    setHydrated(true)
  }, [showFilter])

  function changeFilter(f: Filter) {
    if (f === filter) return
    setFilter(f)
    replaceParam('filter', f === 'all' ? null : f)
    showFilter(f)
  }

  // Keep this tab's copy current after every load.
  useEffect(() => {
    if (!hydrated || loading || loadingMore || pages === 0 || rowsFor !== filter) return
    writeFeedSnap(filter, { rows: reports, offset, hasMore, total, pages, t: Date.now() })
  }, [hydrated, loading, loadingMore, pages, rowsFor, filter, reports, offset, hasMore, total])

  useScrollMemory(hydrated && !loading)

  function loadMore() {
    loadFeed(filter, offset, true)
  }

  return (
    <div className="page-full">
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1.25rem', width: '100%', boxSizing: 'border-box' }}>
        <PageHeader
          eyebrow="Live feed"
          title="Fresh from the community"
          crumbLabel="Live feed"
          sub="Applicant accounts, newest first — submitted to Seen or compiled from public review sites and discussions (labeled). Each one counts toward that company's score at its trust weight."
        />

        {/* The ONE report call on this page: an outlined link in ink (the old green callout here plus a
            filled "Submit your report" at the foot were two CTAs for one action). */}
        <Link href="/report" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-2)', borderRadius: 10, padding: '.75rem 1rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.75rem', flexWrap: 'wrap', cursor: 'pointer', textDecoration: 'none' }}>
          <div>
            <div style={{ fontSize: 'var(--fs-meta)', color: 'var(--text-1)', fontWeight: 600, marginBottom: '.125rem' }}>Your experience matters</div>
            <div style={{ fontSize: 'var(--fs-meta)', color: 'var(--text-3)', fontWeight: 400 }}>Had an interview? Got ghosted? Add your report — it shapes scores for every future applicant.</div>
          </div>
          <div style={{ fontSize: 'var(--fs-meta)', fontWeight: 600, color: 'var(--text-1)', flexShrink: 0, whiteSpace: 'nowrap' }}>Add yours →</div>
        </Link>

        {/* The old "ghost surges this week" banner here was any two companies with a ghosted row in the
            first page — no window, no threshold. Real surges (≥3 in 7 days) show on the dashboard. */}

        {/* Filters */}
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => changeFilter(f.key)}
              className={`feed-filter-btn${filter === f.key ? ' active' : ''}`}
              style={filter === f.key ? ACTIVE_CHIP : undefined}
            >
              {f.icon && <Icon name={f.icon} size={14} />}{f.icon ? ' ' : ''}{f.label}
            </button>
          ))}
        </div>

        {/* Feed */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)' }}>
            Loading feed...
          </div>
        ) : reports.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)' }}>
            No reports yet for this filter.
          </div>
        ) : (
          <>
            {reports.map(r => {
              const oc: { icon?: IconName; label: string; cls: string } = OUTCOME_LABELS[r.outcome] || { label: r.outcome, cls: '' }
              const badge = reportSourceBadge(r.platform, r.report_text, r.trust_reason)
              const src = reportSourceLink(r.platform, r.report_text)
              const body = src ? src.body : r.report_text
              return (
                <div key={r.id} className={`rcard ${oc.cls}`} style={{ marginBottom: '.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '.5rem' }}>
                    <div>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', fontWeight: 500, color: 'var(--white)' }}>{oc.icon && <Icon name={oc.icon} size={14} />}{oc.icon ? ' ' : ''}{oc.label}</span>
                      {r.company_name && (
                        <Link href={`/company/${encodeURIComponent(r.company_name.toLowerCase().replace(/\s+/g, '-'))}`} prefetch={false} className="tap" style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--blue)', marginLeft: '.5rem', textDecoration: 'none' }}>
                          @ {displayCompanyName(r.company_name)}
                        </Link>
                      )}
                      {r.company_name && appliedCos.has(r.company_name.toLowerCase().trim()) && (
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', background: 'var(--accent-tint)', border: '1px solid var(--accent-line)', borderRadius: 4, padding: '.125rem .25rem', color: 'var(--accent)', marginLeft: '.25rem', verticalAlign: 'middle' }}>
                          You applied
                        </span>
                      )}
                    </div>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--muted)', flexShrink: 0 }}>
                      {isPublicDiscussion(r.platform) ? reportDate(r.platform, r.report_text, r.created_at).label : timeAgo(r.created_at)}
                    </span>
                  </div>

                  {r.role && (
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--dim)', marginBottom: '.5rem' }}>
                      {r.role}{r.experience_level ? ` · ${r.experience_level}` : ''}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: r.report_text ? '.6rem' : 0 }}>
                    {(r.rounds ?? 0) > 0 && (
                      <span className="vibe v-n">{r.rounds} round{r.rounds !== 1 ? 's' : ''}</span>
                    )}
                    {r.ghost_stage && (
                      <span className="vibe v-r">ghosted after {r.ghost_stage}</span>
                    )}
                    {r.platform && !badge && (
                      <span className="vibe v-n">{displayPlatform(r.platform)}</span>
                    )}
                    {badge && (
                      <span className="vibe v-n" style={{ borderStyle: 'dashed', color: 'var(--dim)' }} title={badge.title}>{badge.label}</span>
                    )}
                  </div>

                  {body && (
                    <p style={{ fontFamily: 'var(--body)', fontSize: 'var(--fs-meta)', color: 'var(--sub)', lineHeight: 1.7, margin: 0 }}>
                      {body}
                    </p>
                  )}
                  {src && (
                    <div style={{ marginTop: '.5rem' }}>
                      <ReportSourceLink url={src.url} host={src.host} posted={src.posted} />
                    </div>
                  )}
                  {(r.more_from_company ?? 0) > 0 && r.company_name && (
                    <Link href={`/company/${encodeURIComponent(r.company_name.toLowerCase().replace(/\s+/g, '-'))}#reports`} prefetch={false} style={{ display: 'inline-block', marginTop: '.5rem', fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--muted)', textDecoration: 'none' }}>
                      + {r.more_from_company} more from {displayCompanyName(r.company_name)} on its page →
                    </Link>
                  )}
                </div>
              )
            })}

            {hasMore && (
              <div style={{ textAlign: 'center', marginTop: '1.25rem' }}>
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '.75rem 1.5rem', fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--sub)', cursor: loadingMore ? 'not-allowed' : 'pointer', opacity: loadingMore ? 0.6 : 1 }}
                >
                  {loadingMore ? 'Loading...' : `Load more${total > offset ? ` (${(total - offset).toLocaleString()} to read)` : ''}`}
                </button>
              </div>
            )}
          </>
        )}

      </div>
    </div>
  )
}
