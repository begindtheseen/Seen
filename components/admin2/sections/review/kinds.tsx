'use client'

// The six smaller kinds (tickets, Reddit disputes, employer claims, employer replies, purchases, data
// issues — account clusters are People's) as DATA: how each is listed, what a row says, what the sheet shows, and the
// real actions SHAPES.md gives it. KindPanel (the list) and KindItem (the sheet) render any of them with
// the same row → sheet → action → result-line pattern.
import type { ReactNode } from 'react'
import { httpHref } from '@/lib/safeHref'
import type { AdminItemKind } from '../../contract.ts'
import {
  hasOpenDispute, label, money, outcomeWord, plural, snippet, ticketSummary, when,
  type Claim, type Dispute, type Issue, type KindKey, type Purchase, type Reply, type Ticket, type Tone,
} from './adapter.ts'
import { Block, Facts } from './parts.tsx'
import styles from './review.module.css'

export type KAction<R> = {
  key: string
  label: string
  action: string
  /** Sent to /api/employer-claims instead of /api/admin-stats. */
  claims?: boolean
  args: (r: R, note: string) => Record<string, unknown>
  when?: (r: R) => boolean
  variant?: 'secondary' | 'ghost' | 'danger'
  running: string
  /** An inline confirm step first (actions with an outside effect and no Undo, or a take-down). */
  confirm?: (r: R) => { title: string; body: string; irreversible?: string; confirmLabel: string }
  /** The row leaves the waiting list once decided (removed at once while that list is on screen). */
  decides?: boolean
  /** Shown in the row as well as the sheet (default true). */
  inRow?: boolean
  /** Desktop key: a = the approve-like decision, r = the reject-like one. */
  hotkey?: 'a' | 'r'
  /** Takes the sheet's note field. */
  note?: boolean
}

export type Chip = { tone: Tone; label: string }

export type KindConfig<R> = {
  kind: KindKey
  item: AdminItemKind
  noun: string
  one: string
  /** Cache key prefix (an AdminCacheKey the server names in `touched`). */
  prefix: string
  statuses: Array<{ value: string; label: string }>
  waiting: string
  listAction: string
  claims?: boolean
  body: (status: string, after?: string | null) => Record<string, unknown>
  /** For lists the server does not filter by status. */
  clientFilter?: (r: R, status: string) => boolean
  idOf: (r: R) => string
  search: (r: R) => unknown[]
  title: (r: R) => string
  sub: (r: R) => string
  chips: (r: R) => Array<Chip | null>
  meta: (r: R) => Array<string | null | undefined>
  detail: (r: R) => ReactNode
  empty: (status: string) => string
  /** Lists that page (keyset). */
  paged?: boolean
  actions: Array<KAction<R>>
  /** The note field's label in the sheet (claims, disputes). */
  noteLabel?: string
}

const statusChip = (s: string | undefined, good: string[], bad: string[], waiting: string[]): Chip | null => {
  if (!s) return null
  const tone: Tone = waiting.includes(s) ? 'caution' : good.includes(s) ? 'good' : bad.includes(s) ? 'bad' : 'neutral'
  return { tone, label: label(s) }
}

const Ext = ({ href, children }: { href: string | null; children: ReactNode }) => (href
  ? <a className={styles.link} href={href} target="_blank" rel="noopener noreferrer nofollow">{children}</a>
  : <span>—</span>)

