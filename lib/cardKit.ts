// ── Seen share-card kit — premium 1080×1080 canvas creatives ───────────────
// Browser-only canvas code. Single source of truth for the company "Hiring Grade"
// card (CompanyScoreCard) and the tracker "Outcome" card (OutcomeCard). Clean type
// hierarchy (Syne display + Instrument Sans labels — both already loaded globally in
// app/layout.tsx), grade ring, stat row, journey stepper, and CTA footer. No emoji,
// no monospace body text — these are the launch creatives, so they read as brand.

export const W = 1080
export const H = 1080
export const PAD = 84

type Ctx = CanvasRenderingContext2D
type Risk = 'safe' | 'warn' | 'danger'

const C = {
  ink: '#070810',
  white: '#ffffff',
  green: '#10b981',
  red: '#ef4444',
  amber: '#f59e0b',
  blue: '#3b82f6',
}

export interface CompanyCardData {
  company: string
  grade: string
  overall_score: number
  ghost_rate: number      // 0–1
  response_rate: number   // 0–1
  avg_wait_days: number
  waste: number           // 0–100
  report_count: number
  risk?: Risk
}

export interface OutcomeStep { label: string; sub: string; mark?: string }
export interface StatCell { value: string; label: string; color?: string }

export interface OutcomeCardData {
  company: string
  role?: string
  outcome: string
  days?: number | null
  reachedInterview?: boolean
  platform?: string
  steps?: OutcomeStep[]
  stats?: StatCell[]
}

function hexA(h: string, a: number): string {
  const n = parseInt(h.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

function roundRect(c: Ctx, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath()
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r)
  c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r)
  c.arcTo(x, y, x + w, y, r); c.closePath()
}

// Manual letter-spacing — reliable across iOS Safari versions (ctx.letterSpacing is new).
function tracked(c: Ctx, text: string, x: number, y: number, ls: number, align: 'left' | 'center' | 'right' = 'left') {
  const chars = [...text]
  const widths = chars.map(ch => c.measureText(ch).width)
  const total = widths.reduce((a, b) => a + b, 0) + ls * (chars.length - 1)
  let sx = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x
  const prev = c.textAlign; c.textAlign = 'left'
  for (let i = 0; i < chars.length; i++) { c.fillText(chars[i], sx, y); sx += widths[i] + ls }
  c.textAlign = prev
}

// Shrink font until the text fits a max width.
function fitFont(c: Ctx, text: string, weight: string, family: string, start: number, min: number, maxW: number): number {
  let fs = start
  c.font = `${weight} ${fs}px ${family}`
  while (c.measureText(text).width > maxW && fs > min) { fs -= 2; c.font = `${weight} ${fs}px ${family}` }
  return fs
}

function wrapText(c: Ctx, text: string, x: number, y: number, maxW: number, lh: number) {
  const words = text.split(' ')
  let line = '', yy = y
  for (const w of words) {
    const test = line ? line + ' ' + w : w
    if (c.measureText(test).width > maxW && line) { c.fillText(line, x, yy); line = w; yy += lh }
    else line = test
  }
  if (line) c.fillText(line, x, yy)
}

function paintBg(c: Ctx, accent: string) {
  c.fillStyle = C.ink; c.fillRect(0, 0, W, H)
  const g = c.createRadialGradient(W * 0.5, H * 0.26, 0, W * 0.5, H * 0.26, 680)
  g.addColorStop(0, hexA(accent, 0.18)); g.addColorStop(1, 'rgba(0,0,0,0)')
  c.fillStyle = g; c.fillRect(0, 0, W, H)
  const g2 = c.createRadialGradient(W * 0.92, H * 1.02, 0, W * 0.92, H * 1.02, 560)
  g2.addColorStop(0, 'rgba(124,58,237,0.12)'); g2.addColorStop(1, 'rgba(0,0,0,0)')
  c.fillStyle = g2; c.fillRect(0, 0, W, H)
  const v = c.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, H * 0.72)
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.45)')
  c.fillStyle = v; c.fillRect(0, 0, W, H)
  c.fillStyle = accent; c.fillRect(0, 0, W, 8)
  roundRect(c, 10, 18, W - 20, H - 28, 34)
  c.strokeStyle = 'rgba(255,255,255,0.07)'; c.lineWidth = 2; c.stroke()
}

