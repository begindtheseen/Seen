// System, made safe for the screen (pure — system.test.mjs): cron schedules in plain words (California
// time), cron rows, flags, errors, the activity log, revenue. Unknown stays unknown — never a guess.
import { formatPacific, pacificParts } from '../../../../lib/time/pacific.js'

export const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

// ── Cron schedules in words ──────────────────────────────────────────────────────────────────────
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** A UTC hour:minute as a California clock time on `ref`'s date ("7:20 AM"). */
export function pacificClock(hourUtc: number, minute: number, ref = new Date()): string {
  const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), hourUtc, minute))
  const p = pacificParts(d)
  const h12 = ((p.hour + 11) % 12) + 1
  return `${h12}:${String(p.minute).padStart(2, '0')} ${p.hour < 12 ? 'AM' : 'PM'}`
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const ints = (f: string) => (f.split(',').every((x) => /^\d+$/.test(x)) ? f.split(',').map(Number) : null)

/** One 5-field cron (UTC, Vercel's clock) in words, times in California. Anything unusual is shown as written. */
export function cronOneInWords(expr: string, ref = new Date()): string {
  const f = expr.trim().split(/\s+/)
  if (f.length !== 5) return expr
  const [mi, hr, dom, mon, dow] = f
  const minutes = ints(mi)
  if (!minutes || mon !== '*') return `${expr} (UTC)`
  if (hr === '*' && dom === '*' && dow === '*') return minutes.length === 1 ? `Every hour at :${String(minutes[0]).padStart(2, '0')}` : `Every hour at ${list(minutes.map((m) => `:${String(m).padStart(2, '0')}`))}`
  const step = /^\*\/(\d+)$/.exec(hr)
  if (step && dom === '*' && dow === '*' && minutes.length === 1) return `Every ${step[1]} hours`
  const hours = ints(hr)
  if (!hours || minutes.length !== 1) return `${expr} (UTC)`
  // In California order (the UTC hours wrap past midnight).
  const pt = (h: number) => { const p = pacificParts(new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), h, minutes[0]))); return p.hour * 60 + p.minute }
  const times = list([...hours].sort((a, b) => pt(a) - pt(b)).map((h) => pacificClock(h, minutes[0], ref)))
  if (dom === '*' && dow === '*') return `Every day at ${times}`
  const days = ints(dow)
  if (dom === '*' && days) return `Every ${list(days.map((d) => DAYS[d % 7]))} at ${times}`
  const doms = ints(dom)
  if (doms && dow === '*') return `On day ${list(doms.map(String))} of each month at ${times}`
  return `${expr} (UTC)`
}

/** The server joins several schedules for one path with ";" (or puts several hours in one field). */
export function cronInWords(schedule: string, ref = new Date()): string {
  const parts = schedule.split(';').map((s) => s.trim()).filter(Boolean)
  if (!parts.length) return 'No schedule'
  return parts.map((p) => cronOneInWords(p, ref)).join('; ')
}

// ── Cron rows ────────────────────────────────────────────────────────────────────────────────────
export type CronRow = { name: string; path: string; schedule: string; last_run: string | null; last_result: 'ok' | 'failed' | 'partial' | 'unknown'; next_run: string | null; overdue: boolean; detail: string }
export function readCron(r: unknown): CronRow {
  const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
  const lr = str(o.last_result)
  return { name: str(o.name) || str(o.path), path: str(o.path), schedule: str(o.schedule), last_run: o.last_run ? str(o.last_run) : null, last_result: (['ok', 'failed', 'partial'].includes(lr) ? lr : 'unknown') as CronRow['last_result'], next_run: o.next_run ? str(o.next_run) : null, overdue: o.overdue === true, detail: str(o.detail) }
}

export type Tone = 'good' | 'caution' | 'bad' | 'info' | 'neutral'
export function cronState(c: CronRow): { word: string; tone: Tone } {
  if (c.overdue) return { word: 'Overdue', tone: 'bad' }
  if (c.last_result === 'failed') return { word: 'Failed', tone: 'bad' }
  if (c.last_result === 'partial') return { word: 'Partly done', tone: 'caution' }
  if (c.last_result === 'ok') return { word: 'On time', tone: 'good' }
  return { word: 'No run recorded yet', tone: 'neutral' }
}

