import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import Link from 'next/link'
import { getLeaderboard, getScoresByNames, slugify, grade, type LeaderboardRow } from '@/lib/growth'
import { gradeTone, toneText, ghostRateTone, ghostRateWord, responseRateTone, responseRateWord } from '@/lib/ui/tone.js'
import { STAFFING_AGENCIES } from '@/lib/agencies'
import { assembleGhostReport, pickHeadline, weekProvenance } from '@/lib/server/ghostReport'
import { displayCompanyName } from '@/lib/companyDisplay'
import PageHeader from '@/components/shell/PageHeader'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import StatTile from '@/components/ui/StatTile'
import st from './ghost.module.css'

// The Weekly Ghost Report — the amplifier engine's flagship, auto-generated public data story
// (playbook/CONTENT_ENGINE.md). Server component + hourly ISR, reading cached scores DIRECTLY
// from Supabase via lib/growth (never a self-fetch of the live API — see lib/growth.ts). Every
// number is computed by lib/server/ghostReport.js, which ranks ONLY rows with real applicant
// reports and never fabricates a figure. The link's share card is app/ghost-report/opengraph-image.
//
// Design review 2026-11-02: the headline is ONE short line; the generated sentence (pickHeadline, the
// postable line) is the lede in body type. Figures are ink; the only toned figure is the one a threshold
// decides (lib/ui/tone.js ghostRateTone), and it carries its word and icon.

export const revalidate = 3600

export const metadata: Metadata = pageMetadata({
  title: 'The Weekly Ghost Report — Which Companies Ghost Applicants',
  description:
    'A weekly, auto-generated snapshot of hiring transparency from real applicant accounts: the most-reported ghosters, the companies that actually reply, and the running staffing-agency ghost index. Real numbers only — companies with no reports show no score.',
  path: '/ghost-report',
  ogTitle: 'The Weekly Ghost Report',
  ogDescription: 'The most-reported ghosters and the companies that actually reply — from real applicant outcomes.',
  // This segment ships its own share card (app/ghost-report/opengraph-image.tsx); file-based images win.
  image: { url: '/ghost-report/opengraph-image', width: 1200, height: 630, alt: 'The Weekly Ghost Report on Seen' },
})

// weekProvenance (the "week of …" label + rotation seed) is shared from lib/server/ghostReport so
// the public page, the admin panel, and the OG card all resolve the SAME week and headline.

// Build the pool of scored rows the report ranks over: the leaderboard ordered by FIRST-PARTY report
// rows (the default fused order is dominated by web-research claims, which the assembler ignores —
// it would crowd genuinely-reported companies out of the 150-row window) plus every staffing-agency
// row (agencies may not all sit in the top-150), deduped by stored name. The agency name set flags which rows count as agencies for the spotlight.
async function loadRows(): Promise<{ rows: LeaderboardRow[]; agencyNames: string[] }> {
  const agencyAliases = STAFFING_AGENCIES.flatMap((a) => a.aliases)
  const [leaderboard, agencyMap] = await Promise.all([getLeaderboard({ by: 'first_party' }), getScoresByNames(agencyAliases)])
  const byName = new Map<string, LeaderboardRow>()
  for (const r of leaderboard) if (r?.name) byName.set(r.name.toLowerCase(), r)
  for (const [name, r] of agencyMap) if (!byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), r)
  return { rows: [...byName.values()], agencyNames: agencyAliases.map((a) => a.toLowerCase()) }
}

type Ranked = ReturnType<typeof assembleGhostReport>['worstOffenders'][number]

