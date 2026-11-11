'use client'

// Every report filed under a company's name, keyset-paged (not "the newest 25"), with the moderation the
// server allows for each state — approve / hold / reject / restore — answered in place with Undo.
import { useState } from 'react'
import { formatPacific } from '@/lib/time/pacific'
import Button from '@/components/ui/Button'
import type { AdminList } from '../../contract.ts'
import { useAdminAction, useAdminList, useApi } from '../../core/hooks.tsx'
import { FilterChips, StatusChip } from '../../ui/bits.tsx'
import { List, Row, RowActions } from '../../ui/List.tsx'
import ResultLine from '../../ui/ResultLine.tsx'
import { EmptyState } from '../../ui/states.tsx'
import styles from '../listings/listings.module.css'
import { displayName } from './adapter.ts'

type ReportRow = { id: string; company_name?: string; outcome?: string; outcome_label?: string; source_label?: string; role?: string; platform?: string; created_at?: string; report_text?: string; state?: string; counted?: boolean }

const STATES = [{ value: '', label: 'All' }, { value: 'live', label: 'Live' }, { value: 'held', label: 'Held' }, { value: 'rejected', label: 'Rejected' }, { value: 'duplicate', label: 'Duplicates' }]
const TONE: Record<string, 'good' | 'caution' | 'bad' | 'neutral'> = { live: 'good', held: 'caution', rejected: 'bad', duplicate: 'neutral' }
const WORD: Record<string, string> = { live: 'Live', held: 'Held', rejected: 'Rejected', duplicate: 'Duplicate' }

export default function CompanyReports({ name, onOpenReport }: { name: string; onOpenReport: (id: string) => void }) {
  const api = useApi()
  const [state, setState] = useState('')
  const key = `reports?company=${name.toLowerCase()}&state=${state}`
  const list = useAdminList<ReportRow>(key, ({ after }) => api<AdminList<ReportRow>>('reports_recent', { q: name, state: state || undefined, after: after || undefined, limit: 25 }), { staleMs: 30_000 })
  // A decision can move the row out of the current filter: <List actions> keeps its slot as the result line with Undo.
  const mod = useAdminAction('moderate_report', { dock: false })
  const act = (r: ReportRow, decision: string) => { void mod.run({ id: r.id, decision }, r.id) }
  return (
    <div className={styles.itemPart} data-testid="co-reports">
      <h3 className={styles.h2}>Reports</h3>
      <p className={styles.quiet}>Every report filed under a name containing “{displayName(name)}”, newest first. Approve makes a held report public; Hold takes a live one back to Review; Reject hides it and takes it out of the grade; Restore undoes a rejection.</p>
      <FilterChips label="Report state" value={state} onChange={setState} options={STATES} />
      <List<ReportRow>
        rows={list.rows} idOf={(r) => r.id} noun="reports" actions={[mod]} loading={list.loading} error={list.error} onRetry={() => void list.refresh()}
        hasMore={list.hasMore} loadingMore={list.loadingMore} onLoadMore={() => void list.loadMore()} newCount={list.newCount} onShowNew={list.showNew}
        empty={<EmptyState icon="file-text" title={state ? `No ${WORD[state]?.toLowerCase() || state} reports under this name.` : 'No reports under this name.'} />}
        renderRow={(r) => {
          const st = r.state || ''
          const busy = mod.busy(r.id)
          return (
            <Row testId={`co-report-${r.id}`}
              title={`${r.outcome_label || r.outcome || 'Report'}${r.role ? ` · ${r.role}` : ''}`}
              onOpen={() => onOpenReport(r.id)}
              sub={r.report_text ? (r.report_text.length > 180 ? `${r.report_text.slice(0, 180)}…` : r.report_text) : undefined}
              status={<StatusChip tone={TONE[st] || 'neutral'} label={`${WORD[st] || st || 'Unknown state'}${r.counted ? ' · counts in the grade' : ''}`} />}
              meta={<span>{[r.company_name && r.company_name.toLowerCase() !== name.toLowerCase() ? displayName(r.company_name) : '', r.source_label || r.platform, r.created_at ? formatPacific(r.created_at, { dateStyle: 'medium' }) : ''].filter(Boolean).join(' · ')}</span>}
              pending={busy}
              actions={(
                <RowActions>
                  {st === 'held' ? <Button variant="secondary" onClick={() => act(r, 'approve')} disabled={busy} data-testid={`co-rep-approve-${r.id}`}>Approve</Button> : null}
                  {st === 'live' ? <Button variant="ghost" onClick={() => act(r, 'hold')} disabled={busy}>Hold</Button> : null}
                  {st === 'live' || st === 'held' ? <Button variant="ghost" onClick={() => act(r, 'reject')} disabled={busy} data-testid={`co-rep-reject-${r.id}`}>Reject</Button> : null}
                  {st === 'rejected' ? <Button variant="secondary" onClick={() => act(r, 'restore')} disabled={busy}>Restore</Button> : null}
                </RowActions>
              )}
              below={mod.state(r.id).status !== 'idle' ? <ResultLine state={mod.state(r.id)} onUndo={() => mod.undo(r.id)} onRetry={() => mod.retry(r.id)} onDismiss={() => mod.dismiss(r.id)} runningText="Saving the decision…" /> : undefined}
            />
          )
        }}
      />
    </div>
  )
}
