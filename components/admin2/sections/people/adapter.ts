// People, made safe for the screen (pure — people.test.mjs). Pro is a WINDOW (`pro_until`); setting it never
// touches a credit balance. A number the server could not read is null, never 0.
import { formatPacific, pacificDate } from '../../../../lib/time/pacific.js'

export const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

export type UserRow = { id: string; email: string | null; created_at: string | null; pro_until: string | null; pro_active: boolean; comped: boolean; balance: number | null }

export function readUser(r: unknown): UserRow {
  const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
  return { id: str(o.id), email: o.email ? str(o.email) : null, created_at: o.created_at ? str(o.created_at) : null, pro_until: o.pro_until ? str(o.pro_until) : null, pro_active: o.pro_active === true, comped: o.comped === true, balance: num(o.balance) }
}

const day = (iso: string) => formatPacific(iso, { dateStyle: 'medium' })

/** "Pro until Nov 24, 2026" / "Pro ended Oct 2, 2026" / "Never Pro" — from the window, in California days. */
export function proLine(u: Pick<UserRow, 'pro_until' | 'pro_active' | 'comped'>, now = Date.now()): string {
  const t = u.pro_until ? Date.parse(u.pro_until) : NaN
  if (Number.isFinite(t) && t > now) return `Pro until ${day(u.pro_until!)}`
  if (u.pro_active) return u.comped ? 'Pro (an old lifetime grant — end it to remove)' : 'Pro (an old flag, no end date)'
  if (Number.isFinite(t)) return `Pro ended ${day(u.pro_until!)}`
  return 'Never Pro'
}

export function userSub(u: UserRow): string {
  return [u.created_at ? `Joined ${day(u.created_at)}` : '', proLine(u), u.balance === null ? 'balance couldn’t be read' : `${fmt(u.balance)} ${u.balance === 1 ? 'credit' : 'credits'}`].filter(Boolean).join(' · ')
}

export const FILTERS = [
  { value: 'all', label: 'Everyone' }, { value: 'pro', label: 'Pro now' }, { value: 'free', label: 'Free' }, { value: 'new_today', label: 'Joined today' }, { value: 'new_week', label: 'Joined this week' },
]

// ── One account (user_detail) ────────────────────────────────────────────────────────────────────
export type LedgerLine = { delta: number | null; reason: string; note?: string | null; by?: string | null; created_at: string }
export type SignupSource = { landing_path: string | null; referrer_host: string | null; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; ref_code: string | null; first_seen_at: string | null; landing_group: string | null; referrer_group: string | null }
export type UserDetail = UserRow & { ledger: LedgerLine[]; applications: number | null; reports: number | null; earned: number | null; spent: number | null; signup: SignupSource | null }

export function readUserDetail(raw: unknown): UserDetail | null {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = Array.isArray(o.rows) && o.rows[0] && typeof o.rows[0] === 'object' ? o.rows[0] as Record<string, unknown> : null
  if (!d || !d.id) return null
  const ledger = (Array.isArray(d.ledger) ? d.ledger : []).map((l: Record<string, unknown>) => ({ delta: num(l.delta), reason: str(l.reason), note: l.note ? str(l.note) : null, by: l.by ? str(l.by) : null, created_at: str(l.created_at) }))
  const sg = d.signup_source && typeof d.signup_source === 'object' ? d.signup_source as Record<string, unknown> : null
  const signup = sg ? Object.fromEntries(['landing_path', 'referrer_host', 'utm_source', 'utm_medium', 'utm_campaign', 'ref_code', 'first_seen_at', 'landing_group', 'referrer_group'].map((k) => [k, sg[k] ? str(sg[k]) : null])) as SignupSource : null
  return { ...readUser(d), ledger, applications: num(d.applications), reports: num(d.reports), earned: num(d.credits_earned), spent: num(d.credits_spent), signup }
}

const REASONS: Record<string, string> = {
  admin_grant: 'Granted by an admin', purchase_interview: 'Bought Interview Prep', purchase_pass30: 'Bought the Job Search Pass',
  purchase_credits20: 'Bought a credit pack', daily: 'Daily free credit', daily_reset: 'Daily free credit', survey: 'Answered a survey',
  survey_answer: 'Answered a survey', spend: 'Used', ai_spend: 'Used on an AI tool',
}
export function ledgerWords(l: LedgerLine): string {
  const d = l.delta === null ? '' : l.delta > 0 ? `+${fmt(l.delta)}` : `−${fmt(Math.abs(l.delta))}`
  const why = REASONS[l.reason] || (l.reason.startsWith('purchase_') ? `Bought ${l.reason.slice(9).replace(/_/g, ' ')}` : l.reason.replace(/_/g, ' ') || 'No reason recorded')
  const tail = [l.note ? `“${l.note}”` : '', l.by ? `by ${l.by}` : ''].filter(Boolean).join(' ')
  return `${d} ${why}${tail ? ` — ${tail}` : ''}`.trim()
}