export function cronLines(c: CronRow): string[] {
  return [
    c.last_run ? `Last run ${formatPacific(c.last_run)}` : 'No run recorded yet — nothing writes this job’s runs down, so it is not known whether it ran.',
    c.next_run ? `Next ${formatPacific(c.next_run)}` : '',
  ].filter(Boolean)
}

export function cronSummary(rows: CronRow[]): string {
  const bad = rows.filter((c) => c.overdue || c.last_result === 'failed')
  const unknown = rows.filter((c) => c.last_result === 'unknown' && !c.overdue)
  const known = rows.length - unknown.length
  if (!rows.length) return 'No scheduled jobs were listed.'
  if (bad.length) return `${fmt(bad.length)} of ${fmt(rows.length)} scheduled jobs need a look: ${list(bad.slice(0, 3).map((c) => c.name))}${bad.length > 3 ? ' and more' : ''}.`
  if (!known) return `None of the ${fmt(rows.length)} scheduled jobs records its runs yet, so none can be called on time.`
  return `${fmt(known)} of ${fmt(rows.length)} scheduled jobs record their runs and none of those is late. ${fmt(unknown.length)} record nothing yet.`
}

// ── Flags ────────────────────────────────────────────────────────────────────────────────────────
// Every flag the code reads is on/off in practice: each reader treats ANY setting other than "off" as on for
// everyone (lib/server/credits.js, api/optimizer.js) — "beta users" or "a share of users" target nobody.
// So the screen offers On / Off and says what an odd stored setting really does.
export type Flag = { name: string; label: string; status: string | null; percentage: number; readers: string[]; dangerous: boolean; exists: boolean; updated_by: string | null; updated_at: string | null }
const STORED_WORDS: Record<string, string> = { off: 'Off', admin_only: 'Admins only', beta_users: 'Beta users', percentage_rollout: 'A share of users', fully_on: 'On', on: 'On' }

type FlagInfo = { does: string; whenOff: string; defaultOn: boolean; env?: string }
const FLAG_INFO: Record<string, FlagInfo> = {
  ai_credit_system_enabled: { does: 'Paid AI tools cost credits.', whenOff: 'everyone gets paid features free', defaultOn: false },
  seenfit_engine_enabled: { does: 'Optimize runs the SeenFit résumé engine.', whenOff: 'Optimize is switched off', defaultOn: true, env: 'SEENFIT_ENGINE_ENABLED' },
  humanproof_enabled: { does: 'HumanProof (the optimizer’s rewrite into the person’s own voice) is available.', whenOff: 'HumanProof is switched off', defaultOn: true, env: 'HUMANPROOF_ENABLED' },
  humanproof_paid_only: { does: 'HumanProof only for accounts that paid.', whenOff: 'HumanProof follows its own switch for everyone', defaultOn: false, env: 'HUMANPROOF_PAID_ONLY' },
  local_humanizer_model_enabled: { does: 'HumanProof may use a local model (a stub today: it calls nothing outside).', whenOff: 'no local model', defaultOn: false, env: 'LOCAL_HUMANIZER_MODEL_ENABLED' },
}

export function readFlags(raw: unknown): { flags: Flag[]; unread: string[] } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const flags = (Array.isArray(o.rows) ? o.rows : []).filter((f) => f && typeof f === 'object').map((f) => {
    const x = f as Record<string, unknown>
    return { name: str(x.flag_name), label: str(x.label || x.description || x.flag_name), status: x.status ? str(x.status) : null, percentage: num(x.percentage) ?? 0, readers: Array.isArray(x.readers) ? x.readers.map(str) : [], dangerous: x.dangerous === true, exists: x.exists !== false, updated_by: x.updated_by ? str(x.updated_by) : null, updated_at: x.updated_at ? str(x.updated_at) : null }
  })
  return { flags, unread: Array.isArray(o.unread) ? o.unread.map(str) : [] }
}

export const flagDoes = (f: Flag) => FLAG_INFO[f.name]?.does || f.label
export const flagEnv = (f: Flag) => FLAG_INFO[f.name]?.env || null

/** Is the flag in effect, as its reader decides (no row → the reader's default; any non-"off" → on). */
export function flagIsOn(f: Flag): boolean {
  if (!f.exists || !f.status) return FLAG_INFO[f.name]?.defaultOn ?? false
  return f.status !== 'off'
}

