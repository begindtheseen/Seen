import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import Link from 'next/link'
import { getScoresByNames, slugify, grade, pct, MIN_REPORTS_FOR_GRADE, type LeaderboardRow } from '@/lib/growth'
import { publicDiscussionCountPath, parseExactCount, publicDiscussionShare } from '@/lib/server/reportCounts'
import { STAFFING_AGENCIES, agencyPageSlug, type StaffingAgency } from '@/lib/agencies'
import { pickActiveSponsor } from '@/lib/server/sponsorSlot'
import { jsonLdHtml } from '@/lib/jsonLd'
import { notEnoughReviewsLabel } from '@/lib/gradeGate'
import PageHeader from '@/components/shell/PageHeader'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { gradeTone, toneText, ghostRateTone, ghostRateWord, responseRateTone, responseRateWord } from '@/lib/ui/tone.js'
import st from './agencies.module.css'

// The Staffing Agency Ghost Index: a ranked, living page of major staffing agencies by
// ghosting/transparency signals. Server component + ISR, reading cached scores DIRECTLY from
// Supabase via lib/growth (never a self-fetch of the live API — see the warning in lib/growth.ts).
//
// HONESTY RULES (load-bearing — do not soften):
// - Ghost/response percentages are shown ONLY for agencies with actual applicant accounts
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

export const metadata: Metadata = pageMetadata({
  title: 'Staffing Agency Ghost Index — Which Agencies Ghost Candidates',
  description:
    'A live index of major staffing agencies — Robert Half, Insight Global, Randstad, Addison Group, Express and more — ranked by applicant-reported ghost and response rates, from outcomes submitted to Seen or shared publicly in discussion threads and on review sites. Agencies without reports are labeled, never given a made-up rate.',
  keywords: [
    'staffing agency ghosting', 'staffing agency ghost rate', 'do staffing agencies ghost',
    'recruiter ghosted me', 'staffing agency reviews', 'best staffing agencies', 'worst staffing agencies',
    'Robert Half ghosting', 'Aerotek ghosting', 'Insight Global ghosting',
  ],
  path: '/agencies',
  ogTitle: 'The Staffing Agency Ghost Index',
  ogDescription: 'Major staffing agencies ranked by applicant-reported ghost and response rates — no reports, no number.',
})

type Ranked = {
  agency: StaffingAgency
  row: LeaderboardRow | null // matched company_scores row (may have 0 applicant accounts)
  slug: string // slug of the matched stored name when scored, else of the display name
  reports: number // FIRST-PARTY applicant accounts behind the row (0 when none / no row)
  publicDiscussion: number | null // of `reports`, how many came from public discussion threads / review sites; null = unknown
}

function reportHref(agencyName: string) {
  return `/report?company=${encodeURIComponent(agencyName)}&outcome=ghosted`
}

function ReportCta({ agencyName }: { agencyName: string }) {
  return <Link href={reportHref(agencyName)} prefetch={false} className={st.cta}>Report →</Link>
}

// Row for an agency WITH first-party applicant accounts: grade + honest percentages + count, and how
// much of that count is attributed public discussion / review-site content. Colour comes from the
// numbers themselves (lib/ui/tone.js) and always travels with an icon and a word — the stored
// risk_level word ("SAFE") used to sit next to a 40% ghost rate.
function ReportedRow({ r, rank }: { r: Ranked; rank: number }) {
  const s = r.row!.score
  if (s.overall_score == null) return null // only gradeable rows reach here
  const letterTone = gradeTone(s.overall_score)
  const ghost = pct(s.ghost_rate)
  const reply = pct(s.response_rate)
  const gTone = ghostRateTone(s.ghost_rate)
  const rTone = responseRateTone(s.response_rate)
  const n = r.reports
  const thin = n < 10
  const pub = r.publicDiscussion
  // Rates sit under the name (not in a right-hand column) so the name keeps the row's width on a phone
  // — the audit saw "Robert / Half" squeezed to 8 characters at 390px.
  return (
    <div className={st.row}>
      <div className={st.rank}>{rank}</div>
      <div className={st.letter} style={{ color: toneText(letterTone) }}>{grade(s.overall_score)}</div>
      <div className={st.main}>
        <Link href={`/company/${r.slug}`} prefetch={false} className={st.name}>{r.agency.name}</Link>
        <div className={st.rates}>
          {ghost != null && gTone && <Badge tone={gTone}>{ghost}% ghost · {ghostRateWord(gTone).toLowerCase()}</Badge>}
          {reply != null && rTone && <Badge tone={rTone}>{reply}% reply · {responseRateWord(rTone).toLowerCase()}</Badge>}
        </div>
        <div className={st.meta}>
          {n.toLocaleString()} account{n !== 1 ? 's' : ''}
          {pub ? (pub >= n ? ', all from public posts' : ` · ${pub.toLocaleString()} from public posts`) : ''}
          {thin ? ' · early signal, low confidence' : ''}
        </div>
      </div>
      <ReportCta agencyName={r.agency.name} />
    </div>
  )
}

