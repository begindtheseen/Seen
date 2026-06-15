'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Score } from '@/lib/score'
import { AppStore } from '@/lib/stores/AppStore'

interface Company {
  id: string
  name: string
  industry?: string
  verified?: boolean
  score: {
    overall_score: number
    ghost_rate: number
    response_rate: number
    avg_wait_days: number
    report_count: number
    risk_level: 'safe' | 'warn' | 'danger'
    waste: number
  }
}

type SortKey = 'score' | 'ghost' | 'wait'

function grade(score: number): string {
  if (score >= 80) return 'A'
  if (score >= 65) return 'B'
  if (score >= 50) return 'C'
  if (score >= 35) return 'D'
  return 'F'
}

export default function CompaniesPage() {
  const router = useRouter()
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('score')
  const [lookup, setLookup] = useState('')
  const [appliedCos, setAppliedCos] = useState<Set<string>>(new Set())

  useEffect(() => {
    try {
      const apps = AppStore.loadSync()
      setAppliedCos(new Set(apps.map(a => a.company.toLowerCase().trim())))
    } catch {}
  }, [])

  useEffect(() => {
    fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'leaderboard' }),
    })
      .then((r) => r.json())
      .then((d: { companies?: Company[] }) => {
        if (d.companies?.length) setCompanies(d.companies)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    let list = companies
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.industry || '').toLowerCase().includes(q)
      )
    }
    if (sort === 'score')
      list = [...list].sort((a, b) => b.score.overall_score - a.score.overall_score)
    if (sort === 'ghost')
      list = [...list].sort((a, b) => a.score.ghost_rate - b.score.ghost_rate)
    if (sort === 'wait')
      list = [...list].sort((a, b) => a.score.avg_wait_days - b.score.avg_wait_days)
    return list
  }, [companies, search, sort])

  function handleLookup(e: React.FormEvent) {
    e.preventDefault()
    const name = lookup.trim()
    if (!name) return
    router.push(
      `/company/${encodeURIComponent(name.toLowerCase().replace(/\s+/g, '-'))}`
    )
  }

  const sortBtn = (key: SortKey, label: string) => (
    <button
      onClick={() => setSort(key)}
      className="btn btn-ghost"
      style={{
        fontSize: '.72rem',
        padding: '.45rem .85rem',
        ...(sort === key ? { background: 'var(--bdim)', borderColor: 'var(--blue)' } : {}),
      }}
    >
      {label}
    </button>
  )

  return (
    <div className="page-full">
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '2.5rem 1.5rem', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ marginBottom: '2rem' }}>
          <div className="eyebrow">Transparency rankings</div>
          <h1
            style={{
              fontFamily: 'var(--display)',
              fontSize: '1.9rem',
              fontWeight: 800,
              color: 'var(--white)',
              letterSpacing: '-.03em',
              marginBottom: '.35rem',
            }}
          >
            Company scoreboard
          </h1>
          <p
            style={{
              color: 'var(--sub)',
              fontSize: '.82rem',
              fontWeight: 300,
              marginBottom: '1.5rem',
            }}
          >
            Ranked by hiring transparency score. Ghost rate, response rate, and
            process quality — all in one place.
          </p>

          {/* Hero company lookup */}
          <form
            onSubmit={handleLookup}
            style={{ display: 'flex', gap: '.6rem', marginBottom: '.5rem' }}
          >
            <input
              type="text"
              placeholder="Look up any company — Google, Stripe, Tesla..."
              value={lookup}
              onChange={(e) => setLookup(e.target.value)}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--blue)')}
              onBlur={(e) =>
                (e.currentTarget.style.borderColor = 'rgba(99,102,241,.3)')
              }
              style={{
                flex: 1,
                background: 'rgba(99,102,241,0.07)',
                border: '1.5px solid rgba(99,102,241,.3)',
                borderRadius: 10,
                padding: '.65rem 1rem',
                color: 'var(--white)',
                fontFamily: 'var(--mono)',
                fontSize: '.78rem',
                outline: 'none',
                caretColor: 'var(--blue)',
                boxShadow: '0 0 24px rgba(99,102,241,.08)',
              }}
            />
            <button
              type="submit"
              disabled={!lookup.trim()}
              style={{
                background: 'rgba(99,102,241,0.15)',
                border: '1.5px solid rgba(99,102,241,.4)',
                borderRadius: 10,
                padding: '.65rem 1.25rem',
                fontFamily: 'var(--mono)',
                fontSize: '.75rem',
                fontWeight: 700,
                color: 'var(--blue)',
                cursor: lookup.trim() ? 'pointer' : 'not-allowed',
                opacity: lookup.trim() ? 1 : 0.5,
                whiteSpace: 'nowrap',
                boxShadow: '0 0 20px rgba(99,102,241,.1)',
              }}
            >
              Get score →
            </button>
          </form>
          <div
            style={{
              fontFamily: 'var(--mono)',
              fontSize: '.58rem',
              color: 'var(--dim)',
            }}
          >
            First lookup researches the company with web search. Results cached for
            everyone.
          </div>
        </div>

        {/* Leaderboard controls */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '.65rem',
            flexWrap: 'wrap',
            marginBottom: '1.5rem',
          }}
        >
          <input
            type="text"
            placeholder="Filter scoreboard..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--blue)')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--line2)')}
            style={{
              flex: 1,
              minWidth: 180,
              maxWidth: 280,
              background: 'var(--surface)',
              border: '1.5px solid var(--line2)',
              borderRadius: 8,
              padding: '.55rem 1rem',
              color: 'var(--white)',
              fontFamily: 'var(--mono)',
              fontSize: '.78rem',
              outline: 'none',
              caretColor: 'var(--blue)',
            }}
          />
          {sortBtn('score', 'Score ↓')}
          {sortBtn('ghost', 'Ghost rate')}
          {sortBtn('wait', 'Wait time')}
        </div>

        {loading ? (
          <div
            style={{
              textAlign: 'center',
              padding: '3rem',
              color: 'var(--muted)',
              fontFamily: 'var(--mono)',
              fontSize: '.72rem',
            }}
          >
            Loading scoreboard...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
            {search.trim() ? (
              <>
                <div
                  style={{
                    color: 'var(--muted)',
                    fontFamily: 'var(--mono)',
                    fontSize: '.72rem',
                    marginBottom: '1.25rem',
                  }}
                >
                  &ldquo;{search}&rdquo; isn&apos;t in the scoreboard yet.
                </div>
                <a
                  href={`/company/${encodeURIComponent(
                    search.trim().toLowerCase().replace(/\s+/g, '-')
                  )}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '.4rem',
                    background: 'rgba(99,102,241,0.1)',
                    border: '1px solid rgba(99,102,241,0.3)',
                    borderRadius: 9,
                    padding: '.7rem 1.4rem',
                    fontFamily: 'var(--mono)',
                    fontSize: '.72rem',
                    fontWeight: 600,
                    color: 'var(--blue)',
                    textDecoration: 'none',
                    boxShadow: '0 0 24px rgba(99,102,241,0.1)',
                  }}
                >
                  Look up &ldquo;{search.trim()}&rdquo; →
                </a>
                <div
                  style={{
                    marginTop: '.75rem',
                    fontFamily: 'var(--mono)',
                    fontSize: '.58rem',
                    color: 'var(--dim)',
                  }}
                >
                  We&apos;ll research this company and cache the score for everyone.
                </div>
              </>
            ) : (
              <div
                style={{
                  color: 'var(--muted)',
                  fontFamily: 'var(--mono)',
                  fontSize: '.72rem',
                }}
              >
                No company data yet. Use the search above to look up any company.
              </div>
            )}
          </div>
        ) : (
          <div className="ldr-grid">
            {filtered.map((co, i) => {
              const risk = Score.risk(co.score.overall_score)
              const g = grade(co.score.overall_score)
              const fillPct = Math.max(4, co.score.overall_score)
              const fillColor =
                risk === 'safe'
                  ? 'var(--green)'
                  : risk === 'warn'
                  ? 'var(--amber)'
                  : 'var(--red)'
              return (
                <a
                  key={co.id || co.name}
                  href={`/company/${encodeURIComponent(
                    co.name.toLowerCase().replace(/\s+/g, '-')
                  )}`}
                  style={{
                    textDecoration: 'none',
                    animation: `fadeUp .4s ${Math.min(i, 14) * 0.04}s ease both`,
                  }}
                >
                  <div
                    className="ldr-item"
                    style={{
                      boxShadow:
                        risk === 'safe'
                          ? '0 0 24px rgba(16,185,129,0.12), inset 0 0 0 1px rgba(16,185,129,0.12)'
                          : risk === 'danger'
                          ? '0 0 24px rgba(239,68,68,0.12), inset 0 0 0 1px rgba(239,68,68,0.12)'
                          : '0 0 24px rgba(245,158,11,0.08), inset 0 0 0 1px rgba(245,158,11,0.08)',
                    }}
                  >
                    <div className="ldr-rank">#{i + 1}</div>
                    <div className={`ldr-score ${risk}`}>{g}</div>
                    <div className="ldr-name">
                      {co.name}
                      {co.verified && (
                        <span
                          style={{
                            marginLeft: '.3rem',
                            color: 'var(--green)',
                            fontSize: '.55rem',
                          }}
                        >
                          ✓
                        </span>
                      )}
                      {appliedCos.has(co.name.toLowerCase().trim()) && (
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '.48rem', background: 'rgba(99,102,241,.12)', border: '1px solid rgba(99,102,241,.25)', borderRadius: 4, padding: '.06rem .28rem', color: 'var(--indigo)', marginLeft: '.35rem', verticalAlign: 'middle', flexShrink: 0 }}>Applied</span>
                      )}
                    </div>
                    {co.industry && (
                      <div
                        style={{
                          fontFamily: 'var(--mono)',
                          fontSize: '.52rem',
                          color: 'var(--dim)',
                          marginTop: '.15rem',
                          letterSpacing: '.03em',
                        }}
                      >
                        {co.industry}
                      </div>
                    )}
                    <div
                      style={{
                        display: 'flex',
                        gap: '.3rem',
                        flexWrap: 'wrap',
                        marginTop: '.25rem',
                        marginBottom: '.2rem',
                      }}
                    >
                      {co.score.ghost_rate > 0 && (
                        <span
                          style={{
                            fontFamily: 'var(--mono)',
                            fontSize: '.5rem',
                            background:
                              co.score.ghost_rate > 0.5
                                ? 'rgba(239,68,68,0.12)'
                                : 'rgba(245,158,11,0.1)',
                            color:
                              co.score.ghost_rate > 0.5
                                ? 'var(--red)'
                                : 'var(--amber)',
                            border: `1px solid ${
                              co.score.ghost_rate > 0.5
                                ? 'rgba(239,68,68,0.25)'
                                : 'rgba(245,158,11,0.2)'
                            }`,
                            borderRadius: 4,
                            padding: '.1rem .35rem',
                          }}
                        >
                          {Math.round(co.score.ghost_rate * 100)}% ghost
                        </span>
                      )}
                      {co.score.response_rate > 0 && (
                        <span
                          style={{
                            fontFamily: 'var(--mono)',
                            fontSize: '.5rem',
                            background: 'rgba(16,185,129,0.08)',
                            color: 'var(--green)',
                            border: '1px solid rgba(16,185,129,0.2)',
                            borderRadius: 4,
                            padding: '.1rem .35rem',
                          }}
                        >
                          {Math.round(co.score.response_rate * 100)}% response
                        </span>
                      )}
                    </div>
                    {co.score.waste > 0 && (
                      <div className="ldr-waste">⚠ {co.score.waste}% waste risk</div>
                    )}
                    <div className="ldr-label">
                      {co.score.overall_score}/100 · {co.score.report_count}r
                    </div>
                    <div className="ldr-bar">
                      <div
                        className="ldr-fill"
                        style={{ width: `${fillPct}%`, background: fillColor }}
                      />
                    </div>
                  </div>
                </a>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
