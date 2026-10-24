// ── Seen share-card kit — typographic posters, 1080×1080 and 1080×1920 ─────────────────────
// Browser-only canvas code. ONE source for the tracker "Outcome" card (OutcomeCard) and the
// company "Grade" card (CompanyScoreCard). The server OG unfurl (app/company/[slug]/og) is the
// same design in satori. Palette + type scale: lib/cardTheme.js. Every sentence: lib/cardCopy.js.
// Hero grid math: lib/cardLayout.js.
//
// The outcome card is a poster of one person's hiring story: a sentence headline with the
// company set in the accent, and the DAYS as the picture (one cell per day, the decision day
// marked, ghosting literally fading out) beside one big number. Full bleed, no inner frame,
// no widgets, no buttons. Fonts Syne (display) + Instrument Sans (text) are loaded globally
// by app/layout.tsx; callers await document.fonts.ready before drawing.

import { INK, TEXT, TYPE, ACCENTS, accentKeyForOutcome, accentKeyForRisk, riskForScore, rgba } from '@/lib/cardTheme.js'
import {
  outcomeHeadline, daysLabel, subLine, metaLine, contextStrip, outcomeKind, companyUrl,
  companyVerdict, companyStatPairs, confidenceLine,
} from '@/lib/cardCopy.js'
import { heroCells, layoutGrid } from '@/lib/cardLayout.js'
import { formatPacific } from '@/lib/time/pacific.js'

export type CardFormat = 'square' | 'story'
export const W = 1080
export const H = 1080
export const STORY_H = 1920
export const PAD = 84

type Ctx = CanvasRenderingContext2D
type Risk = 'safe' | 'warn' | 'danger'

export interface CompanyGradeContext {
  grade: string
  score: number
  ghostRate?: number | null     // 0–1
  responseRate?: number | null  // 0–1
}

export interface OutcomeCardData {
  company: string
  role?: string
  /** ghosted · rejected · hired/offer · interview · waiting (lib/cardCopy.js outcomeKind). */
  outcome: string
  /** Days from applying to the outcome (or to today, for silence). null = unknown, never invented. */
  days?: number | null
  reachedInterview?: boolean
  platform?: string
  /** The application's city, printed in the top-right meta when known. */
  city?: string
  /** When the outcome happened (ms) — the month in the top-right meta. */
  dateMs?: number
  /** The company's Seen grade, when it has one. Absent → the context strip is omitted. */
  companyGrade?: CompanyGradeContext | null
}

export interface CompanyCardData {
  company: string
  grade: string
  overall_score: number
  ghost_rate: number      // 0–1
  response_rate: number   // 0–1
  avg_wait_days: number   // 0 = unknown, left out
  report_count: number    // first-party only
  risk?: Risk
  /** ISO timestamp of the last (re)compute, printed as "updated Oct 19, 2026" (California time). */
  updatedAt?: string | null
}

// ── Frame ──────────────────────────────────────────────────────────────────────────────────
interface Frame { W: number; H: number; PAD: number; top: number; bottom: number; story: boolean }

function frame(format: CardFormat): Frame {
  // Story safe margins: 180px top/bottom stay clear of IG/TikTok UI.
  return format === 'story'
    ? { W, H: STORY_H, PAD, top: 180, bottom: STORY_H - 180, story: true }
    : { W, H, PAD, top: 0, bottom: H, story: false }
}

function prep(canvas: HTMLCanvasElement, f: Frame): Ctx {
  canvas.width = f.W; canvas.height = f.H
  const c = canvas.getContext('2d')!
  c.textBaseline = 'alphabetic'
  return c
}

const white = (a: number) => `rgba(255,255,255,${a})`
const font = (weight: number, px: number, family: string = TYPE.text) => `${weight} ${px}px ${family}`

