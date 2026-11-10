'use client'

// The three states every admin read can be in besides "data": empty, failed, first load — plus the
// small "couldn't refresh" line for a refresh that failed while the old data stays on screen.
// A failed read is NEVER drawn as empty, and a missing number is NEVER drawn as 0.
import type { ReactNode } from 'react'
import Button from '@/components/ui/Button'
import Icon, { type IconName } from '@/components/ui/Icon'
import type { AdminErr } from '../contract.ts'
import styles from './ui.module.css'

export function EmptyState({ icon = 'inbox', title, body, action }: { icon?: IconName; title: ReactNode; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className={styles.empty} data-testid="empty-state">
      <Icon name={icon} size={24} className={styles.emptyIcon} />
      <div className={styles.emptyTitle}>{title}</div>
      {body ? <div className={styles.emptyBody}>{body}</div> : null}
      {action ? <div className={styles.emptyAction}>{action}</div> : null}
    </div>
  )
}

/** A read that failed and has nothing to show. `what` completes "Couldn't load …". */
export function ErrorState({ what, error, onRetry, retrying }: { what: string; error?: AdminErr | string; onRetry?: () => void; retrying?: boolean }) {
  const detail = typeof error === 'string' ? error : error?.error
  return (
    <div className={styles.error} role="alert" data-testid="error-state">
      <Icon name="circle-alert" size={20} className={styles.errorIcon} />
      <div className={styles.errorText}>
        <div className={styles.errorTitle}>Couldn&apos;t load {what}.</div>
        {detail ? <div className={styles.errorDetail}>{detail}</div> : null}
      </div>
      {onRetry ? <Button variant="secondary" icon="refresh-cw" onClick={onRetry} loading={retrying} data-testid="error-retry">Retry</Button> : null}
    </div>
  )
}

/** A refresh failed; the data on screen is the last good copy. */
export function RefreshFailed({ error, onRetry }: { error?: AdminErr; onRetry: () => void }) {
  if (!error) return null
  return (
    <div className={styles.stale} role="status" data-testid="refresh-failed">
      <Icon name="triangle-alert" size={16} />
      <span>Couldn&apos;t refresh — showing what was read before. {error.error}</span>
      <button type="button" className={styles.lineLink} onClick={onRetry}>Retry</button>
    </div>
  )
}

export function Skeleton({ rows = 4, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div className={styles.skeleton} role="status" aria-label={label} data-testid="skeleton">
      {Array.from({ length: rows }, (_, i) => <div key={i} className={`sk ${styles.skRow}`} />)}
      <span className="sr-only">{label}…</span>
    </div>
  )
}

/** The hairline at the top of a section while a read is in flight (data stays visible under it). */
export function RefreshHairline({ active }: { active: boolean }) {
  return <div className={active ? `${styles.hair} ${styles.hairOn}` : styles.hair} aria-hidden="true" data-testid={active ? 'refreshing' : undefined} />
}