// One ranked company: letter (toned by the grade), name, the two rates as badges that carry their word
// and icon (lib/ui/tone.js), and the evidence count — the same row the agencies index uses.
function OffenderRow({ r, rank }: { r: Ranked; rank: number }) {
  const letterTone = gradeTone(r.overallScore)
  const gTone = r.ghostPct != null ? ghostRateTone(r.ghostPct / 100) : null
  const rTone = r.replyPct != null ? responseRateTone(r.replyPct / 100) : null
  return (
    <div className={st.row}>
      <div className={st.rank}>{rank}</div>
      <div className={st.letter} style={{ color: toneText(letterTone) }}>{grade(r.overallScore)}</div>
      <div className={st.main}>
        <Link href={`/company/${slugify(r.name)}`} prefetch={false} className={st.name}>{displayCompanyName(r.name)}</Link>
        <div className={st.rates}>
          {r.ghostPct != null && gTone && <Badge tone={gTone}>{r.ghostPct}% ghost · {ghostRateWord(gTone).toLowerCase()}</Badge>}
          {r.replyPct != null && rTone && <Badge tone={rTone}>{r.replyPct}% reply · {responseRateWord(rTone).toLowerCase()}</Badge>}
        </div>
        <div className={st.meta}>
          {r.reportCount.toLocaleString()} applicant account{r.reportCount !== 1 ? 's' : ''}
          {r.isAgency ? ' · staffing agency' : ''}
          {r.thin ? ' · early signal, low confidence' : ''}
        </div>
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
  const lede = pickHeadline(report)
  const avgGhostTone = h.avgGhostRatePct != null ? ghostRateTone(h.avgGhostRatePct / 100) : null

  return (
    <div className="page-full">
      <div className={st.wrap}>
        <PageHeader
          size="lg"
          eyebrow={<>Weekly Ghost Report · {weekLabel}</>}
          title="This week's ghost report"
          crumbLabel="Ghost report"
          sub={lede}
        />

        {report.hasReported ? (
          <>
            {/* Figures are ink. The average ghost rate is the one reading a threshold decides, so it alone
                carries a tone — with its word and icon. "In this report" = the companies ranked here, not
                every company on Seen (the homepage and /data total different sets). */}
            <div className={st.stats}>
              <StatTile label="Applicant accounts" value={h.reportsTotal} note="in this report" instant />
              <StatTile label="Companies" value={h.companiesTracked} note="with reports" instant />
              {h.avgGhostRatePct != null && <StatTile label="Avg ghost rate" value={h.avgGhostRatePct} suffix="%" tone={avgGhostTone} toneWord={ghostRateWord(avgGhostTone)} note="reported" instant />}
              {h.avgWaitDays != null && <StatTile label="Avg wait to silence" value={h.avgWaitDays} suffix="d" note="reported" instant />}
              {h.agenciesTracked > 0 && <StatTile label="Staffing agencies" value={h.agenciesTracked} note="tracked" instant />}
            </div>

            {report.agencySpotlight && (
              <div className={st.spot}>
                <Badge tone="bad" icon="ghost">Agency spotlight</Badge>
                <p className={st.spotText}>
                  {displayCompanyName(report.agencySpotlight.name)} is the most-reported ghosting staffing agency this week — {report.agencySpotlight.ghostPct}% of {report.agencySpotlight.reportCount.toLocaleString()} reported applications got no response at all.
                </p>
                <Link href="/agencies" prefetch={false} className={st.spotLink}>See the full staffing-agency ghost index <Icon name="arrow-right" size={14} /></Link>
              </div>
            )}

            {report.worstOffenders.length > 0 && (
              <section className={st.section}>
                <h2 className={st.h2}>Most-reported ghosters</h2>
                <p className={st.lede}>Ranked by reported ghost rate among companies with real applicant accounts. No reports, no number.</p>
                {report.worstOffenders.map((r, i) => <OffenderRow key={r.name} r={r} rank={i + 1} />)}
              </section>
            )}

            {report.responseLeaders.length > 0 && (
              <section className={st.section}>
                <h2 className={st.h2}>Actually replies</h2>
                <p className={st.lede}>The companies applicants reported hearing back from most — proof that responding is a choice.</p>
                {report.responseLeaders.map((r, i) => <OffenderRow key={r.name} r={r} rank={i + 1} />)}
              </section>
            )}
          </>
        ) : (
          <div className={st.waiting}>
            <p>
              The report is waiting on its first substantial batch of applicant outcomes. The framework is live — every report you submit becomes a data point in next week&apos;s edition. We&apos;ll never print a number we don&apos;t have.
            </p>
          </div>
        )}

        <div className={st.actions}>
          <Button href="/report?outcome=ghosted" variant="primary" size="lg" prefetch={false}>Been ghosted? Add it — 2 min →</Button>
          <Button href="/agencies" variant="ghost" size="lg" prefetch={false}>The full ghost index</Button>
        </div>

        <p className={st.fine}>
          Methodology: applicant-reported outcomes, trust-weighted, aggregated with public hiring signals into a 0–100 Seen Grade. These are community signals, not verified facts, and update as reports arrive. Percentages appear only where applicants have actually reported outcomes; companies with no reports show no number — Seen never fabricates a rate. Report counts include outcomes submitted to Seen and outcomes shared publicly in discussion threads or on review sites (labeled and down-weighted); web-research estimates are never counted as reports. Where reports are few, rates can be blended with a public-data baseline and are marked low confidence.
        </p>
      </div>
    </div>
  )
}