// ── Primitives ─────────────────────────────────────────────────────────────────────────────
function roundRect(c: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  c.beginPath()
  c.moveTo(x + rr, y); c.arcTo(x + w, y, x + w, y + h, rr)
  c.arcTo(x + w, y + h, x, y + h, rr); c.arcTo(x, y + h, x, y, rr)
  c.arcTo(x, y, x + w, y, rr); c.closePath()
}

// Manual letter-spacing — reliable across iOS Safari versions (ctx.letterSpacing is new).
function tracked(c: Ctx, text: string, x: number, y: number, ls: number, align: 'left' | 'right' = 'left') {
  const chars = [...text]
  const widths = chars.map(ch => c.measureText(ch).width)
  const total = widths.reduce((a, b) => a + b, 0) + ls * (chars.length - 1)
  let sx = align === 'right' ? x - total : x
  const prev = c.textAlign; c.textAlign = 'left'
  for (let i = 0; i < chars.length; i++) { c.fillText(chars[i], sx, y); sx += widths[i] + ls }
  c.textAlign = prev
  return total
}

function ellipsize(c: Ctx, text: string, maxW: number): string {
  if (c.measureText(text).width <= maxW) return text
  let t = text
  while (t.length > 2 && c.measureText(t + '…').width > maxW) t = t.slice(0, -1)
  return t.trimEnd() + '…'
}

// Shrink a font until a single line fits.
function fitFont(c: Ctx, text: string, weight: number, family: string, start: number, min: number, maxW: number): number {
  let fs = start
  c.font = font(weight, fs, family)
  while (c.measureText(text).width > maxW && fs > min) { fs -= 2; c.font = font(weight, fs, family) }
  return fs
}

// Fit a block of text: shrink from `start` until it wraps into ≤ maxLines that each fit maxW and
// the block (cap height + line gaps) is no taller than maxH.
function fitWrapped(c: Ctx, text: string, weight: number, family: string, start: number, min: number, maxW: number, maxLines: number, maxH = Infinity): { fs: number; lines: string[]; lh: number; height: number } {
  let fs = start
  const blockH = (n: number, size: number) => (n - 1) * Math.round(size * 1.02) + size * 0.75
  const fits = (ls: string[]) => ls.length <= maxLines && blockH(ls.length, fs) <= maxH && ls.every(l => c.measureText(l).width <= maxW)
  c.font = font(weight, fs, family)
  let lines = wrapLines(c, text, maxW)
  while (!fits(lines) && fs > min) { fs -= 4; c.font = font(weight, fs, family); lines = wrapLines(c, text, maxW) }
  if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = ellipsize(c, lines[maxLines - 1] + '…', maxW) }
  else lines = lines.map(l => ellipsize(c, l, maxW))
  return { fs, lines, lh: Math.round(fs * 1.02), height: blockH(lines.length, fs) }
}

// The company name block: one line at `start`, wrapping and shrinking for long names. Its last
// baseline sits at `anchor` unless the block would climb above `top`; then it hangs from `top`.
// Returns the baseline of the last line so the verdict can follow it.
function companyName(c: Ctx, text: string, x: number, top: number, anchor: number, maxW: number, start: number, min: number): number {
  const name = fitWrapped(c, text, 800, TYPE.display, start, min, maxW, 3, anchor - top + start * 0.75)
  c.font = font(800, name.fs, TYPE.display); c.fillStyle = white(TEXT.full); c.textAlign = 'left'
  const first = Math.max(anchor - (name.lines.length - 1) * name.lh, top + name.fs * 0.75)
  name.lines.forEach((l, i) => c.fillText(l, x - name.fs * 0.04, first + i * name.lh))
  return first + (name.lines.length - 1) * name.lh
}

function wrapLines(c: Ctx, text: string, maxW: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const test = line ? line + ' ' + w : w
    if (c.measureText(test).width > maxW && line) { lines.push(line); line = w } else line = test
  }
  if (line) lines.push(line)
  return lines
}

