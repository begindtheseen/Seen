'use client'

// Job-listing share card — same graphics kit as the outcome + company-score cards.
// Renders at a per-platform format (square for FB/Reddit, portrait for IG/Threads).

import {
  type FormatKey, type Risk, riskColor, riskFromScore, letterGrade, riskHeadline,
  createCard, paintBackground, eyebrow, footer, divider, fitText, ellipsize, wrapLines, drawTags,
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

export async function drawListingCard(d: ListingCardData, format: FormatKey = 'square'): Promise<HTMLCanvasElement> {
  const { canvas, ctx } = createCard(format)
  const { c, H, W, PAD } = ctx
  const maxW = W - PAD * 2
  const risk = riskFromScore(d.score)
  const accent = riskColor(risk)

  paintBackground(ctx, accent)
  eyebrow(ctx, 'JOB LISTING')

  // Title — fit to a size, then wrap to at most 2 lines so it never overflows.
  let y = PAD + 50
  const titleFs = fitText(c, d.title || 'Role', maxW, 60, 40, 800, 'Syne')
  c.font = `800 ${titleFs}px "Syne",sans-serif`
  c.fillStyle = '#fff'; c.textAlign = 'left'; c.textBaseline = 'top'
  const lineH = Math.round(titleFs * 1.12)
  for (const ln of wrapLines(c, d.title || 'Role', maxW, 2)) { c.fillText(ln, PAD, y); y += lineH }
  y += 14

  // Company · location
  c.font = '400 21px "DM Mono",monospace'; c.fillStyle = 'rgba(255,255,255,0.42)'
  c.textBaseline = 'top'
  c.fillText(ellipsize(c, `${d.company}${d.location ? '  ·  ' + d.location : ''}`, maxW), PAD, y)
  y += 54

  // Level / type pills
  drawTags(ctx, [d.level, d.type].filter(Boolean) as string[], y)
  y += 40

  divider(ctx, y)
  y += 42

  // Grade block — big letter on the left, label/score/headline stacked to its right.
  const gradeStr = letterGrade(d.score)
  c.save()
  c.shadowBlur = 40; c.shadowColor = accent
  c.font = '800 132px "Syne",sans-serif'; c.fillStyle = accent
  c.textAlign = 'left'; c.textBaseline = 'top'
  c.fillText(gradeStr, PAD, y)
  const gradeW = c.measureText(gradeStr).width // measured at the 132px font it was drawn with
  c.restore()

  const rx = PAD + gradeW + 48
  c.textAlign = 'left'; c.textBaseline = 'top'
  c.font = '600 18px "DM Mono",monospace'; c.fillStyle = 'rgba(255,255,255,0.40)'
  c.fillText('SEEN HIRING GRADE', rx, y + 18)
  c.font = '800 54px "Syne",sans-serif'; c.fillStyle = '#fff'
  c.fillText(`${Math.round(d.score)} / 100`, rx, y + 44)
  c.font = '500 16px "DM Mono",monospace'; c.fillStyle = accent
  c.fillText(riskHeadline(risk), rx, y + 108)
  y += 170

  divider(ctx, y)
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
    while (c.measureText(b).width > maxW && fs > 15) { fs--; c.font = `500 ${fs}px "DM Mono",monospace` }
    c.fillStyle = 'rgba(255,255,255,0.85)'; c.textBaseline = 'top'
    if (y > H - 150) break
    c.fillText(ellipsize(c, b, maxW), PAD, y)
    y += Math.max(44, fs + 18)
  }

  footer(ctx, 'Job intel from Seen  ·  seenjobs.io')
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
      draw={(fmt) => drawListingCard(data, fmt)}
      onClose={onClose}
    />
  )
}
