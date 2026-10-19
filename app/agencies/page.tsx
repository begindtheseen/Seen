import type { Metadata } from 'next'
import Link from 'next/link'
import { getScoresByNames, slugify, grade, riskColor, riskLabel, pct, MIN_REPORTS_FOR_GRADE, type LeaderboardRow } from '@/lib/growth'
import { publicDiscussionCountPath, parseExactCount, publicDiscussionShare } from '@/lib/server/reportCounts'
import { STAFFING_AGENCIES, type StaffingAgency } from '@/lib/agencies'
import { pickActiveSponsor } from '@/lib/server/sponsorSlot'
import { jsonLdHtml } from '@/lib/jsonLd'
import { notEnoughReviewsLabel } from '@/lib/gradeGate'
import PageHeader from '@/components/shell/PageHeader'

// The Staffing Agency Ghost Index: a ranked, living page of major staffing agencies by
// ghosting/transparency signals. Server component + ISR, reading cached scores DIRECTLY from
// Supabase via lib/growth (never a self-fetch of the live API — see the warning in lib/growth.ts).
//
// HONESTY RULES (load-bearing — do not soften):
// - Ghost/response percentages are shown ONLY for agencies with actual applicant reports
//   (first_party_report_count > 0 — NEVER the fused report_count, which adds the web-research
//   pipeline's *claimed* mention count: live, Robert Half showed "3,085 reports" with zero report
//   rows behind it).
// - GRADE GATE (owner decision 2026-10-17, lib/server/reportCounts.js MIN_REPORTS_FOR_GRADE): a grade
//   and percentages appear only with ≥5 first-party reports. 1–4 reports → "building a record" row with
//   the count and no verdict; 0 reports → "no data yet", even if a web-prior estimate exists (estimates
//   are never shown as a grade).
// - First-party reports include attributed public third-party rows — Reddit threads imported with
//   platform "Reddit r/<sub>" and first-hand accounts from public review sites found by web search
//   (platform "Public review · <host>"), both trust-weighted 0.3 in the fusion. Each reported row
//   says how many of its reports came from those public sources; if that count can't be read, NO
//   split is shown (never a guessed one).
// - Agencies with no score row at all show "No reports yet — be the first". No number is
//   ever fabricated for them.

export const revalidate = 3600

export const metadata: Metadata = {
  title: 'Staffing Agency Ghost Index — Which Agencies Ghost Candidates | Seen',
  description:
    'A live index of major staffing agencies — Robert Half, Aerotek, Insight Global, TEKsystems, Randstad and more — ranked by applicant-reported ghost and response rates, from outcomes submitted to Seen or shared publicly in discussion threads and on review sites. Agencies without reports are labeled, never given a made-up rate.',
  keywords: [
    'staffing agency ghosting', 'staffing agency ghost rate', 'do staffing agencies ghost',
    'recruiter ghosted me', 'staffing agency reviews', 'best staffing agencies', 'worst staffing agencies',
    'Robert Half ghosting', 'Aerotek ghosting', 'Insight Global ghosting',
  ],
  alternates: { canonical: 'https://seenjobs.io/agencies' },
  openGraph: {
    title: 'The Staffing Agency Ghost Index',
    description: 'Major staffing agencies ranked by applicant-reported ghost and response rates — no reports, no number.',
    url: 'https://seenjobs.io/agencies',
    type: 'website',
    siteName: 'Seen',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'The Staffing Agency Ghost Index',
    description: 'Staffing agencies ranked by applicant-reported ghost rates — no reports, no number.',
  },
}

const wrap = { maxWidth: 760, margin: '0 auto', padding: '3.5rem 1.25rem 5rem', width: '100%', boxSizing: 'border-box' as const }
const mono = (size: string, color: string): React.CSSProperties => ({ fontFamily: 'var(--mono)', fontSize: size, color })

