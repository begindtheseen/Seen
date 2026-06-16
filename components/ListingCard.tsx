'use client'

// Job-listing share card — new card type, same 1080×1080 graphics as the
// outcome + company-score cards (shared cardKit). Lets a user share a specific
// role with its Seen hiring grade + intel.

import {
  CARD_W, CARD_H, CARD_PAD, type Risk, riskColor, riskFromScore, letterGrade, riskHeadline,
  createCard, paintBackground, eyebrow, footer, divider, fitText, ellipsize, drawTags,
} from '@/lib/cards/cardKit'
import CardShareModal from './CardShareModal'

export interface ListingCardData {
  title: string
  company: string
  location: string
  level?: string
  type?: string
  score: number        // company hiring grade for this listing
  waste?: number
  whatTheyWant?: string[]
  insiderTip?: string
}

export async function drawListingCard(d: ListingCardData): Promise<HTMLCanvasElement> {
  const { canvas, c } = createCard()
  const risk = riskFromScore(d.score)
  const accent = riskColor(risk)

  paintBackground(c, accent)
  eyebrow(c, 'JOB LISTING')

  // Title
  const titleY = CARD_PAD + 50
  const titleFs = fitText(c, d.title || 'Role', CARD_W - CARD_PAD * 2, 60, 32, 800, 'Syne')
  c.fillStyle = '#fff'; c.textAlign = 'left'; c.textBaseline = 'top'
  c.fillText(d.title || 'Role', CARD_PAD, titleY)

  // Company · location
  let y = titleY + titleFs + 12
  c.font = '400 21px "DM Mono",monospace'; c.fillStyle = 'rgba(255,255,255,0.42)'
  c.fillText(ellipsize(c, `${d.company}${d.location ? '  ·  ' + d.location : ''}`, CARD_W - CARD_PAD * 2), CARD_PAD, y)

  // Level / type pills
  y += 56
  drawTags(c, [d.level, d.type].filter(Boolean) as string[], y)

  // Divider
  y += 40
  divider(c, y)

  // Grade block — big letter on the left, label/score/headline stacked right
  y += 40
  c.save()
  c.shadowBlur = 40; c.shadowColor = accent
  c.font = '800 132px "Syne",sans-serif'; c.fillStyle = accent
  c.textAlign = 'left'; c.textBaseline = 'top'
  c.fillText(letterGrade(d.score), CARD_PAD, y)
  c.restore()
  const gradeW = c.measureText(letterGrade(d.score)).width
  const rx = CARD_PAD + gradeW + 44
  c.font = '600 18px "DM Mono",monospace'; c.fillStyle = 'rgba(255,255,255,0.40)'
  c.textBaseline = 'top'
  c.fillText('SEEN HIRING GRADE', rx, y + 14)
  c.font = '800 54px "Syne",sans-serif'; c.fillStyle = '#fff'
  c.fillText(`${Math.round(d.score)} / 100`, rx, y + 40)
  c.font = '500 16px "DM Mono",monospace'; c.fillStyle = accent
  c.fillText(riskHeadline(risk), rx, y + 104)
  y += 160

  // Divider
  divider(c, y)
  y += 36

  // Intel bullets
  const bullets: string[] = []
  for (const w of (d.whatTheyWant || []).slice(0, 3)) bullets.push('→  ' + w)
  if (d.insiderTip) bullets.push('💡  ' + d.insiderTip)
  if (!bullets.length) bullets.push('→  Check the ghost risk and response rate before you apply.')

  c.textAlign = 'left'
  for (const b of bullets) {
    let fs = 24
    c.font = `500 ${fs}px "DM Mono",monospace`
    while (c.measureText(b).width > CARD_W - CARD_PAD * 2 && fs > 15) { fs--; c.font = `500 ${fs}px "DM Mono",monospace` }
    c.fillStyle = 'rgba(255,255,255,0.85)'; c.textBaseline = 'top'
    if (y > CARD_H - 150) break
    c.fillText(b, CARD_PAD, y)
    y += Math.max(44, fs + 18)
  }

  footer(c, 'Job intel from Seen  ·  seenjobs.io')
  return canvas
}

export default function ListingCard({ data, onClose }: { data: ListingCardData; onClose: () => void }) {
  const risk: Risk = riskFromScore(data.score)
  const grade = letterGrade(data.score)
  const shareText = `${data.title} at ${data.company}${data.location ? ' (' + data.location + ')' : ''} — Seen hiring grade ${grade} (${Math.round(data.score)}/100). Know before you apply.`
  return (
    <CardShareModal
      title={`${data.title} — ${data.company}`}
      subtitle="Share this listing with its Seen hiring grade and intel."
      accent={riskColor(risk)}
      shareText={shareText}
      fileNameBase={`seen_listing_${(data.company || 'company').replace(/[^a-z0-9]/gi, '_')}`}
      draw={() => drawListingCard(data)}
      onClose={onClose}
    />
  )
}
