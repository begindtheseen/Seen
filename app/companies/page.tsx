'use client'

import { useState, useEffect, useMemo } from 'react'
import { Score } from '@/lib/score'

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
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('score')

  useEffect(() => {
    fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'leaderboard' }),
    })
      .then(r => r.json())
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
      list = list.filter(c => c.name.toLowerCase().includes(q) || (c.industry || '').toLowerCase().includes(q))
    }
    if (sort === 'score') list = [...list].sort((a, b) => b.score.overall_score - a.score.overall_score)
    if (sort === 'ghost') list = [...list].sort((a, b) => a.score.ghost_rate - b.score.ghost_rate)
    if (sort === 'wait') list = [...list].sort((a, b) => a.score.avg_wait_days - b.score.avg_wait_days)
    return list
  }, [companies, search, sort])

  const sortBtn = (key: SortKey, label: string) => (
    <button
      onClick={() => setSort(key)}
      style={{
        background: sort === key ? 'var(--blue)' : 'var(--card)',
        border: `1px solid ${sort === key ? 'var(--blue)' : 'var(--line)'}`,
        color: sort === key ? '#fff' : 'var(--sub)',
        borderRadius: 6, padding: '.3rem .75rem',
        fontFamily: 'var(--mono)', fontSize: '.62rem',
        cursor: 'pointer', transition: 'all .15s',
      }}
    >
      {label}
    </button>
  )

  return (
    <div className="page-full">
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '2.5rem 2rem' }}>
        <div className="eyebrow">Transparency rankings</div>
        <h1 style={{ fontFamily: 'var(--display)', fontSize: '1.9rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', marginBottom: '.35rem' }}>
          Company scoreboard
        </h1>
        <p style={{ color: 'var(--sub)', fontSize: '.82rem', fontWeight: 300, marginBottom: '1.5rem' }}>
          Ranked by how well companies actually treat applicants.
        </p>

        {/* Controls */}
        <div style={{ display: 'flex', gap: '.65rem', flexWrap: 'wrap', marginBottom: '1.25rem', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search companies..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 200, background: 'var(--surface)', border: '1.5px solid var(--line2)', borderRadius: 8, padding: '.55rem .9rem', color: 'var(--white)', fontFamily: 'var(--body)', fontSize: '.875rem', outline: 'none', caretColor: 'var(--blue)' }}
          />
          <div style={{ display: 'flex', gap: '.4rem' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--muted)', display: 'flex', alignItems: 'center' }}>Sort:</span>
            {sortBtn('score', '↑ Score')}
            {sortBtn('ghost', '↓ Ghost %')}
            {sortBtn('wait', '↓ Wait days')}
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.72rem' }}>
            Loading scoreboard...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.72rem' }}>
            {search ? 'No companies match that search.' : 'No company data yet. Be the first to submit a report.'}
          </div>
        ) : (
          <div className="ldr-grid">
            {filtered.map((co, i) => {
              const risk = Score.risk(co.score.overall_score)
              const g = grade(co.score.overall_score)
              const fillPct = Math.max(4, co.score.overall_score)
              const fillColor = risk === 'safe' ? 'var(--green)' : risk === 'warn' ? 'var(--amber)' : 'var(--red)'
              return (
                <a
                  key={co.id || co.name}
                  href={`/company/${encodeURIComponent(co.name.toLowerCase().replace(/\s+/g, '-'))}`}
                  style={{ textDecoration: 'none', animation: `fadeUp .4s ${Math.min(i, 14) * 0.04}s ease both` }}
                >
                  <div className="ldr-item">
                    <div className="ldr-rank">#{i + 1}</div>
                    <div className={`ldr-score ${risk}`}>{g}</div>
                    <div className="ldr-name">
                      {co.name}
                      {co.verified && <span style={{ marginLeft: '.3rem', color: 'var(--green)', fontSize: '.55rem' }}>✓</span>}
                    </div>
                    {co.industry && (
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--dim)', marginTop: '.15rem', letterSpacing: '.03em' }}>
                        {co.industry}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', marginTop: '.25rem', marginBottom: '.2rem' }}>
                      {co.score.ghost_rate > 0 && (
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', background: co.score.ghost_rate > 0.5 ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.1)', color: co.score.ghost_rate > 0.5 ? 'var(--red)' : 'var(--amber)', border: `1px solid ${co.score.ghost_rate > 0.5 ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.2)'}`, borderRadius: 4, padding: '.1rem .35rem' }}>
                          {Math.round(co.score.ghost_rate * 100)}% ghost
                        </span>
                      )}
                      {co.score.response_rate > 0 && (
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', background: 'rgba(16,185,129,0.08)', color: 'var(--green)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 4, padding: '.1rem .35rem' }}>
                          {Math.round(co.score.response_rate * 100)}% response
                        </span>
                      )}
                    </div>
                    {co.score.waste > 0 && (
                      <div className="ldr-waste">⚠ {co.score.waste}% waste risk</div>
                    )}
                    <div className="ldr-label">{co.score.overall_score}/100 · {co.score.report_count}r</div>
                    <div className="ldr-bar">
                      <div className="ldr-fill" style={{ width: `${fillPct}%`, background: fillColor }} />
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