type Ranked = {
  agency: StaffingAgency
  row: LeaderboardRow | null // matched company_scores row (may have 0 applicant reports)
  slug: string // slug of the matched stored name when scored, else of the display name
  reports: number // FIRST-PARTY applicant reports behind the row (0 when none / no row)
  publicDiscussion: number | null // of `reports`, how many came from public discussion threads / review sites; null = unknown
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

// Row for an agency WITH first-party applicant reports: grade + honest percentages + count, and how
// much of that count is attributed public discussion / review-site content.
function ReportedRow({ r, rank }: { r: Ranked; rank: number }) {
  const s = r.row!.score
  if (s.overall_score == null) return null // only gradeable rows reach here
  const accent = riskColor(s.risk_level)
  const ghost = pct(s.ghost_rate)
  const reply = pct(s.response_rate)
  const n = r.reports
  const thin = n < 10
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '.85rem', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '.85rem 1rem', marginBottom: '.55rem' }}>
      <div style={{ ...mono('.62rem', 'var(--muted)'), width: 18, textAlign: 'right', flexShrink: 0 }}>{rank}</div>
      <div style={{ fontFamily: 'var(--display)', fontSize: '1.5rem', fontWeight: 800, color: accent, width: 30, textAlign: 'center', flexShrink: 0 }}>{grade(s.overall_score)}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <Link href={`/company/${r.slug}`} style={{ fontFamily: 'var(--display)', fontSize: '.92rem', fontWeight: 700, color: 'var(--white)', textDecoration: 'none' }}>{r.agency.name}</Link>
        <div style={{ ...mono('.6rem', 'var(--dim)'), marginTop: '.15rem' }}>
          {n.toLocaleString()} report{n !== 1 ? 's' : ''}
          {r.publicDiscussion ? ` · ${r.publicDiscussion.toLocaleString()} from public threads & review sites` : ''}
          {` · ${riskLabel(s.risk_level)}`}
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

// Row for an agency with SOME applicant reports but fewer than the grade bar: the reports are
// readable on its page, but no grade or percentage is shown until it has enough of them.
function BuildingRow({ r }: { r: Ranked }) {
  const n = r.reports
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '.85rem', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '.85rem 1rem', marginBottom: '.55rem', opacity: 0.92 }}>
      <div style={{ fontFamily: 'var(--display)', fontSize: '1.5rem', fontWeight: 800, color: 'var(--muted)', width: 30, textAlign: 'center', flexShrink: 0 }}>—</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <Link href={`/company/${r.slug}`} style={{ fontFamily: 'var(--display)', fontSize: '.92rem', fontWeight: 700, color: 'var(--white)', textDecoration: 'none' }}>{r.agency.name}</Link>
        <div style={{ ...mono('.6rem', 'var(--dim)'), marginTop: '.15rem' }}>
          {/* The one wording every surface uses — reports plus half of each online mention, like the company page. */}
          {notEnoughReviewsLabel(r.row?.score ?? null)}
          {r.publicDiscussion ? ` · ${r.publicDiscussion.toLocaleString()} from public threads & review sites` : ''}
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

// How many of an agency's first-party reports came from attributed public sources (Reddit threads
// and public review sites). Same service-key server read as fetchActiveSponsor below, counting the exact corpus the score
// fusion counts (lib/server/reportCounts.js publicDiscussionCountPath). Best-effort: ANY failure
// returns null and the row shows no split — never a wrong one.
async function fetchPublicDiscussionCount(storedName: string): Promise<number | null> {
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
  const path = publicDiscussionCountPath(storedName)
  if (!SUPABASE_URL || !SERVICE_KEY || !path) return null
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method: 'HEAD',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Prefer: 'count=exact' },
      signal: AbortSignal.timeout(2500),
    })
    if (!r.ok) return null
    return parseExactCount(r.headers.get('content-range'))
  } catch {
    return null
  }
}

// The single, owner-granted sponsor slot for this page (employer_perks.sponsor_until). Read directly
// with the service key (perks are server-only), same pattern as the other server reads. Best-effort:
// any failure just hides the slot — it never breaks the index.
async function fetchActiveSponsor(): Promise<{ company: string; until: string } | null> {
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
  if (!SUPABASE_URL || !SERVICE_KEY) return null
  try {
    const nowISO = new Date().toISOString()
    const r = await fetch(`${SUPABASE_URL}/rest/v1/employer_perks?sponsor_until=gt.${encodeURIComponent(nowISO)}&select=company,sponsor_until&limit=50`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }, next: { revalidate: 3600 },
    })
    if (!r.ok) return null
    return pickActiveSponsor(await r.json(), Date.now())
  } catch {
    return null
  }
}