// ── Background: ink, a quiet dot grid, one soft accent bloom, a 6% hairline frame ───────────
function paintBg(c: Ctx, f: Frame, accent: string, bloom: { x: number; y: number; r: number; a: number }) {
  c.fillStyle = INK; c.fillRect(0, 0, f.W, f.H)
  // Dot grid: the paper's texture. Very low alpha so it reads as tooth, not a pattern.
  c.fillStyle = white(0.045)
  const step = 36
  for (let y = step; y < f.H; y += step) for (let x = step; x < f.W; x += step) { c.beginPath(); c.arc(x, y, 1.2, 0, Math.PI * 2); c.fill() }
  // One bloom behind the hero graphic.
  const g = c.createRadialGradient(bloom.x, bloom.y, 0, bloom.x, bloom.y, bloom.r)
  g.addColorStop(0, rgba(accent, bloom.a)); g.addColorStop(0.55, rgba(accent, bloom.a * 0.35)); g.addColorStop(1, rgba(accent, 0))
  c.fillStyle = g; c.fillRect(0, 0, f.W, f.H)
  // Full-bleed hairline — a print edge, not a modal border.
  c.strokeStyle = white(0.06); c.lineWidth = 1
  c.strokeRect(0.5, 0.5, f.W - 1, f.H - 1)
}

// ── Shared rows ────────────────────────────────────────────────────────────────────────────
function topRow(c: Ctx, f: Frame, accent: string, meta: string) {
  const y = f.top + f.PAD + 16
  c.fillStyle = accent
  c.beginPath(); c.arc(f.PAD + 9, y - 13, 9, 0, Math.PI * 2); c.fill()
  c.font = font(800, TYPE.wordmark, TYPE.display); c.fillStyle = white(TEXT.full); c.textAlign = 'left'
  c.fillText('Seen', f.PAD + 30, y)
  if (meta) {
    c.font = font(500, TYPE.meta); c.fillStyle = white(TEXT.meta)
    tracked(c, meta, f.W - f.PAD, y - 2, 3, 'right')
  }
}

function footer(c: Ctx, f: Frame, url: string, note: string) {
  const base = f.bottom - 76
  c.strokeStyle = white(0.06); c.lineWidth = 1
  c.beginPath(); c.moveTo(f.PAD, base - 52); c.lineTo(f.W - f.PAD, base - 52); c.stroke()
  const inner = f.W - f.PAD * 2
  c.font = font(600, TYPE.footerUrl); c.fillStyle = white(TEXT.strong); c.textAlign = 'left'
  const shownUrl = ellipsize(c, url, inner)
  c.fillText(shownUrl, f.PAD, base)
  const urlW = c.measureText(shownUrl).width
  // The URL is the point of the footer; the note takes what is left or steps aside.
  const room = inner - urlW - 48
  c.font = font(400, TYPE.footerNote); c.fillStyle = white(TEXT.faint); c.textAlign = 'right'
  if (room >= 140) c.fillText(ellipsize(c, note, room), f.W - f.PAD, base)
  c.textAlign = 'left'
  return base - 52
}

