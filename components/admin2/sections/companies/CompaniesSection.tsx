'use client'

// Companies (audit §3.1): search any company (keyset, server-side) → its sheet `?item=company:<name>`;
// duplicate names with Auto-merge (only names that differ by a legal suffix — the server's rule) as a job
// and look-alikes listed for a human; the merge history with Separate.
import { useEffect, useRef, useState } from 'react'
import { formatPacific } from '@/lib/time/pacific'
import Button from '@/components/ui/Button'
import type { AdminList } from '../../contract.ts'
import { useAdminAction, useAdminJob, useAdminList, useAdminQuery, useApi } from '../../core/hooks.tsx'
import { useUrlFilter } from '../../core/place.ts'
import type { SectionProps } from '../../core/sections.tsx'
import { useShell } from '../../core/shellContext.ts'
import { KeyHint, SearchField, SectionHeader, StatusChip } from '../../ui/bits.tsx'
import ConfirmStep from '../../ui/ConfirmStep.tsx'
import { JobProgress } from '../../ui/Job.tsx'
import { List, Row } from '../../ui/List.tsx'
import ResultLine from '../../ui/ResultLine.tsx'
import { EmptyState, ErrorState, RefreshFailed, Skeleton } from '../../ui/states.tsx'
import { useSectionKeys } from '../listings/sectionKeys.ts'
import styles from '../listings/listings.module.css'
import { companyLine, displayName, fmt, readCompanyRow, readDupeGroups, readMerge, type CompanyRow, type Merge } from './adapter.ts'

export default function CompaniesSection({ active }: SectionProps) {
  const api = useApi()
  const shell = useShell()
  const [q, setQ] = useUrlFilter('companies', 'q', '')
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
  const list = useAdminList<CompanyRow>(`companies?q=${q.trim().toLowerCase()}`, async ({ after }) => {
    const res = await api<AdminList<Record<string, unknown>>>('companies_list', { q: q.trim() || undefined, after: after || undefined, limit: 50 })
    return res.ok ? { ...res, rows: (res.rows || []).map(readCompanyRow) } : res
  }, { staleMs: 60_000, idOf: (r) => r.id || r.name })

  return (
    <div className={styles.wrap} data-testid="section-companies">
      <SectionHeader title="Companies" sub="Open any company to see what its grade is built from, recompute it, export its audit, or merge it."
        fetching={list.fetching && !list.loading} />
      <section className={styles.blockFlat} aria-labelledby="co-search">
        <div className={styles.blockHead}>
          <h2 id="co-search" className={styles.h2}>Every graded company</h2>
          <div className={styles.keys}><span><KeyHint keys="/" /> search</span><span><KeyHint keys="j" /><KeyHint keys="k" /> move</span><span><KeyHint keys="Enter" /> open</span></div>
        </div>
        <SearchField ref={search} value={typed} onChange={setTyped} label="Search companies" placeholder="Company name" testId="companies-q"
          onEnter={() => { const v = typed.trim(); pushed.current = v; setQ(v) }} />
        <div ref={listRef}>
          <List<CompanyRow>
            rows={list.rows} idOf={(r) => r.id || r.name} noun="companies" loading={list.loading} error={list.error} onRetry={() => void list.refresh()}
            total={list.total} hasMore={list.hasMore} loadingMore={list.loadingMore} onLoadMore={() => void list.loadMore()}
            newCount={list.newCount} onShowNew={list.showNew}
            empty={<EmptyState icon="building-2" title={q ? `No graded company matches “${q}”.` : 'No graded companies.'} body={q ? 'Only companies with a score row are listed here. Global search (top bar) also finds companies by name.' : undefined} />}
            renderRow={(r) => (
              <Row testId={`co-row-${r.name}`} title={<span data-row-title>{displayName(r.name)}</span>} sub={companyLine(r)} onOpen={() => shell.openItem('company', r.name)} />
            )}
          />
        </div>
      </section>
      <DuplicatesBlock />
      <MergesBlock />
    </div>
  )
}

