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
import { BulkBar, List, Row, RowActions } from '../../ui/List.tsx'
import { EmptyState } from '../../ui/states.tsx'
import {
  FLAG_TEXT, GROUP_TEXT, HELD_VIEWS, MAX_BULK, approvableIds, filterNote, fmt, groupOf, heldHasRules, heldSearchFields,
  heldViewCounts, heldWhy, label, matchesHeldView, matchesQuery, newRequestId, outcomeTone, parseHeldView,
  plural, approvePlan, pruneSelection, nothingToPublishLine, snippet, when, type HeldRow, type HeldView,
} from './adapter.ts'
import { Chips, Choice, CursorRow, KeysHint, Line, Meta, RecomputeLine } from './parts.tsx'
import { useListKeys } from './reviewHooks.tsx'
import styles from './review.module.css'

const PAGE = 200
const SORTS = [
  { value: 'needs_eyes', label: 'Needs eyes first' },
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
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
  // Which bulk approve is waiting for its confirm: the clear positives, or the selection.
  const [confirmApprove, setConfirmApprove] = useState<'positive' | 'selection' | null>(null)
  // Rows the owner ticked one by one: only these can bring an anti-gaming hold or a possible duplicate into a bulk approve.
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [lastRow, setLastRow] = useState<string | null>(null)
  const [lastTarget, setLastTarget] = useState<string | null>(null)
  const [limit, setLimit] = useState(PAGE)
  const pendingCursors = useRef<string[]>([])
  // The score count the decision's answer gave, so progress reads "0 of 71" before the job's first round.
  const [recomputeQueued, setRecomputeQueued] = useState<number | null>(null)

  // The server flags copies of held AND published reports (review.duplicate_of_live) — no client memory needed.
  const rows = list.rows
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const truncated = !!(list.data as { truncated?: boolean } | undefined)?.truncated
  const hasRules = heldHasRules(rows)
  const counts = useMemo(() => heldViewCounts(rows), [rows])
  const filtered = useMemo(() => rows.filter((r) => matchesHeldView(r, view) && matchesQuery(heldSearchFields(r), q)), [rows, view, q])
  const isFiltered = view !== 'all' || !!q.trim()
  const shown = filtered.slice(0, limit)
  const positivePlan = useMemo(() => approvePlan(rows, 'positive'), [rows])
  const selectionPlan = useMemo(() => approvePlan(rows, 'selection', selected, picked), [rows, selected, picked])

  // Rows decided elsewhere (the sheet, another tab) leave the selection too.
  // Not while a bulk decision is in flight: its rows leave optimistically, and the bar (with its busy confirm)
  // must stay put until the answer lands — a second tap then lands on a disabled button, not the list.
  const bulkBusyRef = useRef(false)
  const bulkArgsRef = useRef<Record<string, unknown> | null>(null)
  // The selection a bulk-bar press acted on: once it lands, every row of it leaves the selection (the ones the
  // server changed AND the ones held back), while rows ticked meanwhile stay ticked.
  const snapRef = useRef<Set<string> | null>(null)
  useEffect(() => { if (!bulkBusyRef.current) { setSelected((s) => pruneSelection(s, rows)); setPicked((s) => pruneSelection(s, rows)) } }, [rows])

  const recomputeJob = [...allJobs].reverse().find((j) => j.action === 'recompute_queue_drain')
  const recomputeRunning = !!recomputeJob && (recomputeJob.status === 'running' || recomputeJob.status === 'cancelling')
  const startRecompute = (cursor?: string, total?: number) => {
    // The decision's answer already says how many scores are queued: the job carries that total from the start,
    // so this line and the global job bar both read "0 of 58".
    jobs.start({ action: 'recompute_queue_drain', args: cursor ? { cursor } : {}, label: 'Updating company scores', past: 'Updated', noun: 'company scores', ...(total ? { total } : {}) })
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
      const leaving = args.decision === 'approve' ? approvableIds(rowsRef.current, ids, (args.include_ids as string[] | undefined) || []) : ids
      tx.removeRows('held', leaving)
    },
    onSettled: (res, args) => {
      const ids = args.ids as string[]
      const isBulk = args === bulkArgsRef.current
      if (isBulk) { bulkBusyRef.current = false; bulkArgsRef.current = null }
      // Only what this press acted on leaves the selection — never a newer selection made meanwhile.
      const sent = new Set(ids)
      if (isBulk && snapRef.current && res.ok) for (const id of snapRef.current) sent.add(id)
      if (isBulk) snapRef.current = null
      const drop = (cur: Set<string>) => { if (![...cur].some((id) => sent.has(id))) return cur; const n = new Set(cur); for (const id of sent) n.delete(id); return n }
      if (res.ok) {
        setSelected(drop); setPicked(drop)
        const rc = (res as AdminOk & { recompute?: Recompute }).recompute
        if (rc && (rc.remaining || 0) > 0) {
          setRecomputeQueued((q) => (recomputeRunning && q ? q + (rc.remaining || 0) : rc.remaining || 0))
          if (recomputeRunning) { if (rc.cursor) pendingCursors.current.push(rc.cursor) } else startRecompute(rc.cursor, rc.remaining)
        }
      }
      setConfirmReject(false)
      setConfirmApprove(null)
    },
  })

  const run = (decision: 'approve' | 'reject', ids: string[], target: string, extra: Record<string, unknown> = {}, fromSelection = false) => {
    if (!ids.length) return
    setLastTarget(target)
    if (target !== 'bulk') setLastRow(target)
    const args = { decision, request_id: newRequestId(), ...extra, ids: ids.slice(0, MAX_BULK) }
    if (target === 'bulk' && !decide.busy('bulk')) { bulkBusyRef.current = true; bulkArgsRef.current = args; snapRef.current = fromSelection ? new Set(selected) : null }
    void decide.run(args, target)
  }
  // A single report is never filtered by the server's bulk guard: approving one row is the owner naming it.
  const one = (decision: 'approve' | 'reject', r: HeldRow) => run(decision, [r.id], r.id)
  const byId = (id: string) => rows.find((r) => r.id === id)

  const toggle = (id: string) => {
    const on = !selected.has(id)
    setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n })
    setPicked((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n })
  }
  const clearSelection = () => { setSelected(new Set()); setPicked(new Set()); setConfirmReject(false); setConfirmApprove(null) }
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
    anti_gaming_hold: { label: 'Review the holds', onSelect: () => setView('anti_gaming') },
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
            <span className={styles.hidePhone}>Sort</span>
            <select className={`ui-input ${styles.select}`} aria-label="Sort held reports" value={sort} onChange={(e) => setSort(e.target.value)} data-testid="held-sort">
              {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
        </div>
        <KeysHint keys={[['j k', 'move'], ['Enter', 'open'], ['a', 'approve'], ['r', 'reject'], ['x', 'select'], ['u', 'undo'], ['/', 'search this list']]} />
      </div>

      {rows.length ? (
        <div className={styles.actions}>
          {positivePlan.ids.length && confirmApprove !== 'positive' ? (
            <Button variant="primary" icon="check" onClick={() => setConfirmApprove('positive')} disabled={decide.busy('bulk')} data-testid="held-approve-positive">
              Approve all positive ({fmt(positivePlan.ids.length)})
            </Button>
          ) : null}
          {!positivePlan.ids.length ? (
            <p className={styles.leftLine} data-testid="held-nothing-positive">
              {nothingToPublishLine(positivePlan)}
              {positivePlan.heldBack.duplicates ? <button type="button" className={styles.inlineLink} onClick={() => setView('duplicates')}>Review the duplicates</button> : null}
            </p>
          ) : null}
          {confirmApprove === 'positive' ? (
            <ConfirmStep
              title={`Publish ${plural(positivePlan.ids.length, 'clear positive')}?`}
              body={<span data-testid="held-positive-plan">{positivePlan.sentence} Undo puts them back in this queue.</span>}
              confirmLabel={`Publish ${fmt(positivePlan.ids.length)}`}
              tone="primary"
              busy={decide.busy('bulk')}
              onCancel={() => setConfirmApprove(null)}
              onConfirm={() => run('approve', positivePlan.ids, 'bulk')}
            />
          ) : null}
          {filtered.length ? (
            <Button variant="secondary" onClick={() => (allMatchingSelected ? clearSelection() : setSelected(new Set(filtered.map((r) => r.id))))} data-testid="held-select-all">
              {allMatchingSelected ? 'Clear selection' : isFiltered ? `Select all ${fmt(filtered.length)} matching` : `Select all ${fmt(filtered.length)}`}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className={styles.lines}>
        <Line state={bulkState} onUndo={() => decide.undo('bulk')} onRetry={() => decide.retry('bulk')} onDismiss={() => decide.dismiss('bulk')}
          runningText={`${bulkState.args?.decision === 'reject' ? 'Rejecting' : 'Approving'} ${plural((bulkState.args?.ids as string[] | undefined)?.length || 0, 'report')}…`} skipLinks={skipLinks} />
        {lastRow && lastRowState && lastRowState.status === 'done' ? (
          <Line state={lastRowState} onUndo={() => decide.undo(lastRow)} onDismiss={() => { decide.dismiss(lastRow); setLastRow(null) }} skipLinks={skipLinks} />
        ) : null}
        {recomputeJob ? <RecomputeLine job={recomputeJob} queued={recomputeQueued} onCancel={() => jobs.cancel(recomputeJob.id)} onResume={() => jobs.resume(recomputeJob.id)} onDismiss={() => jobs.dismiss(recomputeJob.id)} /> : null}
      </div>

      {rows.length && (isFiltered || truncated) ? (
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
                  <Line state={decide.state(r.id)} onRetry={() => decide.retry(r.id)} onDismiss={() => decide.dismiss(r.id)} />
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

      <BulkBar count={selected.size} noun={selected.size === 1 ? 'report' : 'reports'} onClear={clearSelection}>
        {confirmApprove === 'selection' ? (
          <ConfirmStep
            inline
            title={selectionPlan.ids.length ? `Publish ${plural(Math.min(selectionPlan.ids.length, MAX_BULK), 'selected report')}?` : 'Nothing selected can be published in bulk'}
            body={<span data-testid="held-selection-plan">{selectionPlan.sentence} Undo puts them back in this queue.</span>}
            confirmLabel={`Publish ${fmt(Math.min(selectionPlan.ids.length, MAX_BULK))}`}
            busy={decide.busy('bulk')}
            onCancel={() => setConfirmApprove(null)}
            onConfirm={() => { if (selectionPlan.ids.length) run('approve', selectionPlan.sendIds, 'bulk', selectionPlan.includeIds.length ? { include_ids: selectionPlan.includeIds } : {}, true) }}
          />
        ) : confirmReject ? (
          <ConfirmStep
            inline
            title={`Reject ${plural(Math.min(selectedIds.length, MAX_BULK), 'held report')}?`}
            body="They stay stored but are hidden from company pages and never count in a grade. Undo puts them back in this queue."
            confirmLabel={`Reject ${fmt(Math.min(selectedIds.length, MAX_BULK))}`}
            busy={decide.busy('bulk')}
            onCancel={() => setConfirmReject(false)}
            onConfirm={() => run('reject', selectedIds, 'bulk', {}, true)}
          />
        ) : (
          <>
            <Button variant="secondary" onClick={() => setConfirmApprove('selection')} disabled={decide.busy('bulk')} data-testid="held-bulk-approve">
              {overCap ? `Approve the first ${fmt(MAX_BULK)}…` : 'Approve…'}
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