// A sentence headline with the company name in the accent. Wraps word by word, fits down to
// `min` so it stays ≤ maxLines; a still-too-long company name is ellipsized, never clipped.
function headline(c: Ctx, parts: { text: string; accent: boolean }[], x: number, y: number, maxW: number, start: number, min: number, maxLines: number, accent: string): { bottom: number; size: number } {
  type Word = { text: string; accent: boolean }
  const toWords = (ps: { text: string; accent: boolean }[]): Word[] => {
    const words: Word[] = []
    ps.forEach(p => p.text.trim().split(/\s+/).filter(Boolean).forEach(t => words.push({ text: t, accent: p.accent })))
    return words
  }
  const layout = (words: Word[], fs: number): Word[][] => {
    c.font = font(800, fs, TYPE.display)
    const lines: Word[][] = []
    let line: Word[] = [], lineW = 0
    const space = c.measureText(' ').width
    for (const w of words) {
      const ww = c.measureText(w.text).width
      const next = line.length ? lineW + space + ww : ww
      if (next > maxW && line.length) { lines.push(line); line = [w]; lineW = ww } else { line.push(w); lineW = next }
    }
    if (line.length) lines.push(line)
    return lines
  }
  // The budget is HEIGHT (maxLines at the start size): four short lines at 72px take the same
  // room as three at 100px and keep the whole company name, so no ellipsis is needed.
  const maxH = maxLines * Math.round(start * 1.04)
  const tall = (ls: Word[][], size: number) => ls.length * Math.round(size * 1.04) > maxH
  let fs = start
  let words = toWords(parts)
  let lines = layout(words, fs)
  while (tall(lines, fs) && fs > min) { fs -= 4; lines = layout(words, fs) }
  // Still too long at the minimum size: shorten the company name itself.
  let guard = 0
  while (tall(lines, fs) && guard++ < 40) {
    const i = parts.findIndex(p => p.accent)
    if (i < 0) break
    const name = parts[i].text.replace(/…$/, '')
    if (name.length <= 3) break
    parts = parts.map((p, j) => j === i ? { ...p, text: name.slice(0, -2).trimEnd() + '…' } : p)
    words = toWords(parts); lines = layout(words, fs)
  }
  const lh = Math.round(fs * 1.04)
  c.font = font(800, fs, TYPE.display); c.textAlign = 'left'
  const space = c.measureText(' ').width
  let yy = y
  for (const line of lines) {
    let xx = x
    line.forEach((w, i) => {
      c.fillStyle = w.accent ? accent : white(TEXT.full)
      c.fillText(w.text, xx, yy)
      xx += c.measureText(w.text).width + (i < line.length - 1 ? space : 0)
    })
    yy += lh
  }
  return { bottom: yy - lh, size: fs }
}

// ── The hero: the days as cells ────────────────────────────────────────────────────────────
function drawMark(c: Ctx, kind: 'yes' | 'no' | 'dot', cx: number, cy: number, s: number) {
  c.save()
  c.strokeStyle = INK; c.fillStyle = INK; c.lineCap = 'round'; c.lineJoin = 'round'
  c.lineWidth = Math.max(3, s * 0.12)
  if (kind === 'yes') {
    c.beginPath(); c.moveTo(cx - s * 0.26, cy + 0.02 * s); c.lineTo(cx - s * 0.06, cy + s * 0.22); c.lineTo(cx + s * 0.3, cy - s * 0.22); c.stroke()
  } else if (kind === 'no') {
    c.beginPath(); c.moveTo(cx - s * 0.22, cy - s * 0.22); c.lineTo(cx + s * 0.22, cy + s * 0.22)
    c.moveTo(cx + s * 0.22, cy - s * 0.22); c.lineTo(cx - s * 0.22, cy + s * 0.22); c.stroke()
  } else {
    c.beginPath(); c.arc(cx, cy, s * 0.16, 0, Math.PI * 2); c.fill()
  }
  c.restore()
}

