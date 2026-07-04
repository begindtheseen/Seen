import type { Metadata } from 'next'
import Link from 'next/link'
import { getScoresByNames, slugify, grade, riskColor, riskLabel, pct, type LeaderboardRow } from '@/lib/growth'
import { STAFFING_AGENCIES, type StaffingAgency } from '@/lib/agencies'

// The Staffing Agency Ghost Index: a ranked, living page of major staffing agencies by
// ghosting/transparency signals. Server component + ISR, reading cached scores DIRECTLY from
// Supabase via lib/growth (never a self-fetch of the live API — see the warning in lib/growth.ts).
//
// HONESTY RULES (load-bearing — do not soften):
// - Ghost/response percentages are shown ONLY for agencies with actual applicant reports
//   (report_count > 0). Score rows that exist with zero reports carry web-prior estimates;
//   those show a grade explicitly labeled as estimated, never a percentage.
// - Agencies with no score row at all show "No reports yet — be the first". No number is
//   ever fabricated for them.

export const revalidate = 3600

export const metadata: Metadata = {
  title: 'Staffing Agency Ghost Index — Which Agencies Ghost Candidates | Seen',
  description:
    'A live index of major staffing agencies — Robert Half, Aerotek, Insight Global, TEKsystems, Randstad and more — ranked by reported ghost rates and response rates from real applicants. See who replies before you hand an agency your resume.',
  keywords: [
    'staffing agency ghosting', 'staffing agency ghost rate', 'do staffing agencies ghost',
    'recruiter ghosted me', 'staffing agency reviews', 'best staffing agencies', 'worst staffing agencies',
    'Robert Half ghosting', 'Aerotek ghosting', 'Insight Global ghosting',
  ],
  alternates: { canonical: 'https://seenjobs.io/agencies' },
  openGraph: {
    title: 'The Staffing Agency Ghost Index',
    description: 'Major staffing agencies ranked by reported ghost rates and response rates from real applicants.',
    url: 'https://seenjobs.io/agencies',
    type: 'website',
    siteName: 'Seen',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'The Staffing Agency Ghost Index',
    description: 'Staffing agencies ranked by reported ghost rates from real applicants.',
  },
}

const wrap = { maxWidth: 760, margin: '0 auto', padding: '3.5rem 1.25rem 5rem', width: '100%', boxSizing: 'border-box' as const }
const mono = (size: string, color: string): React.CSSProperties => ({ fontFamily: 'var(--mono)', fontSize: size, color })

type Ranked = {
  agency: StaffingAgency
  row: LeaderboardRow | null // matched company_scores row (may have 0 applicant reports)
  slug: string // slug of the matched stored name when scored, else of the display name
}

function reportHref(agencyName: string) {
  return `/report?company=${encodeURIComponent(agencyName)}&outcome=ghosted`
}

function ReportCta({ agencyName }: { agencyName: string }) {
  return (
    <Link href={reportHref(agencyName)} style={{ ...mono('.6rem', 'var(--blue)'), textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}>
      Report →
    </Link>
  )
}

// Row for an agency WITH real applicant reports: grade + honest percentages + count.
function ReportedRow({ r, rank }: { r: Ranked; rank: number }) {
  const s = r.row!.score
  const accent = riskColor(s.risk_level)
  const ghost = pct(s.ghost_rate)
  const reply = pct(s.response_rate)
  const thin = s.report_count < 10
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '.85rem', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '.85rem 1rem', marginBottom: '.55rem' }}>
      <div style={{ ...mono('.62rem', 'var(--muted)'), width: 18, textAlign: 'right', flexShrink: 0 }}>{rank}</div>
      <div style={{ fontFamily: 'var(--display)', fontSize: '1.5rem', fontWeight: 800, color: accent, width: 30, textAlign: 'center', flexShrink: 0 }}>{grade(s.overall_score)}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <Link href={`/company/${r.slug}`} style={{ fontFamily: 'var(--display)', fontSize: '.92rem', fontWeight: 700, color: 'var(--white)', textDecoration: 'none' }}>{r.agency.name}</Link>
        <div style={{ ...mono('.6rem', 'var(--dim)'), marginTop: '.15rem' }}>
          {s.report_count.toLocaleString()} report{s.report_count !== 1 ? 's' : ''} · {riskLabel(s.risk_level)}
          {thin ? ' · early signal — low confidence' : ''}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        {ghost != null && <div style={mono('.62rem', 'var(--red)')}>{ghost}% ghost</div>}
        {reply != null && <div style={mono('.62rem', 'var(--green)')}>{reply}% reply</div>}
      </div>
      <ReportCta agencyName={r.agency.name} />
    </div>
  )
}