// ── Listing tickets ──────────────────────────────────────────────────────────────────────────────
const tickets: KindConfig<Ticket> = {
  kind: 'tickets', item: 'ticket', noun: 'listing tickets', one: 'listing ticket', prefix: 'tickets',
  statuses: [{ value: 'open', label: 'Open' }, { value: 'resolved', label: 'Resolved' }, { value: 'all', label: 'All' }],
  waiting: 'open', listAction: 'list_listing_tickets',
  body: (status) => (status === 'all' ? {} : { status }),
  idOf: (t) => String(t.job_id),
  search: (t) => [t.title, t.company, t.city, t.job_id],
  title: (t) => `${t.title || 'Untitled listing'} — ${t.company || 'unknown company'}`,
  sub: (t) => ticketSummary(t),
  chips: (t) => [
    statusChip(t.status, ['resolved'], [], ['open']),
    hasOpenDispute(t) ? { tone: 'caution', label: 'Employer dispute open' } : null,
    t.removed ? { tone: 'bad', label: 'Taken down' } : t.availability_status ? { tone: 'neutral', label: `Listing ${label(t.availability_status).toLowerCase()}` } : null,
    t.is_db_listing === false ? { tone: 'neutral', label: 'Not in Seen’s listings' } : null,
  ],
  meta: (t) => [t.city, t.latest_activity ? `last activity ${when(t.latest_activity)}` : null],
  detail: (t) => (
    <>
      <Facts rows={[
        ['Listing', t.title || '—'], ['Company', t.company || '—'], ['City', t.city || '—'],
        ['Apply link', <Ext key="a" href={httpHref(t.apply_url)}>Open the employer’s page</Ext>],
        ['Listing state', t.removed ? `Taken down ${t.removed.at ? when(t.removed.at) : ''} (${label(t.removed.reason)})` : label(t.availability_status) || '—'],
        ['Seeker reports', t.reports ? `${plural(t.reports.count, 'report')} · ${t.reports.expired} say closed · ${t.reports.unknown} unsure${t.reports.latest ? ` · latest ${when(t.reports.latest)}` : ''}` : 'None'],
      ]} />
      {t.dispute ? (
        <Block title={`Employer dispute #${t.dispute.id}`}>
          <Facts rows={[
            ['Asks for', label(t.dispute.kind) || '—'], ['Status', label(t.dispute.status) || '—'],
            ['Reason', t.dispute.reason || '—'], ['Detail', t.dispute.detail || '—'], ['Filed', when(t.dispute.created_at) || '—'],
          ]} />
        </Block>
      ) : null}
    </>
  ),
  empty: (s) => (s === 'open' ? 'No open listing tickets — no seeker reports or employer disputes are waiting.' : 'No listing tickets here.'),
  noteLabel: 'Note to the employer (optional, sent with the dispute decision)',
  actions: [
    {
      key: 'approve_dispute', label: 'Approve dispute', action: 'resolve_listing_dispute', running: 'Approving the dispute…', hotkey: 'a', decides: true, note: true,
      when: hasOpenDispute, args: (t, note) => ({ id: t.dispute!.id, decision: 'approved', ...(note ? { note } : {}) }),
      confirm: (t) => ({ title: `Approve dispute #${t.dispute!.id}?`, body: `Seen does what the employer asked (${label(t.dispute!.kind).toLowerCase() || 'their change'}) and tells them. A take-down can be undone; an edit or cleared reports cannot.`, confirmLabel: 'Approve dispute' }),
    },
    {
      key: 'deny_dispute', label: 'Deny dispute', action: 'resolve_listing_dispute', running: 'Denying the dispute…', variant: 'ghost', hotkey: 'r', decides: true, note: true,
      when: hasOpenDispute, args: (t, note) => ({ id: t.dispute!.id, decision: 'denied', ...(note ? { note } : {}) }),
      confirm: (t) => ({ title: `Deny dispute #${t.dispute!.id}?`, body: 'The listing stays as it is. The employer is told the dispute was not approved.', irreversible: 'The employer is notified at once; the decision cannot be taken back here.', confirmLabel: 'Deny dispute' }),
    },
    {
      key: 'take_down', label: 'Take down…', action: 'delete_listing', running: 'Taking the listing down…', variant: 'ghost', decides: true,
      when: (t) => !t.removed && !hasOpenDispute(t), args: (t) => ({ job_id: t.job_id }),
      confirm: (t) => ({ title: 'Take this listing down?', body: `“${t.title || 'This listing'}” at ${t.company || 'this company'} leaves search, its apply link is blocked and ${t.reports?.count ? plural(t.reports.count, 'seeker report') + ' are' : 'its reports are'} cleared. Undo restores it for 14 days.`, confirmLabel: 'Take it down' }),
    },
    {
      key: 'keep', label: 'Keep — clear reports', action: 'dismiss_inactive_report', running: 'Clearing the reports…', hotkey: 'r', decides: true,
      when: (t) => !t.removed && !hasOpenDispute(t) && !!t.reports?.count, args: (t) => ({ job_id: t.job_id }),
    },
    {
      key: 'restore', label: 'Restore listing', action: 'job_restore', running: 'Restoring…', variant: 'ghost',
      when: (t) => !!t.removed && t.is_db_listing === true, args: (t) => ({ job_id: t.job_id }),
    },
  ],
}