function drawDayGrid(c: Ctx, x: number, y: number, kind: string, days: number | null | undefined, boxW: number, boxH: number, accent: string, dim: number, align: 'left' | 'right' | 'center' = 'left', valign: 'bottom' | 'middle' = 'bottom') {
  const cells = heroCells(kind, days)
  const g = layoutGrid(cells.length, boxW, boxH)
  const x0 = align === 'right' ? x + boxW - g.width : align === 'center' ? x + Math.round((boxW - g.width) / 2) : x
  const y0 = valign === 'middle' ? y + Math.round((boxH - g.height) / 2) : y + boxH - g.height
  const r = Math.max(6, g.cell * 0.22)
  const mark: 'yes' | 'no' | 'dot' = kind === 'hired' ? 'yes' : kind === 'rejected' ? 'no' : 'dot'
  cells.forEach((cell, i) => {
    const cx = x0 + (i % g.perRow) * (g.cell + g.gap)
    const cy = y0 + Math.floor(i / g.perRow) * (g.cell + g.gap)
    roundRect(c, cx, cy, g.cell, g.cell, r)
    if (cell.kind === 'decision') {
      c.save(); c.shadowColor = rgba(accent, 0.55); c.shadowBlur = g.cell * 0.5
      c.fillStyle = accent; c.fill(); c.restore()
      drawMark(c, mark, cx + g.cell / 2, cy + g.cell / 2, g.cell)
    } else {
      const a = Math.max(0.03, dim * (cell.alpha ?? 1))
      c.fillStyle = rgba(accent, a); c.fill()
      // A hairline keeps the faintest ghosted cells legible as cells.
      c.strokeStyle = rgba(accent, Math.min(0.5, a + 0.08)); c.lineWidth = 1; c.stroke()
      if (cell.kind === 'more' && cell.label) {
        const fs = fitFont(c, cell.label, 700, TYPE.text, Math.round(g.cell * 0.34), 12, g.cell - 10)
        c.font = font(700, fs); c.fillStyle = rgba(accent, Math.min(1, 0.55 + (cell.alpha ?? 1) * 0.4)); c.textAlign = 'center'; c.textBaseline = 'middle'
        c.fillText(cell.label, cx + g.cell / 2, cy + g.cell / 2 + 1)
        c.textAlign = 'left'; c.textBaseline = 'alphabetic'
      }
    }
  })
  return { x: x0, y: y0, ...g }
}

function bigNumber(c: Ctx, x: number, baseline: number, value: string, label: string, size: number, maxW: number) {
  const fs = fitFont(c, value, 800, TYPE.display, size, Math.round(size * 0.6), maxW)
  c.font = font(800, fs, TYPE.display); c.fillStyle = white(TEXT.full); c.textAlign = 'left'
  c.fillText(value, x - fs * 0.04, baseline)
  const descent = c.measureText(value).actualBoundingBoxDescent || 0
  c.font = font(400, TYPE.numberLabel); c.fillStyle = white(TEXT.body)
  c.fillText(ellipsize(c, label, maxW), x, baseline + descent + 40)
}

// "Walmart · Seen grade [A] · 13% of applicants get ghosted" — the letter in a small accent tag.
function contextLine(c: Ctx, f: Frame, baseline: number, strip: { before: string; letter: string; after: string }, accent: string) {
  c.font = font(400, TYPE.context); c.fillStyle = white(TEXT.body); c.textAlign = 'left'
  let x = f.PAD
  c.fillText(strip.before, x, baseline); x += c.measureText(strip.before).width + 4
  c.font = font(700, 20, TYPE.display)
  const lw = c.measureText(strip.letter).width
  const tagW = lw + 22, tagH = 32
  roundRect(c, x, baseline - 24, tagW, tagH, 7)
  c.strokeStyle = rgba(accent, 0.7); c.lineWidth = 1.5; c.stroke()
  c.fillStyle = rgba(accent, 0.12); c.fill()
  c.fillStyle = accent; c.fillText(strip.letter, x + 11, baseline - 1)
  x += tagW + 4
  c.font = font(400, TYPE.context); c.fillStyle = white(TEXT.body)
  c.fillText(ellipsize(c, strip.after, f.W - f.PAD - x), x, baseline)
}

