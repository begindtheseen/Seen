// Listings, made safe for the screen (pure — listings.test.mjs). Every server shape the Listings section
// reads goes through here, so a shape change is a one-file edit. A number the server could not read is
// null ("couldn't read"), never 0.
import { formatPacific } from '../../../../lib/time/pacific.js'

export const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

// ── Counts ───────────────────────────────────────────────────────────────────────────────────────
export type ClearPlan = { will: number | null; stale: number | null; expired: number | null; aging: number | null; kept: number | null; expiredKept: number | null }

export type ListingCounts = {
  total: number | null
  active: number | null
  added_today: number | null
  stale_clearable: number | null
  expired_kept: number | null
  stale_overdue: number | null
  /** What Clear stale will do, from the server's exact reads (`clear_plan`); null when it could not be read. */
  plan: ClearPlan | null
  failed: string[]
}

export function readListingCounts(raw: unknown): ListingCounts {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const c = (o.counts && typeof o.counts === 'object' ? o.counts : {}) as Record<string, unknown>
  const out = {
    total: num(c.total), active: num(c.active), added_today: num(c.added_today),
    stale_clearable: num(c.stale_clearable), expired_kept: num(c.expired_kept), stale_overdue: num(c.stale_overdue),
  }
  const failed = Object.entries(out).filter(([, v]) => v === null).map(([k]) => k)
  const p = (o.clear_plan && typeof o.clear_plan === 'object' ? o.clear_plan : null) as Record<string, unknown> | null
  const plan = p ? { will: num(p.will_delete), stale: num(p.stale_delete), expired: num(p.expired_delete), aging: num(p.aging_delete), kept: num(p.kept_referenced), expiredKept: num(p.expired_kept_referenced) } : null
  return { ...out, plan, failed }
}

const COUNT_WORDS: Record<string, string> = {
  total: 'all listings', active: 'live listings', added_today: 'added today', stale_clearable: 'stale listings',
  expired_kept: 'expired listings', stale_overdue: 'long-unseen listings',
}
export const countWords = (keys: string[]) => keys.map((k) => COUNT_WORDS[k] || k.replace(/_/g, ' '))

// ── The browser's filters (all in the URL) ───────────────────────────────────────────────────────
export type BrowseUrl = { q: string; status: string; visible: string; employer: string; since: string; sort: string; source: string }