function wordmark(c: Ctx, accent: string, rightLabel: string) {
  const y = PAD + 4
  c.fillStyle = accent
  c.shadowColor = accent; c.shadowBlur = 18
  c.beginPath(); c.arc(PAD + 10, y + 18, 10, 0, Math.PI * 2); c.fill()
  c.shadowBlur = 0
  c.font = '800 42px "Syne",sans-serif'; c.fillStyle = C.white; c.textAlign = 'left'; c.textBaseline = 'middle'
  c.fillText('Seen', PAD + 32, y + 20)
  c.font = '500 19px "Instrument Sans",sans-serif'; c.fillStyle = 'rgba(255,255,255,0.42)'; c.textBaseline = 'middle'
  tracked(c, rightLabel, W - PAD, y + 20, 2.5, 'right')
}

function gradeRing(c: Ctx, cx: number, cy: number, r: number, frac: number, accent: string, centerBig: string) {
  c.save()
  c.lineWidth = 20
  c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.strokeStyle = 'rgba(255,255,255,0.09)'; c.stroke()
  c.shadowColor = accent; c.shadowBlur = 28
  c.beginPath(); c.lineCap = 'round'
  c.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.02, Math.min(1, frac)))
  c.strokeStyle = accent; c.stroke()
  c.restore()
  c.font = `800 ${Math.round(r * 0.92)}px "Syne",sans-serif`; c.fillStyle = accent
  c.textAlign = 'center'; c.textBaseline = 'middle'
  c.fillText(centerBig, cx, cy + 2)
}

function statRow(c: Ctx, x: number, y: number, w: number, cells: StatCell[]) {
  const n = cells.length, cw = w / n
  cells.forEach((cell, i) => {
    const cx = x + cw * i + cw / 2
    if (i > 0) {
      c.strokeStyle = 'rgba(255,255,255,0.10)'; c.lineWidth = 1
      c.beginPath(); c.moveTo(x + cw * i, y - 2); c.lineTo(x + cw * i, y + 78); c.stroke()
    }
    let vFs = 54
    c.font = `700 ${vFs}px "Syne",sans-serif`
    while (c.measureText(cell.value).width > cw - 16 && vFs > 26) { vFs -= 2; c.font = `700 ${vFs}px "Syne",sans-serif` }
    c.fillStyle = cell.color || C.white; c.textAlign = 'center'; c.textBaseline = 'alphabetic'
    c.fillText(cell.value, cx, y + 46)
    c.font = '500 17px "Instrument Sans",sans-serif'; c.fillStyle = 'rgba(255,255,255,0.42)'; c.textBaseline = 'top'
    tracked(c, cell.label.toUpperCase(), cx, y + 64, 1.8, 'center')
  })
}

function ctaBar(c: Ctx, accent: string, text: string) {
  const h = 70, y = H - PAD - h + 8, x = PAD, w = W - PAD * 2
  roundRect(c, x, y, w, h, 18); c.fillStyle = hexA(accent, 0.13); c.fill()
  c.strokeStyle = hexA(accent, 0.32); c.lineWidth = 1.5; c.stroke()
  c.font = '600 25px "Instrument Sans",sans-serif'; c.fillStyle = C.white
  c.textAlign = 'center'; c.textBaseline = 'middle'
  c.fillText(text, W / 2, y + h / 2)
}