// ── OUTCOME CARD ───────────────────────────────────────────────────────────────────────────
export function drawOutcomeCard(canvas: HTMLCanvasElement, d: OutcomeCardData, format: CardFormat = 'square') {
  const f = frame(format)
  const c = prep(canvas, f)
  const kind = outcomeKind(d.outcome)
  const A = ACCENTS[accentKeyForOutcome(d.outcome)]
  const accent = A.hex
  const days = d.days != null && Number.isFinite(d.days) ? Math.max(0, Math.round(d.days)) : null
  const head = outcomeHeadline({ outcome: d.outcome, company: d.company, days, reachedInterview: !!d.reachedInterview })
  const sub = subLine(d.role, d.platform)
  const strip = contextStrip(d.company, d.companyGrade ?? null)
  const inner = f.W - f.PAD * 2

  if (!f.story) {
    paintBg(c, f, accent, { x: f.W * 0.78, y: 700, r: 620, a: A.bloom })
    topRow(c, f, accent, metaLine(d.dateMs ?? NaN, d.city))

    const hl = headline(c, head.parts, f.PAD, 270, inner, TYPE.headline, TYPE.headlineMin, 3, accent)
    let y = hl.bottom
    if (sub) {
      y += 58
      c.font = font(400, TYPE.sub); c.fillStyle = white(TEXT.body); c.textAlign = 'left'
      c.fillText(ellipsize(c, sub, inner), f.PAD, y)
    }
    const heroTop = y + 46
    const heroBottom = strip ? 850 : 880
    const numW = 380
    drawDayGrid(c, f.PAD + numW + 40, heroTop, kind, days, f.W - f.PAD - (f.PAD + numW + 40), heroBottom - heroTop, accent, A.dim, 'right')
    bigNumber(c, f.PAD, heroBottom - 74, days != null ? String(days) : '?', daysLabel({ outcome: d.outcome, days }), TYPE.number, numW)
    if (strip) contextLine(c, f, 924, strip, accent)
    footer(c, f, companyUrl(d.company), 'Tracked with Seen')
    return
  }

  // Story: the same elements with more air — headline, the number, then the calendar full width.
  paintBg(c, f, accent, { x: f.W * 0.5, y: 1250, r: 760, a: A.bloom })
  topRow(c, f, accent, metaLine(d.dateMs ?? NaN, d.city))
  const hl = headline(c, head.parts, f.PAD, f.top + 232, inner, 108, TYPE.headlineMin, 3, accent)
  let y = hl.bottom
  if (sub) {
    y += 64
    c.font = font(400, 32); c.fillStyle = white(TEXT.body); c.textAlign = 'left'
    c.fillText(ellipsize(c, sub, inner), f.PAD, y)
  }
  const numBase = y + 268
  bigNumber(c, f.PAD, numBase, days != null ? String(days) : '?', daysLabel({ outcome: d.outcome, days }), 260, inner)
  const hairline = f.bottom - 76 - 52
  const contextBase = hairline - 54
  const gridTop = numBase + 150
  const gridBottom = (strip ? contextBase - 70 : hairline - 64)
  drawDayGrid(c, f.PAD, gridTop, kind, days, inner, Math.max(120, gridBottom - gridTop), accent, A.dim, 'center', 'middle')
  if (strip) contextLine(c, f, contextBase, strip, accent)
  footer(c, f, companyUrl(d.company), 'Tracked with Seen')
}

// ── COMPANY GRADE CARD ─────────────────────────────────────────────────────────────────────
function watermarkLetter(c: Ctx, letter: string, rightX: number, baseline: number, size: number, maxW: number, accent: string) {
  const fs = fitFont(c, letter, 800, TYPE.display, size, Math.round(size * 0.5), maxW)
  c.font = font(800, fs, TYPE.display); c.textAlign = 'right'
  c.fillStyle = rgba(accent, 0.22)
  c.fillText(letter, rightX, baseline)
  c.textAlign = 'left'
}

function scoreUnder(c: Ctx, score: number, rightX: number, baseline: number, accent: string, big = 76) {
  c.font = font(800, big, TYPE.display); c.textAlign = 'right'
  c.fillStyle = white(TEXT.faint); c.font = font(500, Math.round(big * 0.42)); const tail = '/100'
  const tailW = c.measureText(tail).width
  c.fillText(tail, rightX, baseline)
  c.font = font(800, big, TYPE.display); c.fillStyle = accent
  c.fillText(String(score), rightX - tailW - 8, baseline)
  c.textAlign = 'left'
}

