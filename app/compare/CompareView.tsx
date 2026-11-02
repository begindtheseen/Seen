import Link from 'next/link'
import { grade, pct, slugify, firstPartyReportCount, MIN_REPORTS_FOR_GRADE, displayCompanyName, type GrowthScore } from '@/lib/growth'
import { gradeTone, gradeWord, ghostRateTone, ghostRateWord, responseRateTone, responseRateWord, toneText } from '@/lib/ui/tone.js'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'

// Server-rendered side-by-side comparison card used by both /compare?a=&b= and /compare/[slugs].
// Mobile-first: two columns that stay readable at 390px (no overflow), real data only.
//
// ONE scale, one palette (design review 2026-11-02): the letter's tone and word come from the grade
// (lib/ui/tone.js gradeTone / gradeWord — "Mixed record", never the stored "CAUTION"), and a rate is
// coloured only by the shared thresholds, with its word and icon — the same badge the company page,
// /companies and /agencies show. A 25% ghost rate reads "Low" here exactly as it does there.

const card: React.CSSProperties = { flex: '1 1 0', minWidth: 0, background: 'var(--surface-1)', border: '1px solid var(--border-1)', borderRadius: 'var(--r-card)', padding: '1rem', textAlign: 'center' }
const nameStyle: React.CSSProperties = { fontFamily: 'var(--body)', fontSize: 'var(--fs-lead)', fontWeight: 600, color: 'var(--text-1)', wordBreak: 'break-word', lineHeight: 1.15 }
const bigDash: React.CSSProperties = { fontFamily: 'var(--body)', fontSize: 'var(--fs-fig-m)', fontWeight: 600, color: 'var(--text-4)', margin: '.5rem 0' }
const small: React.CSSProperties = { fontSize: 'var(--fs-meta)', color: 'var(--text-3)', lineHeight: 1.5 }

