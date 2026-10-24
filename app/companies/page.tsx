'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { LoadError } from '@/components/shell/LoadStates'
import { useRouter } from 'next/navigation'
import { Score } from '@/lib/score'
import { AppStore } from '@/lib/stores/AppStore'
import CompanyScoreModal from '@/components/CompanyScoreModal'
import { firstPartyReportCount } from '@/lib/server/reportCounts'
import { isGradeableScore, MIN_REPORTS_FOR_GRADE } from '@/lib/gradeGate'
import PageHeader from '@/components/shell/PageHeader'
import { gradeLetter, displayCompanyName } from '@/lib/companyDisplay'

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
    /** FUSED total (first-party + web-research claim) — sorting only, never a "reports" label. */
    report_count: number
    /** Real applicant-report rows (api/reports.js leaderboard). */
    first_party_report_count?: number
    data_source?: string | null
    risk_level: 'safe' | 'warn' | 'danger'
    waste: number
  }
}

// "12 reports" = 12 first-party applicant reports (it read "11R" — cryptic, audit 2026-10-23). A
// score with none behind it is a web-research estimate and says so — the fused report_count once
// rendered here as "12775r".
function reportsLabel(s: Company['score']): string {
  const fp = firstPartyReportCount(s)
  return fp > 0 ? `${fp} report${fp === 1 ? '' : 's'}` : 'estimate'
}

// The top of the board is reserved for well-evidenced grades: a company needs this many first-party
// reports to take one of the first TOP_SLOTS places. Thinner grades (5–9 reports) still appear, below,
// under their own heading — "#1 aaa · 100/100 · 11 reports" over "#2 united wholesale mortgage · 8"
// read as a board nobody curates.
const WELL_EVIDENCED_REPORTS = 10
const TOP_SLOTS = 20

type SortKey = 'score' | 'ghost' | 'wait'

// ONE grade scale for every surface (lib/companyDisplay.ts).
const grade = (score: number): string => gradeLetter(score)

