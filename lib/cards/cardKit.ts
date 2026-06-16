'use client'

// Shared social share-card graphics kit.
//
// Every Seen share card — outcome, company-score, listing — is drawn with these
// primitives so they're visually identical. Native canvas, no libraries.
//
// Cards render at a per-platform FORMAT. Width is fixed at 1080 (so the absolute
// type sizes look identical everywhere); only the height changes per platform:
//   - square   1080×1080  → Facebook / Reddit feed (1:1)
//   - portrait 1080×1350  → Instagram / Threads feed (4:5)
// The layout is top-anchored with the footer pinned to the bottom, so it reflows
// cleanly between the two heights.

export type FormatKey = 'square' | 'portrait'

export interface CardFormat { w: number; h: number; pad: number }
export const FORMATS: Record<FormatKey, CardFormat> = {
  square: { w: 1080, h: 1080, pad: 72 },
  portrait: { w: 1080, h: 1350, pad: 72 },
}

// Back-compat constants (default square).
export const CARD_W = FORMATS.square.w
export const CARD_H = FORMATS.square.h
export const CARD_PAD = FORMATS.square.pad

export interface CardCtx { c: CanvasRenderingContext2D; W: number; H: number; PAD: number }

export type Risk = 'safe' | 'warn' | 'danger'

export function riskColor(risk: Risk): string {
  return risk === 'safe' ? '#10b981' : risk === 'warn' ? '#f59e0b' : '#ef4444'
}

export function riskFromScore(score: number): Risk {
  return score >= 70 ? 'safe' : score >= 40 ? 'warn' : 'danger'
}

// Granular grade scale (parity with the old site's letterGrade).
export function letterGrade(s: number): string {
  if (s >= 90) return 'A+'; if (s >= 85) return 'A'; if (s >= 80) return 'A-'
  if (s >= 77) return 'B+'; if (s >= 73) return 'B'; if (s >= 70) return 'B-'
  if (s >= 67) return 'C+'; if (s >= 63) return 'C'; if (s >= 60) return 'C-'
  if (s >= 55) return 'D+'; if (s >= 50) return 'D'; if (s >= 45) return 'D-'
  return 'F'
}

export function riskHeadline(risk: Risk): string {
  return risk === 'safe' ? 'STRONG — WORTH YOUR TIME'
    : risk === 'warn' ? 'MIXED — APPLY WITH EYES OPEN'
    : 'HIGH RISK — APPLY WITH CAUTION'
}

export function createCard(format: FormatKey = 'square'): { canvas: HTMLCanvasElement; ctx: CardCtx } {
  const fmt = FORMATS[format]
  const canvas = document.createElement('canvas')
  canvas.width = fmt.w
  canvas.height = fmt.h
  const c = canvas.getContext('2d')!
  return { canvas, ctx: { c, W: fmt.w, H: fmt.h, PAD: fmt.pad } }
}

export function rrPath(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath()
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r)
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r)
  c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath()
}

// Dark base + accent glow + purple corner + hairline rounded border.
export function paintBackground({ c, W, H }: CardCtx, accent: string) {
  c.fillStyle = '#02040a'; c.fillRect(0, 0, W, H)
  const g1 = c.createRadialGradient(W * 0.5, H * 0.38, 0, W * 0.5, H * 0.38, Math.max(W, H) * 0.52)
  g1.addColorStop(0, accent + '1F'); g1.addColorStop(1, 'rgba(0,0,0,0)')
  c.fillStyle = g1; c.fillRect(0, 0, W, H)
  const g2 = c.createRadialGradient(W, 0, 0, W, 0, 440)
  g2.addColorStop(0, 'rgba(124,58,237,0.13)'); g2.addColorStop(1, 'rgba(0,0,0,0)')
  c.fillStyle = g2; c.fillRect(0, 0, W, H)
  rrPath(c, 1, 1, W - 2, H - 2, 24)
  c.strokeStyle = 'rgba(255,255,255,0.06)'; c.lineWidth = 1.5; c.stroke()
}

// Top "SEEN · {label}" eyebrow with right-aligned seenjobs.io.
export function eyebrow({ c, W, PAD }: CardCtx, label: string) {
  c.font = '600 13px "DM Mono",monospace'; c.fillStyle = 'rgba(255,255,255,0.20)'
  c.textAlign = 'left'; c.textBaseline = 'top'
  c.fillText(`SEEN  ·  ${label}`, PAD, PAD)
  c.textAlign = 'right'; c.fillText('seenjobs.io', W - PAD, PAD)
}