// ── Duplicate names + Auto-merge ─────────────────────────────────────────────────────────────────
function DuplicatesBlock() {
  const api = useApi()
  const shell = useShell()
  const [asked, setAsked] = useState(false)
  const q = useAdminQuery<Record<string, unknown>>('company_dupes', () => api<Record<string, unknown>>('find_duplicates', {}, { timeoutMs: 60_000 }), { enabled: asked, staleMs: 60_000 })
  const job = useAdminJob({ action: 'auto_merge', label: 'Merging names that differ only by Inc, LLC and the like', past: 'Merged', noun: 'companies' })
  const [confirming, setConfirming] = useState(false)
  useEffect(() => { if (confirming && job.job && (job.job.rounds > 0 || !job.running)) setConfirming(false) }, [confirming, job.job, job.running])
  const view = q.data ? readDupeGroups(q.data) : null
  const auto = view?.groups.filter((g) => g.auto) || []
  const look = view?.groups.filter((g) => !g.auto) || []
  return (
    <section className={styles.block} aria-labelledby="co-dupes" data-testid="co-dupes">
      <div className={styles.blockHead}><h2 id="co-dupes" className={styles.h2}>Duplicate names</h2></div>
      <p className={styles.text}>
        Auto-merge only joins names that differ by a legal ending (Inc, LLC, Corp, Ltd, Co, PLC). Names that merely look alike are listed for you
        to judge: open one and merge it from its sheet. Every merge can be undone below.
      </p>
      {!asked ? (
        <div className={styles.actions}><Button variant="secondary" icon="search" onClick={() => setAsked(true)} data-testid="co-dupes-find">Find duplicate names</Button></div>
      ) : q.loading ? <Skeleton rows={2} label="Comparing every company name" />
        : q.error && !view ? <ErrorState what="duplicate names" error={q.error} onRetry={() => void q.refresh()} retrying={q.fetching} />
        : view ? (
          <div className={styles.blockFlat}>
            <RefreshFailed error={q.error} onRetry={() => void q.refresh()} />
            <p className={styles.text} data-testid="co-dupes-summary">
              {view.groups.length
                ? `${fmt(view.groups.length)} ${view.groups.length === 1 ? 'group' : 'groups'} of matching names${view.total !== null ? ` among ${fmt(view.total)} companies` : ''}: ${fmt(auto.length)} can merge automatically, ${fmt(look.length)} ${look.length === 1 ? 'needs' : 'need'} you.`
                : `No duplicate names${view.total !== null ? ` among ${fmt(view.total)} companies` : ''}.`}
            </p>
            {job.job ? <JobProgress job={job.job} onCancel={job.cancel} onResume={job.resume} onDismiss={job.dismiss} /> : null}
            {confirming ? (
              <ConfirmStep title={`Merge ${fmt(auto.length)} ${auto.length === 1 ? 'group' : 'groups'} automatically?`}
                body="In each group the company with the most reports keeps the name; the others’ reports move to it. It runs in rounds and keeps going if you leave this section. Each merge can be undone in the history below."
                confirmLabel="Auto-merge" busy={confirming && job.running} onCancel={() => setConfirming(false)} onConfirm={() => { job.start() }} />
            ) : auto.length || job.running ? (
              <div className={styles.actions}>
                <Button variant="secondary" icon="layers" onClick={() => (job.running ? job.start() : setConfirming(true))} data-testid="co-automerge">
                  {job.running ? 'Merging… (show progress)' : `Auto-merge ${fmt(auto.length)} ${auto.length === 1 ? 'group' : 'groups'}`}
                </Button>
                <Button variant="ghost" icon="refresh-cw" onClick={() => void q.refresh()} disabled={q.fetching}>Compare again</Button>
              </div>
            ) : <div className={styles.actions}><Button variant="ghost" icon="refresh-cw" onClick={() => void q.refresh()} disabled={q.fetching}>Compare again</Button></div>}
            {look.length ? (
              <>
                <h3 className={styles.h2}>Look alike — your call</h3>
                <ul className={styles.lines} aria-label="Look-alike names">
                  {look.slice(0, 50).map((g) => (
                    <li key={g.key} className={styles.lineItem} data-testid="co-lookalike">
                      <span className={styles.lineMain}>
                        {g.companies.map((c, i) => (
                          <span key={c.id || c.name}>{i ? ' · ' : ''}<button type="button" className={styles.linkBtn} onClick={() => shell.openItem('company', c.name)}>{displayName(c.name)}</button>{c.report_count !== null ? ` (${fmt(c.report_count)} reports)` : ''}</span>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
                {look.length > 50 ? <p className={styles.quiet}>Showing 50 of {fmt(look.length)} groups.</p> : null}
              </>
            ) : null}
            {auto.length ? (
              <details>
                <summary className={styles.linkBtn}>Show the {fmt(auto.length)} automatic {auto.length === 1 ? 'group' : 'groups'}</summary>
                <ul className={styles.lines} aria-label="Automatic groups">
                  {auto.slice(0, 100).map((g) => <li key={g.key} className={styles.lineItem}><span className={styles.lineMain}>{g.companies.map((c) => displayName(c.name)).join(' · ')}</span></li>)}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}
    </section>
  )
}

// ── Merge history with Separate ──────────────────────────────────────────────────────────────────
function MergesBlock() {
  const api = useApi()
  const shell = useShell()
  const list = useAdminList<Merge>('merges', async () => {
    const res = await api<AdminList<Record<string, unknown>>>('list_merges')
    return res.ok ? { ...res, rows: (res.rows || []).map(readMerge), next: undefined } : res
  }, { staleMs: 60_000 })
  const undo = useAdminAction('undo_merge', { onSettled: () => setConfirm(null) })
  const resplit = useAdminAction('resplit_company')
  const [confirm, setConfirm] = useState<string | null>(null)
  const [name, setName] = useState('')
  return (
    <section className={styles.block} aria-labelledby="co-merges" data-testid="co-merges">
      <div className={styles.blockHead}><h2 id="co-merges" className={styles.h2}>Merge history</h2></div>
      <p className={styles.quiet}>The 50 most recent merges. Separate moves the absorbed company&apos;s reports back and restores its page.</p>
      <List<Merge>
        rows={list.rows} idOf={(m) => m.id} noun="merges" loading={list.loading} error={list.error} onRetry={() => void list.refresh()}
        empty={<EmptyState icon="layers" title="No merges yet." />}
        renderRow={(m) => (
          <Row testId={`merge-row-${m.id}`}
            title={`${displayName(m.secondary_name)} → ${displayName(m.primary_name)}`}
            sub={`${m.moved_reports === null || m.moved_reports === undefined ? '' : `${fmt(m.moved_reports)} reports moved · `}${m.created_at ? formatPacific(m.created_at) : ''}`}
            status={m.undone_at ? <StatusChip tone="neutral" label={`Separated ${formatPacific(m.undone_at, { dateStyle: 'medium' })}`} /> : undefined}
            actions={!m.undone_at && confirm !== m.id ? (
              <div className={styles.actions}>
                <Button variant="ghost" onClick={() => shell.openItem('company', m.primary_name)}>Open</Button>
                <Button variant="secondary" icon="undo-2" onClick={() => setConfirm(m.id)} disabled={undo.busy(m.id)} data-testid={`merge-separate-${m.id}`}>Separate</Button>
              </div>
            ) : undefined}
            below={confirm === m.id ? (
              <ConfirmStep inline title={`Separate ${displayName(m.secondary_name)} from ${displayName(m.primary_name)}?`}
                body="Its reports move back, its page and score return, and the alias is removed. Both companies are recomputed."
                confirmLabel="Separate" busy={undo.busy(m.id)} onCancel={() => setConfirm(null)} onConfirm={() => { void undo.run({ merge_id: m.id }, m.id) }} />
            ) : undo.state(m.id).status !== 'idle' ? <ResultLine state={undo.state(m.id)} onRetry={() => undo.retry(m.id)} onDismiss={() => undo.dismiss(m.id)} runningText="Separating…" /> : undefined}
          />
        )}
      />
      <form className={styles.inline} onSubmit={(e) => { e.preventDefault(); if (name.trim().length >= 2) void resplit.run({ name: name.trim() }) }}>
        <label className={styles.field}><span>Separate by name (an absorbed company not in the list above)</span>
          <input className="ui-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" data-testid="co-resplit-name" /></label>
        <Button type="submit" variant="secondary" disabled={name.trim().length < 2} loading={resplit.busy()} data-testid="co-resplit">Separate</Button>
      </form>
      <ResultLine state={resplit.state()} onRetry={() => resplit.retry()} onDismiss={() => resplit.dismiss()} runningText="Separating…" />
    </section>
  )
}