export default function CompaniesPage() {
  const router = useRouter()
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  // The leaderboard request failed (API down / 500 / bad JSON): an error with Retry, never
  // "No company data yet" (R-1).
  const [loadFailed, setLoadFailed] = useState(false)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('score')
  const [lookup, setLookup] = useState('')
  const [showLookupSuggs, setShowLookupSuggs] = useState(false)
  const [appliedCos, setAppliedCos] = useState<Set<string>>(new Set())
  const [modalCo, setModalCo] = useState<string | null>(null)

  // Instant company autocomplete for the lookup field — filters the already-loaded leaderboard
  // (companies with scores) locally. Prefix matches rank first; free text still works for any
  // company not yet scored (the lookup then web-researches it).
  const lookupSuggs = useMemo(() => {
    const q = lookup.trim().toLowerCase()
    if (q.length < 2) return []
    const starts: Company[] = []
    const contains: Company[] = []
    for (const c of companies) {
      const n = c.name.toLowerCase()
      if (n === q) continue
      if (n.startsWith(q)) starts.push(c)
      else if (n.includes(q)) contains.push(c)
      if (starts.length >= 6) break
    }
    return [...starts, ...contains].slice(0, 6)
  }, [companies, lookup])

  useEffect(() => {
    try {
      const apps = AppStore.loadSync()
      setAppliedCos(new Set(apps.map(a => a.company.toLowerCase().trim())))
    } catch {}
  }, [])

  const loadLeaderboard = useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const r = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'leaderboard' }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json() as { companies?: Company[] }
      if (!Array.isArray(d.companies)) throw new Error('bad payload')
      // Grade gate: the API already ranks only gradeable companies (≥5 real reports); filter
      // again so a CDN-cached pre-gate payload can never put an ungraded company on the board.
      setCompanies(d.companies.filter((c) => isGradeableScore(c.score)))
    } catch {
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void loadLeaderboard() }, [loadLeaderboard])

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
    // Stable partition: well-evidenced companies take the top slots in the chosen order; the rest
    // follow in the same order. Filtering by name keeps the plain order (the visitor asked for a name).
    if (search.trim()) return list
    const strong = list.filter((c) => firstPartyReportCount(c.score) >= WELL_EVIDENCED_REPORTS)
    const thin = list.filter((c) => firstPartyReportCount(c.score) < WELL_EVIDENCED_REPORTS)
    return [...strong, ...thin]
  }, [companies, search, sort])
  // Where the thinner grades begin (the heading sits before this index), or -1 when none / searching.
  const thinStart = useMemo(() => {
    if (search.trim()) return -1
    const i = filtered.findIndex((c) => firstPartyReportCount(c.score) < WELL_EVIDENCED_REPORTS)
    return i >= 0 && i < filtered.length ? i : -1
  }, [filtered, search])

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
        fontSize: 'var(--fs-72)',
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
          <PageHeader
            eyebrow="Transparency rankings"
            title="Company scoreboard"
            crumbLabel="Companies"
            sub={<>Ranked by hiring transparency score. Ghost rate, response rate, and process quality — all in one place. A company is graded once it has at least one report submitted to Seen and {MIN_REPORTS_FOR_GRADE} pieces of evidence in total (an online mention counts as half).</>}
          />

          {/* Hero company lookup */}
          <form
            onSubmit={handleLookup}
            style={{ display: 'flex', gap: '.6rem', marginBottom: '.5rem' }}
          >
            <div style={{ position: 'relative', flex: 1 }}>
            <input
              type="text"
              placeholder="Look up any company — Google, Stripe, Tesla..."
              value={lookup}
              onChange={(e) => { setLookup(e.target.value); setShowLookupSuggs(true) }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--blue)'; setShowLookupSuggs(true) }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = 'rgba(99,102,241,.3)'
                setTimeout(() => setShowLookupSuggs(false), 150)
              }}
              style={{
                width: '100%',
                boxSizing: 'border-box',
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
            {showLookupSuggs && lookupSuggs.length > 0 && (
              <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 30, background: 'var(--surface, #0c0f1a)', border: '1px solid rgba(99,102,241,.3)', borderRadius: 10, overflow: 'hidden', boxShadow: '0 12px 32px rgba(0,0,0,.5)' }}>
                {lookupSuggs.map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      setLookup(c.name)
                      setShowLookupSuggs(false)
                      router.push(`/company/${encodeURIComponent(c.name.toLowerCase().replace(/\s+/g, '-'))}`)
                    }}
                    style={{ display: 'flex', width: '100%', textAlign: 'left', alignItems: 'center', justifyContent: 'space-between', gap: '.6rem', background: 'none', border: 'none', borderBottom: '1px solid var(--line2)', padding: '.55rem .85rem', cursor: 'pointer', color: 'var(--white)', fontFamily: 'var(--mono)', fontSize: 'var(--fs-72)' }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayCompanyName(c.name)}</span>
                    <span style={{ flexShrink: 0, color: 'var(--dim)', fontSize: 'var(--fs-60)' }}>{Math.round(c.score.overall_score)}/100 · {reportsLabel(c.score)}</span>
                  </button>
                ))}
              </div>
            )}
            </div>
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
              fontSize: 'var(--fs-58)',
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
              fontSize: 'var(--fs-72)',
            }}
          >
            Loading scoreboard...
          </div>
        ) : loadFailed ? (
          <div style={{ padding: '1.5rem 0' }}>
            <LoadError what="the company scoreboard" detail="Seen could not be reached. You can still look up any company by name above." onRetry={loadLeaderboard} />
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
            {search.trim() ? (
              <>
                <div
                  style={{
                    color: 'var(--muted)',
                    fontFamily: 'var(--mono)',
                    fontSize: 'var(--fs-72)',
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
                    fontSize: 'var(--fs-72)',
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
                    fontSize: 'var(--fs-58)',
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
                  fontSize: 'var(--fs-72)',
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
              const divider = thinStart >= 0 && i === thinStart ? (
                <div key="thin-divider" style={{ gridColumn: '1 / -1', fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--muted)', letterSpacing: '.08em', textTransform: 'uppercase', padding: '.9rem .2rem .3rem', borderTop: '1px solid var(--line)' }}>
                  Early grades · fewer than {WELL_EVIDENCED_REPORTS} applicant reports{thinStart >= TOP_SLOTS ? '' : ` · the top ${TOP_SLOTS} need ${WELL_EVIDENCED_REPORTS}+`}
                </div>
              ) : null
              const fillPct = Math.max(4, co.score.overall_score)
              const fillColor =
                risk === 'safe'
                  ? 'var(--green)'
                  : risk === 'warn'
                  ? 'var(--amber)'
                  : 'var(--red)'
              return (
                <React.Fragment key={co.id || co.name}>
                {divider}
                <a
                  href={`/company/${encodeURIComponent(
                    co.name.toLowerCase().replace(/\s+/g, '-')
                  )}`}
                  onClick={(e) => {
                    // Plain click pops the score modal in place. Cmd/Ctrl/Shift/middle-click
                    // keep the native <a> behavior so "open in new tab" still works.
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
                    e.preventDefault()
                    setModalCo(co.name)
                  }}
                  style={{
                    textDecoration: 'none',
                    animation: `riseIn .55s ${Math.min(i, 14) * 0.045}s cubic-bezier(.16,1,.3,1) both`,
                  }}
                >
                  <div
                    className="ldr-item spot"
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
                      {displayCompanyName(co.name)}
                      {co.verified && (
                        <span
                          style={{
                            marginLeft: '.3rem',
                            color: 'var(--green)',
                            fontSize: 'var(--fs-55)',
                          }}
                        >
                          ✓
                        </span>
                      )}
                      {appliedCos.has(co.name.toLowerCase().trim()) && (
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-48)', background: 'rgba(99,102,241,.12)', border: '1px solid rgba(99,102,241,.25)', borderRadius: 4, padding: '.06rem .28rem', color: 'var(--indigo)', marginLeft: '.35rem', verticalAlign: 'middle', flexShrink: 0 }}>Applied</span>
                      )}
                    </div>
                    {co.industry && (
                      <div
                        style={{
                          fontFamily: 'var(--mono)',
                          fontSize: 'var(--fs-52)',
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
                            fontSize: 'var(--fs-50)',
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
                            fontSize: 'var(--fs-50)',
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
                      {co.score.overall_score}/100 · {reportsLabel(co.score)}
                    </div>
                    <div className="ldr-bar">
                      <div
                        className="ldr-fill"
                        style={{ width: `${fillPct}%`, background: fillColor }}
                      />
                    </div>
                  </div>
                </a>
                </React.Fragment>
              )
            })}
          </div>
        )}
      </div>

      {modalCo && (
        <CompanyScoreModal companyName={modalCo} onClose={() => setModalCo(null)} />
      )}
    </div>
  )
}
