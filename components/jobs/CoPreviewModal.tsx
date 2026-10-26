'use client'

import { displayCompanyName } from '@/lib/companyDisplay'
import { useState, useEffect } from 'react'
import { firstPartyReportCount } from '@/lib/server/reportCounts'
import { isGradeableScore, notEnoughReviewsLabel } from '@/lib/gradeGate'
import ModalPortal from '@/components/ModalPortal'

// ── Company Preview Modal ─────────────────────────────────────────────────────

interface CoPreviewScore {
  overall_score: number
  ghost_rate: number
  response_rate: number
  avg_wait_days: number
  avg_rounds: number
  waste: number
  report_count: number // FUSED (first-party + web claim) — never rendered as "reports"
  first_party_report_count?: number
  data_source?: string
  data_quality?: string
}

// What /api/reports actually returns: below the grade gate (≥5 real reports, lib/gradeGate.ts)
// `gradeable` is false and every verdict field is null. Only a gradeable payload becomes a
// CoPreviewScore (the graded shape the card renders).
type CoPreviewPayload = { [K in keyof CoPreviewScore]?: CoPreviewScore[K] | null } & { gradeable?: boolean | null }

function coVibes(sc: CoPreviewScore): { label: string; cls: string }[] {
  const vibes: { label: string; cls: string }[] = []
  if (sc.ghost_rate > 0.55)       vibes.push({ label: '👻 Frequent ghosting', cls: 'v-r' })
  else if (sc.ghost_rate > 0.4)   vibes.push({ label: '👻 High ghost rate',   cls: 'v-r' })
  if (sc.avg_wait_days > 21)      vibes.push({ label: `⏳ ${sc.avg_wait_days}d avg wait`, cls: 'v-y' })
  if (sc.avg_rounds >= 4)         vibes.push({ label: `📋 ${sc.avg_rounds.toFixed(1)} rounds avg`, cls: 'v-b' })
  if (sc.waste > 55)              vibes.push({ label: '⚠ High wasted-effort risk',    cls: 'v-y' })
  if (sc.response_rate > 0.72)    vibes.push({ label: '✅ Highly responsive', cls: 'v-g' })
  if (sc.overall_score >= 80)     vibes.push({ label: '🌟 Strong process',    cls: 'v-g' })
  if (sc.overall_score < 35)      vibes.push({ label: '❌ Low transparency',   cls: 'v-r' })
  return vibes.slice(0, 4)
}

function coGrade(s: number) {
  if (s >= 80) return 'A'; if (s >= 65) return 'B'
  if (s >= 50) return 'C'; if (s >= 35) return 'D'; return 'F'
}

