'use client'

interface HiringProbabilityProps {
  responseRate?: number   // e.g. 0.22 (22%)
  ghostRate?: number      // e.g. 0.55 (55%)
  overallScore?: number   // 0-100
  jobLevel?: string       // e.g. "Senior", "Entry Level", "Mid level"
  profileExp?: string     // from profile.experience e.g. "2-5 years", "Senior"
  compact?: boolean       // compact mode for swipe cards (less height)
}

function calcProb(responseRate: number, ghostRate: number, jobLevel?: string, profileExp?: string): number {
  const base = (responseRate || 0.20) * (1 - (ghostRate || 0.55) * 0.45)

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

  return Math.min(0.70, Math.max(0.03, base * levelMult))
}

export default function HiringProbability({ responseRate, ghostRate, overallScore: _overallScore, jobLevel, profileExp, compact = false }: HiringProbabilityProps) {
  const prob = calcProb(responseRate ?? 0.20, ghostRate ?? 0.55, jobLevel, profileExp)
  const pct = Math.round(prob * 100)
  const color = pct >= 40 ? 'var(--green)' : pct >= 20 ? 'var(--amber)' : 'var(--red)'

  if (compact) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '.45rem', marginTop: '.3rem' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--dim)', flexShrink: 0 }}>Response chance</span>
        <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,.08)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2 }} />
        </div>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', fontWeight: 600, color, flexShrink: 0 }}>~{pct}%</span>
      </div>
    )
  }

  const context = pct >= 50
    ? `Strong match — above-average response chance`
    : pct >= 30
    ? `Moderate — apply with a tailored resume`
    : `Competitive — company responds to fewer applicants`

  return (
    <div style={{ background: 'rgba(99,102,241,.06)', border: '1px solid rgba(99,102,241,.15)', borderRadius: 9, padding: '.65rem .85rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.35rem' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Your response probability</span>
        <span style={{ fontFamily: 'var(--display)', fontSize: '1.1rem', fontWeight: 700, color, lineHeight: 1 }}>~{pct}%</span>
      </div>
      <div style={{ height: 4, background: 'rgba(255,255,255,.07)', borderRadius: 2, overflow: 'hidden', marginBottom: '.3rem' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width .8s ease' }} />
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)' }}>{context}</div>
    </div>
  )
}
