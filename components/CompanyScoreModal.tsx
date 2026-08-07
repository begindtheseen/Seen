'use client'

// CompanyScoreModal — the score, modal-first. A focused overlay that pops from the scoreboard (and
// anywhere a company is named) so a Seen grade is a glance, not a full-page trek. Fetches the score +
// industry benchmark for one company, shows the grade ring, the three metrics candidates care about,
// the "vs your industry" benchmark, a one-tap track, and a link to the full report.

import { useEffect, useState, useCallback } from 'react'
import { AppStore } from '@/lib/stores/AppStore'
import { useAuth } from '@/lib/auth'
import IndustryBenchmark, { type Benchmark } from './IndustryBenchmark'
import styles from './CompanyScoreModal.module.css'

type Score = {
  overall_score: number
  ghost_rate: number
  response_rate: number
  avg_wait_days: number
  waste?: number
  report_count?: number
  first_party_report_count?: number
  data_source?: string
  industry?: string
  verification_status?: string
}

const slugify = (n: string) => encodeURIComponent(n.toLowerCase().replace(/\s+/g, '-'))
const gradeOf = (s: number) => (s >= 80 ? 'A' : s >= 65 ? 'B' : s >= 50 ? 'C' : s >= 35 ? 'D' : 'F')
const riskColor = (s: number) => (s >= 65 ? 'var(--green)' : s >= 45 ? 'var(--amber)' : 'var(--red)')
const pct = (v?: number | null) => (v == null ? '—' : `${Math.round(Math.min(1, Math.max(0, v)) * 100)}%`)

function DataQuality({ s }: { s: Score }) {
  const fp = s.first_party_report_count ?? (s.data_source === 'reports' ? (s.report_count || 0) : 0)
  if (fp > 0) return <span className={styles.dq} style={{ color: 'var(--green)' }}>🟢 {fp} applicant report{fp === 1 ? '' : 's'}</span>
  return <span className={styles.dq} style={{ color: 'var(--amber)' }}>🌐 Web-research estimate — no first-party reports yet</span>
}

