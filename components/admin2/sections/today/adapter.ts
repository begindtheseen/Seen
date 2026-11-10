// Today's read, made safe for the screen (pure — today.test.mjs). The server answers `overview` per the
// contract (AdminOverview); anything missing or malformed becomes "couldn't read" (null), never 0, and
// the screen never crashes on a shape it did not expect.
import type { AdminOverview, AdminQueueKey, AdminSection } from '../../contract.ts'

export const QUEUE_LABEL: Record<AdminQueueKey, string> = {
  held_reports: 'Held reports',
  listing_tickets: 'Listing tickets',
  reddit_disputes: 'Reddit disputes',
  employer_claims: 'Employer claims',
  employer_replies: 'Employer replies',
  purchases_to_fulfil: 'Purchases to fulfil',
  data_issues: 'Data issues',
  account_clusters: 'Account clusters',
}

const QUEUE_SECTION: Record<AdminQueueKey, AdminSection> = {
  held_reports: 'review', listing_tickets: 'review', reddit_disputes: 'review', employer_claims: 'review',
  employer_replies: 'review', purchases_to_fulfil: 'review', data_issues: 'review', account_clusters: 'people',
}

/** Words for the stats the server names in `failed` (any other name is shown with spaces). */
const FAILED_LABEL: Record<string, string> = {
  listings_live: 'live listings', listings_stale: 'stale listings', reports_24h: 'new reports', signups_24h: 'new sign-ups',
  revenue_7d_cents: 'revenue', crons: 'scheduled jobs',
  ...Object.fromEntries(Object.entries(QUEUE_LABEL).map(([k, v]) => [k, v.toLowerCase()])),
}

export type TodayQueue = { key: string; label: string; count: number | null; section: AdminSection; filter?: Record<string, string> }
export type TodayView = {
  asOf: string | null
  degraded: boolean
  failedLabels: string[]
  stats: AdminOverview['stats']
  /** Queues with work (or an unreadable count), in the server's order. */
  waiting: TodayQueue[]
  /** Queues that read as zero — collapsed into one quiet line. */
  empty: TodayQueue[]
  system: { ok: boolean | null; line: string; failing: NonNullable<AdminOverview['system']['failing']> }
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const numOrNull = (v: unknown) => (isCount(v) ? v : null)

export function readToday(raw: unknown): TodayView {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<AdminOverview>
  const s = (o.stats || {}) as Partial<AdminOverview['stats']>
  const stats = {
    listings_live: numOrNull(s.listings_live),
    listings_stale: numOrNull(s.listings_stale),
    reports_24h: numOrNull(s.reports_24h),
    signups_24h: numOrNull(s.signups_24h),
    revenue_7d_cents: numOrNull(s.revenue_7d_cents),
  }
  const queues: TodayQueue[] = (Array.isArray(o.queues) ? o.queues : []).filter((q) => q && typeof q.key === 'string').map((q) => {
    const key = q.key as AdminQueueKey
    return {
      key,
      label: (typeof q.label === 'string' && q.label.trim()) || QUEUE_LABEL[key] || key.replace(/_/g, ' '),
      count: numOrNull(q.count),
      section: (q.section || QUEUE_SECTION[key] || 'review') as AdminSection,
      filter: q.filter && typeof q.filter === 'object' ? q.filter : undefined,
    }
  })
  const failed = Array.isArray(o.failed) ? o.failed.filter((f) => typeof f === 'string') : []
  const anyNull = Object.values(stats).some((v) => v === null) || queues.some((q) => q.count === null)
  const sys = (o.system || {}) as Partial<AdminOverview['system']>
  return {
    asOf: typeof o.as_of === 'string' ? o.as_of : null,
    degraded: !!o.degraded || failed.length > 0 || anyNull,
    failedLabels: [...new Set(failed.map((f) => FAILED_LABEL[f] || f.replace(/_/g, ' ')))],
    stats,
    waiting: queues.filter((q) => q.count === null || q.count > 0),
    empty: queues.filter((q) => q.count === 0),
    system: {
      ok: typeof sys.ok === 'boolean' ? sys.ok : null,
      line: typeof sys.line === 'string' && sys.line.trim() ? sys.line.trim() : 'The scheduled jobs could not be read.',
      failing: Array.isArray(sys.failing) ? sys.failing.filter((f) => f && typeof f.name === 'string') : [],
    },
  }
}

export function money(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** "Nothing waiting in: Reddit disputes, Employer claims and Data issues." */
export function emptyLine(empty: TodayQueue[]): string {
  const names = empty.map((q) => q.label)
  if (!names.length) return ''
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `Nothing waiting in ${list}.`
}