// Row for an agency with SOME applicant accounts but fewer than the grade bar: the reports are
// readable on its page, but no grade or percentage is shown until it has enough of them.
function BuildingRow({ r }: { r: Ranked }) {
  return (
    <div className={`${st.row} ${st.rowQuiet}`}>
      <div className={`${st.letter} ${st.letterNone}`}>—</div>
      <div className={st.main}>
        <Link href={`/company/${r.slug}`} prefetch={false} className={st.name}>{r.agency.name}</Link>
        <div className={st.meta}>
          {/* The one wording every surface uses — reports plus half of each online mention, like the company page. */}
          {notEnoughReviewsLabel(r.row?.score ?? null)}
          {r.publicDiscussion ? ` · ${r.publicDiscussion.toLocaleString()} from public threads & review sites` : ''}
        </div>
      </div>
      <ReportCta agencyName={r.agency.name} />
    </div>
  )
}

// Agencies we have NO data on: one compact card of names below the graded rows — never a row each
// that reads like half the index is empty (conversion audit 2026-10-24), and never a made-up number.
function NoDataList({ rows }: { rows: Ranked[] }) {
  return (
    <div className={st.none}>
      <div className={st.noneNames}>
        {rows.map(r => (
          <Link key={r.agency.name} href={`/company/${r.slug}`} prefetch={false} className={st.noneName}>{r.agency.name}</Link>
        ))}
      </div>
      <p className={st.noneNote}>
        Applied through one? <Link href="/report?outcome=ghosted" prefetch={false} className={st.inline}>Report what happened →</Link> Your report is its first data point.
      </p>
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
    // Best match across aliases: prefer the row with the most FIRST-PARTY applicant accounts, then
    // the larger fused total (more evidence behind the estimate), then alias order.
    let row: LeaderboardRow | null = null
    for (const alias of agency.aliases) {
      const hit = scoreMap.get(alias)
      if (!hit) continue
      if (!row
        || hit.score.first_party_report_count > row.score.first_party_report_count
        || (hit.score.first_party_report_count === row.score.first_party_report_count && hit.score.report_count > row.score.report_count)) row = hit
    }
    const reports = row ? row.score.first_party_report_count : 0
    return { agency, row, slug: agencyPageSlug(agency.name, row?.name, reports), reports }
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
      a: 'No. They are aggregated community signals from applicant accounts and public hiring data, with confidence labels where data is thin. Agencies with no reports show no numbers at all — Seen never fabricates a rate.',
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
      <div className={st.wrap}>
        <PageHeader
          size="lg"
          eyebrow="Live index · updates hourly"
          title="The Staffing Agency Ghost Index"
          crumbLabel="Agency Ghost Index"
          sub={<>
            Staffing agencies are the highest-volume gatekeepers in hiring — and the most common source of &ldquo;the recruiter just disappeared&rdquo; stories. This index tracks {STAFFING_AGENCIES.length} major agencies by what applicants actually report: who replies, who ghosts, and how long it takes.
            {totalReports > 0
              ? ` It currently reflects ${totalReports.toLocaleString()} applicant-reported outcome${totalReports !== 1 ? 's' : ''}${totalPublic ? (totalPublic >= totalReports ? `, all shared publicly in discussion threads or on review sites — none submitted to Seen yet` : ` (${totalPublic.toLocaleString()} shared publicly in discussion threads or on review sites)`) : ''}, and grows with every new one.`
              : ' No agency has applicant-reported outcomes on Seen yet — it grows with every report submitted.'}
          </>}
        />
        <div className={st.actions}>
          <Button href="/report?outcome=ghosted" variant="primary" size="lg" prefetch={false}>Ghosted by an agency? Report it →</Button>
          <Button href="/ghosted" variant="ghost" size="lg" prefetch={false}>Why this index exists</Button>
        </div>

        {/* Sponsor slot — LABELED advertising above the index. Never part of the ranking, never a
            score. Renders only when the owner has granted an active sponsor (employer_perks.sponsor_until). */}
        {sponsor && (
          <div className={st.sponsor}>
            <Badge>Sponsored</Badge>
            <div className={st.main}>
              <div className={st.sponsorName}>{sponsor.company}</div>
              <div className={st.meta}>Sponsors the Staffing Agency Ghost Index · placement only, never part of the ranking</div>
            </div>
            <Button href={`/company/${slugify(sponsor.company)}`} variant="secondary" size="sm" prefetch={false}>View their record →</Button>
          </div>
        )}

        {reported.length > 0 && (
          <section className={st.section}>
            <h2 className={st.h2}>Ranked by reported ghost rate</h2>
            <p className={st.lede}>{`Agencies with enough evidence for a grade: at least one real applicant account and ${MIN_REPORTS_FOR_GRADE} pieces in total. Applicant accounts shared publicly in discussion threads and on review sites count (labeled and down-weighted), online mentions count half. Worst ghost rate first; rows with fewer than 10 accounts are marked low confidence.`}</p>
            {reported.map((r, i) => <ReportedRow key={r.agency.name} r={r} rank={i + 1} />)}
          </section>
        )}

        {building.length > 0 && (
          <section className={st.section}>
            <h2 className={st.h2}>Building a record — not graded yet</h2>
            <p className={st.lede}>{`These agencies have applicant accounts you can read on their page, but fewer than ${MIN_REPORTS_FOR_GRADE} in all (an online mention counts half) — too few for a fair grade or ghost rate. Every new report gets them closer.`}</p>
            {building.map(r => <BuildingRow key={r.agency.name} r={r} />)}
          </section>
        )}

        {unlisted.length > 0 && (
          <section className={st.section}>
            <h2 className={st.h2}>Not enough reports yet ({unlisted.length})</h2>
            <p className={st.lede}>No applicant accounts on these agencies yet, so no grade or rate — we won&apos;t invent a number.</p>
            <NoDataList rows={unlisted} />
          </section>
        )}

        {reported.length === 0 && building.length === 0 && unlisted.length === 0 && (
          <div className={st.emptyAll}>
            The index is loading its first data. Check back shortly — or <Link href="/report?outcome=ghosted" prefetch={false} className={st.inline}>add the first report</Link>.
          </div>
        )}

        <section className={st.faq}>
          <h2 className={st.h2}>What is a staffing agency ghost rate?</h2>
          {faqQa.map(({ q, a }) => (
            <div key={q} className={st.qa}>
              <h3 className={st.q}>{q}</h3>
              <p className={st.a}>{a}</p>
            </div>
          ))}
        </section>

        <p className={st.fine}>
          Seen Grades aggregate applicant accounts and public hiring signals into a 0–100 score. They are community signals, not verified facts, and update hourly as new reports arrive. Grades and percentages appear only once at least {MIN_REPORTS_FOR_GRADE} applicants have reported outcomes. Report counts include outcomes shared publicly in discussion threads and on review sites (labeled and counted at reduced weight); web-research estimates are never counted as reports.
        </p>
      </div>
    </div>
  )
}