function stepper(c: Ctx, x: number, y: number, w: number, steps: OutcomeStep[], accent: string) {
  const n = steps.length, gap = w / Math.max(1, n - 1)
  c.strokeStyle = accent; c.lineWidth = 3
  c.beginPath(); c.moveTo(x, y); c.lineTo(x + w, y); c.stroke()
  steps.forEach((s, i) => {
    const sx = x + gap * i, last = i === n - 1
    c.beginPath(); c.arc(sx, y, last ? 17 : 11, 0, Math.PI * 2)
    c.fillStyle = accent; c.shadowColor = accent; c.shadowBlur = last ? 22 : 0; c.fill(); c.shadowBlur = 0
    if (last && s.mark) { c.fillStyle = C.ink; c.font = '700 18px "Syne",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(s.mark, sx, y + 1) }
    const al: 'left' | 'center' | 'right' = i === 0 ? 'left' : last ? 'right' : 'center'
    const lx = i === 0 ? sx - 6 : last ? sx + 6 : sx
    c.font = '600 23px "Instrument Sans",sans-serif'; c.fillStyle = C.white; c.textAlign = al; c.textBaseline = 'alphabetic'
    c.fillText(s.label, lx, y - 32)
    c.font = '400 18px "Instrument Sans",sans-serif'; c.fillStyle = 'rgba(255,255,255,0.42)'; c.textBaseline = 'top'
    c.fillText(s.sub, lx, y + 26)
  })
}

// ── COMPANY HIRING GRADE CARD ──────────────────────────────────────────────
export function drawCompanyCard(canvas: HTMLCanvasElement, d: CompanyCardData) {
  canvas.width = W; canvas.height = H
  const c = canvas.getContext('2d')!
  const score = Math.round(d.overall_score || 0)
  const risk: Risk = d.risk ?? (score >= 70 ? 'safe' : score >= 40 ? 'warn' : 'danger')
  const accent = risk === 'safe' ? C.green : risk === 'danger' ? C.red : C.amber
  const verdict = risk === 'safe' ? 'Strong, transparent hiring process'
    : risk === 'danger' ? 'High risk — most applicants get ghosted'
    : 'Mixed signals — proceed with eyes open'

  paintBg(c, accent)
  wordmark(c, accent, 'HIRING GRADE')

  const ringR = 150, ringCx = PAD + ringR, ringCy = 392
  gradeRing(c, ringCx, ringCy, ringR, score / 100, accent, d.grade)
  c.font = '500 19px "Instrument Sans",sans-serif'; c.fillStyle = hexA(accent, 0.8)
  c.textAlign = 'center'; c.textBaseline = 'top'
  tracked(c, 'SEEN GRADE', ringCx, ringCy + ringR * 0.42, 2, 'center')

  const tx = ringCx + ringR + 52
  const txW = W - PAD - tx
  fitFont(c, d.company, '800', '"Syne",sans-serif', 64, 34, txW)
  c.fillStyle = C.white; c.textAlign = 'left'; c.textBaseline = 'alphabetic'
  c.fillText(d.company, tx, 320)
  c.font = '800 72px "Syne",sans-serif'; c.fillStyle = accent; c.textBaseline = 'alphabetic'
  c.fillText(`${score}`, tx, 410)
  const sW = c.measureText(`${score}`).width
  c.font = '600 34px "Instrument Sans",sans-serif'; c.fillStyle = 'rgba(255,255,255,0.45)'
  c.fillText('/100', tx + sW + 12, 410)
  c.font = '400 25px "Instrument Sans",sans-serif'; c.fillStyle = 'rgba(255,255,255,0.82)'
  wrapText(c, verdict, tx, 452, txW, 33)

  const dY = ringCy + ringR + 70
  c.strokeStyle = 'rgba(255,255,255,0.10)'; c.lineWidth = 1
  c.beginPath(); c.moveTo(PAD, dY); c.lineTo(W - PAD, dY); c.stroke()

  statRow(c, PAD, dY + 40, W - PAD * 2, [
    { value: `${Math.round((d.ghost_rate || 0) * 100)}%`, label: 'Ghost rate', color: C.red },
    { value: `${Math.round((d.response_rate || 0) * 100)}%`, label: 'Response rate', color: C.green },
    { value: `${Math.round(d.avg_wait_days || 0)}d`, label: 'Avg wait', color: C.white },
    { value: `${Math.round(d.waste || 0)}%`, label: 'Wasted-time risk', color: C.amber },
  ])

  const confY = dY + 40 + 130
  const n = d.report_count || 0
  const conf = n >= 12 ? 'High confidence' : n >= 4 ? 'Growing confidence' : 'Early signal'
  const line = n > 0 ? `Based on ${n.toLocaleString()} applicant report${n === 1 ? '' : 's'}  ·  ${conf}` : 'Baseline estimate  ·  share your experience to sharpen it'
  c.font = '400 21px "Instrument Sans",sans-serif'
  const lineW = c.measureText(line).width
  c.fillStyle = accent; c.beginPath(); c.arc(W / 2 - lineW / 2 - 16, confY, 6, 0, Math.PI * 2); c.fill()
  c.fillStyle = 'rgba(255,255,255,0.5)'; c.textAlign = 'center'; c.textBaseline = 'middle'
  c.fillText(line, W / 2, confY)

  ctaBar(c, accent, 'Check any company free  ·  seenjobs.io')
}

// ── TRACKER OUTCOME CARD ───────────────────────────────────────────────────
const OUTCOME_MAP: Record<string, { word: string; color: string; mark: string }> = {
  ghosted: { word: 'GHOSTED', color: C.red, mark: '✕' },
  rejected: { word: 'REJECTED', color: C.red, mark: '✕' },
  autoreject: { word: 'AUTO-REJECTED', color: C.red, mark: '✕' },
  hired: { word: 'HIRED', color: C.green, mark: '✓' },
  offer: { word: 'OFFER', color: C.green, mark: '✓' },
  interview: { word: 'INTERVIEW', color: C.blue, mark: '•' },
  human: { word: 'GOT A REPLY', color: C.green, mark: '✓' },
  waiting: { word: 'STILL WAITING', color: C.amber, mark: '•' },
}

export function drawOutcomeCard(canvas: HTMLCanvasElement, d: OutcomeCardData) {
  canvas.width = W; canvas.height = H
  const c = canvas.getContext('2d')!
  const o = OUTCOME_MAP[d.outcome] || { word: String(d.outcome || '').toUpperCase(), color: C.amber, mark: '•' }
  const accent = o.color

  paintBg(c, accent)
  wordmark(c, accent, 'HIRING OUTCOME')

  fitFont(c, d.company, '800', '"Syne",sans-serif', 60, 34, W - PAD * 2)
  c.fillStyle = C.white; c.textAlign = 'left'; c.textBaseline = 'alphabetic'
  c.fillText(d.company, PAD, 248)
  if (d.role) {
    c.font = '400 26px "Instrument Sans",sans-serif'; c.fillStyle = 'rgba(255,255,255,0.5)'
    let role = d.role
    while (c.measureText(role).width > W - PAD * 2 && role.length > 4) role = role.slice(0, -1)
    if (role !== d.role) role += '…'
    c.fillText(role, PAD, 290)
  }

  const owFs = fitFont(c, o.word, '800', '"Syne",sans-serif', 150, 70, W - PAD * 2)
  c.font = `800 ${owFs}px "Syne",sans-serif`; c.fillStyle = accent
  c.textAlign = 'left'; c.textBaseline = 'alphabetic'
  c.shadowColor = accent; c.shadowBlur = 30
  c.fillText(o.word, PAD, 430)
  c.shadowBlur = 0
  c.fillStyle = accent; roundRect(c, PAD, 452, 120, 7, 4); c.fill()

  const steps: OutcomeStep[] = d.steps && d.steps.length ? d.steps : [
    { label: 'Applied', sub: 'Day 0' },
    { label: 'Interview', sub: d.reachedInterview ? 'Reached' : 'Not reached' },
    { label: o.word.split(' ')[0].replace('AUTO-', ''), sub: d.days != null ? `Day ${d.days}` : '—', mark: o.mark },
  ]
  stepper(c, PAD + 24, 590, W - PAD * 2 - 48, steps, accent)

  const dY = 710
  c.strokeStyle = 'rgba(255,255,255,0.10)'; c.lineWidth = 1
  c.beginPath(); c.moveTo(PAD, dY); c.lineTo(W - PAD, dY); c.stroke()

  statRow(c, PAD, dY + 40, W - PAD * 2, d.stats || [
    { value: d.days != null ? `${d.days}d` : '—', label: 'To decision', color: C.white },
    { value: d.reachedInterview ? 'Yes' : 'No', label: 'Reached interview', color: d.reachedInterview ? C.green : 'rgba(255,255,255,0.85)' },
    { value: d.platform || 'Seen', label: 'Applied via', color: C.white },
  ])

  ctaBar(c, accent, 'Track your applications free  ·  seenjobs.io')
}
