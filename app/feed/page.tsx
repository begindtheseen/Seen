'use client'

import { useState, useEffect, useCallback } from 'react'

type Filter = 'all' | 'ghosted' | 'rejected' | 'interviewing' | 'hired'

interface FeedReport {
  id: string
  role?: string
  outcome: string
  ghost_stage?: string
  rounds?: number
  report_text?: string
  platform?: string
  created_at: string
  experience_level?: string
  company_name?: string
}

const OUTCOME_LABELS: Record<string, { label: string; cls: string }> = {
  ghosted:      { label: '👻 Ghosted', cls: 'outcome-ghosted' },
  autoreject:   { label: '🤖 Auto-rejected', cls: 'outcome-autoreject' },
  rejected:     { label: '🤝 Rejected with feedback', cls: 'outcome-autoreject' },
  human:        { label: '💬 Got a response', cls: 'outcome-human' },
  interview:    { label: '📅 Interviewing', cls: 'outcome-human' },
  interviewing: { label: '📅 Interviewing', cls: 'outcome-human' },
  hired:        { label: '✅ Hired / Offer', cls: 'outcome-hired' },
  offer:        { label: '✅ Got an offer', cls: 'outcome-hired' },
  waiting:      { label: '⏳ Waiting', cls: '' },
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'interviewing', label: 'Interviewing' },
  { key: 'ghosted', label: 'Ghosted' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'hired', label: 'Hired' },
]

const PAGE_SIZE = 15

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
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  const loadFeed = useCallback(async (newFilter: Filter, newOffset: number, append = false) => {
    if (newOffset === 0) setLoading(true); else setLoadingMore(true)
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
      const data = await res.json() as { reports?: FeedReport[]; total?: number }
      const rows = data.reports || []
      setTotal(data.total || 0)
      setReports(prev => append ? [...prev, ...rows] : rows)
    } catch {
      if (!append) setReports([])
    }
    setLoading(false)
    setLoadingMore(false)
  }, [])

  useEffect(() => {
    setOffset(0)
    loadFeed(filter, 0, false)
  }, [filter, loadFeed])

  function loadMore() {
    const next = offset + PAGE_SIZE
    setOffset(next)
    loadFeed(filter, next, true)
  }

  const hasMore = offset + PAGE_SIZE < total

  return (
    <div className="page-full">
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '2.5rem 2rem' }}>
        {/* Header */}
        <div style={{ marginBottom: '1.75rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.22em', color: 'var(--blue)', marginBottom: '.6rem', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 22, height: 1, background: 'var(--blue)', display: 'inline-block' }} />
            Community feed · live reports
          </div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: '1.75rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', marginBottom: '.25rem' }}>
            What&apos;s actually happening out there
          </h1>
          <p style={{ color: 'var(--sub)', fontSize: '.82rem', fontWeight: 300 }}>
            Real reports from real applicants. Updated as they happen.
          </p>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                background: filter === f.key ? 'var(--blue)' : 'var(--card)',
                border: `1px solid ${filter === f.key ? 'var(--blue)' : 'var(--line)'}`,
                color: filter === f.key ? '#fff' : 'var(--sub)',
                borderRadius: 6, padding: '.3rem .75rem',
                fontFamily: 'var(--mono)', fontSize: '.65rem',
                cursor: 'pointer', transition: 'all .15s',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Feed */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.72rem' }}>
            Loading feed...
          </div>
        ) : reports.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.72rem' }}>
            No reports yet for this filter.
          </div>
        ) : (
          <>
            {reports.map(r => {
              const oc = OUTCOME_LABELS[r.outcome] || { label: r.outcome, cls: '' }
              return (
                <div key={r.id} className={`rcard ${oc.cls}`} style={{ marginBottom: '.65rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '.5rem' }}>
                    <div>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '.7rem', fontWeight: 600, color: 'var(--white)' }}>{oc.label}</span>
                      {r.company_name && (
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--blue)', marginLeft: '.5rem' }}>
                          @ {r.company_name}
                        </span>
                      )}
                    </div>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)', flexShrink: 0 }}>
                      {timeAgo(r.created_at)}
                    </span>
                  </div>

                  {r.role && (
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--dim)', marginBottom: '.4rem' }}>
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
                    {r.platform && (
                      <span className="vibe v-n">{r.platform}</span>
                    )}
                  </div>

                  {r.report_text && (
                    <p style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--sub)', lineHeight: 1.7, margin: 0 }}>
                      {r.report_text}
                    </p>
                  )}
                </div>
              )
            })}

            {hasMore && (
              <div style={{ textAlign: 'center', marginTop: '1.25rem' }}>
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '.65rem 1.5rem', fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--sub)', cursor: loadingMore ? 'not-allowed' : 'pointer', opacity: loadingMore ? 0.6 : 1 }}
                >
                  {loadingMore ? 'Loading...' : `Load more (${total - offset - PAGE_SIZE} remaining)`}
                </button>
              </div>
            )}
          </>
        )}

        {/* CTA */}
        <div style={{ marginTop: '2.5rem', textAlign: 'center', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '1.5rem' }}>
          <div style={{ fontFamily: 'var(--display)', fontSize: '1rem', fontWeight: 800, color: 'var(--white)', marginBottom: '.4rem' }}>
            Had a notable experience?
          </div>
          <p style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--sub)', marginBottom: '1rem' }}>
            Takes 60 seconds. Helps thousands of job seekers tonight.
          </p>
          <a href="/report" style={{ display: 'inline-block', background: 'linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%)', border: 'none', borderRadius: 8, padding: '.65rem 1.5rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.82rem', color: '#fff', textDecoration: 'none', boxShadow: '0 0 20px rgba(59,130,246,0.3)' }}>
            Submit your report →
          </a>
        </div>
      </div>
    </div>
  )
}
