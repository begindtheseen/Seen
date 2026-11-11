'use client'

// A keyset list of rows (audit §3.6). Desktop: one line per row (select · what · meta · actions).
// Under 560px every row stacks into a card — title line, meta line, actions line — so nothing is a
// table on a phone and nothing scrolls sideways. "Load more" asks for the next page after the last row
// on screen; new rows the server has are announced ("3 new — show") instead of being pushed in above
// what the owner is reading.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ActionView } from '../core/hooks.tsx'
import ResultLine from './ResultLine.tsx'
import { checkingText, isChecking, type Checking } from './bits.tsx'
import Button from '@/components/ui/Button'
import type { AdminErr } from '../contract.ts'
import { EmptyState, ErrorState, RefreshFailed, Skeleton } from './states.tsx'
import styles from './ui.module.css'

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

export type ListProps<Row> = {
  rows: Row[]
  idOf: (row: Row) => string
  renderRow: (row: Row) => ReactNode
  /** e.g. "held reports" — used in "Couldn't load held reports." and the count line. */
  noun: string
  loading?: boolean
  error?: AdminErr
  onRetry?: () => void
  /** Shown when the list read fine and is empty. */
  empty?: ReactNode
  total?: number | null
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
  newCount?: number
  onShowNew?: () => void
  /**
   * The row actions (keyed by row id as their target). A row that leaves the list because one of them ran
   * keeps its place for a few seconds as that action's result line — with Undo — so the owner sees what
   * happened where he tapped (judge F2). The result dock holds it after that.
   */
  actions?: ActionView[]
}

/** How long a row that left keeps its slot as a result line. */
export const SLOT_MS = 6000

export function List<Row>({ rows, idOf, renderRow, noun, loading, error, onRetry, empty, total, hasMore, loadingMore, onLoadMore, newCount = 0, onShowNew, actions }: ListProps<Row>) {
  const slots = useLeavingSlots(rows, idOf, actions)
  if (loading && !rows.length) return <Skeleton rows={5} label={`Loading ${noun}`} />
  if (error && !rows.length) return <ErrorState what={noun} error={error} onRetry={onRetry} />
  if (!rows.length && !slots.list.length) return <>{empty ?? <EmptyState title={`No ${noun}.`} />}</>
  return (
    <div className={styles.listWrap}>
      {error && onRetry ? <RefreshFailed error={error} onRetry={onRetry} /> : null}
      {newCount > 0 && onShowNew ? (
        <button type="button" className={styles.newRows} onClick={onShowNew} data-testid="list-new">
          {fmt(newCount)} new {newCount === 1 ? 'row' : 'rows'} — show
        </button>
      ) : null}
      <ul className={styles.list} aria-label={noun}>
        {withSlots(rows, idOf, slots.list).map((x) => x.row !== undefined
          ? <li key={idOf(x.row)} className={styles.listItem}>{renderRow(x.row)}</li>
          : <li key={`slot:${x.slot!.id}`} className={styles.listItem} data-testid="row-result-slot">
              <ResultLine state={x.slot!.action.state(x.slot!.id)} onUndo={() => x.slot!.action.undo(x.slot!.id)}
                onRetry={() => x.slot!.action.retry(x.slot!.id)} onDismiss={() => slots.drop(x.slot!.id)} />
            </li>)}
      </ul>
      <div className={styles.listFoot}>
        <span className={styles.listCount}>
          {typeof total === 'number' ? `Showing ${fmt(rows.length)} of ${fmt(total)} ${noun}` : `Showing ${fmt(rows.length)} ${noun}${hasMore ? ' so far' : ''}`}
        </span>
        {hasMore && onLoadMore ? <Button variant="ghost" onClick={onLoadMore} loading={loadingMore} data-testid="list-more">Load more</Button> : null}
      </div>
    </div>
  )
}

export type RowProps = {
  title: ReactNode
  /** Opens the item's sheet. The title becomes a button; focus comes back to it on close. */
  onOpen?: () => void
  sub?: ReactNode
  meta?: ReactNode
  status?: ReactNode
  actions?: ReactNode
  /** Selection for the bulk bar. */
  selected?: boolean
  onToggle?: () => void
  selectLabel?: string
  /** A result line or an inline confirm under the row. */
  below?: ReactNode
  /** Leaving: dimmed while its action is in flight. */
  pending?: boolean
  testId?: string
}