/** "Landed on /company/walmart from google.com (utm reddit / social / fall) · invite code X". */
export function signupWords(s: SignupSource | null): string {
  if (!s) return 'Not recorded — the account has no sign-up source row (accounts before the tracking started have none).'
  const from = s.referrer_host ? `from ${s.referrer_host}` : 'with no referring site (typed or bookmarked)'
  const utm = [s.utm_source, s.utm_medium, s.utm_campaign].filter(Boolean).join(' / ')
  return [`First page ${s.landing_path || 'unknown'} ${from}`, utm ? `tagged link: ${utm}` : '', s.ref_code ? `invite code ${s.ref_code}` : '', s.first_seen_at ? `first visit ${formatPacific(s.first_seen_at)}` : ''].filter(Boolean).join(' · ') + '.'
}

/** The ISO end of a California day picked in a date field ("2026-11-24" → that day's last second, PT). */
export function endOfPacificDay(ymd: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null
  // Find the UTC instant whose California date is ymd and is the latest second of it.
  const [y, m, d] = ymd.split('-').map(Number)
  for (const offset of [7, 8]) {
    const t = Date.UTC(y, m - 1, d + 1, offset, 0, 0) - 1000
    if (pacificDate(new Date(t)) === ymd && pacificDate(new Date(t + 1000)) !== ymd) return new Date(t).toISOString()
  }
  return null
}

/** Today + n days as a California date string, for the date field. */
export function pacificPlusDays(n: number, now = new Date()): string {
  return pacificDate(new Date(now.getTime() + n * 86_400_000))
}

// ── Sign-up sources (signup_attribution) ─────────────────────────────────────────────────────────
export type SourceGroup = { key: string; label: string; signups: number; tracked: number; pro_or_trial: number; paid: number | null }
export type Attribution = { ready: boolean; days: number | null; total: SourceGroup | null; groups: Array<{ title: string; what: string; rows: SourceGroup[] }>; paidNote: string | null }

const group = (g: unknown, fallback = ''): SourceGroup => {
  const o = (g && typeof g === 'object' ? g : {}) as Record<string, unknown>
  return { key: str(o.key ?? o.slug ?? fallback), label: str(o.label ?? o.name ?? o.key ?? fallback), signups: num(o.signups) ?? 0, tracked: num(o.tracked) ?? 0, pro_or_trial: num(o.pro_or_trial) ?? 0, paid: num(o.paid) }
}

export function readAttribution(raw: unknown): Attribution {
  const o0 = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const o = (o0.report && typeof o0.report === 'object' ? o0.report : o0) as Record<string, unknown>
  if (o.ready === false) return { ready: false, days: num(o.days), total: null, groups: [], paidNote: null }
  const list = (k: string) => (Array.isArray(o[k]) ? o[k] as unknown[] : []).map((g) => group(g))
  return {
    ready: true,
    days: num(o.days),
    total: o.total ? group(o.total, 'total') : null,
    paidNote: o.paid_note ? str(o.paid_note) : null,
    groups: [
      { title: 'First page they landed on', what: 'the page of their first visit', rows: list('by_landing') },
      { title: 'Where they came from', what: 'the site that sent them (referrer)', rows: list('by_referrer') },
      { title: 'Company pages that brought sign-ups', what: 'first visit on that company’s page', rows: list('top_companies') },
      { title: 'Campaign source (utm_source)', what: 'from a tagged link', rows: list('by_utm_source').filter((g) => g.key !== '(none)') },
    ].filter((g) => g.rows.length),
  }
}

// ── Account clusters ─────────────────────────────────────────────────────────────────────────────
export type Cluster = { id: string; users: Array<{ id: string; email: string | null }>; signals: string[]; risk: number | null; status: string; note: string | null; created_at: string | null }
export const CLUSTER_STATUSES = ['suspected', 'watching', 'safe', 'limited', 'frozen', 'suspended']
export const CLUSTER_WORDS: Record<string, string> = {
  suspected: 'Suspected — not judged yet', watching: 'Watching', safe: 'Safe — different people', limited: 'Limited', frozen: 'Frozen', suspended: 'Suspended',
}

export function readCluster(c: unknown): Cluster {
  const o = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>
  const ids = Array.isArray(o.user_ids) ? o.user_ids.map(str) : []
  const users = Array.isArray(o.users) ? (o.users as Record<string, unknown>[]).map((u) => ({ id: str(u.id), email: u.email ? str(u.email) : null })) : ids.map((id) => ({ id, email: null }))
  return { id: str(o.id), users, signals: Array.isArray(o.signals) ? o.signals.map(str) : [], risk: num(o.risk_score), status: str(o.status) || 'suspected', note: o.admin_note ? str(o.admin_note) : null, created_at: o.created_at ? str(o.created_at) : null }
}

/** "ip:1.2.3.4" → "Same sign-in address 1.2.3.4". */
export function signalWords(s: string): string {
  if (s.startsWith('ip:')) return `Signed in from the same address (${s.slice(3)})`
  if (s.startsWith('device:')) return `Same device (${s.slice(7)})`
  return s
}
