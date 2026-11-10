'use client'

// Recent reports — moderate ANY row, live or not (the old "Recent hiring reports ✓ ? ✗ ↺", which
// worked). Each row says its state (Live / Held / Rejected / Duplicate) and whether it counts in the
// grade, and offers only the decisions that do something in that state. A decision patches the row in
// place; Undo is offered in its result line.
import { useRef, useState } from 'react'
import Button from '@/components/ui/Button'
import type { AdminList } from '../../contract.ts'
import { useAdminAction, useAdminList, useApi } from '../../core/hooks.tsx'
import { useUrlFilter } from '../../core/place.ts'
import { useShell } from '../../core/shellContext.ts'
import { SearchField } from '../../ui/bits.tsx'
import { List, Row, RowActions } from '../../ui/List.tsx'
import { EmptyState } from '../../ui/states.tsx'
import {
  DECISION_TEXT, RECENT_STATES, STATE_TEXT, moderationFor, outcomeTone, patchRows, snippet, when,
  outcomeWord, sourceWord, type ModDecision, type ReportRow,
} from './adapter.ts'
import { Chips, Choice, CursorRow, KeysHint, Meta, Line } from './parts.tsx'
import { useListKeys } from './reviewHooks.tsx'
import styles from './review.module.css'

export function useModerate(onDone?: (res: { ok: boolean }, args: Record<string, unknown>) => void) {
  return useAdminAction('moderate_report', {
    // The row's new state is patched in place at once (every list holding it), before the re-read.
    onRows: (rows, cache) => {
      for (const key of cache.keys()) {
        if (key === 'reports' || key.startsWith('reports?')) cache.setData<{ rows?: ReportRow[] }>(key, (cur) => patchRows(cur, rows as Array<Partial<ReportRow> & { id: string }>) as { rows?: ReportRow[] })
      }
    },
    onSettled: (res, args) => onDone?.(res, args),
  })
}

export default function RecentPanel({ on, visible }: { on: boolean; visible: boolean }) {
  const api = useApi()
  const shell = useShell()
  const [stateRaw, setState] = useUrlFilter('review', 'status', 'all')
  const state = on && RECENT_STATES.some((s) => s.value === stateRaw) ? stateRaw : 'all'
  const [qRaw, setQ] = useUrlFilter('review', 'q', '')
  const q = on ? qRaw : ''
  const query = q.trim()
  const searchRef = useRef<HTMLInputElement>(null)
  const [lastRow, setLastRow] = useState<string | null>(null)
  const key = `reports?state=${state}&q=${query}`
  const list = useAdminList<ReportRow>(key, ({ after }) => api<AdminList<ReportRow>>('reports_recent', {
    ...(state !== 'all' ? { state } : {}), ...(query ? { q: query } : {}), ...(after ? { after } : {}), limit: 50,
  }), { staleMs: 20_000 })
  const mod = useModerate()

  const decide = (r: ReportRow, decision: ModDecision) => { setLastRow(r.id); void mod.run({ id: r.id, decision }, r.id) }
  const byId = (id: string) => list.rows.find((r) => r.id === id)
  const keys = useListKeys({
    enabled: visible,
    ids: list.rows.map((r) => r.id),
    onOpen: (id) => shell.openItem('report', id),
    onApprove: (id) => { const r = byId(id); if (r && moderationFor(r.state).includes('approve')) decide(r, 'approve') },
    onReject: (id) => { const r = byId(id); if (r && moderationFor(r.state).includes('reject')) decide(r, 'reject') },
    onUndo: () => { if (lastRow) mod.undo(lastRow) },
    searchRef,
  })

  return (
    <div className={styles.panel} data-testid="panel-recent">
      <div className={styles.toolbar}>
        <Choice label="State" options={RECENT_STATES} value={state} onChange={(v) => setState(v === 'all' ? '' : v)} testId="recent-state" />
        <SearchField ref={searchRef} value={q} onChange={setQ} label="Search recent reports by company" placeholder="Company name contains…" testId="recent-search" />
        <KeysHint keys={[['j k', 'move'], ['Enter', 'open'], ['a', 'approve'], ['r', 'reject'], ['u', 'undo'], ['/', 'search this list']]} />
      </div>
      <p className={styles.note}>Newest first, every report Seen has stored{query ? `, company contains “${query}”` : ''}. Hold sends a live report back to the queue; Restore brings back a rejected one as it was.</p>
      <List<ReportRow>
        rows={list.rows}
        idOf={(r) => r.id}
        noun="reports"
        loading={list.loading}
        error={list.error}
        onRetry={() => void list.refresh()}
        total={list.total}
        hasMore={list.hasMore}
        loadingMore={list.loadingMore}
        onLoadMore={() => void list.loadMore()}
        newCount={list.newCount}
        onShowNew={list.showNew}
        actions={[mod]}
        empty={<EmptyState icon="search" title={query || state !== 'all' ? 'No reports match these filters.' : 'No reports yet.'} />}
        renderRow={(r) => {
          const st = r.state ? STATE_TEXT[r.state] : null
          const options = moderationFor(r.state)
          return (
            <CursorRow id={r.id} cursor={keys.cursor === r.id}>
              <Row
                testId={`recent-row-${r.id}`}
                title={`${r.company_name || 'Unknown company'} — ${outcomeWord(r)}`}
                onOpen={() => shell.openItem('report', r.id)}
                sub={snippet(r.report_text) || 'No text.'}
                status={<Chips items={[
                  st ? { tone: st.tone, label: st.label } : null,
                  r.counted ? { tone: 'info', label: 'Counts in grade' } : { tone: 'neutral', label: 'Not counted' },
                  { tone: outcomeTone(r.outcome), label: outcomeWord(r) },
                  r.employeeReview ? { tone: 'info', label: 'Employee review' } : null,
                  r.rules === 'fails' ? { tone: 'bad', label: 'Fails the rules check' } : r.rules === 'passes' ? { tone: 'good', label: 'Passes the rules check' } : null,
                ]} />}
                meta={<Meta parts={[sourceWord(r), r.role, when(r.created_at)]} />}
                pending={mod.busy(r.id)}
                actions={options.length ? (
                  <RowActions>
                    {options.map((d, i) => (
                      <Button key={d} variant={i === 0 ? 'secondary' : 'ghost'} onClick={() => decide(r, d)} disabled={mod.busy(r.id)} data-testid={`recent-${d}-${r.id}`}>
                        {DECISION_TEXT[d].label}
                      </Button>
                    ))}
                  </RowActions>
                ) : undefined}
                below={mod.state(r.id).status === 'error' ? <Line state={mod.state(r.id)} onRetry={() => mod.retry(r.id)} onDismiss={() => mod.dismiss(r.id)} /> : undefined}
              />
            </CursorRow>
          )
        }}
      />
    </div>
  )
}
