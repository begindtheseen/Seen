'use client'

// Held reports — the owner's "approve all" (audit defect 1). One press sends every id in the POST body
// with ONE request_id (a retry or a double tap can never double-run or call its own work "already
// decided"); rows leave in place; the result line repeats the server's exact counts, names the skipped
// rows as links ("24 skipped as possible duplicates — Review them") and offers Undo. Company scores
// recompute as a background job with its own quiet progress; the list never waits for it.
import { useEffect, useMemo, useRef, useState } from 'react'
import Button from '@/components/ui/Button'
import type { AdminOk } from '../../contract.ts'
import { useAdminAction, useAdminJobs, useRuntime, type ListView } from '../../core/hooks.tsx'
import { useUrlFilter } from '../../core/place.ts'
import { useShell } from '../../core/shellContext.ts'
import { SearchField } from '../../ui/bits.tsx'
import ConfirmStep from '../../ui/ConfirmStep.tsx'
import { JobProgress } from '../../ui/Job.tsx'
import { BulkBar, List, Row, RowActions } from '../../ui/List.tsx'
import ResultLine from '../../ui/ResultLine.tsx'
import { EmptyState } from '../../ui/states.tsx'
import {
  FLAG_TEXT, GROUP_TEXT, HELD_VIEWS, MAX_BULK, approvableIds, filterNote, fmt, groupOf, heldHasRules, heldSearchFields,
  heldViewCounts, heldWhy, isDuplicate, label, matchesHeldView, matchesQuery, newRequestId, outcomeTone, parseHeldView,
  plural, positiveIds, pruneSelection, snippet, when, type HeldRow, type HeldView,
} from './adapter.ts'
import { Chips, Choice, CursorRow, KeysHint, Meta } from './parts.tsx'
import { useListKeys } from './reviewHooks.tsx'
import styles from './review.module.css'

const PAGE = 200
const SORTS = [
  { value: 'needs_eyes', label: 'Needs your eyes first' },
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'company', label: 'Company A–Z' },
  { value: 'outcome', label: 'Outcome' },
]
export const HELD_SORTS = SORTS.map((s) => s.value)

type Recompute = { queued?: number; done?: number; remaining?: number; cursor?: string }

