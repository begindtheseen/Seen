'use client'

// Duplicate reports — the same account imported more than once. "Scan" reads every report (the server
// allows ~20 s) and says how many copies it found, by company; "Mark" runs as a job ("until done") with
// live progress. A marked copy is kept, hidden and never scored; each mark is undoable one by one from
// the activity log (the batch has no single Undo — see the report's requests).
import { useState } from 'react'
import Button from '@/components/ui/Button'
import type { AdminList } from '../../contract.ts'
import { useAdminJobs, useAdminQuery, useApi, useRuntime } from '../../core/hooks.tsx'
import ConfirmStep from '../../ui/ConfirmStep.tsx'
import { JobProgress } from '../../ui/Job.tsx'
import { EmptyState, ErrorState, RefreshFailed } from '../../ui/states.tsx'
import { fmt, newRequestId, plural, when } from './adapter.ts'
import styles from './review.module.css'

type DupeScan = AdminList<{ company: string; count: number }> & { suspected?: number; groups?: number; total?: number; message?: string }

export default function DupesPanel() {
  const api = useApi()
  const [asked, setAsked] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const scan = useAdminQuery<DupeScan>('report_dupes', () => api<DupeScan>('scan_report_dupes', {}, { timeoutMs: 60_000 }), { enabled: asked, staleMs: 5 * 60_000 })
  const { jobs } = useRuntime()
  const all = useAdminJobs()
  // One press = one request_id on EVERY round, so the server's single batch Undo covers the whole press.
  const job = [...all].reverse().find((j) => j.action === 'dedupe_reports')
  const running = !!job && (job.status === 'running' || job.status === 'cancelling')
  const undoJob = [...all].reverse().find((j) => j.action === 'undo' && j.args?.from === 'dedupe_reports')
  const [undoErr, setUndoErr] = useState<string | null>(null)
  const startMark = () => {
    if (running) return
    jobs.start({ action: 'dedupe_reports', args: { request_id: newRequestId() }, label: 'Marking duplicate copies', past: 'Marked', noun: 'duplicate copies', ...(suspected ? { total: suspected } : {}) })
  }
  // The job manager keeps no Undo handle, so the press's batch row is read from the activity log (newest
  // dedupe_reports row — the last round's, which covers every copy of the press) and undone as a job.
  const undoMarks = async () => {
    setUndoErr(null)
    const log = await api<{ rows?: Array<{ id: string; undoable: boolean }> }>('activity_log', { filter_action: 'dedupe_reports', limit: 1 })
    const row = log.ok ? log.rows?.[0] : null
    if (!row || !row.undoable) { setUndoErr(log.ok ? 'There is no mark left to undo — it was already undone or has expired.' : log.error); return }
    jobs.start({ action: 'undo', args: { audit_id: row.id, from: 'dedupe_reports' }, label: 'Putting the copies back', past: 'Put back', noun: 'copies', ...(job?.changed ? { total: job.changed } : {}) })
  }
  const data = scan.data
  const suspected = typeof data?.suspected === 'number' ? data.suspected : null
  const groups = typeof data?.groups === 'number' ? data.groups : null
  const byCompany = (Array.isArray(data?.rows) ? data!.rows : []) as Array<{ company: string; count: number }>

  return (
    <div className={styles.panel} data-testid="panel-dupes">
      <p className={styles.note}>
        A copy is the same company, outcome, platform, role and text stored twice. Marking keeps the oldest copy,
        hides the others and stops them counting in any grade. Nothing is deleted.
      </p>
      <div className={styles.actions}>
        <Button variant="secondary" icon="search" onClick={() => { if (!asked) setAsked(true); else void scan.refresh() }} loading={scan.fetching} disabled={scan.fetching} data-testid="dupes-scan">
          {data ? 'Scan again' : 'Scan every report'}
        </Button>
        {suspected && !confirm ? (
          <Button variant="secondary" onClick={() => setConfirm(true)} disabled={running} data-testid="dupes-mark">
            {running ? 'Marking…' : `Mark ${plural(suspected, 'copy', 'copies')}…`}
          </Button>
        ) : null}
      </div>
      {confirm ? (
        <ConfirmStep
          title={`Mark ${plural(suspected || 0, 'duplicate copy', 'duplicate copies')}?`}
          body="The oldest copy in each group stays as it is. The others are kept but hidden and never scored, and their companies are recomputed. Each mark can be undone from the activity log."
          confirmLabel={`Mark ${fmt(suspected || 0)}`}
          busy={running}
          onCancel={() => setConfirm(false)}
          onConfirm={() => { startMark(); setConfirm(false) }}
        />
      ) : null}
      {job ? <JobProgress job={job} onCancel={() => jobs.cancel(job.id)} onResume={() => jobs.resume(job.id)} onDismiss={() => jobs.dismiss(job.id)} /> : null}
      {job && job.status === 'done' && job.changed > 0 && (!undoJob || undoJob.started_at < job.started_at) ? (
        <div className={styles.actions}>
          <Button variant="ghost" icon="undo-2" onClick={() => void undoMarks()} data-testid="dupes-undo">Undo all {plural(job.changed, 'mark')}</Button>
        </div>
      ) : null}
      {undoErr ? <p className={styles.note} role="status">{undoErr}</p> : null}
      {undoJob && job && undoJob.started_at >= job.started_at ? <JobProgress job={undoJob} onCancel={() => jobs.cancel(undoJob.id)} onResume={() => jobs.resume(undoJob.id)} onDismiss={() => jobs.dismiss(undoJob.id)} /> : null}

      {scan.fetching && !data ? (
        <p className={styles.scanning} role="status" data-testid="dupes-scanning"><span className="ui-btn__spin" aria-hidden="true" />Reading every report — this can take up to 20 seconds.</p>
      ) : null}
      {!data && scan.error ? <ErrorState what="the duplicate scan" error={scan.error} onRetry={() => void scan.refresh()} retrying={scan.fetching} /> : null}
      {data ? (
        <>
          <RefreshFailed error={scan.error} onRetry={() => void scan.refresh()} />
          {suspected ? (
            <>
              <p className={styles.note} data-testid="dupes-summary">
                <strong>{plural(suspected, 'duplicate copy', 'duplicate copies')}</strong>{groups != null ? ` in ${plural(groups, 'group')}` : ''}, out of {typeof data.total === 'number' ? fmt(data.total) : 'all'} reports read{scan.updatedAt ? ` at ${when(new Date(scan.updatedAt).toISOString())}` : ''}.
              </p>
              <ul className={styles.groups} aria-label="Copies by company">
                {byCompany.slice(0, 40).map((g) => <li key={g.company}><span>{g.company}</span><span>{plural(g.count, 'copy', 'copies')}</span></li>)}
              </ul>
              {byCompany.length > 40 ? <p className={styles.note}>And {plural(byCompany.length - 40, 'more company', 'more companies')}.</p> : null}
            </>
          ) : (
            <EmptyState icon="circle-check" title="No duplicate copies." body={typeof data.total === 'number' ? `All ${fmt(data.total)} reports were read.` : undefined} />
          )}
        </>
      ) : null}
      {!asked && !data && !scan.fetching ? <EmptyState icon="layers" title="Not scanned yet." body="Scanning reads every report once; nothing changes until you press Mark." /> : null}
    </div>
  )
}
