'use client'

// Today (audit §3.1): four numbers, the work waiting (one row per queue, each one tap from that queue),
// and one line about the scheduled jobs. Nothing else. A number that could not be read says so.
import { formatPacific } from '@/lib/time/pacific'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import type { AdminOverview } from '../../contract.ts'
import { useAdminQuery, useApi } from '../../core/hooks.tsx'
import type { SectionProps } from '../../core/sections.tsx'
import { useShell } from '../../core/shellContext.ts'
import { QueueRow, SectionHeader, StatStrip, StatTile } from '../../ui/bits.tsx'
import { ErrorState, RefreshFailed, Skeleton } from '../../ui/states.tsx'
import { emptyLine, money, readToday } from './adapter.ts'
import styles from './today.module.css'

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

export default function TodaySection({ active }: SectionProps) {
  const api = useApi()
  const shell = useShell()
  const q = useAdminQuery<AdminOverview>('overview', () => api<AdminOverview>('overview'), { staleMs: 30_000, refetchOnFocus: active })
  const view = q.data ? readToday(q.data) : null
  const asOf = view?.asOf ? formatPacific(view.asOf, { timeStyle: 'short' }) : ''

  return (
    <div className={styles.today} data-testid="section-today">
      <SectionHeader
        title="Today"
        sub={asOf ? `Read at ${asOf}.` : q.loading ? 'Reading…' : undefined}
        fetching={q.fetching && !!q.data}
        actions={<Button variant="ghost" icon="refresh-cw" onClick={() => void q.refresh()} disabled={q.fetching} data-testid="today-refresh">Refresh</Button>}
      />

      {!view && q.loading ? <Skeleton rows={6} label="Reading today’s numbers" /> : null}
      {!view && q.error ? <ErrorState what="today’s numbers" error={q.error} onRetry={() => void q.refresh()} retrying={q.fetching} /> : null}

      {view ? (
        <>
          <RefreshFailed error={q.error} onRetry={() => void q.refresh()} />
          {view.degraded ? (
            <div className={styles.degraded} role="status" data-testid="today-degraded">
              <Icon name="triangle-alert" size={16} />
              <span>
                Some numbers couldn&apos;t be read{view.failedLabels.length ? ` (${view.failedLabels.join(', ')})` : ''}. They show as “couldn&apos;t read”, never as zero.
              </span>
              <button type="button" className={styles.inlineLink} onClick={() => void q.refresh()}>Retry</button>
            </div>
          ) : null}

          <StatStrip label="Today in numbers">
            <StatTile label="Live listings" value={view.stats.listings_live} testId="stat-listings"
              sub={view.stats.listings_stale === null ? 'stale count couldn’t be read' : `${fmt(view.stats.listings_stale)} stale`} />
            <StatTile label="New reports · 24 h" value={view.stats.reports_24h} testId="stat-reports" />
            <StatTile label="Sign-ups · 24 h" value={view.stats.signups_24h} testId="stat-signups" />
            <StatTile label="Revenue · 7 days" value={view.stats.revenue_7d_cents} format={money} sub="one-time purchases" testId="stat-revenue" />
          </StatStrip>

          <h2 className={styles.h2}>Work waiting</h2>
          {view.waiting.length ? (
            <div className={styles.queues}>
              {view.waiting.map((wq) => (
                <QueueRow key={wq.key} label={wq.label} count={wq.count} testId={`queue-${wq.key}`}
                  onOpen={() => shell.goSection(wq.section, wq.filter)} />
              ))}
            </div>
          ) : (
            <p className={styles.calm} data-testid="today-nothing"><Icon name="circle-check" size={16} />Nothing is waiting for you.</p>
          )}
          {view.empty.length ? <p className={styles.quiet} data-testid="today-empty-queues">{emptyLine(view.empty)}</p> : null}

          <h2 className={styles.h2}>Scheduled jobs</h2>
          <button type="button" className={`${styles.system} ${view.system.ok === true ? styles.sysGood : view.system.ok === false ? styles.sysBad : styles.sysUnknown}`}
            onClick={() => shell.goSection('system')} data-testid="today-system">
            <span className={styles.sysWord}>
              <Icon name={view.system.ok === true ? 'circle-check' : view.system.ok === false ? 'circle-x' : 'circle-help'} size={16} />
              {view.system.ok === true ? 'On time' : view.system.ok === false ? 'Failing' : 'Unknown'}
            </span>
            <span className={styles.sysLine}>
              {view.system.line}
              {view.system.ok === false && view.system.failing[0] ? (
                <span className={styles.sysDetail}>
                  {view.system.failing[0].name}: {view.system.failing[0].detail}
                  {view.system.failing[0].last_run ? ` · last ran ${formatPacific(view.system.failing[0].last_run, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ' · no run recorded'}
                </span>
              ) : null}
            </span>
            <Icon name="chevron-right" size={20} className={styles.sysChevron} />
          </button>
        </>
      ) : null}
    </div>
  )
}
