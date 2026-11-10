'use client'

// An account cluster's sheet (`?item=cluster:<id>`): the accounts with their emails (each opens its own
// sheet), why they were grouped, and a decision with a note. Undo where the server offers it.
import { useEffect, useState } from 'react'
import { formatPacific } from '@/lib/time/pacific'
import Button from '@/components/ui/Button'
import type { AdminList } from '../../contract.ts'
import { useAdminAction, useAdminQuery, useApi } from '../../core/hooks.tsx'
import type { ItemViewProps } from '../../core/items.tsx'
import { ItemNotFound } from '../../core/SheetHost.tsx'
import { StatusChip } from '../../ui/bits.tsx'
import ResultLine from '../../ui/ResultLine.tsx'
import { ErrorState, RefreshFailed, Skeleton } from '../../ui/states.tsx'
import styles from '../listings/listings.module.css'
import { CLUSTER_STATUSES, CLUSTER_WORDS, fmt, readCluster, signalWords } from './adapter.ts'

export default function ClusterItem({ kind, id, setTitle, open }: ItemViewProps) {
  const api = useApi()
  // The server has no one-cluster read: read every cluster (≤200, newest risk first) and pick this one.
  const q = useAdminQuery<AdminList<Record<string, unknown>>>('clusters?status=all', () => api<AdminList<Record<string, unknown>>>('clusters_list', { status: 'all' }), { staleMs: 15_000 })
  const raw = q.data?.rows?.find((c) => String(c.id) === id)
  const c = raw ? readCluster(raw) : null
  useEffect(() => { if (c) setTitle(`${fmt(c.users.length)} accounts that look like one person`, `cluster ${c.id} · risk ${c.risk ?? 'unknown'}`) }, [c?.id, c?.users.length, c?.risk, setTitle]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = useAdminAction('update_cluster')
  const [status, setStatus] = useState('')
  const [note, setNote] = useState('')
  useEffect(() => { if (c) { setStatus(c.status); setNote(c.note || '') } }, [c?.status, c?.note]) // eslint-disable-line react-hooks/exhaustive-deps

  if (q.loading) return <Skeleton rows={3} label="Reading the cluster" />
  if (q.error && !q.data) return <ErrorState what="this cluster" error={q.error} onRetry={() => void q.refresh()} retrying={q.fetching} />
  if (!c) return <ItemNotFound kind={kind} id={id} detail={`No cluster with the id “${id}” among the 200 the server returns.`} />
  const changed = status !== c.status || (note.trim() || null) !== (c.note || null)
  return (
    <div className={styles.item} data-testid="cluster-item">
      <RefreshFailed error={q.error} onRetry={() => void q.refresh()} />
      <div className={styles.itemPart}>
        <div className={styles.actions}><StatusChip tone={c.status === 'safe' ? 'good' : c.status === 'suspected' ? 'caution' : 'neutral'} label={CLUSTER_WORDS[c.status] || c.status} /></div>
        <p className={styles.text}>Grouped because: {c.signals.length ? c.signals.map(signalWords).join('; ') : 'no signal recorded'}.{c.created_at ? ` Found ${formatPacific(c.created_at)}.` : ''}</p>
        <ul className={styles.lines} aria-label="Accounts">
          {c.users.map((u) => (
            <li key={u.id} className={styles.lineItem}>
              <span className={styles.lineMain}>{u.email || 'No email on the profile'}</span>
              <Button variant="ghost" iconRight="arrow-right" onClick={() => open('user', u.id)} data-testid={`cluster-user-${u.id}`}>Open</Button>
            </li>
          ))}
        </ul>
      </div>
      <form className={styles.form} onSubmit={(e) => { e.preventDefault(); if (changed) void save.run({ cluster_id: Number(c.id), status, admin_note: note.trim() || null }) }}>
        <div className={styles.formGrid}>
          <label className={styles.field}><span>Decision</span>
            <select className="ui-input" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="cluster-status">
              {CLUSTER_STATUSES.map((s) => <option key={s} value={s}>{CLUSTER_WORDS[s]}</option>)}
            </select></label>
          <label className={styles.field}><span>Note (for you)</span>
            <input className="ui-input" value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" /></label>
        </div>
        <p className={styles.quiet}>The decision is a record for you; it does not lock or change the accounts by itself.</p>
        <div className={styles.actions}><Button type="submit" variant="secondary" disabled={!changed} loading={save.busy()} data-testid="cluster-save">Save the decision</Button></div>
      </form>
      <ResultLine state={save.state()} onUndo={() => save.undo()} onRetry={() => save.retry()} onDismiss={() => save.dismiss()} runningText="Saving…" />
    </div>
  )
}