// Row for an agency whose score row exists but has ZERO applicant reports: the grade is an
// estimate from public hiring signals, so we label it as such and show no percentages.
function EstimatedRow({ r }: { r: Ranked }) {
  const s = r.row!.score
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '.85rem', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '.85rem 1rem', marginBottom: '.55rem', opacity: 0.92 }}>
      <div style={{ fontFamily: 'var(--display)', fontSize: '1.5rem', fontWeight: 800, color: 'var(--dim)', width: 30, textAlign: 'center', flexShrink: 0 }}>{grade(s.overall_score)}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <Link href={`/company/${r.slug}`} style={{ fontFamily: 'var(--display)', fontSize: '.92rem', fontWeight: 700, color: 'var(--white)', textDecoration: 'none' }}>{r.agency.name}</Link>
        <div style={{ ...mono('.6rem', 'var(--dim)'), marginTop: '.15rem' }}>
          Grade estimated from public hiring signals · no applicant reports yet — be the first
        </div>
      </div>
      <ReportCta agencyName={r.agency.name} />
    </div>
  )
}

// Row for an agency we have NO data on at all. Explicit empty state — never a made-up number.
function EmptyRow({ r }: { r: Ranked }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '.85rem', background: 'var(--surface)', border: '1px dashed var(--line2)', borderRadius: 10, padding: '.85rem 1rem', marginBottom: '.55rem' }}>
      <div style={{ fontFamily: 'var(--display)', fontSize: '1.5rem', fontWeight: 800, color: 'var(--muted)', width: 30, textAlign: 'center', flexShrink: 0 }}>—</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <Link href={`/company/${r.slug}`} style={{ fontFamily: 'var(--display)', fontSize: '.92rem', fontWeight: 700, color: 'var(--sub)', textDecoration: 'none' }}>{r.agency.name}</Link>
        <div style={{ ...mono('.6rem', 'var(--muted)'), marginTop: '.15rem' }}>No reports yet — be the first</div>
      </div>
      <ReportCta agencyName={r.agency.name} />
    </div>
  )
}

