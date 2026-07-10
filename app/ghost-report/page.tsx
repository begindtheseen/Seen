import type { Metadata } from 'next'
import Link from 'next/link'
import { getLeaderboard, getScoresByNames, slugify, grade, riskColor, riskLabel, type LeaderboardRow } from '@/lib/growth'
import { STAFFING_AGENCIES } from '@/lib/agencies'
import { assembleGhostReport, pickHeadline } from '@/lib/server/ghostReport'

// The Weekly Ghost Report — the amplifier engine's flagship, auto-generated public data story
// (playbook/CONTENT_ENGINE.md). Server component + hourly ISR, reading cached scores DIRECTLY
// from Supabase via lib/growth (never a self-fetch of the live API — see lib/growth.ts). Every
// number is computed by lib/server/ghostReport.js, which ranks ONLY rows with real applicant
// reports and never fabricates a figure. The link's share card is app/ghost-report/opengraph-image.

export const revalidate = 3600

export const metadata: Metadata = {
  title: 'The Weekly Ghost Report — Which Companies Ghost Applicants | Seen',
  description:
    'A weekly, auto-generated snapshot of hiring transparency from real applicant reports: the most-reported ghosters, the companies that actually reply, and the running staffing-agency ghost index. Real numbers only — companies with no reports show no score.',
  alternates: { canonical: 'https://seenjobs.io/ghost-report' },
  openGraph: {
    title: 'The Weekly Ghost Report',
    description: 'The most-reported ghosters and the companies that actually reply — from real applicant outcomes.',
    url: 'https://seenjobs.io/ghost-report',
    type: 'website',
    siteName: 'Seen',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'The Weekly Ghost Report',
    description: 'The most-reported ghosters and the companies that actually reply — from real applicant outcomes.',
  },
}

const wrap = { maxWidth: 760, margin: '0 auto', padding: '3.5rem 1.25rem 5rem', width: '100%', boxSizing: 'border-box' as const }
const mono = (size: string, color: string): React.CSSProperties => ({ fontFamily: 'var(--mono)', fontSize: size, color })

// Human "week of Mon D, YYYY" label + a stable week ordinal, for provenance (NOT a fabricated
// trend). ISR re-renders hourly so this tracks the real calendar.
function weekProvenance(now: Date): { weekLabel: string; weekNumber: number } {
  const monday = new Date(now)
  const day = (monday.getUTCDay() + 6) % 7 // 0 = Monday
  monday.setUTCDate(monday.getUTCDate() - day)
  const weekLabel = `week of ${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`
  const start = Date.UTC(monday.getUTCFullYear(), 0, 1)
  const weekNumber = Math.floor((monday.getTime() - start) / (7 * 24 * 60 * 60 * 1000)) + 1
  return { weekLabel, weekNumber }
}

// Build the pool of scored rows the report ranks over: the public leaderboard (top companies by
// report volume) plus every staffing-agency row (agencies may not all sit in the top-150), deduped
// by stored name. The agency name set flags which rows count as agencies for the spotlight.
async function loadRows(): Promise<{ rows: LeaderboardRow[]; agencyNames: string[] }> {
  const agencyAliases = STAFFING_AGENCIES.flatMap((a) => a.aliases)
  const [leaderboard, agencyMap] = await Promise.all([getLeaderboard(), getScoresByNames(agencyAliases)])
  const byName = new Map<string, LeaderboardRow>()
  for (const r of leaderboard) if (r?.name) byName.set(r.name.toLowerCase(), r)
  for (const [name, r] of agencyMap) if (!byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), r)
  return { rows: [...byName.values()], agencyNames: agencyAliases.map((a) => a.toLowerCase()) }
}

type Ranked = ReturnType<typeof assembleGhostReport>['worstOffenders'][number]

function Stat({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem', minWidth: 0 }}>
      <div style={{ fontFamily: 'var(--display)', fontSize: '1.7rem', fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      <div style={mono('.55rem', 'var(--dim)')}>{label}</div>
    </div>
  )
}

function OffenderRow({ r, rank }: { r: Ranked; rank: number }) {
  const accent = riskColor(r.riskLevel)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '.85rem', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '.8rem 1rem', marginBottom: '.5rem' }}>
      <div style={{ ...mono('.62rem', 'var(--muted)'), width: 18, textAlign: 'right', flexShrink: 0 }}>{rank}</div>
      <div style={{ fontFamily: 'var(--display)', fontSize: '1.4rem', fontWeight: 800, color: accent, width: 28, textAlign: 'center', flexShrink: 0 }}>{grade(r.overallScore)}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <Link href={`/company/${slugify(r.name)}`} style={{ fontFamily: 'var(--display)', fontSize: '.92rem', fontWeight: 700, color: 'var(--white)', textDecoration: 'none', textTransform: 'capitalize' }}>{r.name}</Link>
        <div style={{ ...mono('.58rem', 'var(--dim)'), marginTop: '.15rem' }}>
          {r.reportCount.toLocaleString()} report{r.reportCount !== 1 ? 's' : ''}
          {r.isAgency ? ' · staffing agency' : ''}
          {r.thin ? ' · early signal — low confidence' : ''}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        {r.ghostPct != null && <div style={mono('.62rem', 'var(--red)')}>{r.ghostPct}% ghost</div>}
        {r.replyPct != null && <div style={mono('.62rem', 'var(--green)')}>{r.replyPct}% reply</div>}
      </div>
    </div>
  )
}