export function Row({ title, onOpen, sub, meta, status, actions, selected, onToggle, selectLabel, below, pending, testId }: RowProps) {
  return (
    <div className={pending ? `${styles.row} ${styles.rowPending}` : styles.row} data-testid={testId} data-selected={selected ? 'true' : undefined}>
      {onToggle ? (
        <label className={styles.rowCheck}>
          <input type="checkbox" checked={!!selected} onChange={onToggle} aria-label={selectLabel || 'Select'} />
        </label>
      ) : null}
      <div className={styles.rowMain}>
        {onOpen ? (
          <button type="button" className={styles.rowTitleBtn} onClick={onOpen}>{title}</button>
        ) : <div className={styles.rowTitle}>{title}</div>}
        {sub ? <div className={styles.rowSub}>{sub}</div> : null}
        {meta || status ? <div className={styles.rowMeta}>{status}{meta}</div> : null}
      </div>
      {actions ? <div className={styles.rowActionsCell}>{actions}</div> : null}
      {below ? <div className={styles.rowBelow}>{below}</div> : null}
    </div>
  )
}

/** The buttons on a row: 44px targets; at most one of them filled (the screen's primary decision). */
export function RowActions({ children }: { children: ReactNode }) {
  return <div className={styles.rowActions}>{children}</div>
}

/** Sticky above the phone bar while rows are selected: "12 selected · Approve · Reject · Clear". */
export function BulkBar({ count, noun, children, onClear, checking }: {
  count: number; noun: string; children: ReactNode; onClear: () => void
  /** The selection's count is still being checked: its buttons wait (disabled) and the bar says so. */
  checking?: Checking | null
}) {
  if (count <= 0) return null
  return (
    <div className={styles.bulk} role="region" aria-label="Selected rows" data-testid="bulk-bar">
      <span className={styles.bulkCount}>{fmt(count)} {noun} selected{isChecking(checking) ? ` · ${checkingText(checking)}` : ''}</span>
      <div className={styles.bulkActions}>
        {/* A disabled fieldset disables every button the section put here until the count is final. */}
        <fieldset className={styles.bulkFieldset} disabled={isChecking(checking)} aria-busy={isChecking(checking) || undefined}>{children}</fieldset>
        <Button variant="ghost" onClick={onClear}>Clear</Button>
      </div>
    </div>
  )
}

type Slot = { id: string; index: number; action: ActionView; until: number }

/** Rows that just left because a row action ran keep their index for SLOT_MS. */
function useLeavingSlots<Row>(rows: Row[], idOf: (r: Row) => string, actions: ActionView[] | undefined) {
  const prev = useRef<string[]>([])
  const [list, setList] = useState<Slot[]>([])
  const ids = rows.map(idOf)
  const key = ids.join('|')
  useEffect(() => {
    const before = prev.current
    prev.current = ids
    if (!actions?.length) return
    const now = Date.now()
    const present = new Set(ids)
    const added: Slot[] = []
    before.forEach((id, index) => {
      if (present.has(id)) return
      const action = actions.find((a) => a.state(id).status !== 'idle')
      if (action) added.push({ id, index, action, until: now + SLOT_MS })
    })
    setList((cur) => [...cur.filter((s) => !present.has(s.id) && s.until > now && !added.some((a) => a.id === s.id)), ...added])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  useEffect(() => {
    if (!list.length) return
    const next = Math.min(...list.map((s) => s.until)) - Date.now()
    const t = setTimeout(() => setList((cur) => cur.filter((s) => s.until > Date.now())), Math.max(50, next))
    return () => clearTimeout(t)
  }, [list])
  return { list, drop: (id: string) => setList((cur) => cur.filter((s) => s.id !== id)) }
}

/** Interleave the slots at the index their row had. Pure. */
export function withSlots<Row>(rows: Row[], idOf: (r: Row) => string, slots: Slot[]): Array<{ row?: Row; slot?: Slot }> {
  const out: Array<{ row?: Row; slot?: Slot }> = rows.map((row) => ({ row }))
  const live = new Set(rows.map(idOf))
  for (const s of [...slots].filter((x) => !live.has(x.id)).sort((a, b) => a.index - b.index)) out.splice(Math.min(s.index, out.length), 0, { slot: s })
  return out
}
