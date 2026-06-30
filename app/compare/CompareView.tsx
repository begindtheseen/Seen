import Link from 'next/link'
import { grade, riskColor, riskLabel, pct, slugify, type GrowthScore } from '@/lib/growth'

// Server-rendered side-by-side comparison card used by both /compare?a=&b= and /compare/[slugs].
// Mobile-first: two columns that stay readable at 390px (no overflow), real data only.

function Col({ name, s }: { name: string; s: GrowthScore | null }) {
  const cslug = slugify(name)
  if (!s) {
    return (
      <div style={{ flex: '1 1 0', minWidth: 0, background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '1.1rem', textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--display)', fontSize: '1.1rem', fontWeight: 800, color: 'var(--white)', wordBreak: 'break-word' }}>{name}</div>
        <div style={{ fontFamily: 'var(--display)', fontSize: '2.6rem', fontWeight: 800, color: 'var(--dim)', margin: '.6rem 0' }}>?</div>
        <div style={{ fontSize: '.74rem', color: 'var(--sub)', lineHeight: 1.5 }}>No reports yet.</div>
        <Link href={`/report`} className="btn btn-ghost" style={{ marginTop: '.8rem', fontSize: '.7rem', padding: '.5rem .9rem' }}>Be the first to report</Link>
      </div>
    )
  }
  const accent = riskColor(s.risk_level)
  const rows: { label: string; value: string; color?: string }[] = [
    { label: 'Ghost rate', value: pct(s.ghost_rate) != null ? `${pct(s.ghost_rate)}%` : '—', color: 'var(--red)' },
    { label: 'Response rate', value: pct(s.response_rate) != null ? `${pct(s.response_rate)}%` : '—', color: 'var(--green)' },
    { label: 'Avg wait', value: s.avg_wait_days != null ? `${Math.round(s.avg_wait_days)}d` : '—', color: 'var(--amber)' },
    { label: 'Reports', value: s.report_count > 0 ? s.report_count.toLocaleString() : '—' },
  ]
  return (
    <div style={{ flex: '1 1 0', minWidth: 0, background: 'var(--card)', border: '1px solid var(--line)', borderTop: `3px solid ${accent}`, borderRadius: 12, padding: '1.1rem', textAlign: 'center' }}>
      <Link href={`/company/${cslug}`} style={{ textDecoration: 'none' }}>
        <div style={{ fontFamily: 'var(--display)', fontSize: '1.05rem', fontWeight: 800, color: 'var(--white)', wordBreak: 'break-word', lineHeight: 1.15 }}>{name}</div>
      </Link>
      <div style={{ fontFamily: 'var(--display)', fontSize: '2.8rem', fontWeight: 800, color: accent, lineHeight: 1, margin: '.5rem 0 .15rem' }}>{grade(s.overall_score)}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', letterSpacing: '.1em', color: accent }}>{s.overall_score}/100 · {riskLabel(s.risk_level)}</div>
      <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
        {rows.map(r => (
          <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '.5rem', borderTop: '1px solid var(--line)', paddingTop: '.5rem' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--dim)' }}>{r.label}</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.85rem', fontWeight: 500, color: r.color || 'var(--white)' }}>{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Verdict({ aName, a, bName, b }: { aName: string; a: GrowthScore | null; bName: string; b: GrowthScore | null }) {
  if (!a || !b) return null
  const better = a.overall_score >= b.overall_score ? aName : bName
  const worse = better === aName ? bName : aName
  const hi = Math.max(a.overall_score, b.overall_score)
  const lo = Math.min(a.overall_score, b.overall_score)
  const tie = hi === lo
  return (
    <div style={{ background: 'var(--raised)', border: '1px solid var(--line)', borderRadius: 12, padding: '1rem 1.2rem', margin: '1.4rem 0 0' }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--blue)', marginBottom: '.5rem' }}>The verdict</div>
      <p style={{ color: 'var(--sub)', fontSize: '.84rem', lineHeight: 1.65, margin: 0, fontWeight: 300 }}>
        {tie
          ? `${aName} and ${bName} score evenly at ${hi}/100 on hiring transparency. Compare the ghost and response rates above to break the tie for your situation.`
          : <>On reported hiring transparency, <strong style={{ color: 'var(--white)' }}>{better}</strong> scores higher ({hi}/100) than <strong style={{ color: 'var(--white)' }}>{worse}</strong> ({lo}/100). That means applicants to {better} were more likely to hear back. Scores are community signals, not verified facts.</>}
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.85rem', color: 'var(--dim)', flexShrink: 0 }}>vs</div>
        <Col name={bName} s={b} />
      </div>
      <Verdict aName={aName} a={a} bName={bName} b={b} />
    </div>
  )
}