// ── Reddit disputes ──────────────────────────────────────────────────────────────────────────────
const disputes: KindConfig<Dispute> = {
  kind: 'disputes', item: 'dispute', noun: 'Reddit disputes', one: 'Reddit dispute', prefix: 'disputes',
  statuses: [{ value: 'open', label: 'Open' }, { value: 'reviewed', label: 'Reviewed' }, { value: 'actioned', label: 'Actioned' }, { value: 'dismissed', label: 'Dismissed' }, { value: 'all', label: 'All' }],
  waiting: 'open', listAction: 'list_reddit_disputes',
  body: (status) => (status === 'all' ? {} : { status }),
  idOf: (d) => String(d.id),
  search: (d) => [d.company_name, d.reason, d.detail, d.permalink, d.contact],
  title: (d) => `${d.company_name || 'Unknown company'} — ${label(d.reason) || 'dispute'}`,
  sub: (d) => snippet(d.detail) || 'No detail given.',
  chips: (d) => [statusChip(d.status, ['actioned', 'reviewed'], ['dismissed'], ['open'])],
  meta: (d) => [when(d.created_at), d.contact ? `contact: ${d.contact}` : null],
  detail: (d) => (
    <Facts rows={[
      ['Company', d.company_name || '—'], ['Reason', label(d.reason) || '—'], ['Status', label(d.status) || '—'],
      ['Thread', <Ext key="p" href={httpHref(d.permalink)}>Open the Reddit thread</Ext>],
      ['Contact', d.contact || '—'], ['Filed', when(d.created_at) || '—'],
      ['Detail', <span key="d" className={styles.fullText}>{d.detail || '—'}</span>],
    ]} />
  ),
  empty: (s) => (s === 'open' ? 'No open Reddit disputes.' : 'No Reddit disputes here.'),
  actions: [
    { key: 'reviewed', label: 'Mark reviewed', action: 'update_reddit_dispute', running: 'Saving…', hotkey: 'a', decides: true, when: (d) => d.status !== 'reviewed', args: (d) => ({ id: d.id, status: 'reviewed' }) },
    { key: 'actioned', label: 'Actioned', action: 'update_reddit_dispute', running: 'Saving…', variant: 'ghost', decides: true, when: (d) => d.status !== 'actioned', args: (d) => ({ id: d.id, status: 'actioned' }) },
    { key: 'dismissed', label: 'Dismiss', action: 'update_reddit_dispute', running: 'Dismissing…', variant: 'ghost', hotkey: 'r', decides: true, when: (d) => d.status !== 'dismissed', args: (d) => ({ id: d.id, status: 'dismissed' }) },
  ],
}

// ── Employer claims ──────────────────────────────────────────────────────────────────────────────
const verified = (c: Claim) => (c.email ? `${c.email}${c.email_verified ? ' (verified)' : ' (NOT verified)'}` : 'no verified email on the account')
const claims: KindConfig<Claim> = {
  kind: 'claims', item: 'claim', noun: 'employer claims', one: 'employer claim', prefix: 'claims', claims: true,
  statuses: [{ value: 'pending', label: 'Pending' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }, { value: 'all', label: 'All' }],
  waiting: 'pending', listAction: 'list',
  body: (status) => (status === 'all' ? {} : { status }),
  idOf: (c) => String(c.id),
  search: (c) => [c.company_display_name, c.company_name, c.email, c.employer_name],
  title: (c) => `${c.company_display_name || c.company_name || 'Unknown company'}`,
  sub: (c) => `Claimed by ${c.employer_name ? `${c.employer_name}, ` : ''}${verified(c)}`,
  chips: (c) => [statusChip(c.status, ['approved'], ['rejected'], ['pending']), c.email && !c.email_verified ? { tone: 'bad', label: 'Email not verified' } : null],
  meta: (c) => [when(c.created_at), c.reviewed_by ? `decided by ${c.reviewed_by} ${when(c.reviewed_at)}` : null],
  detail: (c) => (
    <Facts rows={[
      ['Company', c.company_display_name || c.company_name || '—'], ['Employer', c.employer_name || '—'],
      ['Account email', verified(c)], ['Status', label(c.status) || '—'], ['Claimed', when(c.created_at) || '—'],
      ['Note', c.note || '—'], c.reviewed_at ? ['Decided', `${when(c.reviewed_at)} by ${c.reviewed_by || 'an admin'}`] : null,
    ]} />
  ),
  empty: (s) => (s === 'pending' ? 'No employer claims are waiting.' : 'No employer claims here.'),
  noteLabel: 'Note (optional, kept with the decision)',
  actions: [
    {
      key: 'approve', label: 'Approve', action: 'approve', claims: true, running: 'Approving…', hotkey: 'a', decides: true, note: true,
      when: (c) => c.status === 'pending', args: (c, note) => ({ id: c.id, ...(note ? { note } : {}) }),
      confirm: (c) => ({ title: `Approve the claim on ${c.company_display_name || c.company_name}?`, body: `${verified(c)} gets the employer tools for this company.`, irreversible: 'No Undo is offered for a claim decision.', confirmLabel: 'Approve claim' }),
    },
    {
      key: 'reject', label: 'Reject', action: 'reject', claims: true, running: 'Rejecting…', variant: 'ghost', hotkey: 'r', decides: true, note: true,
      when: (c) => c.status === 'pending', args: (c, note) => ({ id: c.id, ...(note ? { note } : {}) }),
      confirm: (c) => ({ title: `Reject the claim on ${c.company_display_name || c.company_name}?`, body: `${verified(c)} does not get the employer tools for this company.`, irreversible: 'No Undo is offered for a claim decision.', confirmLabel: 'Reject claim' }),
    },
  ],
}