export default function CoPreviewModal({ company, onClose }: { company: string; onClose: () => void }) {
  const [sc, setSc] = useState<CoPreviewPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const slug = encodeURIComponent(company.toLowerCase().replace(/\s+/g, '-'))

  useEffect(() => {
    setLoading(true)
    setSc(null)
    fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: company }),
    })
      .then(r => r.ok ? r.json() : {})
      .then((d: { score?: CoPreviewPayload }) => { if (d.score) setSc(d.score) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [company])

  const graded: CoPreviewScore | null = sc && isGradeableScore(sc) ? (sc as CoPreviewScore) : null
  const risk = graded ? (graded.overall_score >= 65 ? 'safe' : graded.overall_score >= 40 ? 'warn' : 'danger') : 'warn'
  const glowColor = risk === 'safe' ? 'rgba(16,185,129,0.3)' : risk === 'danger' ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'
  const borderColor = risk === 'safe' ? 'rgba(16,185,129,0.35)' : risk === 'danger' ? 'rgba(239,68,68,0.35)' : 'rgba(245,158,11,0.35)'
  const gradeColor = risk === 'safe' ? 'var(--green)' : risk === 'danger' ? 'var(--red)' : 'var(--amber)'

  return (
    <ModalPortal>
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9500, background: 'rgba(0,0,0,.88)' }}
      onClick={onClose}
    >
      <div
        style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          width: 'calc(100% - 2rem)', maxWidth: 400,
          background: 'var(--surface)', borderRadius: 16, overflow: 'hidden',
          border: `1px solid ${borderColor}`,
          boxShadow: `0 0 60px ${glowColor}, 0 0 120px ${glowColor.replace('0.3', '0.12')}`,
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '1rem 1.15rem .75rem', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-lead)', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.02em' }}>{displayCompanyName(company)}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', fontSize: 'var(--fs-lead)', padding: '.2rem .3rem', lineHeight: 1 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: '1.15rem' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '1.5rem 0', fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--muted)' }}>
              <div style={{ fontSize: 'var(--fs-h3)', marginBottom: '.5rem', animation: 'spin 1s linear infinite' }}>🔍</div>
              Checking hiring data...
            </div>
          ) : graded ? (
            <>
              {/* Grade + score */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '.85rem', marginBottom: '.75rem' }}>
                <div style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-fig-l)', fontWeight: 800, color: gradeColor, lineHeight: 1, letterSpacing: '-.04em' }}>{coGrade(graded.overall_score)}</div>
                <div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)' }}>Seen Score</div>
                  <div style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-xl)', fontWeight: 800, color: 'var(--white)', lineHeight: 1, letterSpacing: '-.03em' }}>{graded.overall_score}<span style={{ fontSize: 'var(--fs-ui)', color: 'var(--muted)' }}>/100</span></div>
                  {(() => {
                    const fp = firstPartyReportCount(graded)
                    return <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--dim)', marginTop: '.15rem' }}>{fp > 0 ? `${fp} applicant account${fp === 1 ? '' : 's'}` : 'Estimated from public web data'}</div>
                  })()}
                </div>
              </div>

              {/* Vibe tags */}
              {coVibes(graded).length > 0 && (
                <div style={{ display: 'flex', gap: '.28rem', flexWrap: 'wrap', marginBottom: '.85rem' }}>
                  {coVibes(graded).map(v => <span key={v.label} className={`vibe ${v.cls}`}>{v.label}</span>)}
                </div>
              )}

              {/* Key stats */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '.5rem', marginBottom: '1rem' }}>
                {[
                  { label: 'Response', value: `${Math.round((graded.response_rate || 0) * 100)}%` },
                  { label: 'Ghosts',   value: `${Math.round((graded.ghost_rate || 0) * 100)}%`    },
                  { label: 'Avg wait', value: `${graded.avg_wait_days || '—'}d`                   },
                ].map(({ label, value }) => (
                  <div key={label} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '.55rem .6rem', textAlign: 'center' }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-body)', fontWeight: 500, color: 'var(--white)', lineHeight: 1, marginBottom: '.18rem' }}>{value}</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
                  </div>
                ))}
              </div>

              <a
                href={`/company/${slug}`}
                style={{ display: 'block', width: '100%', textAlign: 'center', background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)', color: '#fff', border: 'none', borderRadius: 9, padding: '.7rem 1rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: 'var(--fs-ui)', cursor: 'pointer', textDecoration: 'none', boxShadow: '0 0 20px rgba(59,130,246,0.3)' }}
              >
                View full company →
              </a>
            </>
          ) : sc ? (
            <>
              {/* Grade gate: real reports exist but fewer than the bar — no verdict, just the facts. */}
              <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)', marginBottom: '.35rem' }}>Seen Score</div>
              <div style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-lead)', fontWeight: 700, color: 'var(--white)', lineHeight: 1.3, marginBottom: '.35rem' }}>{notEnoughReviewsLabel(sc)}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--dim)', marginBottom: '1rem' }}>We only grade a company once enough real applicants have reported. Read the reviews we have on the company page.</div>
              <a
                href={`/company/${slug}`}
                style={{ display: 'block', width: '100%', textAlign: 'center', background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)', color: '#fff', border: 'none', borderRadius: 9, padding: '.7rem 1rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: 'var(--fs-ui)', cursor: 'pointer', textDecoration: 'none', boxShadow: '0 0 20px rgba(59,130,246,0.3)' }}
              >
                View full company →
              </a>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '1.5rem 0', fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--muted)' }}>
              No data found for this company yet.<br />
              <a href={`/company/${slug}`} style={{ color: 'var(--blue)', textDecoration: 'none', marginTop: '.5rem', display: 'inline-block' }}>View company page →</a>
            </div>
          )}
        </div>
      </div>
    </div>
    </ModalPortal>
  )
}