export default async function AgenciesPage() {
  // One exact-name batch read against cached scores (see honesty note in lib/agencies.ts on
  // why matching is exact, never fuzzy).
  const allAliases = STAFFING_AGENCIES.flatMap(a => a.aliases)
  const scoreMap = await getScoresByNames(allAliases)
  const sponsor = await fetchActiveSponsor()

  const matched = STAFFING_AGENCIES.map(agency => {
    // Best match across aliases: prefer the row with the most FIRST-PARTY applicant reports, then
    // the larger fused total (more evidence behind the estimate), then alias order.
    let row: LeaderboardRow | null = null
    for (const alias of agency.aliases) {
      const hit = scoreMap.get(alias)
      if (!hit) continue
      if (!row
        || hit.score.first_party_report_count > row.score.first_party_report_count
        || (hit.score.first_party_report_count === row.score.first_party_report_count && hit.score.report_count > row.score.report_count)) row = hit
    }
    return { agency, row, slug: slugify(row ? row.name : agency.name), reports: row ? row.score.first_party_report_count : 0 }
  })

  // Public-discussion split, read only for agencies that actually have first-party reports.
  const ranked: Ranked[] = await Promise.all(matched.map(async m => ({
    ...m,
    publicDiscussion: m.row && m.reports > 0
      ? publicDiscussionShare(await fetchPublicDiscussionCount(m.row.name), m.reports)
      : null,
  })))

  // Grade gate: only gradeable agencies (≥ MIN_REPORTS_FOR_GRADE real reports) are ranked.
  const reported = ranked
    .filter(r => r.row?.score.gradeable)
    .sort((a, b) => (b.row!.score.ghost_rate ?? 0) - (a.row!.score.ghost_rate ?? 0) || a.agency.name.localeCompare(b.agency.name))
  const building = ranked
    .filter(r => r.row && !r.row.score.gradeable && r.reports > 0)
    .sort((a, b) => b.reports - a.reports || a.agency.name.localeCompare(b.agency.name))
  // No real reports → no data, even when a web-prior estimate exists (never shown as a grade).
  const unlisted = ranked
    .filter(r => !r.row || r.reports === 0)
    .sort((a, b) => a.agency.name.localeCompare(b.agency.name))

  const withReports = [...reported, ...building]
  const totalReports = withReports.reduce((n, r) => n + r.reports, 0)
  // Only state a public-discussion total when EVERY row-with-reports' split is known — a partial sum
  // would understate it.
  const totalPublic = withReports.every(r => r.publicDiscussion != null)
    ? withReports.reduce((n, r) => n + (r.publicDiscussion ?? 0), 0)
    : null

  const faqQa = [
    {
      q: 'What is a staffing agency ghost rate?',
      a: 'The share of applicants who reported never hearing back from an agency after applying or interviewing — no rejection, no update, just silence. Seen computes it from applicant-reported outcomes — submitted to Seen, or shared publicly in discussion threads and on review sites (labeled, linked to their source where available, and down-weighted) — not agency marketing, and never from web-research estimates.',
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
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }} />
      <div style={wrap}>
        <PageHeader
          size="lg"
          eyebrow="Live index · updates hourly"
          title="The Staffing Agency Ghost Index"
          crumbLabel="Agency Ghost Index"
          sub={<>
            Staffing agencies are the highest-volume gatekeepers in hiring — and the most common source of &ldquo;the recruiter just disappeared&rdquo; stories. This index tracks {STAFFING_AGENCIES.length} major agencies by what applicants actually report: who replies, who ghosts, and how long it takes.
            {totalReports > 0
              ? ` It currently reflects ${totalReports.toLocaleString()} applicant-reported outcome${totalReports !== 1 ? 's' : ''}${totalPublic ? ` (${totalPublic.toLocaleString()} shared publicly in discussion threads or on review sites)` : ''} and grows with every new one.`
              : ' No agency has applicant-reported outcomes on Seen yet — it grows with every report submitted.'}
          </>}
        />
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', margin: '0 0 2.6rem' }}>
          <Link href="/report?outcome=ghosted" className="btn" style={{ background: 'linear-gradient(135deg,var(--g-start),var(--g-mid),var(--g-end))', color: '#fff', padding: '.7rem 1.3rem', fontWeight: 800 }}>Ghosted by an agency? Report it →</Link>
          <Link href="/ghosted" className="btn btn-ghost" style={{ padding: '.7rem 1.3rem' }}>Why this index exists</Link>
        </div>

        {/* Sponsor slot — LABELED advertising above the index. Never part of the ranking, never a
            score. Renders only when the owner has granted an active sponsor (employer_perks.sponsor_until). */}
        {sponsor && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '.9rem', flexWrap: 'wrap', margin: '0 0 2.6rem', padding: '.9rem 1.1rem', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', textTransform: 'uppercase', letterSpacing: '.16em', color: 'var(--muted)', border: '1px solid var(--line2)', borderRadius: 5, padding: '.15rem .4rem', flexShrink: 0 }}>Sponsored</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontFamily: 'var(--display)', fontSize: '.92rem', fontWeight: 700, color: 'var(--white)', textTransform: 'capitalize' }}>{sponsor.company}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', color: 'var(--sub)', marginTop: '.1rem' }}>Sponsors the Staffing Agency Ghost Index · placement only, never part of the ranking</div>
            </div>
            <Link href={`/company/${slugify(sponsor.company)}`} className="btn btn-ghost" style={{ padding: '.5rem 1rem', flexShrink: 0 }}>View their record →</Link>
          </div>
        )}

        {reported.length > 0 && (
          <section style={{ marginBottom: '2.4rem' }}>
            <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--white)', margin: '0 0 .3rem' }}>Ranked by reported ghost rate</h2>
            <p style={{ color: 'var(--sub)', fontSize: '.8rem', lineHeight: 1.6, margin: '0 0 1rem', fontWeight: 300 }}>{`Agencies with enough evidence for a grade — at least one report submitted to Seen and ${MIN_REPORTS_FOR_GRADE} pieces in total, counting applicant accounts shared publicly in discussion threads and on review sites (labeled and down-weighted) and online mentions at half weight — worst ghost rate first. Rows with fewer than 10 reports are marked low confidence.`}</p>
            {reported.map((r, i) => <ReportedRow key={r.agency.name} r={r} rank={i + 1} />)}
          </section>
        )}

        {building.length > 0 && (
          <section style={{ marginBottom: '2.4rem' }}>
            <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--white)', margin: '0 0 .3rem' }}>Building a record — not graded yet</h2>
            <p style={{ color: 'var(--sub)', fontSize: '.8rem', lineHeight: 1.6, margin: '0 0 1rem', fontWeight: 300 }}>{`These agencies have applicant reports you can read on their page, but not yet ${MIN_REPORTS_FOR_GRADE} pieces of evidence — too few for a fair grade or ghost rate. Every new report gets them closer.`}</p>
            {building.map(r => <BuildingRow key={r.agency.name} r={r} />)}
          </section>
        )}

        {unlisted.length > 0 && (
          <section style={{ marginBottom: '2.4rem' }}>
            <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--white)', margin: '0 0 .3rem' }}>No data yet</h2>
            <p style={{ color: 'var(--sub)', fontSize: '.8rem', lineHeight: 1.6, margin: '0 0 1rem', fontWeight: 300 }}>We have nothing on these agencies yet — and we won&apos;t invent a number. If you&apos;ve applied through one, your report is the first data point.</p>
            {unlisted.map(r => <EmptyRow key={r.agency.name} r={r} />)}
          </section>
        )}

        {reported.length === 0 && building.length === 0 && unlisted.length === 0 && (
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
          Seen Grades aggregate applicant reports and public hiring signals into a 0–100 score. They are community signals, not verified facts, and update hourly as new reports arrive. Grades and percentages appear only once at least {MIN_REPORTS_FOR_GRADE} applicants have reported outcomes. Report counts include outcomes shared publicly in discussion threads and on review sites (labeled and counted at reduced weight); web-research estimates are never counted as reports.
        </p>
      </div>
    </div>
  )
}