// ── Employer replies ─────────────────────────────────────────────────────────────────────────────
const replies: KindConfig<Reply> = {
  kind: 'replies', item: 'reply', noun: 'employer replies', one: 'employer reply', prefix: 'replies',
  statuses: [{ value: 'pending', label: 'Pending' }, { value: 'approved', label: 'Published' }, { value: 'rejected', label: 'Rejected' }, { value: 'all', label: 'All' }],
  waiting: 'pending', listAction: 'list_employer_replies',
  body: (status) => (status === 'all' ? {} : { status }),
  idOf: (r) => String(r.id),
  search: (r) => [r.company_key, r.body, r.report?.company_name, r.report?.role],
  title: (r) => `${r.report?.company_name || r.company_key || 'Unknown company'} replies to ${r.report?.outcome_phrase || (r.report ? `a ${outcomeWord(r.report)}` : 'a')} report`,
  sub: (r) => snippet(r.body) || 'No text.',
  chips: (r) => [statusChip(r.status, ['approved'], ['rejected'], ['pending'])],
  meta: (r) => [r.report?.role, when(r.created_at)],
  detail: (r) => (
    <>
      <Block title="The reply"><p className={styles.fullText}>{r.body || '—'}</p></Block>
      <Block title="The report it answers">
        <Facts rows={[
          ['Company', r.report?.company_name || r.company_key || '—'], ['Role', r.report?.role || '—'], ['Outcome', r.report ? outcomeWord(r.report) : '—'],
          ['Report', <span key="t" className={styles.fullText}>{r.report?.report_text || 'The report could not be read.'}</span>],
        ]} />
      </Block>
      <Facts rows={[['Status', label(r.status) || '—'], ['Sent', when(r.created_at) || '—'], r.reviewed_at ? ['Decided', `${when(r.reviewed_at)} by ${r.reviewed_by || 'an admin'}`] : null]} />
    </>
  ),
  empty: (s) => (s === 'pending' ? 'No employer replies are waiting.' : 'No employer replies here.'),
  actions: [
    {
      key: 'approve', label: 'Publish', action: 'moderate_employer_reply', running: 'Publishing…', hotkey: 'a', decides: true,
      when: (r) => r.status === 'pending', args: (r) => ({ reply_id: r.id, decision: 'approve' }),
      confirm: (r) => ({ title: 'Publish this reply?', body: `It appears under the report on ${r.report?.company_name || r.company_key || 'the company'}’s page.`, irreversible: 'No Undo is offered; a published reply stays published.', confirmLabel: 'Publish reply' }),
    },
    { key: 'reject', label: 'Reject', action: 'moderate_employer_reply', running: 'Rejecting…', variant: 'ghost', hotkey: 'r', decides: true, when: (r) => r.status === 'pending', args: (r) => ({ reply_id: r.id, decision: 'reject' }) },
  ],
}

