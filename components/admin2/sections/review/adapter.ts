// Review's reads, made safe for the screen (pure — review.test.mjs). Every server shape the Review
// section reads passes through here, so a shape change is a one-file edit. A count the server could
// not read stays `null` ("couldn't read"), never 0; a filter over loaded rows says how many it covers.
import type { AdminItemKind, AdminOverview, AdminQueueKey } from '../../contract.ts'
import { formatPacific } from '../../../../lib/time/pacific.js'
import { httpHref } from '../../../../lib/safeHref.js'

// ── Kinds ────────────────────────────────────────────────────────────────────────────────────────

export type KindKey = 'held' | 'recent' | 'dupes' | 'tickets' | 'disputes' | 'claims' | 'replies' | 'purchases' | 'issues' | 'clusters'

export type KindDef = {
  key: KindKey
  label: string
  /** The overview queue that counts what is waiting (null = not a queue: nothing "waits" there). */
  queue: AdminQueueKey | null
  /** What a row opens in the sheet. */
  item: AdminItemKind | null
}

export const KINDS: KindDef[] = [
  { key: 'held', label: 'Held reports', queue: 'held_reports', item: 'report' },
  { key: 'recent', label: 'Recent reports', queue: null, item: 'report' },
  { key: 'dupes', label: 'Duplicate reports', queue: null, item: null },
  { key: 'tickets', label: 'Listing tickets', queue: 'listing_tickets', item: 'ticket' },
  { key: 'disputes', label: 'Reddit disputes', queue: 'reddit_disputes', item: 'dispute' },
  { key: 'claims', label: 'Employer claims', queue: 'employer_claims', item: 'claim' },
  { key: 'replies', label: 'Employer replies', queue: 'employer_replies', item: 'reply' },
  { key: 'purchases', label: 'Purchases to fulfil', queue: 'purchases_to_fulfil', item: 'purchase' },
  { key: 'issues', label: 'Data issues', queue: 'data_issues', item: 'issue' },
  { key: 'clusters', label: 'Account clusters', queue: 'account_clusters', item: 'cluster' },
]

// Older links and the fixture used other words for the same kinds; never land on nothing.
const KIND_ALIAS: Record<string, KindKey> = {
  reports: 'held', held_reports: 'held', listings: 'tickets', listing_tickets: 'tickets', reddit: 'disputes',
  reddit_disputes: 'disputes', employers: 'claims', employer_claims: 'claims', employer_replies: 'replies',
  purchases_to_fulfil: 'purchases', data_issues: 'issues', account_clusters: 'clusters', duplicates: 'dupes',
}

export function parseKind(raw: string | null | undefined): KindKey {
  const v = String(raw || '').trim().toLowerCase()
  if (KINDS.some((k) => k.key === v)) return v as KindKey
  return KIND_ALIAS[v] || 'held'
}

export const kindDef = (k: KindKey): KindDef => KINDS.find((d) => d.key === k) || KINDS[0]

/**
 * What a kind's chip shows: a number, `null` (the server could not count it), or `undefined` (not a
 * queue, or not read yet). The held list, once read, is the exact count and wins over the overview.
 */
export function kindCount(kind: KindKey, overview: Partial<AdminOverview> | undefined, heldTotal?: number | null): number | null | undefined {
  if (kind === 'held' && typeof heldTotal === 'number') return heldTotal
  const def = kindDef(kind)
  if (!def.queue || !overview || !Array.isArray(overview.queues)) return undefined
  const q = overview.queues.find((x) => x && x.key === def.queue)
  if (!q) return undefined
  return typeof q.count === 'number' && Number.isFinite(q.count) ? q.count : null
}

/**
 * The queues the header sentence adds up — exactly the ones the shell's Review badge adds up (core/AdminApp:
 * every overview queue whose `section` is 'review'), so the badge and the sentence are always the same number.
 * Account clusters belong to People there; their chip stays here, outside the total.
 */
