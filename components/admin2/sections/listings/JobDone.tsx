'use client'

// A long job on screen: progress while it runs (the core's JobProgress); once it is done, the SERVER's sentence
// for a one-round job ("Cleared 1,261 listings · 25 kept hidden because someone saved or tracked them"), or the
// summed summary for a multi-round one with the server's last sentence after it — never a sentence built here
// under the wrong noun. `summary` lets a caller word the sum itself (e.g. one row / N rows).
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import type { Job } from '../../core/jobs.ts'
import { JobProgress } from '../../ui/Job.tsx'
import styles from './listings.module.css'

export function doneText(job: Job, summary?: (j: Job) => string): string {
  const last = (job.last_message || '').trim()
  if (job.rounds <= 1 && last && !summary) return last
  const head = summary ? summary(job) : job.message
  return last && last !== head && job.rounds > 1 ? `${head} Last round: ${last}` : head
}

export default function JobDone({ job, onCancel, onResume, onDismiss, onUndo, summary, testId }: {
  job: Job; onCancel?: () => void; onResume?: () => void; onDismiss?: () => void; onUndo?: () => void; summary?: (j: Job) => string; testId?: string
}) {
  if (job.status !== 'done') return <JobProgress job={job} onCancel={onCancel} onResume={onResume} onDismiss={onDismiss} />
  return (
    <div className={styles.doneLine} role="status" aria-live="polite" data-testid={testId || 'job-done'} data-status="done">
      <span className={styles.doneWord}><Icon name="circle-check" size={16} />Done</span>
      <span className={styles.doneText}>{doneText(job, summary)}</span>
      <span className={styles.actions}>
        {onUndo && job.undo ? <Button variant="secondary" icon="undo-2" onClick={onUndo} data-testid="job-undo">Undo</Button> : null}
        {onDismiss ? <Button variant="ghost" onClick={onDismiss} data-testid="job-dismiss">Dismiss</Button> : null}
      </span>
    </div>
  )
}