// ── Purchases to fulfil ──────────────────────────────────────────────────────────────────────────
const purchases: KindConfig<Purchase> = {
  kind: 'purchases', item: 'purchase', noun: 'employer purchases', one: 'employer purchase', prefix: 'purchases',
  statuses: [{ value: 'paid', label: 'To fulfil' }, { value: 'fulfilled', label: 'Fulfilled' }, { value: 'all', label: 'All' }],
  waiting: 'paid', listAction: 'list_employer_purchases',
  body: () => ({}),
  clientFilter: (p, status) => status === 'all' || p.status === status,
  idOf: (p) => String(p.id),
  search: (p) => [p.company, p.email, p.employer_sku],
  title: (p) => `${p.company || 'Unknown company'} — ${label(p.employer_sku) || 'purchase'}`,
  sub: (p) => `${money(p.amount_cents)} paid by ${p.email || 'an unknown email'}`,
  chips: (p) => [statusChip(p.status, ['fulfilled'], [], ['paid'])],
  meta: (p) => [when(p.created_at), p.fulfilled_at ? `fulfilled ${when(p.fulfilled_at)}` : null],
  detail: (p) => (
    <Facts rows={[
      ['Company', p.company || '—'], ['Product', label(p.employer_sku) || '—'], ['Amount', money(p.amount_cents)],
      ['Buyer', p.email || '—'], ['Status', label(p.status) || '—'], ['Bought', when(p.created_at) || '—'],
      p.fulfilled_at ? ['Fulfilled', when(p.fulfilled_at)] : null,
    ]} />
  ),
  empty: (s) => (s === 'paid' ? 'No purchases are waiting to be fulfilled.' : 'No purchases here (the newest 200 are read).'),
  actions: [
    { key: 'fulfil', label: 'Grant the perk', action: 'fulfill_employer_purchase', running: 'Granting…', hotkey: 'a', decides: true, when: (p) => p.status === 'paid', args: (p) => ({ purchase_id: p.id }) },
  ],
}

// ── Data issues ──────────────────────────────────────────────────────────────────────────────────
const issues: KindConfig<Issue> = {
  kind: 'issues', item: 'issue', noun: 'data issues', one: 'data issue', prefix: 'issues', paged: true,
  statuses: [{ value: 'open', label: 'Open' }, { value: 'resolved', label: 'Resolved' }, { value: 'dismissed', label: 'Dismissed' }, { value: 'all', label: 'All' }],
  waiting: 'open', listAction: 'issues_list',
  body: (status, after) => ({ status, ...(after ? { after } : {}) }),
  idOf: (i) => String(i.id),
  search: (i) => [i.type, i.target_name, i.notes],
  title: (i) => `${label(i.type) || 'Issue'}${i.target_name ? ` — ${i.target_name}` : ''}`,
  sub: (i) => snippet(i.notes) || 'No notes.',
  chips: (i) => [statusChip(i.status, ['resolved'], ['dismissed'], ['open']), i.target_type ? { tone: 'neutral', label: label(i.target_type) } : null],
  meta: (i) => [when(i.created_at), i.resolved_at ? `closed ${when(i.resolved_at)}` : null],
  detail: (i) => (
    <Facts rows={[
      ['Type', label(i.type) || '—'], ['About', `${label(i.target_type) || '—'}${i.target_name ? `: ${i.target_name}` : ''}`],
      ['Status', label(i.status) || '—'], ['Reported', when(i.created_at) || '—'], i.resolved_at ? ['Closed', when(i.resolved_at)] : null,
      ['Notes', <span key="n" className={styles.fullText}>{i.notes || '—'}</span>],
    ]} />
  ),
  empty: (s) => (s === 'open' ? 'No open data issues.' : 'No data issues here.'),
  actions: [
    { key: 'resolve', label: 'Resolve', action: 'resolve_issue', running: 'Resolving…', hotkey: 'a', decides: true, when: (i) => i.status === 'open', args: (i) => ({ id: i.id }) },
    { key: 'dismiss', label: 'Dismiss', action: 'dismiss_issue', running: 'Dismissing…', variant: 'ghost', hotkey: 'r', decides: true, when: (i) => i.status === 'open', args: (i) => ({ id: i.id }) },
  ],
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const KIND_CONFIGS: Partial<Record<KindKey, KindConfig<any>>> = { tickets, disputes, claims, replies, purchases, issues }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const CONFIG_BY_ITEM: Partial<Record<AdminItemKind, KindConfig<any>>> = Object.fromEntries(Object.values(KIND_CONFIGS).map((c) => [c!.item, c]))

export const listKey = (cfg: KindConfig<unknown>, status: string) => `${cfg.prefix}?status=${status}`
