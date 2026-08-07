'use client'

// IndustryBenchmark — "you vs your industry on Seen". The never-empty reputation layer: even a
// company with zero first-party applicant reports has a web-researched score and an industry, so we
// can always show how it compares to its sector. Used on the employer hub + analytics (second-person,
// with the cost-of-gap callout) and the consumer company page (third-person ranking).

import styles from './IndustryBenchmark.module.css'

export type Benchmark = {
  scope: 'industry' | 'all'
  industry: string | null
  nPeers: number
  company: { ghost: number | null; response: number | null; wait: number | null; score: number | null }
  average: { ghost: number | null; response: number | null; wait: number | null; score: number | null }
  percentile: { response: number | null; ghostAvoidance: number | null; overall: number | null }
  verdict: { tone: 'good' | 'warn' | 'bad' | 'neutral'; headline: string; detail: string }
  cost: { gapPoints: number; per100: number; headline: string } | null
}

const toneClass: Record<string, string> = {
  good: styles.toneGood, warn: styles.toneWarn, bad: styles.toneBad, neutral: styles.toneNeutral,
}
const fillClass: Record<string, string> = {
  good: styles.fillGood, warn: styles.fillWarn, bad: styles.fillBad, neutral: styles.fillNeutral,
}

const pctText = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`)
const dayText = (v: number | null) => (v == null ? '—' : `${Math.round(v)}d`)
const clampW = (v: number) => Math.max(2, Math.min(100, v))

type Row = { label: string; you: number | null; avg: number | null; better: boolean; youText: string; avgText: string; youW: number; avgW: number }

function buildRows(b: Benchmark): Row[] {
  const rows: Row[] = []
  const { company: c, average: a } = b
  if (c.response != null && a.response != null) {
    rows.push({ label: 'Reply rate', you: c.response, avg: a.response, better: c.response >= a.response, youText: pctText(c.response), avgText: pctText(a.response), youW: c.response * 100, avgW: a.response * 100 })
  }
  if (c.ghost != null && a.ghost != null) {
    rows.push({ label: 'Ghost rate', you: c.ghost, avg: a.ghost, better: c.ghost <= a.ghost, youText: pctText(c.ghost), avgText: pctText(a.ghost), youW: c.ghost * 100, avgW: a.ghost * 100 })
  }
  if (c.wait != null && a.wait != null) {
    const wMax = Math.max(c.wait, a.wait, 20) * 1.2
    rows.push({ label: 'Reply speed', you: c.wait, avg: a.wait, better: c.wait <= a.wait, youText: dayText(c.wait), avgText: dayText(a.wait), youW: (c.wait / wMax) * 100, avgW: (a.wait / wMax) * 100 })
  }
  return rows
}

// Third-person one-liner for the consumer/company-page variant, derived from the response
// percentile (falls back to overall). Neutral, informative — it's candidate-facing context.
function publicVerdict(b: Benchmark, name: string): { tone: string; headline: string; detail: string } {
  const where = b.scope === 'industry' && b.industry ? b.industry : 'employers on Seen'
  const p = b.percentile.response ?? b.percentile.overall
  if (p == null) return { tone: 'neutral', headline: `Not enough ${where} scored yet to rank`, detail: 'The grade above stands on its own for now.' }
  if (p >= 75) return { tone: 'good', headline: `${name} replies more than ${p}% of ${where}`, detail: 'Better odds of hearing back than most of its industry.' }
  if (p >= 45) return { tone: 'warn', headline: `${name} is about average for ${where}`, detail: 'Middle of the pack on responding to applicants.' }
  return { tone: 'bad', headline: `${name} replies less than ${100 - p}% of ${where}`, detail: 'Most of its industry responds to applicants more often — factor that into your effort.' }
}

export default function IndustryBenchmark({
  benchmark,
  variant = 'employer',
  companyName = '',
}: {
  benchmark: Benchmark | null | undefined
  variant?: 'employer' | 'public'
  companyName?: string
}) {
  if (!benchmark || benchmark.nPeers <= 0) return null
  const b = benchmark
  const rows = buildRows(b)
  if (rows.length === 0) return null

  const where = b.scope === 'industry' && b.industry ? b.industry : 'employers on Seen'
  const isPublic = variant === 'public'
  const name = companyName ? companyName.charAt(0).toUpperCase() + companyName.slice(1) : 'This company'
  const v = isPublic ? publicVerdict(b, name) : b.verdict
  const kicker = isPublic ? `${name} vs its industry` : `You vs ${where}`

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <span className={styles.kicker}>{kicker}</span>
        <span className={styles.scope}>
          {b.scope === 'industry' ? `${b.nPeers} ${where} scored` : `${b.nPeers} employers scored`}
        </span>
      </div>

      <div className={styles.verdict}>
        <div className={`${styles.verdictHead} ${toneClass[v.tone] || ''}`}>{v.headline}</div>
        <p className={styles.verdictDetail}>{v.detail}</p>
      </div>

      <div className={styles.rows}>
        {rows.map((r) => {
          const tone = r.better ? 'good' : 'bad'
          return (
            <div key={r.label} className={styles.row}>
              <span className={styles.rowLabel}>{r.label}</span>
              <div className={styles.track} title={`${r.youText} vs ${where} avg ${r.avgText}`}>
                <div className={`${styles.fill} ${fillClass[tone]}`} style={{ width: `${clampW(r.youW)}%` }} />
                <div className={styles.avgTick} style={{ left: `${clampW(r.avgW)}%` }} aria-hidden />
              </div>
              <span className={styles.rowVals}>
                <b>{r.youText}</b> <span className={styles.rowAvg}>· avg {r.avgText}</span>
              </span>
            </div>
          )
        })}
      </div>

      {!isPublic && b.cost && (
        <div className={styles.cost}>
          <span className={styles.costIcon} aria-hidden>⚠</span>
          <span className={styles.costText}>{b.cost.headline}. The strongest candidates screen for this before applying.</span>
        </div>
      )}

      <p className={styles.foot}>
        {b.scope === 'industry'
          ? `Benchmarked against ${b.nPeers} ${where} employers scored on Seen. The white tick marks the ${where} average.`
          : `Benchmarked against ${b.nPeers} employers scored on Seen (too few direct industry peers to compare). The white tick marks the average.`}
      </p>
    </div>
  )
}
