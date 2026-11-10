'use client'

// A keyset list of rows (audit §3.6). Desktop: one line per row (select · what · meta · actions).
// Under 560px every row stacks into a card — title line, meta line, actions line — so nothing is a
// table on a phone and nothing scrolls sideways. "Load more" asks for the next page after the last row
// on screen; new rows the server has are announced ("3 new — show") instead of being pushed in above
// what the owner is reading.
import type { ReactNode } from 'react'
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
}

export function List<Row>({ rows, idOf, renderRow, noun, loading, error, onRetry, empty, total, hasMore, loadingMore, onLoadMore, newCount = 0, onShowNew }: ListProps<Row>) {
  if (loading && !rows.length) return <Skeleton rows={5} label={`Loading ${noun}`} />
  if (error && !rows.length) return <ErrorState what={noun} error={error} onRetry={onRetry} />
  if (!rows.length) return <>{empty ?? <EmptyState title={`No ${noun}.`} />}</>
  return (
    <div className={styles.listWrap}>
      {error && onRetry ? <RefreshFailed error={error} onRetry={onRetry} /> : null}
      {newCount > 0 && onShowNew ? (
        <button type="button" className={styles.newRows} onClick={onShowNew} data-testid="list-new">
          {fmt(newCount)} new {newCount === 1 ? 'row' : 'rows'} — show
        </button>
      ) : null}
      <ul className={styles.list} aria-label={noun}>
        {rows.map((r) => <li key={idOf(r)} className={styles.listItem}>{renderRow(r)}</li>)}
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
export function BulkBar({ count, noun, children, onClear }: { count: number; noun: string; children: ReactNode; onClear: () => void }) {
  if (count <= 0) return null
  return (
    <div className={styles.bulk} role="region" aria-label="Selected rows" data-testid="bulk-bar">
      <span className={styles.bulkCount}>{fmt(count)} {noun} selected</span>
      <div className={styles.bulkActions}>
        {children}
        <Button variant="ghost" onClick={onClear}>Clear</Button>
      </div>
    </div>
  )
}
