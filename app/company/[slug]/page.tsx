'use client'

import { useState, useEffect, use } from 'react'
import { Score } from '@/lib/score'

interface CompanyScore {
  overall_score: number
  response_rate: number
  ghost_rate: number
  avg_wait_days: number
  avg_rounds: number
  waste: number
  report_count: number
  risk_level: 'safe' | 'warn' | 'danger'
  process_score?: number
}

interface Report {
  id: string
  outcome: string
  rounds: number
  wait_days: number
  unpaid_work: string
  created_at: string
  report_text?: string
  ghost_stage?: string
  role?: string
  location?: string
}

interface CompanyData {
  name: string
  industry?: string
  score: CompanyScore
  vibes?: string[]
  reports?: Report[]
  verified?: boolean
}

function grade(score: number): string {
  if (score >= 80) return 'A'
  if (score >= 65) return 'B'
  if (score >= 50) return 'C'
  if (score >= 35) return 'D'
  return 'F'
}

function pct(n: number): string {
  return Math.round(n * 100) + '%'
}

function MetBox({ label, value, alarm }: { label: string; value: string; alarm?: boolean }) {
  return (
    <div className={`co-m${alarm ? ' co-alarm' : ''}`}>
      <span className="co-mn">{value}</span>
      <span className="co-ml">{label}</span>
    </div>
  )
}

function BarRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '.65rem' }}>
      <span style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--dim)', width: 120, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 5, background: 'var(--line2)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, value)}%`, height: '100%', background: color, borderRadius: 3, transition: 'width .6s ease' }} />
      </div>
      <span style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--muted)', width: 36, textAlign: 'right' }}>{Math.round(value)}%</span>
    </div>
  )
}

export default function CompanyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const companyName = decodeURIComponent(slug).replace(/-/g, ' ')

  const [data, setData] = useState<CompanyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'overview' | 'reports'>('overview')
  const [location, setLocation] = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError('')
      try {
        const res = await fetch('/api/reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'get_company', company: companyName.toLowerCase(), location }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json() as { company?: CompanyData; score?: CompanyScore; reports?: Report[]; vibes?: string[] }
        if (json.company) {
          setData(json.company)
        } else if (json.score) {
          setData({
            name: companyName,
            score: json.score,
            reports: json.reports || [],
            vibes: json.vibes || [],
          })
        } else {
          setError('No data found for this company.')
        }
      } catch {
        setError('Failed to load company data.')
      }
      setLoading(false)
    }
    load()
  }, [companyName, location]) // eslint-disable-line react-hooks/exhaustive-deps

  const risk = data ? Score.risk(data.score.overall_score) : 'warn'
  const g = data ? grade(data.score.overall_score) : '—'
  const logoLetter = (companyName[0] || '?').toUpperCase()

  return (
    <div style={{ minHeight: '100vh' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '2.5rem 2rem' }}>

        {/* Header */}
        <div className="co-hdr">
          <div className="co-top">
            <div className="co-logo-lg">{logoLetter}</div>
            <div style={{ flex: 1 }}>
              <div className="co-name">{data?.name || companyName}</div>
              {data?.industry && <div className="co-ind">{data.industry}</div>}
              {data?.verified && (
                <span className="co-verified">✓ Seen Verified</span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
              <input
                type="text"
                placeholder="Filter by city..."
                value={location}
                onChange={e => setLocation(e.target.value)}
                style={{ background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 6, padding: '.35rem .65rem', color: 'var(--white)', fontFamily: 'var(--mono)', fontSize: '.65rem', outline: 'none', width: 160, caretColor: 'var(--blue)' }}
              />
            </div>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.72rem' }}>
              Loading company data...
            </div>
          ) : error ? (
            <div style={{ background: 'var(--rdim)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '1rem', fontFamily: 'var(--mono)', fontSize: '.72rem', color: 'var(--red)', textAlign: 'center' }}>
              {error}
            </div>
          ) : data ? (
            <>
              {/* Grade bar */}
              <div className={`co-grade-bar ${risk}`} style={{ marginBottom: '1rem' }}>
                <div className={`co-grade-letter ${risk}`}>{g}</div>
                <div style={{ flex: 1 }}>
                  <span className="co-grade-lbl">Transparency score</span>
                  <span className="co-grade-score">{data.score.overall_score}/100 — {Score.label(risk)}</span>
                  {data.score.ghost_rate > 0.5 && (
                    <div style={{ marginTop: '.4rem', fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--red)' }}>
                      ⚠️ {pct(data.score.ghost_rate)} ghost rate — high risk of no response
                    </div>
                  )}
                </div>
                {data.score.report_count > 0 && (
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <span className="co-live">{data.score.report_count} reports</span>
                  </div>
                )}
              </div>

              {/* Metrics grid */}
              <div className="co-mets">
                <MetBox label="Score" value={String(data.score.overall_score)} />
                <MetBox label="Response %" value={pct(data.score.response_rate)} />
                <MetBox label="Ghost %" value={pct(data.score.ghost_rate)} alarm={data.score.ghost_rate > 0.5} />
                <MetBox label="Avg wait" value={`${data.score.avg_wait_days}d`} />
                <MetBox label="Avg rounds" value={String(data.score.avg_rounds.toFixed(1))} />
                <MetBox label="Waste risk" value={`${data.score.waste}%`} />
              </div>
            </>
          ) : null}
        </div>

        {!loading && !error && data && (
          <>
            {/* Tabs */}
            <div className="co-tabs" style={{ display: 'flex', gap: '.08rem', borderBottom: '1px solid var(--line)', marginBottom: '1.35rem' }}>
              {(['overview', 'reports'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  style={{
                    background: 'none', border: 'none', borderBottom: `2px solid ${tab === t ? 'var(--blue)' : 'transparent'}`,
                    color: tab === t ? 'var(--white)' : 'var(--muted)',
                    fontFamily: 'var(--mono)', fontSize: '.65rem', textTransform: 'capitalize',
                    padding: '.55rem .9rem', cursor: 'pointer', transition: 'all .15s',
                  }}
                >
                  {t === 'overview' ? 'Overview' : `Reports (${data.reports?.length || 0})`}
                </button>
              ))}
            </div>

            {/* Overview tab */}
            {tab === 'overview' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                <div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--dim)', marginBottom: '.75rem' }}>
                    Hiring transparency
                  </div>
                  <BarRow label="Response rate" value={data.score.response_rate * 100} color="var(--green)" />
                  <BarRow label="Ghost rate" value={data.score.ghost_rate * 100} color="var(--red)" />
                  <BarRow label="Waste risk" value={data.score.waste} color="var(--amber)" />
                </div>

                {data.vibes && data.vibes.length > 0 && (
                  <div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--dim)', marginBottom: '.75rem' }}>
                      Vibe check
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem' }}>
                      {data.vibes.map((v, i) => (
                        <span key={i} className="vibe v-n">{v}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Reports tab */}
            {tab === 'reports' && (
              <div>
                {data.reports && data.reports.length > 0 ? (
                  data.reports.map(r => (
                    <div key={r.id} className="rcard">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '.5rem' }}>
                        <div>
                          <span style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--white)', fontWeight: 500 }}>
                            {r.outcome === 'hired' ? '✅ Hired' : r.outcome === 'ghosted' ? '👻 Ghosted' : r.outcome === 'human' ? '🤝 Rejected with feedback' : r.outcome}
                          </span>
                          {r.role && <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--muted)', marginLeft: '.5rem' }}>· {r.role}</span>}
                        </div>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)' }}>
                          {new Date(r.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap', marginBottom: r.report_text ? '.65rem' : 0 }}>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)' }}>{r.rounds} rounds</span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)' }}>{r.wait_days}d wait</span>
                        {r.ghost_stage && <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--red)' }}>ghosted after {r.ghost_stage}</span>}
                        {r.unpaid_work && r.unpaid_work !== 'na' && <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--amber)' }}>⚠️ unpaid work: {r.unpaid_work}</span>}
                      </div>
                      {r.report_text && (
                        <p style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--sub)', lineHeight: 1.7, margin: 0 }}>{r.report_text}</p>
                      )}
                    </div>
                  ))
                ) : (
                  <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.72rem' }}>
                    No community reports yet. Be the first to report your experience.
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
