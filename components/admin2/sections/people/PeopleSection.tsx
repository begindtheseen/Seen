'use client'

// People (audit §3.1): find any account by email or id (server-side over every profile — no 100-row cap) →
// its sheet `?item=user:<id>`; where sign-ups come from; account clusters with their emails.
import { useEffect, useRef, useState } from 'react'
import Button from '@/components/ui/Button'
import type { AdminList } from '../../contract.ts'
import { useAdminAction, useAdminList, useAdminQuery, useApi } from '../../core/hooks.tsx'
import { useUrlFilter } from '../../core/place.ts'
import type { SectionProps } from '../../core/sections.tsx'
import { useShell } from '../../core/shellContext.ts'
import { FilterChips, KeyHint, SearchField, SectionHeader, StatusChip } from '../../ui/bits.tsx'
import { List, Row } from '../../ui/List.tsx'
import ResultLine from '../../ui/ResultLine.tsx'
import { EmptyState, ErrorState, RefreshFailed, Skeleton } from '../../ui/states.tsx'
import { useSectionKeys } from '../listings/sectionKeys.ts'
import { readApps } from '../system/adapter.ts'
import { formatPacific } from '@/lib/time/pacific'
import styles from '../listings/listings.module.css'
import { CLUSTER_STATUSES, CLUSTER_WORDS, FILTERS, fmt, readAttribution, readCluster, readUser, signalWords, userSub, type Cluster, type SourceGroup, type UserRow } from './adapter.ts'

const VIEWS = [{ value: 'accounts', label: 'Accounts' }, { value: 'apps', label: 'Tracked applications' }, { value: 'sources', label: 'Sign-up sources' }, { value: 'clusters', label: 'Account clusters' }]

export default function PeopleSection({ active }: SectionProps) {
  const [view, setView] = useUrlFilter('people', 'view', 'accounts')
  return (
    <div className={styles.wrap} data-testid="section-people">
      <SectionHeader title="People" sub="Accounts, where sign-ups come from, and accounts that look like one person." />
      <FilterChips label="Show" value={VIEWS.some((v) => v.value === view) ? view : 'accounts'} onChange={(v) => setView(v === 'accounts' ? '' : v)} options={VIEWS} />
      {view === 'sources' ? <SourcesView /> : view === 'clusters' ? <ClustersView /> : view === 'apps' ? <AppsView /> : <AccountsView active={active} />}
    </div>
  )
}

function AccountsView({ active }: { active: boolean }) {
  const api = useApi()
  const shell = useShell()
  const [q, setQ] = useUrlFilter('people', 'q', '')
  const [filter, setFilter] = useUrlFilter('people', 'filter', 'all')
  const [typed, setTyped] = useState(q)
  const pushed = useRef(q)
  useEffect(() => { if (q !== pushed.current) { pushed.current = q; setTyped(q) } }, [q])
  useEffect(() => {
    const t = setTimeout(() => { const v = typed.trim(); if (v !== q.trim()) { pushed.current = v; setQ(v) } }, 350)
    return () => clearTimeout(t)
  }, [typed, q, setQ])
  const search = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useSectionKeys({ active, sheetOpen: shell.sheetOpen, search, list: listRef })
  const f = FILTERS.some((x) => x.value === filter) ? filter : 'all'
  const list = useAdminList<UserRow>(`users?q=${q.trim().toLowerCase()}&filter=${f}`, async ({ after }) => {
    const res = await api<AdminList<Record<string, unknown>>>('users_list', { q: q.trim() || undefined, filter: f, after: after || undefined, limit: 50 })
    return res.ok ? { ...res, rows: (res.rows || []).map(readUser) } : res
  }, { staleMs: 30_000 })
  return (
    <section className={styles.blockFlat} aria-label="Accounts">
      <div className={styles.keys}><span><KeyHint keys="/" /> search</span><span><KeyHint keys="j" /><KeyHint keys="k" /> move</span><span><KeyHint keys="Enter" /> open</span></div>
      <SearchField ref={search} value={typed} onChange={setTyped} label="Find an account" placeholder="Email (or part of it), or the account id" placeholderShort="Email or account id" testId="people-q"
        onEnter={() => { const v = typed.trim(); pushed.current = v; setQ(v) }} />
      <FilterChips label="Accounts" value={f} onChange={(v) => setFilter(v === 'all' ? '' : v)} options={FILTERS} />
      <div ref={listRef}>
        <List<UserRow>
          rows={list.rows} idOf={(r) => r.id} noun="accounts" loading={list.loading} error={list.error} onRetry={() => void list.refresh()}
          total={list.total} hasMore={list.hasMore} loadingMore={list.loadingMore} onLoadMore={() => void list.loadMore()}
          newCount={list.newCount} onShowNew={list.showNew}
          empty={<EmptyState icon="users" title={q ? `No account matches “${q}”.` : 'No accounts here.'} body={q ? 'Search looks inside every account email, or matches an account id exactly.' : undefined} />}
          renderRow={(u) => (
            <Row testId={`user-row-${u.id}`} title={<span data-row-title>{u.email || `Account ${u.id}`}</span>} sub={userSub(u)}
              status={u.pro_active ? <StatusChip tone="info" label="Pro" /> : undefined} onOpen={() => shell.openItem('user', u.id)} />
          )}
        />
      </div>
    </section>
  )
}