function Col({ name, s }: { name: string; s: GrowthScore | null }) {
  const cslug = slugify(name)
  const shown = s?.company_name ? displayCompanyName(s.company_name) : name
  if (!s) {
    return (
      <div style={card}>
        <div style={nameStyle}>{shown}</div>
        <div style={bigDash}>?</div>
        <div style={small}>No reports yet.</div>
        <Button variant="secondary" size="sm" href="/report" style={{ marginTop: '.75rem' }}>Be the first to report</Button>
      </div>
    )
  }
  // First-party applicant accounts only — the fused report_count includes the web-research claim.
  const fp = firstPartyReportCount(s)
  // Grade gate: below MIN_REPORTS_FOR_GRADE real reports there is no grade or rate to compare.
  if (s.overall_score == null) {
    return (
      <div style={card}>
        <Link href={`/company/${cslug}`} style={{ textDecoration: 'none' }}><div style={nameStyle}>{shown}</div></Link>
        <div style={bigDash}>—</div>
        <div style={small}>{`Not graded yet (${Math.min(fp, MIN_REPORTS_FOR_GRADE)} of ${MIN_REPORTS_FOR_GRADE} applicant accounts).`}</div>
        <Button variant="secondary" size="sm" href={fp > 0 ? `/company/${cslug}` : '/report'} style={{ marginTop: '.75rem' }}>{fp > 0 ? 'Read the reports' : 'Be the first to report'}</Button>
      </div>
    )
  }
  const tone = gradeTone(s.overall_score)
  const gTone = ghostRateTone(s.ghost_rate)
  const rTone = responseRateTone(s.response_rate)
  const ghost = pct(s.ghost_rate)
  const reply = pct(s.response_rate)
  const rows: { label: string; cell: React.ReactNode }[] = [
    { label: 'Ghost rate', cell: ghost != null && gTone ? <Badge tone={gTone}>{ghost}% · {ghostRateWord(gTone)}</Badge> : <span style={{ color: 'var(--text-1)' }}>—</span> },
    { label: 'Response rate', cell: reply != null && rTone ? <Badge tone={rTone}>{reply}% · {responseRateWord(rTone)}</Badge> : <span style={{ color: 'var(--text-1)' }}>—</span> },
    { label: 'Avg wait', cell: <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{s.avg_wait_days != null ? `${Math.round(s.avg_wait_days)}d` : '—'}</span> },
    { label: 'Accounts', cell: <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{fp > 0 ? fp.toLocaleString() : '—'}</span> },
  ]
  return (
    <div style={card}>
      <Link href={`/company/${cslug}`} style={{ textDecoration: 'none' }}><div style={nameStyle}>{shown}</div></Link>
      {/* The letter is a figure: Instrument Sans 600, toned by the grade, with its word beside it. */}
      <div style={{ fontFamily: 'var(--body)', fontSize: 'var(--fs-fig-m)', fontWeight: 600, color: toneText(tone), lineHeight: 1, margin: '.5rem 0 .25rem', fontVariantNumeric: 'tabular-nums' }}>{grade(s.overall_score)}</div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.25rem' }}>
        <span style={{ fontFamily: 'var(--body)', fontSize: 'var(--fs-sm)', color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>{s.overall_score}/100</span>
        {tone && <Badge tone={tone}>{gradeWord(tone)}</Badge>}
      </div>
      <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
        {rows.map(r => (
          <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', borderTop: '1px solid var(--border-1)', paddingTop: '.5rem', flexWrap: 'wrap' }}>
            <span className="ui-eyebrow">{r.label}</span>
            <span style={{ fontFamily: 'var(--body)', fontSize: 'var(--fs-ui)', fontVariantNumeric: 'tabular-nums' }}>{r.cell}</span>
          </div>
        ))}
      </div>
      <div style={{ fontFamily: 'var(--body)', fontSize: 'var(--fs-meta)', color: 'var(--text-4)', marginTop: '.75rem', lineHeight: 1.5 }}>
        {`Based on ${fp.toLocaleString()} applicant account${fp === 1 ? '' : 's'}`}
      </div>
    </div>
  )
}

function Verdict({ aName, a, bName, b }: { aName: string; a: GrowthScore | null; bName: string; b: GrowthScore | null }) {
  // Grade gate: a verdict needs two GRADED companies (both ≥ MIN_REPORTS_FOR_GRADE real reports).
  if (!a || !b || a.overall_score == null || b.overall_score == null) return null
  const better = a.overall_score >= b.overall_score ? aName : bName
  const worse = better === aName ? bName : aName
  const hi = Math.max(a.overall_score, b.overall_score)
  const lo = Math.min(a.overall_score, b.overall_score)
  const tie = hi === lo
  // Both graded → both have real reports behind them (the estimate-only case can't reach here).
  const anyEst = firstPartyReportCount(a) === 0 || firstPartyReportCount(b) === 0
  return (
    <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border-1)', borderRadius: 'var(--r-card)', padding: '1rem 1.25rem', margin: '1.5rem 0 0' }}>
      <div className="ui-eyebrow" style={{ marginBottom: '.5rem' }}>The verdict</div>
      <p style={{ color: 'var(--text-3)', fontSize: 'var(--fs-sm)', lineHeight: 1.65, margin: 0, fontWeight: 400 }}>
        {tie
          ? `${aName} and ${bName} score evenly at ${hi}/100 on hiring transparency. Compare the ghost and response rates above to break the tie for your situation.`
          : <>On {anyEst ? 'Seen’s hiring-transparency grade' : 'reported hiring transparency'}, <strong style={{ color: 'var(--text-1)' }}>{better}</strong> scores higher ({hi}/100) than <strong style={{ color: 'var(--text-1)' }}>{worse}</strong> ({lo}/100). {anyEst ? 'At least one of these grades is estimated from aggregated public data rather than applicant accounts, so treat the gap as directional.' : `That means applicants to ${better} were more likely to hear back.`} Scores are community signals, not verified facts.</>}
      </p>
    </div>
  )
}

export default function CompareView({
  aName, a, bName, b,
}: { aName: string; a: GrowthScore | null; bName: string; b: GrowthScore | null }) {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', gap: '.75rem', alignItems: 'stretch' }}>
        <Col name={aName} s={a} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--body)', fontWeight: 600, fontSize: 'var(--fs-ui)', color: 'var(--text-4)', flexShrink: 0 }}>vs</div>
        <Col name={bName} s={b} />
      </div>
      <Verdict aName={aName} a={a} bName={bName} b={b} />
    </div>
  )
}