export const STATUS_OPTIONS = [
  { value: 'all', label: 'All' }, { value: 'active', label: 'Live' }, { value: 'stale', label: 'Stale' }, { value: 'expired', label: 'Expired' },
]
export const VISIBLE_OPTIONS = [{ value: '', label: 'On or off the site' }, { value: 'on', label: 'On the site' }, { value: 'off', label: 'Off the site' }]
export const EMPLOYER_OPTIONS = [{ value: '', label: 'Any poster' }, { value: 'only', label: 'Employer-posted only' }, { value: 'exclude', label: 'Not employer-posted' }]
export const SINCE_OPTIONS = [
  { value: '', label: 'Added any time' }, { value: 'today', label: 'Added today (California)' }, { value: '24h', label: 'Added in the last 24 hours' },
  { value: '7d', label: 'Added in the last 7 days' }, { value: '30d', label: 'Added in the last 30 days' },
]
export const SORT_OPTIONS = [{ value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' }, { value: 'seen', label: 'Recently seen by its source' }]

export type QueryKind = 'empty' | 'id' | 'url' | 'text'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: string) => UUID.test(v.trim())

/** What the owner typed: a listing id opens it, an apply link is looked up, anything else searches title and company. */
export function classifyQuery(q: string): QueryKind {
  const t = q.trim()
  if (!t) return 'empty'
  if (UUID.test(t)) return 'id'
  if (/^https?:\/\//i.test(t)) return 'url'
  return 'text'
}

/** The filters object listings_browse takes. Empty / "all" values are left out. */
export function browseFilters(u: BrowseUrl, limit = 100): Record<string, string | number> {
  const f: Record<string, string | number> = { limit }
  if (classifyQuery(u.q) === 'text') f.q = u.q.trim()
  if (u.status && u.status !== 'all') f.status = u.status
  if (u.visible === 'on' || u.visible === 'off') f.visible = u.visible
  if (u.employer === 'only' || u.employer === 'exclude') f.employer = u.employer
  if (u.since) f.since = u.since
  if (u.sort && u.sort !== 'newest') f.sort = u.sort
  if (u.source.trim()) f.source = u.source.trim()
  return f
}

/** The cache key for one filter combination (each is its own entry; `listings` touched re-reads them all). */
export function browseKey(u: BrowseUrl): string {
  const f = browseFilters(u)
  const parts = Object.keys(f).sort().map((k) => `${k}=${f[k]}`)
  return `listings?${parts.join('&')}`
}

export function activeFilterCount(u: BrowseUrl): number {
  return [u.status && u.status !== 'all', u.visible, u.employer, u.since, u.sort && u.sort !== 'newest', u.source.trim()].filter(Boolean).length
}

// ── A listing row ────────────────────────────────────────────────────────────────────────────────
export type JobRow = {
  id: string; title?: string | null; company?: string | null; location?: string | null; source?: string | null
  availability_status?: string | null; status?: string | null; created_at?: string | null; last_seen_at?: string | null
  expires_at?: string | null; apply_url?: string | null; is_employer_posted?: boolean | null; salary?: string | null
  salary_min?: number | null; salary_max?: number | null; remote?: boolean | null
}

export type Tone = 'good' | 'caution' | 'bad' | 'info' | 'neutral'

/** On the site = what search shows (expires in the future). Its own words, never a colour alone. */
export function jobState(j: JobRow, now = Date.now()): { label: string; tone: Tone } {
  const exp = j.expires_at ? Date.parse(j.expires_at) : NaN
  const onSite = Number.isFinite(exp) && exp > now
  const s = str(j.availability_status)
  if (!onSite) return { label: s === 'expired' ? 'Expired · off the site' : 'Off the site', tone: 'neutral' }
  if (s === 'stale') return { label: 'Stale · still on the site', tone: 'caution' }
  if (s === 'active') return { label: 'Live', tone: 'good' }
  return { label: s ? `${s[0].toUpperCase()}${s.slice(1)}` : 'Unknown state', tone: 'neutral' }
}

export function jobTitle(j: JobRow): string {
  const t = str(j.title).trim() || 'Untitled listing'
  const c = str(j.company).trim()
  return c ? `${t} — ${c}` : t
}

export function jobSub(j: JobRow): string {
  return [str(j.location).trim(), j.source ? `from ${j.source}` : '', j.is_employer_posted ? 'employer-posted' : ''].filter(Boolean).join(' · ')
}

const day = (iso?: string | null) => (iso ? formatPacific(iso, { dateStyle: 'medium' }) : '')
export function jobMeta(j: JobRow): string {
  return [j.created_at ? `added ${day(j.created_at)}` : '', j.last_seen_at ? `last seen ${day(j.last_seen_at)}` : 'never seen by its source'].filter(Boolean).join(' · ')
}

// ── Editing a listing (the fields the server allows: lib/server/jobAdmin.js EDITABLE) ─────────────
export type FieldDef = { key: string; label: string; kind: 'text' | 'long' | 'int' | 'url' | 'select' | 'bool' | 'date'; options?: string[] }
export const EDIT_FIELDS: FieldDef[] = [
  { key: 'title', label: 'Title', kind: 'text' },
  { key: 'company', label: 'Company', kind: 'text' },
  { key: 'location', label: 'Location', kind: 'text' },
  { key: 'apply_url', label: 'Apply link', kind: 'url' },
  { key: 'salary', label: 'Pay as written', kind: 'text' },
  { key: 'salary_min', label: 'Pay from (whole dollars)', kind: 'int' },
  { key: 'salary_max', label: 'Pay to (whole dollars)', kind: 'int' },
  { key: 'availability_status', label: 'Listing state', kind: 'select', options: ['active', 'stale', 'expired', 'unknown'] },
  { key: 'status', label: 'Hiring status', kind: 'select', options: ['active', 'closed', 'filled'] },
  { key: 'remote', label: 'Remote', kind: 'bool' },
  { key: 'job_type', label: 'Job type', kind: 'text' },
  { key: 'level', label: 'Level', kind: 'text' },
  { key: 'expires_at', label: 'Leaves the site on', kind: 'date' },
  { key: 'description', label: 'Description', kind: 'long' },
]

/** The form's starting values, as strings. */
export function formValues(job: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of EDIT_FIELDS) {
    const v = job[f.key]
    if (f.kind === 'bool') out[f.key] = v === true ? 'true' : v === false ? 'false' : ''
    else if (f.kind === 'date') out[f.key] = typeof v === 'string' && v ? v.slice(0, 10) : ''
    else out[f.key] = v == null ? '' : String(v)
  }
  return out
}

/** Only the fields the owner changed, typed for the server. A cleared optional field is null. */
export function buildPatch(before: Record<string, string>, after: Record<string, string>): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const f of EDIT_FIELDS) {
    const a = (after[f.key] ?? '').trim()
    const b = (before[f.key] ?? '').trim()
    if (a === b) continue
    if (f.kind === 'int') patch[f.key] = a === '' ? null : Number(a.replace(/[,$\s]/g, ''))
    else if (f.kind === 'bool') patch[f.key] = a === 'true'
    else if (f.kind === 'date') patch[f.key] = a === '' ? null : new Date(`${a}T23:59:59`).toISOString()
    else patch[f.key] = a === '' ? null : a
  }
  return patch
}