export default function CompanyScoreModal({ companyName, onClose }: { companyName: string; onClose: () => void }) {
  const { isLoggedIn } = useAuth()
  const [score, setScore] = useState<Score | null>(null)
  const [benchmark, setBenchmark] = useState<Benchmark | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [tracked, setTracked] = useState(false)
  const [revealed, setRevealed] = useState(false)

  // Escape to close + lock the background scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  useEffect(() => {
    let alive = true
    setLoading(true); setNotFound(false); setRevealed(false); setScore(null); setBenchmark(null)
    Promise.all([
      fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'company_score', name: companyName }) }).then(r => (r.ok ? r.json() : { score: null })).catch(() => ({ score: null })),
      fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'industry_benchmark', name: companyName }) }).then(r => (r.ok ? r.json() : { benchmark: null })).catch(() => ({ benchmark: null })),
    ]).then(([s, b]) => {
      if (!alive) return
      if (s?.not_found || !s?.score) setNotFound(true)
      else { setScore(s.score); setTimeout(() => { if (alive) setRevealed(true) }, 60) }
      setBenchmark(b?.benchmark || null)
      setLoading(false)
    })
    return () => { alive = false }
  }, [companyName])

  const track = useCallback(async () => {
    try {
      await AppStore.add({ company: companyName, role: '', platform: 'Seen', status: 'active', stage: 'Applied' }, isLoggedIn)
      setTracked(true)
    } catch { /* the full report page has the full track flow as a fallback */ }
  }, [companyName, isLoggedIn])

  const s = score
  const score100 = s ? Math.round(s.overall_score) : 0
  const color = riskColor(score100)
  const R = 40, CIRC = 2 * Math.PI * R
  const dashOff = revealed ? CIRC * (1 - score100 / 100) : CIRC

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label={`${companyName} Seen score`}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.handle} aria-hidden />
        <button className={styles.close} onClick={onClose} aria-label="Close">✕</button>

        <div className={styles.head}>
          <div className={styles.logo}>{(companyName[0] || '?').toUpperCase()}</div>
          <div style={{ minWidth: 0 }}>
            <div className={styles.name}>
              {companyName}
              {s?.verification_status === 'verified' && <span className={styles.verified}>✓ Verified</span>}
            </div>
            {s?.industry && <div className={styles.ind}>{s.industry}</div>}
          </div>
        </div>

        {loading ? (
          <div className={styles.skeleton}>
            <div className={styles.skRow}>
              <div className="sk" style={{ width: 92, height: 92, borderRadius: '50%', flexShrink: 0 }} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
                <div className="sk" style={{ width: '60%', height: 12 }} />
                <div className="sk" style={{ width: '40%', height: 10 }} />
              </div>
            </div>
            <div className="sk" style={{ height: 58, borderRadius: 12 }} />
            <div className="sk" style={{ height: 130, borderRadius: 12 }} />
          </div>
        ) : notFound || !s ? (
          <div style={{ padding: '0.5rem 0 1.25rem', textAlign: 'center' }}>
            <p style={{ color: 'var(--sub)', fontFamily: 'var(--mono)', fontSize: '.72rem', lineHeight: 1.7, marginBottom: '1.25rem' }}>
              No score yet for “{companyName}”. Open the full report to research it.
            </p>
            <a href={`/company/${slugify(companyName)}`} className={styles.full}>Open full report →</a>
          </div>
        ) : (
          <>
            <div className={styles.gradeRow}>
              <div className={styles.ring}>
                <svg width={92} height={92} viewBox="0 0 92 92" style={{ transform: 'rotate(-90deg)' }}>
                  <circle cx={46} cy={46} r={R} fill="none" stroke="var(--line2)" strokeWidth={6} />
                  <circle cx={46} cy={46} r={R} fill="none" stroke={color} strokeWidth={6} strokeLinecap="round"
                    strokeDasharray={CIRC} strokeDashoffset={dashOff} style={{ transition: 'stroke-dashoffset .85s cubic-bezier(.16,1,.3,1)' }} />
                </svg>
                <div className={styles.ringNum}>
                  <div className={styles.ringGrade} style={{ color }}>{gradeOf(score100)}</div>
                  <div className={styles.ringScore}>{score100}/100</div>
                </div>
              </div>
              <div className={styles.gradeMeta}>
                <div className={styles.gradeVerdict}>Seen transparency grade</div>
                <DataQuality s={s} />
              </div>
            </div>

            <div className={styles.metrics}>
              <div className={styles.metric}>
                <div className={styles.metricN} style={{ color: 'var(--green)' }}>{pct(s.response_rate)}</div>
                <div className={styles.metricL}>reply rate</div>
              </div>
              <div className={styles.metric}>
                <div className={styles.metricN} style={{ color: (s.ghost_rate || 0) > 0.5 ? 'var(--red)' : 'var(--amber)' }}>{pct(s.ghost_rate)}</div>
                <div className={styles.metricL}>ghost rate</div>
              </div>
              <div className={styles.metric}>
                <div className={styles.metricN} style={{ color: 'var(--white)' }}>{s.avg_wait_days != null ? `${Math.round(s.avg_wait_days)}d` : '—'}</div>
                <div className={styles.metricL}>avg wait</div>
              </div>
            </div>

            {benchmark && (
              <div className={styles.benchWrap}>
                <IndustryBenchmark benchmark={benchmark} variant="public" companyName={companyName} />
              </div>
            )}

            <div className={styles.actions}>
              {!tracked ? (
                <button className={styles.full} onClick={track} style={{ borderColor: 'rgba(16,185,129,.3)', color: 'var(--green)' }}>
                  ＋ I applied here — track it
                </button>
              ) : (
                <div className={styles.full} style={{ borderColor: 'rgba(16,185,129,.3)', color: 'var(--green)' }}>
                  ✓ Tracked — follow up in your tracker
                </div>
              )}
              <a href={`/company/${slugify(companyName)}`} className={styles.full}>Open full report →</a>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