export default async function GhostReportPage() {
  const now = new Date()
  const { weekLabel, weekNumber } = weekProvenance(now)
  const { rows, agencyNames } = await loadRows()
  const report = assembleGhostReport(rows, { agencyNames, weekLabel, weekNumber, topN: 5 })
  const h = report.headline
  const headline = pickHeadline(report)

  return (
    <div className="page-full">
      <div style={wrap}>
        <div style={{ ...mono('.55rem', 'var(--blue)'), textTransform: 'uppercase', letterSpacing: '.2em', marginBottom: '.7rem', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 20, height: 1, background: 'var(--blue)', display: 'inline-block' }} />
          Weekly Ghost Report · {weekLabel} · updates hourly
        </div>
        <h1 style={{ fontFamily: 'var(--display)', fontSize: 'clamp(1.7rem,5.5vw,2.5rem)', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', lineHeight: 1.08, margin: '0 0 .9rem' }}>
          {headline}
        </h1>

        {report.hasReported ? (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.6rem 2.2rem', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: '1.2rem 1.4rem', margin: '1.2rem 0 2.4rem' }}>
              <Stat value={h.reportsTotal.toLocaleString()} label="applicant reports" color="var(--white)" />
              <Stat value={String(h.companiesTracked)} label="companies with reports" color="var(--white)" />
              {h.avgGhostRatePct != null && <Stat value={`${h.avgGhostRatePct}%`} label="avg reported ghost rate" color="var(--red)" />}
              {h.avgWaitDays != null && <Stat value={`${h.avgWaitDays}d`} label="avg reported wait to silence" color="var(--amber)" />}
              {h.agenciesTracked > 0 && <Stat value={String(h.agenciesTracked)} label="staffing agencies tracked" color="var(--blue)" />}
            </div>

            {report.agencySpotlight && (
              <div style={{ background: 'linear-gradient(135deg, rgba(239,68,68,.10), rgba(239,68,68,.02))', border: '1px solid rgba(239,68,68,.3)', borderRadius: 12, padding: '1.1rem 1.3rem', marginBottom: '2.2rem' }}>
                <div style={{ ...mono('.55rem', 'var(--red)'), textTransform: 'uppercase', letterSpacing: '.15em', marginBottom: '.4rem' }}>Agency spotlight</div>
                <div style={{ fontFamily: 'var(--display)', fontSize: '1.05rem', fontWeight: 700, color: 'var(--white)', lineHeight: 1.5 }}>
                  <span style={{ textTransform: 'capitalize' }}>{report.agencySpotlight.name}</span> is the most-reported ghosting staffing agency this week — {report.agencySpotlight.ghostPct}% of {report.agencySpotlight.reportCount.toLocaleString()} reported applications got no response at all.
                </div>
                <Link href="/agencies" style={{ ...mono('.62rem', 'var(--blue)'), textDecoration: 'none', display: 'inline-block', marginTop: '.6rem' }}>See the full staffing-agency ghost index →</Link>
              </div>
            )}

            {report.worstOffenders.length > 0 && (
              <section style={{ marginBottom: '2.4rem' }}>
                <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--white)', margin: '0 0 .3rem' }}>Most-reported ghosters</h2>
                <p style={{ color: 'var(--sub)', fontSize: '.8rem', lineHeight: 1.6, margin: '0 0 1rem', fontWeight: 300 }}>Ranked by reported ghost rate among companies with real applicant reports. No reports, no number.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                {report.worstOffenders.map((r, i) => (
                <OffenderRow key={r.name} r={r} rank={i + 1} />
                ))}
                </div>
                </section>
                )}

                {report.responseLeaders.length > 0 && (
                <section style={{ marginBottom: '2.4rem' }}>
                <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--white)', margin: '0 0 .3rem' }}>Actually replies</h2>
                <p style={{ color: 'var(--sub)', fontSize: '.8rem', lineHeight: 1.6, margin: '0 0 1rem', fontWeight: 300 }}>The companies applicants reported hearing back from most — proof that responding is a choice.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                {report.responseLeaders.map((r, i) => (
                <OffenderRow key={r.name} r={r} rank={i + 1} />
                ))}
                </div>
                </section>
                )}
          </>
        ) : (
          <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '1.6rem', margin: '1.4rem 0 2.4rem' }}>
            <p style={{ color: 'var(--sub)', fontSize: '.9rem', lineHeight: 1.7, fontWeight: 300, margin: 0 }}>
              The report is waiting on its first substantial batch of applicant outcomes. The framework is live — every report you submit becomes a data point in next week&apos;s edition. We&apos;ll never print a number we don&apos;t have.
            </p>
          </div>
        )}

        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', margin: '0 0 2.4rem' }}>
          <Link href="/report?outcome=ghosted" className="btn" style={{ background: 'linear-gradient(135deg,var(--g-start),var(--g-mid),var(--g-end))', color: '#fff', padding: '.7rem 1.3rem', fontWeight: 800 }}>Been ghosted? Add it — 2 min →</Link>
          <Link href="/agencies" className="btn btn-ghost" style={{ padding: '.7rem 1.3rem' }}>The full ghost index</Link>
        </div>

        <p style={{ ...mono('.6rem', 'var(--dim)'), lineHeight: 1.7 }}>
          Methodology: applicant-reported outcomes, trust-weighted, aggregated with public hiring signals into a 0–100 Seen Grade. These are community signals, not verified facts, and update hourly as reports arrive. Percentages appear only where applicants have actually reported outcomes; companies with no reports show no number — Seen never fabricates a rate.
        </p>
      </div>
    </div>
  )
}