// ── Detail (job_detail) ──────────────────────────────────────────────────────────────────────────
export type Holder = { table: string; label: string; count: number | null }
export type JobDetail = {
  job: JobRow & Record<string, unknown>
  holders: Holder[]
  history: Array<{ id: string; action: string; username: string; created_at: string }>
  suppressed: { reason?: string | null; created_at?: string | null } | null
  onSite: boolean
}

export function readJobDetail(raw: unknown): JobDetail | null {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = (Array.isArray(o.rows) && o.rows[0] && typeof o.rows[0] === 'object' ? o.rows[0] : o) as Record<string, unknown>
  const job = d.job as JobDetail['job'] | undefined
  if (!job || typeof job !== 'object' || !job.id) return null
  const holders = (Array.isArray(d.holders) ? d.holders : []).map((h: Record<string, unknown>) => ({ table: str(h.table), label: str(h.label), count: num(h.count) }))
  const history = (Array.isArray(d.history) ? d.history : []).map((h: Record<string, unknown>) => ({ id: str(h.id), action: str(h.action), username: str(h.username) || 'admin', created_at: str(h.created_at) }))
  const supp = d.suppressed && typeof d.suppressed === 'object' ? d.suppressed as JobDetail['suppressed'] : null
  return { job, holders, history, suppressed: supp, onSite: d.on_site === true }
}

/** "Saved by 3 people · tracked by 1" — why a listing is never hard-deleted. */
export function holdersLine(holders: Holder[]): string {
  const parts: string[] = []
  const unread: string[] = []
  for (const h of holders) {
    if (h.count === null) { unread.push(h.label); continue }
    if (h.count > 0) parts.push(`${h.label} ${fmt(h.count)}×`)
  }
  const head = parts.length ? `Held by people: ${parts.join(' · ')}.` : 'Nobody has saved, tracked, applied to or reported this listing.'
  return unread.length ? `${head} Couldn't read: ${unread.join(', ')}.` : head
}

const ACTION_WORDS: Record<string, string> = {
  job_update: 'Edited', job_restore: 'Put back on the site', delete_listing: 'Taken down', dismiss_inactive_report: 'Reports cleared, listing kept',
  resolve_listing_dispute: 'Dispute resolved', undo: 'Undone',
}
export const historyWord = (action: string) => ACTION_WORDS[action] || action.replace(/_/g, ' ')

// ── Duplicate listings: the plan job_dupes_scan returns when complete ─────────────────────────────
export type DupeBrief = { id: string; title: string; company: string; location: string; source: string; status: string }
export type DupeGroup = { keep: DupeBrief; remove: DupeBrief[]; kept: DupeBrief[] }
export type DupePlan = { suspected: number | null; groups: number | null; protected: number | null; scanned: number | null; sample: DupeGroup[] }

const brief = (r: unknown): DupeBrief => {
  const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
  return { id: str(o.id), title: str(o.title) || 'Untitled', company: str(o.company), location: str(o.location), source: str(o.source), status: str(o.status ?? o.availability_status) }
}

export function readDupePlan(raw: unknown): DupePlan {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const groupsRaw = Array.isArray(o.sample) ? o.sample : Array.isArray(o.rows) ? o.rows : []
  const sample = groupsRaw.filter((g) => g && typeof g === 'object' && (g as Record<string, unknown>).keep).map((g) => {
    const x = g as Record<string, unknown>
    return { keep: brief(x.keep), remove: (Array.isArray(x.remove) ? x.remove : []).map(brief), kept: (Array.isArray(x.kept) ? x.kept : []).map(brief) }
  })
  return { suspected: num(o.suspected), groups: num(o.groups), protected: num(o.protected), scanned: num(o.scanned ?? o.total), sample }
}

