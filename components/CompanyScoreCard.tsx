'use client'

// Company "Hiring Grade" share card — parity with the social card design
// (letter grade, score/100, ghost/response/wait/waste tiles, vibe tags, branding).
// Built on the shared cardKit so it matches the outcome + listing cards exactly.

import {
  CARD_W, CARD_PAD, type Risk, riskColor, riskFromScore, letterGrade, riskHeadline,
  createCard, paintBackground, eyebrow, footer, fitText, drawTileGrid, drawTags, type Tile,
} from '@/lib/cards/cardKit'
import CardShareModal from './CardShareModal'

export interface CompanyScoreCardData {
  company: string
  industry?: string
  overall_score: number
  ghost_rate: number      // 0–1
  response_rate: number   // 0–1
  avg_wait_days: number
  waste: number           // 0–100
  report_count: number
  risk?: Risk
  tags?: string[]
}

const pct = (v: number) => `${Math.round((v || 0) * 100)}%`

export async function drawCompanyScoreCard(d: CompanyScoreCardData): Promise<HTMLCanvasElement> {
  const { canvas, c } = createCard()
  const risk = d.risk ?? riskFromScore(d.overall_score)
  const accent = riskColor(risk)

  paintBackground(c, accent)
  eyebrow(c, 'HIRING TRANSPARENCY')

  // Company name + industry
  const nameY = CARD_PAD + 50
  const nameFs = fitText(c, d.company || 'Company', CARD_W - CARD_PAD * 2, 62, 34, 800, 'Syne')
  c.fillStyle = '#fff'; c.textAlign = 'left'; c.textBaseline = 'top'
  c.fillText(d.company || 'Company', CARD_PAD, nameY)
  let cursor = nameY + nameFs + 8
  if (d.industry) {
    c.font = '400 19px "DM Mono",monospace'; c.fillStyle = 'rgba(255,255,255,0.40)'
    c.fillText(d.industry, CARD_PAD, cursor)
    cursor += 26
  }

  // Risk headline
  cursor += 36
  c.font = '600 20px "DM Mono",monospace'; c.fillStyle = accent
  c.textAlign = 'center'; c.textBaseline = 'top'
  c.fillText(riskHeadline(risk), CARD_W / 2, cursor)

  // Big letter grade (with glow)
  cursor += 40
  c.save()
  c.shadowBlur = 50; c.shadowColor = accent
  c.font = '800 186px "Syne",sans-serif'; c.fillStyle = accent
  c.textAlign = 'center'; c.textBaseline = 'top'
  c.fillText(letterGrade(d.overall_score), CARD_W / 2, cursor)
  c.restore()
  cursor += 196

  // score / 100
  c.font = '500 28px "DM Mono",monospace'; c.fillStyle = 'rgba(255,255,255,0.55)'
  c.textAlign = 'center'; c.textBaseline = 'top'
  c.fillText(`${Math.round(d.overall_score)}  /  100`, CARD_W / 2, cursor)
  cursor += 64

  // Metric tiles
  const tiles: Tile[] = [
    { value: pct(d.ghost_rate), label: 'Ghost rate', color: d.ghost_rate >= 0.5 ? '#ef4444' : '#fff' },
    { value: pct(d.response_rate), label: 'Response rate', color: d.response_rate >= 0.5 ? '#10b981' : '#fff' },
    { value: `${Math.round(d.avg_wait_days || 0)}d`, label: 'Avg wait', color: '#fff' },
    { value: `${Math.round(d.waste || 0)}%`, label: 'Waste risk', color: (d.waste || 0) >= 50 ? '#ef4444' : '#fff' },
  ]
  const afterTiles = drawTileGrid(c, tiles, cursor, 132)

  // Vibe tags
  if (d.tags?.length) drawTags(c, d.tags, afterTiles + 42)

  footer(c, `Based on ${(d.report_count || 0).toLocaleString()} applicant reports  ·  seenjobs.io`)
  return canvas
}

export default function CompanyScoreCard({ data, onClose }: { data: CompanyScoreCardData; onClose: () => void }) {
  const risk = data.risk ?? riskFromScore(data.overall_score)
  const grade = letterGrade(data.overall_score)
  const shareText = risk === 'danger'
    ? `${data.company} scores ${Math.round(data.overall_score)}/100 (${grade}) on Seen — ${Math.round((data.ghost_rate || 0) * 100)}% ghost rate. Research before you apply.`
    : risk === 'warn'
    ? `${data.company} scores ${Math.round(data.overall_score)}/100 (${grade}) on Seen. Know before you apply.`
    : `${data.company} scores ${Math.round(data.overall_score)}/100 (${grade}) on Seen — strong hiring process.`

  return (
    <CardShareModal
      title={`${data.company} — Hiring Grade ${grade}`}
      subtitle="Share this company's hiring grade — help the next applicant know before they apply."
      accent={riskColor(risk)}
      shareText={shareText}
      fileNameBase={`seen_grade_${(data.company || 'company').replace(/[^a-z0-9]/gi, '_')}`}
      draw={() => drawCompanyScoreCard(data)}
      onClose={onClose}
    />
  )
}