export default function HeldPanel({ on, visible, list, sort, setSort }: { on: boolean; visible: boolean; list: ListView<HeldRow>; sort: string; setSort: (s: string) => void }) {
  const shell = useShell()
  const { jobs } = useRuntime()
  const allJobs = useAdminJobs()
  const [viewRaw, setViewRaw] = useUrlFilter('review', 'view', 'all')
  const [qRaw, setQ] = useUrlFilter('review', 'q', '')
  // The URL's search belongs to the kind on screen; a hidden panel keeps its own view unfiltered.
  const q = on ? qRaw : ''
  const view = parseHeldView(viewRaw)
  const searchRef = useRef<HTMLInputElement>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmReject, setConfirmReject] = useState(false)
  const [lastRow, setLastRow] = useState<string | null>(null)
  const [lastTarget, setLastTarget] = useState<string | null>(null)
  const [limit, setLimit] = useState(PAGE)
  const pendingCursors = useRef<string[]>([])

  const rows = list.rows
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const truncated = !!(list.data as { truncated?: boolean } | undefined)?.truncated
  const hasRules = heldHasRules(rows)
  const counts = useMemo(() => heldViewCounts(rows), [rows])
  const filtered = useMemo(() => rows.filter((r) => matchesHeldView(r, view) && matchesQuery(heldSearchFields(r), q)), [rows, view, q])
  const isFiltered = view !== 'all' || !!q.trim()
  const shown = filtered.slice(0, limit)
  const positives = useMemo(() => positiveIds(rows), [rows])

  // Rows decided elsewhere (the sheet, another tab) leave the selection too.
  useEffect(() => { setSelected((s) => pruneSelection(s, rows)) }, [rows])

  const recomputeJob = [...allJobs].reverse().find((j) => j.action === 'recompute_queue_drain')
  const recomputeRunning = !!recomputeJob && (recomputeJob.status === 'running' || recomputeJob.status === 'cancelling')
  const startRecompute = (cursor?: string) => {
    jobs.start({ action: 'recompute_queue_drain', args: cursor ? { cursor } : {}, label: 'Updating company scores', past: 'Updated', noun: 'company scores' })
  }
  // A second decision while scores are still updating: its companies wait for the running job (only one at a time).
  useEffect(() => {
    if (recomputeRunning || !pendingCursors.current.length) return
    const next = pendingCursors.current.shift()
    startRecompute(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recomputeRunning])

  const decide = useAdminAction('review_held', {
    timeoutMs: 75_000,
    partialTouched: ['held', 'reports', 'overview'],
    // Rows the server will change leave at once; possible duplicates stay (a bulk approve skips them).
    optimistic: (tx, args) => {
      const ids = args.ids as string[]
      const leaving = args.decision === 'approve' ? approvableIds(rowsRef.current, ids, args.include_duplicates === true) : ids
      tx.removeRows('held', leaving)
    },
    onSettled: (res, args) => {
      const ids = args.ids as string[]
      if (res.ok) {
        if (ids.length > 1) setSelected(new Set())
        else setSelected((s) => { if (!s.has(ids[0])) return s; const n = new Set(s); n.delete(ids[0]); return n })
        const rc = (res as AdminOk & { recompute?: Recompute }).recompute
        if (rc && (rc.remaining || 0) > 0) {
          if (recomputeRunning) { if (rc.cursor) pendingCursors.current.push(rc.cursor) } else startRecompute(rc.cursor)
        }
      }
      setConfirmReject(false)
    },
  })

  const run = (decision: 'approve' | 'reject', ids: string[], target: string, extra: Record<string, unknown> = {}) => {
    if (!ids.length) return
    setLastTarget(target)
    if (target !== 'bulk') setLastRow(target)
    void decide.run({ decision, ids: ids.slice(0, MAX_BULK), request_id: newRequestId(), ...extra }, target)
  }
  const one = (decision: 'approve' | 'reject', r: HeldRow) => run(decision, [r.id], r.id, decision === 'approve' && isDuplicate(r) ? { include_duplicates: true } : {})
  const byId = (id: string) => rows.find((r) => r.id === id)

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const allMatchingSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id))
  const selectedIds = [...selected]
  const overCap = selectedIds.length > MAX_BULK

  const keys = useListKeys({
    enabled: visible,
    ids: shown.map((r) => r.id),
    onOpen: (id) => shell.openItem('report', id),
    onApprove: (id) => { const r = byId(id); if (r) one('approve', r) },
    onReject: (id) => { const r = byId(id); if (r) one('reject', r) },
    onToggle: toggle,
    onUndo: () => { if (lastTarget) decide.undo(lastTarget) },
    searchRef,
  })

  const viewOptions = HELD_VIEWS.filter((v) => v.value !== 'rules_fail' || hasRules).map((v) => ({ value: v.value, label: v.label, count: counts[v.value] }))
  const setView = (v: string) => { setViewRaw(v === 'all' ? '' : v); setLimit(PAGE) }
  const skipLinks = {
    possible_duplicate: { label: 'Review them', onSelect: () => setView('duplicates') },
  }
  const bulkState = decide.state('bulk')
  const lastRowState = lastRow ? decide.state(lastRow) : null

  return (
    <div className={styles.panel} data-testid="panel-held">
      <div className={styles.toolbar}>
        <Choice label="Saved filters" options={viewOptions} value={view} onChange={setView} testId="held-view" />
        <div className={styles.toolRow}>
          <div className={styles.grow}>
            <SearchField ref={searchRef} value={q} onChange={(v) => { setQ(v); setLimit(PAGE) }} label="Search held reports" placeholder="Search company, role, text" testId="held-search" />
          </div>
          <label className={styles.selectLabel}>
            Sort
            <select className={`ui-input ${styles.select}`} value={sort} onChange={(e) => setSort(e.target.value)} data-testid="held-sort">
              {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
        </div>
        <KeysHint keys={[['j k', 'move'], ['Enter', 'open'], ['a', 'approve'], ['r', 'reject'], ['x', 'select'], ['u', 'undo'], ['/', 'search this list']]} />
      </div>

      {rows.length ? (
        <div className={styles.actions}>
          {positives.length ? (
            <Button variant="primary" icon="check" onClick={() => run('approve', positives, 'bulk')} loading={decide.busy('bulk')} disabled={decide.busy('bulk')} data-testid="held-approve-positive">
              Approve all positive ({fmt(positives.length)})
            </Button>
          ) : null}
          {filtered.length ? (
            <Button variant="secondary" onClick={() => setSelected(allMatchingSelected ? new Set() : new Set(filtered.map((r) => r.id)))} data-testid="held-select-all">
              {allMatchingSelected ? 'Clear selection' : isFiltered ? `Select all ${fmt(filtered.length)} matching` : `Select all ${fmt(filtered.length)}`}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className={styles.lines}>
        <ResultLine state={bulkState} onUndo={() => decide.undo('bulk')} onRetry={() => decide.retry('bulk')} onDismiss={() => decide.dismiss('bulk')}
          runningText={`${bulkState.args?.decision === 'reject' ? 'Rejecting' : 'Approving'} ${plural((bulkState.args?.ids as string[] | undefined)?.length || 0, 'report')}…`} skipLinks={skipLinks} />
        {lastRow && lastRowState && lastRowState.status === 'done' ? (
          <ResultLine state={lastRowState} onUndo={() => decide.undo(lastRow)} onDismiss={() => { decide.dismiss(lastRow); setLastRow(null) }} skipLinks={skipLinks} />
        ) : null}
        {recomputeJob ? <JobProgress job={recomputeJob} onCancel={() => jobs.cancel(recomputeJob.id)} onResume={() => jobs.resume(recomputeJob.id)} onDismiss={() => jobs.dismiss(recomputeJob.id)} /> : null}
      </div>

      {rows.length ? (
        <p className={styles.note} data-testid="held-note">
          {filterNote(filtered.length, rows.length, { total: list.total, truncated, filtered: isFiltered, noun: 'held reports' })}
        </p>
      ) : null}

      <List<HeldRow>
        rows={shown}
        idOf={(r) => r.id}
        noun="held reports"
        loading={list.loading}
        error={list.error}
        onRetry={() => void list.refresh()}
        total={isFiltered ? undefined : list.total}
        newCount={list.newCount}
        onShowNew={list.showNew}
        empty={rows.length ? (
          <EmptyState icon="search" title={`No held reports match${view !== 'all' ? ` “${HELD_VIEWS.find((v) => v.value === view)?.label}”` : ''}${q.trim() ? ` “${q.trim()}”` : ''}.`}
            action={<Button variant="secondary" onClick={() => { setView('all'); setQ('') }}>Show every held report</Button>} />
        ) : (
          <EmptyState icon="circle-check" title="No held reports — nothing is waiting." body="New imports and anti-gaming holds land here for a decision." />
        )}
        renderRow={(r) => {
          const flags = (r.review?.flags || []).map((f) => FLAG_TEXT[f]).filter(Boolean)
          const group = groupOf(r)
          return (
            <CursorRow id={r.id} cursor={keys.cursor === r.id}>
              <Row
                testId={`held-row-${r.id}`}
                title={`${r.company_name || 'Unknown company'} — ${label(r.outcome) || 'no outcome'}`}
                onOpen={() => shell.openItem('report', r.id)}
                sub={snippet(r.report_text) || 'No text.'}
                status={<Chips items={[
                  { tone: outcomeTone(r.outcome), label: label(r.outcome) || 'No outcome' },
                  group !== 'needs_eyes' ? { tone: group === 'positive' ? 'good' : 'info', label: GROUP_TEXT[group] } : { tone: 'neutral', label: GROUP_TEXT.needs_eyes },
                  ...flags.filter((f) => f.label !== GROUP_TEXT[group]),
                  r.rules === 'fails' ? { tone: 'bad', label: 'Fails the rules check' } : r.rules === 'passes' ? { tone: 'good', label: 'Passes the rules check' } : null,
                ]} />}
                meta={<Meta parts={[r.platform || r.source, r.role, when(r.created_at), heldWhy(r)]} />}
                selected={selected.has(r.id)}
                onToggle={() => toggle(r.id)}
                selectLabel={`Select the ${r.company_name || ''} report`}
                pending={decide.busy(r.id)}
                actions={(
                  <RowActions>
                    <Button variant="secondary" onClick={() => one('approve', r)} disabled={decide.busy(r.id)} data-testid={`held-approve-${r.id}`}>Approve</Button>
                    <Button variant="ghost" onClick={() => one('reject', r)} disabled={decide.busy(r.id)} data-testid={`held-reject-${r.id}`}>Reject</Button>
                  </RowActions>
                )}
                below={decide.state(r.id).status === 'error' ? (
                  <ResultLine state={decide.state(r.id)} onRetry={() => decide.retry(r.id)} onDismiss={() => decide.dismiss(r.id)} />
                ) : undefined}
              />
            </CursorRow>
          )
        }}
      />
      {filtered.length > shown.length ? (
        <div className={styles.more}>
          <Button variant="ghost" onClick={() => setLimit((n) => n + PAGE)} data-testid="held-show-more">
            Show {fmt(Math.min(PAGE, filtered.length - shown.length))} more of {fmt(filtered.length - shown.length)} not shown
          </Button>
        </div>
      ) : null}

      <BulkBar count={selected.size} noun={selected.size === 1 ? 'report' : 'reports'} onClear={() => { setSelected(new Set()); setConfirmReject(false) }}>
        {confirmReject ? (
          <ConfirmStep
            inline
            title={`Reject ${plural(Math.min(selectedIds.length, MAX_BULK), 'held report')}?`}
            body="They stay stored but are hidden from company pages and never count in a grade. Undo puts them back in this queue."
            confirmLabel={`Reject ${fmt(Math.min(selectedIds.length, MAX_BULK))}`}
            busy={decide.busy('bulk')}
            onCancel={() => setConfirmReject(false)}
            onConfirm={() => run('reject', selectedIds, 'bulk')}
          />
        ) : (
          <>
            <Button variant="secondary" onClick={() => run('approve', selectedIds, 'bulk')} disabled={decide.busy('bulk')} data-testid="held-bulk-approve">
              {overCap ? `Approve the first ${fmt(MAX_BULK)}` : 'Approve'}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmReject(true)} disabled={decide.busy('bulk')} data-testid="held-bulk-reject">
              {overCap ? `Reject the first ${fmt(MAX_BULK)}…` : 'Reject…'}
            </Button>
          </>
        )}
      </BulkBar>
    </div>
  )
}

export type { HeldView }