function Bars({ rows, paidKnown }: { rows: SourceGroup[]; paidKnown: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.signups))
  return (
    <ul className={styles.lines}>
      {rows.slice(0, 12).map((r) => (
        <li key={r.key} className={styles.barRow}>
          <span>{r.label || r.key}</span>
          <span className={styles.barNum}>{fmt(r.signups)}</span>
          <span className={styles.barTrack} aria-hidden="true"><span className={styles.barFill} style={{ transform: `scaleX(${r.signups / max})` }} /></span>
          <span className={styles.quiet}>{fmt(r.tracked)} tracked an application · {fmt(r.pro_or_trial)} Pro{paidKnown && r.paid !== null ? ` · ${fmt(r.paid)} paid` : ''}</span>
        </li>
      ))}
    </ul>
  )
}

function SourcesView() {
  const api = useApi()
  const [days, setDays] = useUrlFilter('people', 'days', '30')
  const d = ['7', '30', '90'].includes(days) ? days : '30'
  const q = useAdminQuery<Record<string, unknown>>(`signups?days=${d}`, () => api<Record<string, unknown>>('signup_attribution', { days: Number(d) }, { timeoutMs: 45_000 }), { staleMs: 120_000 })
  const a = q.data ? readAttribution(q.data) : null
  const paidKnown = !!a?.total && a.total.paid !== null
  return (
    <section className={styles.blockFlat} aria-label="Sign-up sources" data-testid="people-sources">
      <FilterChips label="Window" value={d} onChange={(v) => setDays(v === '30' ? '' : v)} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
      {q.loading ? <Skeleton rows={4} label="Reading where sign-ups come from" /> : null}
      {q.error && !a ? <ErrorState what="sign-up sources" error={q.error} onRetry={() => void q.refresh()} retrying={q.fetching} /> : null}
      {a ? (
        <>
          <RefreshFailed error={q.error} onRetry={() => void q.refresh()} />
          {!a.ready ? <EmptyState icon="database" title="Sign-up sources are not recorded yet." body="The signup_attribution table is not there; sign-ups start being recorded once it is." />
            : !a.total || a.total.signups === 0 ? <EmptyState icon="users" title={`No sign-ups in the last ${d} days.`} />
            : (
              <>
                <p className={styles.text} data-testid="people-sources-total">
                  <span className={styles.strong}>{fmt(a.total.signups)} sign-ups in the last {d} days</span> (accounts that recorded where they came from):
                  {' '}{fmt(a.total.tracked)} tracked an application, {fmt(a.total.pro_or_trial)} became Pro{paidKnown ? `, ${fmt(a.total.paid!)} paid` : ''}.
                </p>
                {a.paidNote ? <p className={styles.quiet}>{a.paidNote}.</p> : null}
                {a.groups.map((g) => (
                  <div key={g.title} className={styles.block}>
                    <h3 className={styles.h2}>{g.title}</h3>
                    <p className={styles.quiet}>Sign-ups by {g.what}.</p>
                    <Bars rows={g.rows} paidKnown={paidKnown} />
                  </div>
                ))}
              </>
            )}
        </>
      ) : null}
    </section>
  )
}

