'use client'

// A listing's sheet (`?item=job:<id>`): what it is, whether it is on the site, who holds it (the reasons it
// is never hard-deleted), its history; edit the fields the server allows, put it back on the site, or take it
// down with an in-sheet confirm. Every change answers with Undo where the server offers one.
import { useEffect, useMemo, useState } from 'react'
import { formatPacific } from '@/lib/time/pacific'
import Button from '@/components/ui/Button'
import { useAdminAction, useAdminQuery, useApi } from '../../core/hooks.tsx'
import type { ItemViewProps } from '../../core/items.tsx'
import { ItemNotFound } from '../../core/SheetHost.tsx'
import { StatusChip } from '../../ui/bits.tsx'
import ConfirmStep from '../../ui/ConfirmStep.tsx'
import ResultLine from '../../ui/ResultLine.tsx'
import { ErrorState, RefreshFailed, Skeleton } from '../../ui/states.tsx'
import { buildPatch, EDIT_FIELDS, fmt, formValues, historyWord, holdersLine, jobState, jobTitle, readJobDetail } from './adapter.ts'
import { httpHref } from '../../../../lib/safeHref.js'
import styles from './listings.module.css'

const when = (iso?: string | null) => (iso ? formatPacific(iso) : '—')
const money = (n: unknown) => (typeof n === 'number' ? `$${fmt(n)}` : '')