export function flagStateWords(f: Flag): string {
  const on = flagIsOn(f)
  if (!f.exists || !f.status) return `${on ? 'On' : 'Off'} — not set, so the code uses its default`
  if (f.status === 'off' || f.status === 'fully_on' || f.status === 'on') return on ? 'On' : 'Off'
  return `On — stored as “${STORED_WORDS[f.status] || f.status}”, which the code treats as on for everyone`
}

/** The dangerous flag's plain consequence for the confirm step. */
export function dangerConsequence(f: Flag, turnOn: boolean): string {
  if (f.name === 'ai_credit_system_enabled') return turnOn ? 'Paid AI tools cost credits again for everyone.' : 'Everyone gets paid features free until you turn it back on.'
  const info = FLAG_INFO[f.name]
  return turnOn ? `${info?.does || f.label} — for everyone.` : `${info ? info.whenOff[0].toUpperCase() + info.whenOff.slice(1) : f.label} — for everyone.`
}

// ── Errors ───────────────────────────────────────────────────────────────────────────────────────
export function readRoutes(raw: unknown): { total: number | null; routes: Array<{ route: string; count: number }> } | null {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (!o.by_route || typeof o.by_route !== 'object') return null
  const routes = Object.entries(o.by_route as Record<string, unknown>).map(([route, c]) => ({ route, count: num(c) ?? 0 })).sort((a, b) => b.count - a.count)
  return { total: num(o.total_24h), routes }
}

// ── Activity log ─────────────────────────────────────────────────────────────────────────────────
export type ActivityRow = { id: string; at: string; admin: string; action: string; target_kind: string | null; target_id: string | null; summary: string; undoable: boolean }
export function readActivity(r: unknown): ActivityRow {
  const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
  return { id: str(o.id), at: str(o.at), admin: str(o.admin) || 'admin', action: str(o.action), target_kind: o.target_kind ? str(o.target_kind) : null, target_id: o.target_id != null ? str(o.target_id) : null, summary: str(o.summary) || str(o.action).replace(/_/g, ' '), undoable: o.undoable === true }
}
const OPENABLE = new Set(['report', 'job', 'company', 'user', 'ticket', 'dispute', 'claim', 'reply', 'purchase', 'issue', 'cluster'])
export const canOpen = (a: ActivityRow) => !!a.target_kind && !!a.target_id && OPENABLE.has(a.target_kind)

export const ACTION_FILTERS = [
  { value: '', label: 'Every action' }, { value: 'review_held', label: 'Held reports decided in bulk' }, { value: 'moderate_report', label: 'One report moderated' },
  { value: 'merge_companies', label: 'Companies merged' }, { value: 'delete_listing', label: 'Listings taken down' }, { value: 'job_update', label: 'Listings edited' },
  { value: 'purge_stale_jobs', label: 'Stale listings cleared' }, { value: 'dedupe_jobs', label: 'Duplicate listings removed' },
  { value: 'set_pro_window', label: 'Pro windows set' }, { value: 'grant_credits', label: 'Credits granted' }, { value: 'delete_user', label: 'Accounts deleted' },
  { value: 'set_flag', label: 'Flags changed' }, { value: 'undo', label: 'Undos' }, { value: 'login', label: 'Sign-ins' },
]

// ── Revenue (one-time purchases only) ────────────────────────────────────────────────────────────
export type Revenue = { days: number | null; total: number | null; consumer: Array<{ sku: string; name: string; count: number | null; cents: number | null }>; employer: number | null; source: string }
export function readRevenue(raw: unknown): Revenue | null {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const r = Array.isArray(o.rows) && o.rows[0] && typeof o.rows[0] === 'object' ? o.rows[0] as Record<string, unknown> : null
  if (!r) return null
  return {
    days: num(r.days), total: num(r.total_cents), employer: num(r.employer_cents), source: str(r.source),
    consumer: (Array.isArray(r.consumer) ? r.consumer : []).map((c: Record<string, unknown>) => ({ sku: str(c.sku), name: str(c.name) || str(c.sku), count: num(c.count), cents: num(c.cents) })),
  }
}
export const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export type FunnelStep = { key: string; label: string; n: number | null }
export function readFunnel(raw: unknown): FunnelStep[] {
  const o0 = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const o = (o0.report && typeof o0.report === 'object' ? o0.report : o0) as Record<string, unknown>
  return (Array.isArray(o.steps) ? o.steps : []).map((s: Record<string, unknown>) => ({ key: str(s.key), label: str(s.label), n: num(s.n) }))
}