export default async function AgenciesPage() {
  // One exact-name batch read against cached scores (see honesty note in lib/agencies.ts on
  // why matching is exact, never fuzzy).
  const allAliases = STAFFING_AGENCIES.flatMap(a => a.aliases)
  const scoreMap = await getScoresByNames(allAliases)

  const ranked: Ranked[] = STAFFING_AGENCIES.map(agency => {
    // Best match across aliases: prefer the row with the most applicant reports, then alias order.
    let row: LeaderboardRow | null = null
    for (const alias of agency.aliases) {
      const hit = scoreMap.get(alias)
      if (hit && (!row || hit.score.report_count > row.score.report_count)) row = hit
    }
    return { agency, row, slug: slugify(row ? row.name : agency.name) }
  })

  const reported = ranked
    .filter(r => r.row && r.row.score.report_count > 0)
    .sort((a, b) => b.row!.score.ghost_rate - a.row!.score.ghost_rate || a.agency.name.localeCompare(b.agency.name))
  const estimated = ranked
    .filter(r => r.row && r.row.score.report_count === 0)
    .sort((a, b) => a.row!.score.overall_score - b.row!.score.overall_score || a.agency.name.localeCompare(b.agency.name))
  const unlisted = ranked
    .filter(r => !r.row)
    .sort((a, b) => a.agency.name.localeCompare(b.agency.name))

  const totalReports = reported.reduce((n, r) => n + r.row!.score.report_count, 0)

  const faqQa = [
    {
      q: 'What is a staffing agency ghost rate?',
      a: 'The share of applicants who reported never hearing back from an agency after applying or interviewing — no rejection, no update, just silence. Seen computes it from real applicant outcome reports, not agency marketing.',
    },
    {
      q: 'Do staffing agencies ghost candidates more than direct employers?',
      a: 'Staffing agencies run high-volume pipelines, where candidates commonly report going silent after an initial screen. This index exists so those patterns are visible per agency instead of anecdotal — each agency’s row shows exactly how much reported data sits behind it.',
    },
    {
      q: 'Are these ghost rates verified facts?',
      a: 'No. They are aggregated community signals from applicant reports and public hiring data, with confidence labels where data is thin. Agencies with no reports show no numbers at all — Seen never fabricates a rate.',
    },
  ]
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqQa.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  }

  return (
    <div className="page-full">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div style={wrap}>
        <div style={{ ...mono('.55rem', 'var(--blue)'), textTransform: 'uppercase', letterSpacing: '.2em', marginBottom: '.7rem', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 20, height: 1, background: 'var(--blue)', display: 'inline-block' }} />
          Live index · updates hourly
        </div>
        <h1 style={{ fontFamily: 'var(--display)', fontSize: 'clamp(1.7rem,5.5vw,2.5rem)', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', lineHeight: 1.08, margin: '0 0 .9rem' }}>
          The Staffing Agency Ghost Index
        </h1>
        <p style={{ color: 'var(--sub)', fontSize: '.95rem', lineHeight: 1.75, fontWeight: 300, margin: '0 0 1.4rem' }}>
          Staffing agencies are the highest-volume gatekeepers in hiring — and the most common source of &ldquo;the recruiter just disappeared&rdquo; stories. This index tracks {STAFFING_AGENCIES.length} major agencies by what applicants actually report: who replies, who ghosts, and how long it takes.
          {totalReports > 0 ? ` It currently reflects ${totalReports.toLocaleString()} applicant reports and grows with every new one.` : ' It grows with every report submitted.'}
        </p>
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', margin: '0 0 2.6rem' }}>
          <Link href="/report?outcome=ghosted" className="btn" style={{ background: 'linear-gradient(135deg,var(--g-start),var(--g-mid),var(--g-end))', color: '#fff', padding: '.7rem 1.3rem', fontWeight: 800 }}>Ghosted by an agency? Report it →</Link>
          <Link href="/ghosted" className="btn btn-ghost" style={{ padding: '.7rem 1.3rem' }}>Why this index exists</Link>
        </div>

        {reported.length > 0 && (
          <section style={{ marginBottom: '2.4rem' }}>
            <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--white)', margin: '0 0 .3rem' }}>Ranked by reported ghost rate</h2>
            <p style={{ color: 'var(--sub)', fontSize: '.8rem', lineHeight: 1.6, margin: '0 0 1rem', fontWeight: 300 }}>Agencies with real applicant reports, worst ghost rate first. Percentages come only from reported outcomes — never estimates.</p>
            {reported.map((r, i) => <ReportedRow key={r.agency.name} r={r} rank={i + 1} />)}
          </section>
        )}

        {estimated.length > 0 && (
          <section style={{ marginBottom: '2.4rem' }}>
            <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--white)', margin: '0 0 .3rem' }}>Graded on public signals — awaiting first reports</h2>
            <p style={{ color: 'var(--sub)', fontSize: '.8rem', lineHeight: 1.6, margin: '0 0 1rem', fontWeight: 300 }}>These agencies have a provisional Seen Grade from public hiring signals, but no applicant reports yet — so no ghost percentage is shown. One report starts their real record.</p>
            {estimated.map(r => <EstimatedRow key={r.agency.name} r={r} />)}
          </section>
        )}

        {unlisted.length > 0 && (
          <section style={{ marginBottom: '2.4rem' }}>
            <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--white)', margin: '0 0 .3rem' }}>No data yet</h2>
            <p style={{ color: 'var(--sub)', fontSize: '.8rem', lineHeight: 1.6, margin: '0 0 1rem', fontWeight: 300 }}>We have nothing on these agencies yet — and we won&apos;t invent a number. If you&apos;ve applied through one, your report is the first data point.</p>
            {unlisted.map(r => <EmptyRow key={r.agency.name} r={r} />)}
          </section>
        )}

        {reported.length === 0 && estimated.length === 0 && unlisted.length === 0 && (
          <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.7rem' }}>
            The index is loading its first data. Check back shortly — or <Link href="/report?outcome=ghosted" style={{ color: 'var(--blue)' }}>add the first report</Link>.
          </div>
        )}

        <section style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '1.4rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.05rem', fontWeight: 700, color: 'var(--white)', margin: '0 0 .8rem' }}>What is a staffing agency ghost rate?</h2>
          {faqQa.map(({ q, a }) => (
            <div key={q} style={{ marginBottom: '.9rem' }}>
              <div style={{ fontFamily: 'var(--display)', fontSize: '.85rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.25rem' }}>{q}</div>
              <p style={{ color: 'var(--sub)', fontSize: '.8rem', lineHeight: 1.7, fontWeight: 300, margin: 0 }}>{a}</p>
            </div>
          ))}
        </section>

        <p style={{ ...mono('.6rem', 'var(--dim)'), lineHeight: 1.7 }}>
          Seen Grades aggregate applicant reports and public hiring signals into a 0–100 score. They are community signals, not verified facts, and update hourly as new reports arrive. Percentages appear only where applicants have actually reported outcomes.
        </p>
      </div>
    </div>
  )
}