export function planSentence(p: DupePlan): string {
  if (p.suspected === null) return 'The scan finished but the server did not say how many duplicates it found.'
  if (p.suspected === 0) return `No duplicate listings${p.scanned ? ` among ${fmt(p.scanned)} read` : ''}.`
  const groups = p.groups === null ? '' : ` in ${fmt(p.groups)} ${p.groups === 1 ? 'group' : 'groups'}`
  const prot = p.protected ? ` ${fmt(p.protected)} more ${p.protected === 1 ? 'copy is' : 'copies are'} kept because someone saved, tracked or applied to ${p.protected === 1 ? 'it' : 'them'}, or an employer posted ${p.protected === 1 ? 'it' : 'them'}.` : ''
  return `${fmt(p.suspected)} duplicate ${p.suspected === 1 ? 'listing' : 'listings'} can be removed${groups}.${prot}`
}

// ── Sources health (server: source_health) ──────────────────────────────────────────────────────
export type SourceRow = { source: string; live: number | null; added24: number | null; addedToday: number | null; lastSeen: string | null; failing: boolean | null; why: string | null; state: 'ok' | 'failing' | 'unknown'; line: string }

export function readSourceRow(r: unknown): SourceRow {
  const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
  const failing = typeof o.failing === 'boolean' ? o.failing : null
  const lastSeen = o.last_seen ? str(o.last_seen) : null
  const why = o.why ? str(o.why) : null
  const state: SourceRow['state'] = failing === null ? 'unknown' : failing ? 'failing' : 'ok'
  const seen = lastSeen ? `Last seen ${formatPacific(lastSeen)}.` : 'Never seen by its source.'
  const line = state === 'failing' ? `${why ? `${why[0].toUpperCase()}${why.slice(1)}${/[.!?]$/.test(why) ? '' : '.'} ` : ''}${seen}` : state === 'unknown' ? `Some counts couldn’t be read. ${lastSeen ? seen : ''}`.trim() : seen
  return { source: str(o.source) || 'unknown', live: num(o.live), added24: num(o.added_24h), addedToday: num(o.added_today), lastSeen, failing, why, state, line }
}

const n = (v: number | null, what: string) => (v === null ? `${what} couldn’t be read` : `${fmt(v)} ${what}`)
export function sourceCounts(r: SourceRow): string {
  return [n(r.live, 'live'), n(r.added24, 'added in 24 h'), n(r.addedToday, 'added today')].join(' · ')
}

export const SOURCE_STATE: Record<SourceRow['state'], { word: string; tone: Tone }> = {
  ok: { word: 'Working', tone: 'good' }, failing: { word: 'Failing', tone: 'bad' }, unknown: { word: 'Couldn’t read', tone: 'neutral' },
}

/** The Clear-stale confirm: the total AND its parts, from the server's plan; without a plan, it says what is not counted. */
export function staleConfirm(plan: ClearPlan | null, stale: number | null): { title: string; body: string } {
  const pl = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`
  if (plan && plan.will !== null) {
    const parts = [plan.stale ? pl(plan.stale, 'stale listing', 'stale listings') : '', plan.expired ? pl(plan.expired, 'expired listing', 'expired listings') : '', plan.aging ? pl(plan.aging, 'live listing its source hasn’t shown for 7 days', 'live listings their source hasn’t shown for 7 days') : '']
      .filter(Boolean)
    const list = parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
    const keep = plan.kept === null ? 'Listings someone saved or tracked are kept, hidden.' : plan.kept ? `${pl(plan.kept, 'listing someone saved or tracked is', 'listings someone saved or tracked are')} kept, hidden.` : 'Nobody saved or tracked any of them.'
    return { title: `Delete ${pl(plan.will, 'listing', 'listings')}?`, body: `${list ? `${list}, none of them saved by anyone. ` : ''}${keep}` }
  }
  return { title: stale === null ? 'Clear stale listings?' : `Clear ${pl(stale, 'stale listing', 'stale listings')} and any expired ones nobody saved?`, body: 'The full plan couldn’t be read, so the number deleted can be larger. Listings someone saved or tracked are kept, hidden.' }
}
