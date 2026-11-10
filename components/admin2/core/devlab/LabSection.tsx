'use client'

// THE CORE'S LAB — compiled in only when NEXT_PUBLIC_ADMIN_LAB=1 (never in production; see sections.tsx).
// It is two things at once:
//   1. the acceptance harness for the core (scripts/admin-smoke.mjs drives it against a fixture server);
//   2. the reference section for the engineers who build Review, Listings, Companies, People, System:
//      a keyset list with URL filters, selection + bulk bar, row actions with optimistic removal and an
//      in-place result line with Undo, an inline confirm, an "until done" job, and items in the sheet.
// Its `lab_*` actions exist only in the fixture server; real sections call real actions.
import { useState } from 'react'
import Button from '@/components/ui/Button'
import type { AdminItemKind, AdminList } from '../../contract.ts'
import { useAdminAction, useAdminDownload, useAdminJob, useAdminList, useApi } from '../hooks.tsx'
import { useUrlFilter } from '../place.ts'
import type { SectionProps } from '../sections.tsx'
import { useShell } from '../shellContext.ts'
import { FilterChips, SearchField, SectionHeader, StatusChip } from '../../ui/bits.tsx'
import ConfirmStep from '../../ui/ConfirmStep.tsx'
import { JobProgress } from '../../ui/Job.tsx'
import { BulkBar, List, Row, RowActions } from '../../ui/List.tsx'
import ResultLine from '../../ui/ResultLine.tsx'
import styles from './lab.module.css'

/** The lab's own item kind (core/items.tsx registers it in lab builds only). */
const LAB_KIND = 'labitem' as AdminItemKind

type LabRow = { id: string; company: string; outcome: string; text: string; dupe?: boolean }

