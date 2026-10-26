'use client'

import { MIN_REPORTS_FOR_RATES, oddsPhrase, responseVerdict, tooFewReportsLine } from '@/lib/companyPageSummary'

// Grade gate: a probability is derived from the company's response/ghost rates, which are null when
// the company is below MIN_REPORTS_FOR_GRADE real reports (lib/gradeGate.ts). With no real rates there
// is no honest probability — the component renders nothing instead of inventing default rates.
//
// The wording ("Most applicants here hear back" …) comes from lib/companyPageSummary.ts responseVerdict —
// the SAME thresholds as the hero's verdict sentence, so the two can never disagree (audit 2026-10-23:
// Insight Global's hero said "Most applicants never hear back" over an odds panel saying "Most applicants
// here hear back"). With fewer than MIN_REPORTS_FOR_RATES applicant accounts no percentage is shown at all
// (Chipotle: "77% … the share of 2 applicant accounts").
interface HiringProbabilityProps {
  responseRate?: number | null   // e.g. 0.22 (22%)
  ghostRate?: number | null      // e.g. 0.55 (55%)
  overallScore?: number | null   // 0-100
  jobLevel?: string       // e.g. "Senior", "Entry Level", "Mid level"
  profileExp?: string     // from profile.experience e.g. "2-5 years", "Senior"
  compact?: boolean       // compact mode for swipe cards (less height)
  /** Applicant accounts the rate was computed from — named as the basis; below MIN_REPORTS_FOR_RATES no percentage is shown. */
  reportCount?: number
  /** Online mentions that also feed the rate (each counts half) — named with the basis. */
  mentionCount?: number
  /** The page's one-line context for the panel (lib/companyPageSummary.ts oddsContext); built here when absent. */
  context?: string
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

export default function HiringProbability({ responseRate, ghostRate, overallScore: _overallScore, jobLevel, profileExp, compact = false, reportCount, mentionCount = 0, context: givenContext }: HiringProbabilityProps) {
  if (responseRate == null || ghostRate == null) return null
  const personalized = !!(jobLevel && profileExp)
  const prob = calcProb(responseRate, jobLevel, profileExp)
  const pct = Math.round(prob * 100)
  const color = pct >= 40 ? 'var(--green)' : pct >= 20 ? 'var(--amber)' : 'var(--red)'
  // A named basis below the bar → no percentage (the swipe deck passes no count and keeps its bar).
  const tooFew = typeof reportCount === 'number' && reportCount < MIN_REPORTS_FOR_RATES

  if (compact) {
    if (tooFew) return null
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '.45rem', marginTop: '.3rem' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--dim)', flexShrink: 0 }}>Response chance</span>
        <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,.08)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2 }} />
        </div>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', fontWeight: 500, color, flexShrink: 0 }}>{personalized ? '≈' : ''}{pct}%</span>
      </div>
    )
  }

  if (tooFew && !personalized) {
    return (
      <div style={{ background: 'rgba(99,102,241,.06)', border: '1px solid rgba(99,102,241,.15)', borderRadius: 9, padding: '.65rem .85rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.35rem', gap: '.6rem' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Response chance</span>
          <span style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--muted)', lineHeight: 1 }}>Too few reports</span>
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--muted)', lineHeight: 1.5 }}>{givenContext || tooFewReportsLine(reportCount!)}</div>
      </div>
    )
  }

  const basis = typeof reportCount === 'number' && reportCount > 0
    ? (mentionCount > 0
        ? `the share of ${reportCount} applicant account${reportCount === 1 ? '' : 's'} (and ${mentionCount} online mention${mentionCount === 1 ? '' : 's'}, each counting half) that heard back`
        : `the share of ${reportCount} applicant account${reportCount === 1 ? '' : 's'} that heard back`)
    : 'the share of applicant accounts that heard back'
  const context = personalized
    ? `${oddsPhrase(responseVerdict(prob))} · adjusted for your level`
    : (givenContext || `${oddsPhrase(responseVerdict(prob))} · ${basis}`)

  return (
    <div style={{ background: 'rgba(99,102,241,.06)', border: '1px solid rgba(99,102,241,.15)', borderRadius: 9, padding: '.65rem .85rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.35rem' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{personalized ? 'Estimated response chance' : 'Response chance'}</span>
        <span style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-lead)', fontWeight: 700, color, lineHeight: 1 }}>{pct}%</span>
      </div>
      <div style={{ height: 4, background: 'rgba(255,255,255,.07)', borderRadius: 2, overflow: 'hidden', marginBottom: '.3rem' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width .8s ease' }} />
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--muted)' }}>{context}</div>
    </div>
  )
}