function statPairs(c: Ctx, x: number, baseline: number, pairs: { value: string; label: string }[], valueSize: number, maxW: number) {
  let xx = x
  for (const p of pairs) {
    c.font = font(700, valueSize, TYPE.display); c.fillStyle = white(TEXT.full); c.textAlign = 'left'
    const vw = c.measureText(p.value).width
    c.fillText(p.value, xx, baseline)
    c.font = font(400, TYPE.context); c.fillStyle = white(TEXT.meta)
    const lw = c.measureText(p.label).width
    c.fillText(p.label, xx, baseline + 38)
    xx += Math.max(vw, lw) + Math.max(56, maxW * 0.08)
  }
}

export function drawCompanyCard(canvas: HTMLCanvasElement, d: CompanyCardData, format: CardFormat = 'square') {
  const f = frame(format)
  const c = prep(canvas, f)
  const score = Math.round(d.overall_score || 0)
  const risk: Risk = d.risk ?? riskForScore(score)
  const A = ACCENTS[accentKeyForRisk(risk)]
  const accent = A.hex
  const inner = f.W - f.PAD * 2
  const verdict = companyVerdict({ ghostRate: d.ghost_rate, responseRate: d.response_rate })
  const pairs = companyStatPairs({ ghostRate: d.ghost_rate, responseRate: d.response_rate, avgWaitDays: d.avg_wait_days })
  const updated = d.updatedAt ? formatPacific(new Date(d.updatedAt), { dateStyle: 'medium' }) : ''
  const updatedMs = d.updatedAt ? new Date(d.updatedAt).getTime() : NaN
  const meta = ['SEEN GRADE', metaLine(updatedMs, '')].filter(Boolean).join(' · ')
  const conf = confidenceLine(d.report_count, updated)

  if (!f.story) {
    paintBg(c, f, accent, { x: f.W * 0.8, y: 420, r: 640, a: A.bloom })
    topRow(c, f, accent, meta)
    watermarkLetter(c, d.grade, f.W - 40, 622, 600, 520, accent)
    scoreUnder(c, score, f.W - f.PAD, 700, accent, 72)

    // One line at up to 120px; a long name wraps (Syne is wide: 25 characters need three lines)
    // rather than running off the card, and the verdict follows it down.
    const nameBase = companyName(c, d.company, f.PAD, 176, 352, inner, 120, 60)
    c.font = font(400, 34); c.fillStyle = white(TEXT.strong)
    const lines = wrapLines(c, verdict, 520)
    lines.forEach((l, i) => c.fillText(l, f.PAD, nameBase + 66 + i * 46))

    statPairs(c, f.PAD, 812, pairs, 76, inner)
    c.font = font(400, TYPE.footerNote); c.fillStyle = white(TEXT.meta); c.textAlign = 'left'
    c.fillText(ellipsize(c, conf, inner), f.PAD, 904)
    footer(c, f, companyUrl(d.company), 'Check any company free at seenjobs.io')
    return
  }

  paintBg(c, f, accent, { x: f.W * 0.5, y: 1000, r: 820, a: A.bloom })
  topRow(c, f, accent, meta)
  const nameBase = companyName(c, d.company, f.PAD, f.top + 150, f.top + 300, inner, 128, 64)
  c.font = font(400, 36); c.fillStyle = white(TEXT.strong)
  wrapLines(c, verdict, inner).forEach((l, i) => c.fillText(l, f.PAD, nameBase + 72 + i * 48))
  watermarkLetter(c, d.grade, f.W - 40, 1150, 820, inner + 40, accent)
  scoreUnder(c, score, f.W - f.PAD, 1262, accent, 96)
  statPairs(c, f.PAD, 1430, pairs, 84, inner)
  c.font = font(400, TYPE.footerNote); c.fillStyle = white(TEXT.meta); c.textAlign = 'left'
  c.fillText(ellipsize(c, conf, inner), f.PAD, 1540)
  footer(c, f, companyUrl(d.company), 'Check any company free at seenjobs.io')
}