export function footer({ c, W, H, PAD }: CardCtx, text: string) {
  const y = H - 90
  c.strokeStyle = 'rgba(255,255,255,0.08)'; c.lineWidth = 1
  c.beginPath(); c.moveTo(PAD, y); c.lineTo(W - PAD, y); c.stroke()
  c.font = '400 16px "DM Mono",monospace'; c.fillStyle = 'rgba(255,255,255,0.30)'
  c.textAlign = 'center'; c.textBaseline = 'middle'
  c.fillText(text, W / 2, y + 28)
}

export function divider({ c, W, PAD }: CardCtx, y: number) {
  c.strokeStyle = 'rgba(255,255,255,0.09)'; c.lineWidth = 1
  c.beginPath(); c.moveTo(PAD, y); c.lineTo(W - PAD, y); c.stroke()
}

// Shrink the font until `text` fits `maxW`. Sets c.font and returns the size used.
export function fitText(
  c: CanvasRenderingContext2D, text: string, maxW: number,
  startFs: number, minFs: number, weight: number | string, family: string,
): number {
  let fs = startFs
  c.font = `${weight} ${fs}px "${family}",sans-serif`
  while (c.measureText(text).width > maxW && fs > minFs) {
    fs -= 2
    c.font = `${weight} ${fs}px "${family}",sans-serif`
  }
  return fs
}

// Truncate with an ellipsis to fit `maxW` at the current font.
export function ellipsize(c: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (c.measureText(text).width <= maxW) return text
  let t = text
  while (t.length > 4 && c.measureText(t + '…').width > maxW) t = t.slice(0, -1)
  return t + '…'
}

// Word-wrap `text` to at most `maxLines` lines that each fit `maxW` (current font).
// Once on the last allowed line, remaining words are kept on it and the line is
// ellipsized, so the text never overflows. Returns the lines.
export function wrapLines(c: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + ' ' + words[i] : words[i]
    if (c.measureText(test).width <= maxW || !line) {
      line = test
    } else if (lines.length < maxLines - 1) {
      lines.push(line); line = words[i]
    } else {
      line = line + ' ' + words[i] // final line — let ellipsize trim the overflow
    }
  }
  if (line) lines.push(line)
  return lines.slice(0, maxLines).map(l => ellipsize(c, l, maxW))
}

// A 2-column grid of metric tiles (value + label).
export interface Tile { value: string; label: string; color?: string }
export function drawTileGrid(
  { c, W, PAD }: CardCtx, tiles: Tile[], top: number, rowH: number,
): number {
  const gap = 20
  const colW = (W - PAD * 2 - gap) / 2
  tiles.forEach((t, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const x = PAD + col * (colW + gap)
    const y = top + row * (rowH + gap)
    rrPath(c, x, y, colW, rowH, 18)
    c.fillStyle = 'rgba(255,255,255,0.03)'; c.fill()
    c.strokeStyle = 'rgba(255,255,255,0.07)'; c.lineWidth = 1; c.stroke()
    c.textAlign = 'center'
    c.font = '800 52px "Syne",sans-serif'; c.fillStyle = t.color || '#fff'
    c.textBaseline = 'alphabetic'
    c.fillText(t.value, x + colW / 2, y + rowH * 0.52)
    c.font = '500 15px "DM Mono",monospace'; c.fillStyle = 'rgba(255,255,255,0.40)'
    c.textBaseline = 'top'
    c.fillText(t.label.toUpperCase(), x + colW / 2, y + rowH * 0.62)
  })
  const rows = Math.ceil(tiles.length / 2)
  return top + rows * rowH + (rows - 1) * gap
}

// A row of pill tags.
export function drawTags({ c, W, PAD }: CardCtx, tags: string[], y: number) {
  if (!tags.length) return
  c.font = '500 17px "DM Mono",monospace'
  c.textBaseline = 'middle'; c.textAlign = 'left'
  const padX = 16, gap = 12, h = 38
  let x = PAD
  for (const tag of tags) {
    const w = c.measureText(tag).width + padX * 2
    if (x + w > W - PAD) break
    rrPath(c, x, y - h / 2, w, h, h / 2)
    c.fillStyle = 'rgba(255,255,255,0.04)'; c.fill()
    c.strokeStyle = 'rgba(255,255,255,0.10)'; c.lineWidth = 1; c.stroke()
    c.fillStyle = 'rgba(255,255,255,0.72)'
    c.fillText(tag, x + padX, y + 1)
    x += w + gap
  }
}