export default function JobItem({ kind, id, setTitle }: ItemViewProps) {
  const api = useApi()
  const q = useAdminQuery<Record<string, unknown>>(`job:${id}`, () => api<Record<string, unknown>>('job_detail', { job_id: id }), { staleMs: 15_000 })
  const d = q.data ? readJobDetail(q.data) : null
  const job = d?.job
  // a stored apply URL is data: only a real http(s) address becomes a link (lib/safeHref.js)
  const applyHref = job && job.apply_url ? httpHref(String(job.apply_url)) : null
  useEffect(() => { if (job) setTitle(jobTitle(job), `listing ${job.id}`) }, [job, setTitle])

  const edit = useAdminAction('job_edit', { onSettled: (res) => { if (res.ok) setEditing(false) } })
  const restore = useAdminAction('job_restore')
  const takeDown = useAdminAction('delete_listing', { onSettled: () => setConfirmDown(false) })
  const [editing, setEditing] = useState(false)
  const [confirmDown, setConfirmDown] = useState(false)
  const start = useMemo(() => (job ? formValues(job) : {}), [job])
  const [values, setValues] = useState<Record<string, string>>({})
  useEffect(() => { if (editing) setValues(start) }, [editing]) // eslint-disable-line react-hooks/exhaustive-deps
  const patch = editing ? buildPatch(start, values) : {}
  const changedKeys = Object.keys(patch)

  if (q.loading) return <Skeleton rows={4} label="Reading the listing" />
  if (q.error && !d) return q.error.code === 'not_found' || q.error.code === 'bad_request' ? <ItemNotFound kind={kind} id={id} /> : <ErrorState what="this listing" error={q.error} onRetry={() => void q.refresh()} retrying={q.fetching} />
  if (!d || !job) return <ItemNotFound kind={kind} id={id} />
  const st = jobState(job)
  const pay = job.salary || [money(job.salary_min), money(job.salary_max)].filter(Boolean).join(' – ')

  return (
    <div className={styles.item} data-testid="job-item">
      <RefreshFailed error={q.error} onRetry={() => void q.refresh()} />
      <div className={styles.itemPart}>
        <div className={styles.actions}><StatusChip tone={st.tone} label={st.label} />{job.is_employer_posted ? <StatusChip tone="info" label="Employer-posted" /> : null}</div>
        <dl className={styles.facts}>
          <div className={styles.fact}><dt className={styles.factLabel}>Location</dt><dd className={styles.factValue}>{String(job.location || '—')}</dd></div>
          <div className={styles.fact}><dt className={styles.factLabel}>Source</dt><dd className={styles.factValue}>{String(job.source || '—')}</dd></div>
          <div className={styles.fact}><dt className={styles.factLabel}>Pay</dt><dd className={styles.factValue}>{pay || 'Not stated'}</dd></div>
          <div className={styles.fact}><dt className={styles.factLabel}>Added</dt><dd className={styles.factValue}>{when(job.created_at)}</dd></div>
          <div className={styles.fact}><dt className={styles.factLabel}>Last seen by its source</dt><dd className={styles.factValue}>{when(job.last_seen_at)}</dd></div>
          <div className={styles.fact}><dt className={styles.factLabel}>{d.onSite ? 'Leaves the site' : 'Left the site'}</dt><dd className={styles.factValue}>{when(job.expires_at)}</dd></div>
        </dl>
        {job.apply_url ? (applyHref
          ? <p className={styles.text}>Apply link: <a className={styles.linkRow} href={applyHref} target="_blank" rel="noopener noreferrer">{String(job.apply_url)}</a></p>
          : <p className={styles.text}>Apply link (not a web address, shown as stored): {String(job.apply_url)}</p>) : null}
        <p className={styles.text} data-testid="job-holders">{holdersLine(d.holders)}</p>
        {d.suppressed ? <p className={styles.text}>Its apply link is blocked{d.suppressed.reason ? ` (${d.suppressed.reason})` : ''}{d.suppressed.created_at ? ` since ${when(d.suppressed.created_at)}` : ''}: a source cannot bring it back.</p> : null}
      </div>

      <div className={styles.itemPart} aria-live="polite">
        <ResultLine state={edit.state()} onUndo={() => edit.undo()} onRetry={() => edit.retry()} onDismiss={() => edit.dismiss()} runningText="Saving…" />
        <ResultLine state={restore.state()} onRetry={() => restore.retry()} onDismiss={() => restore.dismiss()} runningText="Putting it back…" />
        <ResultLine state={takeDown.state()} onUndo={() => takeDown.undo()} onRetry={() => takeDown.retry()} onDismiss={() => takeDown.dismiss()} runningText="Taking it down…" />
      </div>

      {editing ? (
        <form className={styles.form} onSubmit={(e) => { e.preventDefault(); if (changedKeys.length) void edit.run({ job_id: job.id, patch }) }} data-testid="job-edit-form">
          <div className={styles.formGrid}>
            {EDIT_FIELDS.map((f) => (
              <label key={f.key} className={styles.field}>
                <span>{f.label}</span>
                {f.kind === 'long' ? (
                  <textarea className="ui-input" rows={6} value={values[f.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
                ) : f.kind === 'select' ? (
                  <select className="ui-input" value={values[f.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}>
                    {(values[f.key] ?? '') === '' ? <option value="">Not set</option> : null}
                    {f.options!.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : f.kind === 'bool' ? (
                  <select className="ui-input" value={values[f.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}>
                    {(values[f.key] ?? '') === '' ? <option value="">Not set</option> : null}
                    <option value="true">Yes</option><option value="false">No</option>
                  </select>
                ) : (
                  <input className="ui-input" type={f.kind === 'date' ? 'date' : f.kind === 'int' ? 'text' : f.kind === 'url' ? 'url' : 'text'}
                    inputMode={f.kind === 'int' ? 'numeric' : undefined} value={values[f.key] ?? ''} data-testid={`job-f-${f.key}`}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} autoComplete="off" />
                )}
              </label>
            ))}
          </div>
          <p className={styles.quiet}>{changedKeys.length ? `Changing: ${changedKeys.map((k) => EDIT_FIELDS.find((f) => f.key === k)?.label.toLowerCase() || k).join(', ')}.` : 'Nothing changed yet.'}</p>
          <div className={styles.actions}>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)} disabled={edit.busy()}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!changedKeys.length} loading={edit.busy()} data-testid="job-save">Save changes</Button>
          </div>
        </form>
      ) : confirmDown ? (
        <ConfirmStep
          title="Take this listing down?"
          body="It leaves search now, its apply link is blocked so a source cannot bring it back, and its closed-listing reports are cleared. Undo puts all of it back."
          confirmLabel="Take it down" busy={takeDown.busy()}
          onCancel={() => setConfirmDown(false)} onConfirm={() => { void takeDown.run({ job_id: job.id }) }}
        />
      ) : (
        <div className={styles.actions}>
          <Button variant="secondary" icon="pencil" onClick={() => setEditing(true)} data-testid="job-edit">Edit</Button>
          {!d.onSite || d.suppressed ? (
            <Button variant="secondary" icon="refresh-cw" onClick={() => void restore.run({ job_id: job.id })} loading={restore.busy()} data-testid="job-restore">Put back on the site for 14 days</Button>
          ) : null}
          {d.onSite ? <Button variant="danger" icon="ban" onClick={() => setConfirmDown(true)} data-testid="job-takedown">Take down…</Button> : null}
        </div>
      )}

      <div className={styles.itemPart}>
        <h3 className={styles.h2}>History</h3>
        {d.history.length ? (
          <ul className={styles.lines} aria-label="History">
            {d.history.map((h) => (
              <li key={h.id} className={styles.lineItem}><span className={styles.lineMain}>{historyWord(h.action)} by {h.username}</span><span className={styles.lineSide}>{when(h.created_at)}</span></li>
            ))}
          </ul>
        ) : <p className={styles.quiet}>No admin has changed this listing.</p>}
      </div>
    </div>
  )
}
