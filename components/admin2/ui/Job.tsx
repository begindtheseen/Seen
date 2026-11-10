'use client'

// Long jobs on screen: JobProgress (inline, where the job was started, and in the jobs sheet) and
// JobChip (one in the shell, visible from every section while anything runs or waits to be read).
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import { jobProgressText, jobTotal, type Job } from '../core/jobs.ts'
import styles from './ui.module.css'

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

export function jobWord(j: Job): string {
  if (j.status === 'running') return 'Running'
  if (j.status === 'cancelling') return 'Stopping'
  if (j.status === 'done') return 'Done'
  if (j.status === 'error') return 'Stopped'
  return j.resumable ? 'Paused' : 'Cancelled'
}

/** "Resume clearing stale listings — 12,582 left". */
export function resumeLabel(j: Job): string {
  const verb = j.label.charAt(0).toLowerCase() + j.label.slice(1)
  return typeof j.remaining === 'number' && j.remaining > 0 ? `Resume ${verb} — ${fmt(j.remaining)} left` : `Resume ${verb}`
}

export function JobProgress({ job, onCancel, onResume, onDismiss }: { job: Job; onCancel?: () => void; onResume?: () => void; onDismiss?: () => void }) {
  const live = job.status === 'running' || job.status === 'cancelling'
  const total = jobTotal(job)
  const pct = total ? Math.min(100, Math.round((job.changed / Math.max(1, total)) * 100)) : null
  const tone = live ? styles.lineRun : job.status === 'done' ? styles.lineGood : job.status === 'error' ? styles.lineBad : styles.lineWarn
  return (
    <div className={`${styles.job} ${tone}`} role="status" aria-live="polite" data-testid="job-progress" data-status={job.status}>
      <div className={styles.jobTop}>
        <span className={styles.lineWord}>
          {live ? <span className={styles.spin} aria-hidden="true" /> : <Icon name={job.status === 'done' ? 'circle-check' : job.status === 'error' ? 'circle-x' : 'circle-slash'} size={16} />}
          {jobWord(job)}
        </span>
        <span className={styles.jobLabel}>{job.label}</span>
        {live ? <span className={styles.jobCount}>{jobProgressText(job)}</span> : null}
      </div>
      {live ? (
        <div
          className={styles.bar}
          role="progressbar"
          aria-label={job.label}
          aria-valuemin={0}
          aria-valuemax={total ?? undefined}
          aria-valuenow={total ? job.changed : undefined}
          aria-valuetext={jobProgressText(job)}
        >
          <span className={pct == null ? `${styles.barFill} ${styles.barIndet}` : styles.barFill} style={pct == null ? undefined : { transform: `scaleX(${pct / 100})` }} />
        </div>
      ) : null}
      <div className={styles.jobMsg}>{job.message}</div>
      <div className={styles.jobActions}>
        {live && onCancel ? <Button variant="ghost" onClick={onCancel} disabled={job.status === 'cancelling'} data-testid="job-cancel">{job.status === 'cancelling' ? 'Stopping after this round…' : 'Cancel'}</Button> : null}
        {!live && job.resumable && onResume ? <Button variant="secondary" icon="refresh-cw" onClick={onResume} data-testid="job-resume">{resumeLabel(job)}</Button> : null}
        {!live && onDismiss ? <Button variant="ghost" onClick={onDismiss} data-testid="job-dismiss">Dismiss</Button> : null}
      </div>
    </div>
  )
}

/** The shell's chip: the running job with its count, or the newest result that has not been read. */
export function JobChip({ jobs, onOpen }: { jobs: Job[]; onOpen: () => void }) {
  if (!jobs.length) return null
  const live = jobs.filter((j) => j.status === 'running' || j.status === 'cancelling')
  const show = live[0] || jobs[jobs.length - 1]
  const more = jobs.length - 1
  const total = jobTotal(show)
  const pct = total ? Math.min(100, Math.round((show.changed / Math.max(1, total)) * 100)) : null
  const isLive = show.status === 'running' || show.status === 'cancelling'
  return (
    <button type="button" className={styles.jobChip} onClick={onOpen} data-testid="job-chip" aria-label={`${show.label}: ${isLive ? jobProgressText(show) : jobWord(show)}. Open jobs.`}>
      {isLive ? <span className={styles.spin} aria-hidden="true" /> : <Icon name={show.status === 'done' ? 'circle-check' : 'circle-slash'} size={16} />}
      <span className={styles.jobChipText}>
        <span className={styles.jobChipLabel}>{isLive ? show.label : `${jobWord(show)}: ${show.label}`}</span>
        <span className={styles.jobChipCount}>{isLive ? jobProgressText(show) : more > 0 ? `+${more} more` : 'Open'}</span>
      </span>
      {isLive ? <span className={styles.jobChipBar}><span className={pct == null ? `${styles.barFill} ${styles.barIndet}` : styles.barFill} style={pct == null ? undefined : { transform: `scaleX(${pct / 100})` }} /></span> : null}
    </button>
  )
}