function ClustersView() {
  const api = useApi()
  const shell = useShell()
  const [status, setStatus] = useUrlFilter('people', 'cstatus', 'suspected')
  const st = status === 'all' || CLUSTER_STATUSES.includes(status) ? status : 'suspected'
  const list = useAdminList<Cluster>(`clusters?status=${st}`, async () => {
    const res = await api<AdminList<Record<string, unknown>>>('clusters_list', { status: st })
    return res.ok ? { ...res, rows: (res.rows || []).map(readCluster), next: undefined } : res
  }, { staleMs: 30_000 })
  const detect = useAdminAction('detect_duplicates_by_signals', { dock: false })
  return (
    <section className={styles.blockFlat} aria-label="Account clusters" data-testid="people-clusters">
      <p className={styles.text}>Accounts that signed in from the same address in the last 30 days. Open one to see the emails and decide.</p>
      <FilterChips label="Status" value={st} onChange={(v) => setStatus(v === 'suspected' ? '' : v)}
        options={[{ value: 'suspected', label: 'Not judged' }, { value: 'watching', label: 'Watching' }, { value: 'safe', label: 'Safe' }, { value: 'limited', label: 'Limited' }, { value: 'frozen', label: 'Frozen' }, { value: 'suspended', label: 'Suspended' }, { value: 'all', label: 'All' }]} />
      <div className={styles.actions}>
        <Button variant="secondary" icon="search" onClick={() => void detect.run({})} loading={detect.busy()} data-testid="clusters-detect">Look for new clusters</Button>
      </div>
      <ResultLine state={detect.state()} onRetry={() => detect.retry()} onDismiss={() => detect.dismiss()} runningText="Comparing sign-in addresses…" />
      <List<Cluster>
        rows={list.rows} idOf={(c) => c.id} noun="clusters" loading={list.loading} error={list.error} onRetry={() => void list.refresh()} total={list.total}
        empty={<EmptyState icon="users" title={st === 'suspected' ? 'No clusters waiting for a decision.' : 'No clusters with this status.'} />}
        renderRow={(c) => (
          <Row testId={`cluster-row-${c.id}`} title={<span data-row-title>{`${fmt(c.users.length)} ${c.users.length === 1 ? 'account' : 'accounts'} · risk ${c.risk === null ? 'unknown' : c.risk}`}</span>}
            sub={c.users.map((u) => u.email || `account ${u.id.slice(0, 8)}…`).join(', ')}
            status={<StatusChip tone={c.status === 'safe' ? 'good' : c.status === 'suspected' ? 'caution' : 'neutral'} label={CLUSTER_WORDS[c.status] || c.status} />}
            meta={<span>{c.signals.map(signalWords).join(' · ')}</span>}
            onOpen={() => shell.openItem('cluster', c.id)} />
        )}
      />
    </section>
  )
}

// The newest tracked applications, read-only (the old admin's "Recent tracker applications"). The server's read
// (get_kpi_detail apps_total) returns the newest 100 and no total, so the list says it is the newest 100 at most.
function AppsView() {
  const api = useApi()
  const q = useAdminQuery<Record<string, unknown>>('apps:recent', () => api<Record<string, unknown>>('get_kpi_detail', { metric: 'apps_total' }), { staleMs: 60_000 })
  const rows = q.data ? readApps(q.data) : []
  return (
    <section className={styles.blockFlat} aria-label="Tracked applications" data-testid="people-apps">
      <p className={styles.quiet}>The newest applications people track, newest first — read-only. The server returns the newest 100 and no total.</p>
      {q.loading ? <Skeleton rows={4} label="Reading tracked applications" /> : null}
      {q.error && !q.data ? <ErrorState what="tracked applications" error={q.error} onRetry={() => void q.refresh()} retrying={q.fetching} /> : null}
      {q.data ? (
        <>
          <RefreshFailed error={q.error} onRetry={() => void q.refresh()} />
          <p className={styles.text} data-testid="people-apps-count">{rows.length ? `Showing the newest ${fmt(rows.length)} ${rows.length === 1 ? 'application' : 'applications'}${rows.length >= 100 ? ' (the server’s limit)' : ''}.` : 'No tracked applications.'}</p>
          {rows.length ? (
            <ul className={styles.lines} aria-label="Applications">
              {rows.map((a) => (
                <li key={a.id} className={styles.lineItem}>
                  <span className={styles.lineMain}><span className={styles.strong}>{a.company || 'Unnamed company'}</span>{a.role ? ` · ${a.role}` : ''}{a.stage ? ` · ${a.stage}` : ''}{a.status ? ` (${a.status})` : ''}</span>
                  <span className={styles.lineSide}>{a.created_at ? formatPacific(a.created_at, { dateStyle: 'medium' }) : ''}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
