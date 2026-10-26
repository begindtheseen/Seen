'use client'

// The two states every data-backed page must be able to show besides "data" and "empty":
//   • LoadError — the request failed. Says what could not be loaded and offers Retry. A failed load
//     is NEVER rendered as an empty state ("No applications yet", "0 TOTAL", "No company data yet"):
//     the audit of 2026-10-24 (R-1) found a dead API shown as an empty account.
//   • PageSkeleton — the first load is in flight (R-2). Uses the `.sk` shimmer from globals.css.
// Shared by the dashboard, tracker, companies, company page, jobs and the employer hub so the words
// and the Retry affordance are the same everywhere.

import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import styles from './LoadStates.module.css'

export function LoadError({ what, detail, onRetry, retrying = false, compact = false, children }: {
  /** What failed to load, e.g. "your applications", "the company scoreboard". */
  what: string
  /** One optional line of extra truth, e.g. "Showing what this device last synced." */
  detail?: string
  onRetry?: () => void
  retrying?: boolean
  compact?: boolean
  children?: React.ReactNode
}) {
  return (
    <div role="alert" data-testid="load-error" className={`${styles.err}${compact ? ' ' + styles.compact : ''}`}>
      <Icon name="circle-alert" size={20} className={styles.errIcon} />
      <div className={styles.errText}>
        <div className={styles.errTitle}>Couldn&apos;t load {what}.</div>
        {detail && <div className={styles.errDetail}>{detail}</div>}
        {children}
      </div>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry} disabled={retrying} loading={retrying} data-testid="load-retry" icon={retrying ? undefined : 'refresh-cw'}>
          {retrying ? 'Retrying…' : 'Retry'}
        </Button>
      )}
    </div>
  )
}

/** A page-shaped shimmer for the first load: a header line, a row of tiles, then list rows. */
export function PageSkeleton({ label = 'Loading', tiles = 4, rows = 3 }: { label?: string; tiles?: number; rows?: number }) {
  return (
    <div role="status" aria-label={label} aria-live="polite" data-testid="page-skeleton" className={styles.sk}>
      <div className={`sk ${styles.skTitle}`} />
      <div className={`sk ${styles.skLine}`} />
      {tiles > 0 && (
        <div className={styles.skTiles} style={{ gridTemplateColumns: `repeat(${tiles}, minmax(0, 1fr))` }}>
          {Array.from({ length: tiles }, (_, i) => <div key={i} className={`sk ${styles.skTile}`} />)}
        </div>
      )}
      {Array.from({ length: rows }, (_, i) => <div key={i} className={`sk ${styles.skRow}`} />)}
      <span className="sr-only">{label}…</span>
    </div>
  )
}