export default function LabSection(_props: SectionProps) {
  const api = useApi()
  const shell = useShell()
  const [kind, setKind] = useUrlFilter('lab', 'kind', 'all')
  const [note, setNote] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmAll, setConfirmAll] = useState(false)
  // The last single-row decision: its row has left the list, so its result line (and Undo) lives here.
  const [lastRow, setLastRow] = useState<string | null>(null)
  const key = `lab_held?kind=${kind}`
  const list = useAdminList<LabRow>(key, ({ after }) => api<AdminList<LabRow>>('lab_list', { kind, after }), { staleMs: 10_000 })

  const decide = useAdminAction('lab_decide', {
    // Rows leave at once; if the server says no they come back.
    optimistic: (tx, args) => tx.removeRows('lab_held', args.ids as string[]),
    onSettled: (res, args) => {
      const which = args.ids as string[]
      if (res.ok) setSelected((s) => { const n = new Set(s); for (const id of which) n.delete(id); return n })
      if (which.length === 1 && which[0] !== '*all*' && args.single) setLastRow(which[0])
      // The confirm step stays in place (busy) until the answer lands, so a second tap lands on its
      // disabled button — not on whatever would move under the finger if it collapsed at once.
      if (which[0] === '*all*') setConfirmAll(false)
    },
  })
  const dl = useAdminDownload()
  const job = useAdminJob({ action: 'lab_clear', label: 'Clearing stale listings', past: 'Cleared', noun: 'stale listings' })

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const bulk = (decision: 'approve' | 'reject', which: string[]) => { void decide.run({ ids: which, decision, kind }, 'bulk') }

  return (
    <div data-testid="section-lab">
      <SectionHeader
        title="Lab"
        sub="The core’s test bench: fixture data only, never shown in production."
        fetching={list.fetching && !list.loading}
        actions={<Button variant="secondary" icon="refresh-cw" onClick={() => void list.refresh()} data-testid="lab-refresh">Refresh</Button>}
      />

      <div className={styles.toolbar}>
        <FilterChips label="Show" value={kind} onChange={(v) => { setKind(v === 'all' ? '' : v); setSelected(new Set()) }}
          options={[{ value: 'all', label: 'All' }, { value: 'positive', label: 'Positive' }, { value: 'dupes', label: 'Possible duplicates' }]} />
        <SearchField value={note} onChange={setNote} label="A field that must survive leaving the section" placeholder="Type here, switch section, come back" testId="lab-note" />
      </div>

      <div className={styles.actions}>
        {confirmAll ? (
          <ConfirmStep
            title={`Approve all ${list.total ?? list.rows.length} held reports?`}
            body="They become public and start counting in their companies’ grades. Undo puts them back in the queue."
            confirmLabel="Approve all" tone="primary" busy={decide.busy('bulk')}
            onCancel={() => setConfirmAll(false)}
            onConfirm={() => bulk('approve', ['*all*'])}
          />
        ) : (
          <Button variant="primary" onClick={() => setConfirmAll(true)} disabled={!list.rows.length || decide.busy('bulk')} data-testid="lab-approve-all">
            Approve all{typeof list.total === 'number' ? ` (${list.total})` : ''}
          </Button>
        )}
        <Button variant="secondary" icon="download" onClick={() => void dl.run('/api/admin-company-audit-pdf', { company: 'Acme Logistics' }, { fallbackName: 'audit.pdf' })} loading={dl.busy} data-testid="lab-download">Legal audit PDF</Button>
        <Button variant="secondary" onClick={() => job.start()} data-testid="lab-job">{job.running ? 'Clearing… (tap to see it)' : 'Clear stale listings'}</Button>
      </div>

      <ResultLine state={decide.state('bulk')} onUndo={() => decide.undo('bulk')} onRetry={() => decide.retry('bulk')} onDismiss={() => decide.dismiss('bulk')}
        runningText="Approving…" skipLinks={{ possible_duplicate: { label: 'Review them', onSelect: () => setKind('dupes') } }} />
      {dl.state.status !== 'idle' ? <div className={styles.job}><ResultLine state={dl.state} runningText="Building the PDF…" onRetry={dl.retry} onDismiss={dl.dismiss} /></div> : null}
      {lastRow && decide.state(lastRow).status === 'done' ? (
        <div className={styles.job}>
          <ResultLine state={decide.state(lastRow)} onUndo={() => decide.undo(lastRow)} onDismiss={() => { decide.dismiss(lastRow); setLastRow(null) }} />
        </div>
      ) : null}
      {job.job ? <div className={styles.job}><JobProgress job={job.job} onCancel={job.cancel} onResume={job.resume} onDismiss={job.dismiss} /></div> : null}

      <div className={styles.list}>
        <List<LabRow>
          rows={list.rows} idOf={(r) => r.id} noun="held reports" loading={list.loading} error={list.error} onRetry={() => void list.refresh()}
          total={list.total} hasMore={list.hasMore} loadingMore={list.loadingMore} onLoadMore={() => void list.loadMore()}
          newCount={list.newCount} onShowNew={list.showNew}
          renderRow={(r) => (
            <Row
              testId={`lab-row-${r.id}`}
              title={`${r.company} — ${r.outcome}`}
              onOpen={() => shell.openItem(LAB_KIND, r.id)}
              sub={r.text}
              status={r.dupe ? <StatusChip tone="caution" label="Possible duplicate" /> : undefined}
              selected={selected.has(r.id)} onToggle={() => toggle(r.id)} selectLabel={`Select the ${r.company} report`}
              pending={decide.busy(r.id)}
              actions={(
                <RowActions>
                  <Button variant="secondary" onClick={() => void decide.run({ ids: [r.id], decision: 'approve', single: true }, r.id)} data-testid={`lab-approve-${r.id}`}>Approve</Button>
                  <Button variant="ghost" onClick={() => void decide.run({ ids: [r.id], decision: 'reject', single: true }, r.id)}>Reject</Button>
                </RowActions>
              )}
              below={decide.state(r.id).status === 'error' ? <ResultLine state={decide.state(r.id)} onRetry={() => decide.retry(r.id)} onDismiss={() => decide.dismiss(r.id)} /> : undefined}
            />
          )}
        />
      </div>

      <BulkBar count={selected.size} noun={selected.size === 1 ? 'report' : 'reports'} onClear={() => setSelected(new Set())}>
        <Button variant="secondary" onClick={() => bulk('approve', [...selected])} disabled={decide.busy('bulk')} data-testid="lab-bulk-approve">Approve</Button>
        <Button variant="ghost" onClick={() => bulk('reject', [...selected])} disabled={decide.busy('bulk')}>Reject</Button>
      </BulkBar>
    </div>
  )
}
