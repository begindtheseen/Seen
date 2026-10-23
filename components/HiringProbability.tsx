'use client'

// Grade gate: a probability is derived from the company's response/ghost rates, which are null when
// the company is below MIN_REPORTS_FOR_GRADE real reports (lib/gradeGate.ts). With no real rates there
// is no honest probability — the component renders nothing instead of inventing default rates.
interface HiringProbabilityProps {
  responseRate?: number | null   // e.g. 0.22 (22%)
  ghostRate?: number | null      // e.g. 0.55 (55%)
  overallScore?: number | null   // 0-100
  jobLevel?: string       // e.g. "Senior", "Entry Level", "Mid level"
  profileExp?: string     // from profile.experience e.g. "2-5 years", "Senior"
  compact?: boolean       // compact mode for swipe cards (less height)
  reportCount?: number    // applicant reports the rate was computed from — named as the basis
}

function calcProb(responseRate: number, jobLevel?: string, profileExp?: string): number {
  // The chance of hearing back IS the company's reported response rate (ghosting is already its
  // complement — multiplying by it again double-counted and `0 || 0.55` invented a 55% ghost rate).
  const base = responseRate

  // Level match multiplier
  const exp = (profileExp || '').toLowerCase()
  const lvl = (jobLevel || '').toLowerCase()
  let levelMult = 1.0
  if (lvl.includes('senior') || lvl.includes('lead') || lvl.includes('staff') || lvl.includes('principal')) {
    if (exp.includes('senior') || exp.includes('5+') || exp.includes('lead') || exp.includes('staff')) levelMult = 1.15
    else if (exp.includes('entry') || exp.includes('junior') || exp.includes('intern') || exp.includes('0-1')) levelMult = 0.60
    else levelMult = 0.85
  } else if (lvl.includes('entry') || lvl.includes('junior') || lvl.includes('associate') || lvl.includes('intern')) {
    if (exp.includes('entry') || exp.includes('junior') || exp.includes('intern') || exp.includes('0-1')) levelMult = 1.12
    else if (exp.includes('senior') || exp.includes('5+') || exp.includes('lead')) levelMult = 0.88  // overqualified
    else levelMult = 1.0
  }

  // Company-wide (no level multiplier): the figure IS the response rate, so Sheetz's 100% stays
  // 100% — the page said "100% get a response" while this box said "~95%" (audit 2026-10-23). The
  // clamp only applies to a level-adjusted estimate, which is a model, not a measurement.
  if (levelMult === 1.0) return Math.max(0, Math.min(1, base))
  return Math.min(0.95, Math.max(0.02, base * levelMult))
}

export default function HiringProbability({ responseRate, ghostRate, overallScore: _overallScore, jobLevel, profileExp, compact = false, reportCount }: HiringProbabilityProps) {
  if (responseRate == null || ghostRate == null) return null
  const personalized = !!(jobLevel && profileExp)
  const prob = calcProb(responseRate, jobLevel, profileExp)
  const pct = Math.round(prob * 100)
  const color = pct >= 40 ? 'var(--green)' : pct >= 20 ? 'var(--amber)' : 'var(--red)'

  if (compact) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '.45rem', marginTop: '.3rem' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--dim)', flexShrink: 0 }}>Response chance</span>
        <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,.08)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2 }} />
        </div>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', fontWeight: 600, color, flexShrink: 0 }}>{personalized ? '≈' : ''}{pct}%</span>
      </div>
    )
  }

  const context = (pct >= 50
    ? 'Most applicants here hear back'
    : pct >= 30
    ? 'Mixed — apply with a tailored résumé'
    : 'Few applicants here hear back') + (personalized
      ? ' · adjusted for your level'
      : ` · the share of ${reportCount && reportCount > 0 ? `${reportCount} applicant report${reportCount === 1 ? '' : 's'}` : 'applicant reports'} that heard back`)

  return (
    <div style={{ background: 'rgba(99,102,241,.06)', border: '1px solid rgba(99,102,241,.15)', borderRadius: 9, padding: '.65rem .85rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.35rem' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{personalized ? 'Estimated response chance' : 'Response chance'}</span>
        <span style={{ fontFamily: 'var(--display)', fontSize: '1.1rem', fontWeight: 700, color, lineHeight: 1 }}>{pct}%</span>
      </div>
      <div style={{ height: 4, background: 'rgba(255,255,255,.07)', borderRadius: 2, overflow: 'hidden', marginBottom: '.3rem' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width .8s ease' }} />
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)' }}>{context}</div>
    </div>
  )
}
