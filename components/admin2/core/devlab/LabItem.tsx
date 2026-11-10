'use client'

// The lab's item view (a "report" sheet) — the reference for item views: read the item with
// useAdminQuery, set the sheet title, show "not found" plainly, put actions in the sheet, a destructive
// one behind an inline ConfirmStep (type-to-confirm), and open a related item IN the same sheet.
import { useEffect, useState } from 'react'
import Button from '@/components/ui/Button'
import { useAdminAction, useAdminQuery, useApi } from '../hooks.tsx'
import type { ItemViewProps } from '../items.tsx'
import { ItemNotFound } from '../SheetHost.tsx'
import ConfirmStep from '../../ui/ConfirmStep.tsx'
import ResultLine from '../../ui/ResultLine.tsx'
import { Skeleton, ErrorState } from '../../ui/states.tsx'
import styles from './lab.module.css'

type LabReport = { id: string; company: string; outcome: string; text: string; related?: string }

export default function LabItem({ kind, id, open, setTitle, close }: ItemViewProps) {
  const api = useApi()
  const q = useAdminQuery<{ report: LabReport }>(`report:${id}`, () => api<{ report: LabReport }>('lab_report', { id }))
  const del = useAdminAction('lab_decide', { onSettled: (res) => { if (res.ok) close() } })
  const [confirming, setConfirming] = useState(false)
  const r = q.data?.report
  useEffect(() => { if (r) setTitle(`${r.company} report`, `${r.outcome} · id ${r.id}`) }, [r, setTitle])

  if (q.loading) return <Skeleton rows={3} label="Reading the report" />
  if (q.error && !r) return q.error.code === 'not_found' ? <ItemNotFound kind={kind} id={id} /> : <ErrorState what="this report" error={q.error} onRetry={() => void q.refresh()} />
  if (!r) return <ItemNotFound kind={kind} id={id} />
  return (
    <div className={styles.item} data-testid="lab-item">
      <p className={styles.itemText}>{r.text}</p>
      <label className="ui-field">
        <span className="ui-field__label">Note (kept while the sign-in step covers this sheet)</span>
        <input className="ui-input" data-testid="lab-item-note" />
      </label>
      {r.related ? <Button variant="ghost" iconRight="arrow-right" onClick={() => open('report', r.related!)} data-testid="lab-item-related">Open the related report</Button> : null}
      <ResultLine state={del.state()} onRetry={() => del.retry()} onDismiss={() => del.dismiss()} />
      {confirming ? (
        <ConfirmStep
          title="Delete this report?"
          body={`The ${r.company} report is removed from the queue and from the company’s grade.`}
          irreversible="The report’s text is deleted; it cannot be restored."
          confirmLabel="Delete report" typeToConfirm="DELETE" busy={del.busy()}
          onCancel={() => setConfirming(false)}
          onConfirm={() => { void del.run({ ids: [r.id], decision: 'delete' }) }}
        />
      ) : (
        <div className={styles.itemActions}>
          <Button variant="danger" onClick={() => setConfirming(true)} data-testid="lab-item-delete">Delete…</Button>
        </div>
      )}
    </div>
  )
}