export function reviewQueues(overview: Partial<AdminOverview> | undefined): Array<{ label: string; count: number | null }> {
  if (!overview || !Array.isArray(overview.queues)) return []
  return overview.queues.filter((q) => q && q.section === 'review').map((q) => ({ label: q.label, count: typeof q.count === 'number' && Number.isFinite(q.count) ? q.count : null }))
}

/** The header line: how much is waiting across every queue, and which counts could not be read. */
export function waitingLine(counts: Array<{ label: string; count: number | null | undefined }>): string {
  const known = counts.filter((c) => typeof c.count === 'number') as Array<{ label: string; count: number }>
  const unread = counts.filter((c) => c.count === null).map((c) => c.label.toLowerCase())
  const total = known.reduce((a, c) => a + c.count, 0)
  const head = total === 0 ? 'Nothing is waiting for a decision.' : `${fmt(total)} ${total === 1 ? 'decision is' : 'decisions are'} waiting.`
  return unread.length ? `${head} Couldn't count ${listWords(unread)}.` : head
}

// ── Numbers, dates, words ────────────────────────────────────────────────────────────────────────

export const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
export const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`

export function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] || ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** "Nov 10, 9:02 AM PT" — California time, always. Empty when the date is missing or unreadable. */
export function when(iso: unknown): string {
  if (typeof iso !== 'string' || !iso) return ''
  return formatPacific(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
/** "Nov 10, 2026" (California). */
export function day(iso: unknown): string {
  if (typeof iso !== 'string' || !iso) return ''
  return formatPacific(iso, { dateStyle: 'medium' })
}

export function snippet(text: unknown, max = 160): string {
  const s = String(text || '').replace(/\s*\[Source:[^\]]*\]\s*$/, '').replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s
}

const words = (s: unknown) => String(s || '').replace(/[_-]+/g, ' ').trim()

/** "interview_received" → "Interview received". */
export function label(s: unknown): string {
  const w = words(s)
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : ''
}

export type Tone = 'good' | 'caution' | 'bad' | 'info' | 'neutral'

const GOOD_OUTCOMES = new Set(['hired', 'offer', 'offer_received', 'interview', 'interview_received', 'interview_completed', 'responded', 'response_received', 'human', 'screening'])
const BAD_OUTCOMES = new Set(['ghosted', 'ghost', 'no_response', 'autoreject', 'rejected', 'rejection'])
/** An outcome as a tone (shown with its word and icon, never colour alone). */
export function outcomeTone(outcome: unknown): Tone {
  const o = String(outcome || '').toLowerCase()
  if (GOOD_OUTCOMES.has(o)) return 'good'
  if (BAD_OUTCOMES.has(o)) return 'bad'
  return 'neutral'
}

/** The http(s) link a report cites (its stored source URL or the first URL in its text), safe for an href. */
export function sourceHref(row: { review?: { sourceUrl?: string | null } | null; report_text?: unknown } | null | undefined): string | null {
  const direct = row?.review?.sourceUrl
  if (direct) { const h = httpHref(direct); if (h) return h }
  const m = /https?:\/\/[^\s\])"']+/i.exec(String(row?.report_text || ''))
  return m ? httpHref(m[0]) : null
}

// ── Held reports ─────────────────────────────────────────────────────────────────────────────────

export type HeldRow = {
  id: string
  company_name?: string | null
  outcome?: string | null
  role?: string | null
  platform?: string | null
  source?: string | null
  created_at?: string | null
  report_text?: string | null
  outcome_weight?: number | null
  trust_reason?: string | null
  needs_review?: boolean
  /** Present when the server runs the strict first-hand rules on held rows too. */
  rules?: 'passes' | 'fails' | null
  review?: { kind?: string; positive?: boolean; group?: 'needs_eyes' | 'positive' | 'employee_review'; sourceUrl?: string | null; flags?: string[] } | null
}

export const flagsOf = (r: HeldRow): string[] => (Array.isArray(r.review?.flags) ? r.review!.flags! : [])
export const isDuplicate = (r: HeldRow) => flagsOf(r).includes('possible_duplicate')
export const groupOf = (r: HeldRow) => r.review?.group || 'needs_eyes'

export type HeldView = 'all' | 'needs_eyes' | 'positive' | 'duplicates' | 'anti_gaming' | 'employee' | 'no_source' | 'rules_fail'

export const HELD_VIEWS: Array<{ value: HeldView; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'needs_eyes', label: 'Needs your eyes' },
  { value: 'positive', label: 'Clear positives' },
  { value: 'duplicates', label: 'Possible duplicates' },
  { value: 'anti_gaming', label: 'Anti-gaming holds' },
  { value: 'employee', label: 'Employee reviews' },
  { value: 'no_source', label: 'No source link' },
  { value: 'rules_fail', label: 'Failing the rules check' },
]

export function parseHeldView(raw: string | null | undefined): HeldView {
  return (HELD_VIEWS.some((v) => v.value === raw) ? raw : 'all') as HeldView
}

export function matchesHeldView(r: HeldRow, view: HeldView): boolean {
  switch (view) {
    case 'needs_eyes': return groupOf(r) === 'needs_eyes'
    case 'positive': return groupOf(r) === 'positive'
    case 'duplicates': return isDuplicate(r)
    case 'anti_gaming': return flagsOf(r).includes('anti_gaming_hold')
    case 'employee': return groupOf(r) === 'employee_review'
    case 'no_source': return flagsOf(r).includes('no_source_link')
    case 'rules_fail': return r.rules === 'fails'
    default: return true
  }
}

/** Does the server tell us the rules result on held rows? (Only then is that filter offered.) */
export const heldHasRules = (rows: HeldRow[]) => rows.some((r) => r.rules === 'passes' || r.rules === 'fails')

export function matchesQuery(fields: unknown[], q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return fields.some((f) => String(f ?? '').toLowerCase().includes(needle))
}

export const heldSearchFields = (r: HeldRow) => [r.company_name, r.role, r.platform, r.outcome, r.report_text, r.id]

/** The count each saved filter would show, over the rows that are loaded. */
export function heldViewCounts(rows: HeldRow[]): Record<HeldView, number> {
  const out = Object.fromEntries(HELD_VIEWS.map((v) => [v.value, 0])) as Record<HeldView, number>
  for (const r of rows) for (const v of HELD_VIEWS) if (matchesHeldView(r, v.value)) out[v.value]++
  return out
}

/** Ids "Approve all positive" sends (duplicates included — the server skips and names them). */
export const positiveIds = (rows: HeldRow[]) => rows.filter((r) => groupOf(r) === 'positive').map((r) => r.id)

/** Rows a bulk approve will actually change (the server skips possible duplicates unless asked). */
export function approvableIds(rows: HeldRow[], ids: string[], includeDuplicates = false): string[] {
  if (includeDuplicates) return ids
  const dup = new Set(rows.filter(isDuplicate).map((r) => r.id))
  return ids.filter((id) => !dup.has(id))
}

export type ApprovePlan = {
  /** Ids that will be published. */
  ids: string[]
  /** Send include_duplicates (only when the owner ticked a possible duplicate himself). */
  includeDuplicates: boolean
  /** What stays for the owner to read, by reason. */
  heldBack: { duplicates: number; antiGaming: number; needsEyes: number; employee: number }
  /** "140 clear positives will be published · 24 possible duplicates and 29 anti-gaming holds stay for you to read." */
  sentence: string
}

/**
 * What a bulk approve publishes (audit AB #7: "Approve all (319)" published 119 needs-your-eyes rows and
 * 29 anti-gaming holds behind one confirm). Anti-gaming holds and possible duplicates are NEVER in a bulk
 * approve unless the owner ticked that row himself (`picked`). `scope`: 'positive' = the clear positives
 * only; 'selection' = the selected rows.
 */
export function approvePlan(rows: HeldRow[], scope: 'positive' | 'selection', selected: Set<string> = new Set(), picked: Set<string> = new Set()): ApprovePlan {
  const pool = scope === 'positive' ? rows.filter((r) => groupOf(r) === 'positive') : rows.filter((r) => selected.has(r.id))
  const ids: string[] = []
  const heldBack = { duplicates: 0, antiGaming: 0, needsEyes: 0, employee: 0 }
  let includeDuplicates = false
  for (const r of pool) {
    const own = picked.has(r.id)
    if (flagsOf(r).includes('anti_gaming_hold') && !own) { heldBack.antiGaming++; continue }
    if (isDuplicate(r) && !own) { heldBack.duplicates++; continue }
    if (isDuplicate(r)) includeDuplicates = true
    ids.push(r.id)
  }
  if (scope === 'positive') {
    for (const r of rows) {
      if (groupOf(r) === 'positive') continue
      if (flagsOf(r).includes('anti_gaming_hold')) heldBack.antiGaming++
      else if (groupOf(r) === 'employee_review') heldBack.employee++
      else heldBack.needsEyes++
    }
  }
  const pub = ids.length
  const what = scope === 'positive' ? (pub === 1 ? 'clear positive' : 'clear positives') : (pub === 1 ? 'report' : 'reports')
  const stay = [
    heldBack.duplicates ? plural(heldBack.duplicates, 'possible duplicate') : '',
    heldBack.antiGaming ? plural(heldBack.antiGaming, 'anti-gaming hold') : '',
    heldBack.needsEyes ? `${fmt(heldBack.needsEyes)} that ${heldBack.needsEyes === 1 ? 'needs' : 'need'} your eyes` : '',
    heldBack.employee ? plural(heldBack.employee, 'employee review') : '',
  ].filter(Boolean)
  const head = pub ? `${fmt(pub)} ${what} will be published` : 'Nothing here can be published in bulk'
  const stays = heldBack.duplicates + heldBack.antiGaming + heldBack.needsEyes + heldBack.employee === 1 ? 'stays' : 'stay'
  const tail = stay.length ? ` · ${listWords(stay)} ${stays} for you to read${scope === 'selection' && (heldBack.duplicates || heldBack.antiGaming) ? ' (tick one yourself to include it)' : ''}` : ''
  return { ids, includeDuplicates, heldBack, sentence: `${head}${tail}.` }
}

/** What the held list shows under its filters: "Showing 120 of 343 held reports (all loaded)". */
export function filterNote(shown: number, loaded: number, opts: { total?: number | null; truncated?: boolean; filtered: boolean; noun: string }): string {
  const { total, truncated, filtered, noun } = opts
  if (truncated) {
    return filtered
      ? `Filtering the ${fmt(loaded)} loaded ${noun}: ${fmt(shown)} match. More exist than could be loaded at once.`
      : `Showing the first ${fmt(loaded)} ${noun}. More exist than could be loaded at once.`
  }
  if (!filtered) return `${fmt(loaded)} ${noun}, all loaded.`
  return `${fmt(shown)} of ${fmt(typeof total === 'number' ? total : loaded)} ${noun} match — every held report is loaded, so this covers them all.`
}

/** Keep only ids still on screen (rows decided elsewhere leave the selection too). */
export function pruneSelection(selected: Set<string>, rows: Array<{ id: string }>): Set<string> {
  const have = new Set(rows.map((r) => r.id))
  let changed = false
  const out = new Set<string>()
  for (const id of selected) { if (have.has(id)) out.add(id); else changed = true }
  return changed ? out : selected
}

/** The server takes at most this many ids per press (lib/server/admin/review.js MAX_BULK_IDS). */
export const MAX_BULK = 5000

export const FLAG_TEXT: Record<string, { label: string; tone: Tone }> = {
  possible_duplicate: { label: 'Possible duplicate', tone: 'caution' },
  anti_gaming_hold: { label: 'Anti-gaming hold', tone: 'caution' },
  not_a_hiring_outcome: { label: 'Employee review', tone: 'info' },
  no_source_link: { label: 'No source link', tone: 'neutral' },
}

export const GROUP_TEXT: Record<string, string> = {
  needs_eyes: 'Needs your eyes',
  positive: 'Clear positive',
  employee_review: 'Employee review',
}

/** Why a row is held, in words (trust_reason + group). */
export function heldWhy(r: HeldRow): string {
  const tr = String(r.trust_reason || '')
  const byReason: Record<string, string> = {
    external_import: 'Imported from a review site',
    external_employee_review: 'Employee review',
    anonymous_unverified: 'Anonymous, unverified submitter',
    duplicate_user_company: 'Same person reported this company again within 30 days',
    velocity_capped: 'Too many reports from one person in a short time',
    reddit_rule_match: 'Reddit account matched the first-hand rules',
    web_rule_match: 'Public web account matched the first-hand rules',
    web_search_public_review: 'Paraphrase of a public review page',
    auto_enrich_reddit: 'Found by the company-page enricher',
  }
  return byReason[tr] || (tr ? label(tr) : 'Waiting for review')
}

// ── Recent reports ───────────────────────────────────────────────────────────────────────────────

export type ReportState = 'live' | 'held' | 'rejected' | 'duplicate'
export type ReportRow = HeldRow & { state?: ReportState; counted?: boolean; employeeReview?: boolean; rules?: 'passes' | 'fails' | null }

export const STATE_TEXT: Record<ReportState, { label: string; tone: Tone }> = {
  live: { label: 'Live', tone: 'good' },
  held: { label: 'Held', tone: 'caution' },
  rejected: { label: 'Rejected', tone: 'bad' },
  duplicate: { label: 'Duplicate', tone: 'neutral' },
}

export const RECENT_STATES: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All' }, { value: 'live', label: 'Live' }, { value: 'held', label: 'Held' },
  { value: 'rejected', label: 'Rejected' }, { value: 'duplicate', label: 'Duplicates' },
]

export type ModDecision = 'approve' | 'reject' | 'hold' | 'restore'

/** The moderation buttons that do something for a row in this state (the server says "nothing to do" for the rest). */
export function moderationFor(state: ReportState | undefined): ModDecision[] {
  switch (state) {
    case 'held': return ['approve', 'reject']
    case 'live': return ['hold', 'reject']
    case 'rejected': return ['restore']
    case 'duplicate': return ['reject']
    default: return []
  }
}

export const DECISION_TEXT: Record<ModDecision, { label: string; running: string }> = {
  approve: { label: 'Approve', running: 'Approving…' },
  reject: { label: 'Reject', running: 'Rejecting…' },
  hold: { label: 'Hold', running: 'Moving it back to the queue…' },
  restore: { label: 'Restore', running: 'Restoring…' },
}

/** Patch the rows a moderation returned into a list page in place. */
export function patchRows<R extends { id: string }>(page: { rows?: R[] } | undefined, updates: Array<Partial<R> & { id: string }>): { rows?: R[] } | undefined {
  if (!page || !Array.isArray(page.rows)) return page
  const by = new Map(updates.map((u) => [String(u.id), u]))
  let hit = false
  const rows = page.rows.map((r) => { const u = by.get(String(r.id)); if (!u) return r; hit = true; return { ...r, ...u } })
  return hit ? { ...page, rows } : page
}

// ── Audit history (report sheet) ─────────────────────────────────────────────────────────────────

const ACTION_TEXT: Record<string, string> = {
  approve_held_report: 'Approved from the queue', reject_held_report: 'Rejected from the queue',
  approve_report: 'Approved', reject_report: 'Rejected', hold_report: 'Moved back to the queue', restore_report: 'Restored',
  mark_duplicate_report: 'Marked as a duplicate copy', undo: 'Undone', correct_report_outcome: 'Outcome corrected',
}
export const historyText = (action: unknown) => ACTION_TEXT[String(action)] || label(action)

// ── The other kinds ──────────────────────────────────────────────────────────────────────────────

export type Ticket = {
  job_id: string; title?: string | null; company?: string | null; city?: string | null; apply_url?: string | null
  availability_status?: string | null; is_db_listing?: boolean; removed?: { reason?: string; at?: string | null } | null
  reports?: { count: number; expired: number; unknown: number; latest?: string | null } | null
  dispute?: { id: number; kind?: string; status?: string; reason?: string | null; detail?: string | null; created_at?: string } | null
  status?: 'open' | 'resolved'; latest_activity?: string | null
}

export function ticketSummary(t: Ticket): string {
  const bits: string[] = []
  const rep = t.reports
  if (rep && rep.count) bits.push(`${plural(rep.count, 'seeker report')}${rep.expired ? ` (${fmt(rep.expired)} say it's closed)` : ''}`)
  if (t.dispute) bits.push(`employer dispute: ${words(t.dispute.kind) || 'listing'}${t.dispute.status && t.dispute.status !== 'open' ? ` (${t.dispute.status})` : ''}`)
  if (t.removed) bits.push('taken down')
  return bits.length ? label(bits.join(' · ')) : 'No reports left'
}

export const hasOpenDispute = (t: Ticket) => !!t.dispute && t.dispute.status === 'open'

export type Dispute = { id: number | string; company_name?: string | null; company_key?: string | null; reason?: string | null; detail?: string | null; permalink?: string | null; contact?: string | null; status?: string; created_at?: string }
export type Claim = { id: string; user_id?: string; company_name?: string | null; company_display_name?: string | null; status?: string; created_at?: string; reviewed_at?: string | null; reviewed_by?: string | null; note?: string | null; email?: string | null; email_verified?: boolean | null; employer_name?: string | null }
export type Reply = { id: string; report_id?: string; company_key?: string | null; body?: string | null; status?: string; created_at?: string; reviewed_at?: string | null; reviewed_by?: string | null; report?: { role?: string | null; outcome?: string | null; report_text?: string | null; company_name?: string | null } | null }
export type Purchase = { id: string; company?: string | null; email?: string | null; employer_sku?: string | null; amount_cents?: number | null; status?: string; created_at?: string; fulfilled_at?: string | null }
export type Issue = { id: string | number; type?: string | null; target_type?: string | null; target_name?: string | null; notes?: string | null; status?: string; created_at?: string; resolved_at?: string | null }
export type Cluster = { id: number | string; user_ids?: string[]; users?: Array<{ id: string; email: string | null }>; signals?: unknown; risk_score?: number | null; status?: string; admin_note?: string | null; created_at?: string }

export function money(cents: unknown): string {
  return typeof cents === 'number' && Number.isFinite(cents) ? `$${(cents / 100).toFixed(2)}` : 'amount unknown'
}

/** A cluster's signals in words: "shared IP 203.0.113.4 · 3 accounts". */
export function signalText(signals: unknown): string {
  if (!signals) return ''
  if (typeof signals === 'string') return signals
  if (Array.isArray(signals)) return signals.map((s) => (typeof s === 'string' ? s : signalText(s))).filter(Boolean).join(' · ')
  if (typeof signals === 'object') {
    return Object.entries(signals as Record<string, unknown>)
      .filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length))
      .map(([k, v]) => `${words(k)} ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      .join(' · ')
  }
  return String(signals)
}

export const CLUSTER_STATUSES = ['suspected', 'watching', 'safe', 'limited', 'frozen', 'suspended'] as const

/** A fresh idempotency key for one press (reused by Retry, so a retry can never double-run). */
export function newRequestId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  const b = new Uint8Array(16)
  if (c?.getRandomValues) c.getRandomValues(b)
  else for (let i = 0; i < 16; i++) b[i] = (Date.now() + i * 7919) & 255
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
