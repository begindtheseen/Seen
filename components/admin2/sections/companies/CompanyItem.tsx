'use client'

// A company's sheet (`?item=company:<name>`): its grade and what it is built from (each count says what it
// counts), recompute, the evidence export, merge into / absorb with Undo, its merge history with Separate,
// and employer perks.
import { useEffect, useState } from 'react'
import { formatPacific } from '@/lib/time/pacific'
import Button from '@/components/ui/Button'
import { useAdminAction, useAdminQuery, useApi } from '../../core/hooks.tsx'
import type { ItemViewProps } from '../../core/items.tsx'
import { ItemNotFound } from '../../core/SheetHost.tsx'
import { StatTile, StatStrip, StatusChip } from '../../ui/bits.tsx'
import ConfirmStep from '../../ui/ConfirmStep.tsx'
import ResultLine from '../../ui/ResultLine.tsx'
import { EmptyState, ErrorState, RefreshFailed, Skeleton } from '../../ui/states.tsx'
import styles from '../listings/listings.module.css'
import CompanyReports from './CompanyReports.tsx'
import { displayName, evidence, fmt, perkLines, readCompanyDetail, scoreLine } from './adapter.ts'

function saveJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href; a.download = filename; a.rel = 'noopener'
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 10_000)
}

export default function CompanyItem({ kind, id, setTitle, open }: ItemViewProps) {
  const api = useApi()
  const key = id.toLowerCase().trim()
  const q = useAdminQuery<Record<string, unknown>>(`company:${key}`, () => api<Record<string, unknown>>('company_detail', { name: id }), { staleMs: 15_000 })
  const d = q.data ? readCompanyDetail(q.data) : null
  const name = d?.name || id
  useEffect(() => { if (d) setTitle(displayName(d.name), d.score ? scoreLine(d) : 'No score yet') }, [d, setTitle])

  const recompute = useAdminAction('company_recompute')
  const exp = useAdminAction('export_company', { onSettled: (res) => { if (res.ok && (res as Record<string, unknown>).bundle) saveJson(`seen-company-evidence-${key.replace(/[^a-z0-9]+/g, '-')}.json`, (res as Record<string, unknown>).bundle) } })
  const merge = useAdminAction('merge', { onSettled: () => setConfirmMerge(false) })
  const separate = useAdminAction('undo_merge', { onSettled: () => setConfirmSep(null) })
  const [dir, setDir] = useState<'absorb' | 'into'>('absorb')
  const [other, setOther] = useState('')
  const [confirmMerge, setConfirmMerge] = useState(false)
  const [confirmSep, setConfirmSep] = useState<string | null>(null)
  const otherName = other.trim()
  const mergedAway = merge.state().status === 'done' && dir === 'into'

  if (q.loading) return <Skeleton rows={4} label="Reading the company" />
  if (q.error && !d) {
    // Merged into another company from this sheet: this name no longer exists; keep the result and its Undo.
    if (q.error.code === 'not_found' && mergedAway) {
      return (
        <div className={styles.item}>
          <ResultLine state={merge.state()} onUndo={() => merge.undo()} onDismiss={() => merge.dismiss()} />
          <EmptyState icon="layers" title={`${displayName(id)} is now part of ${displayName(otherName)}.`} body="Undo above separates them again."
            action={<Button variant="secondary" iconRight="arrow-right" onClick={() => open('company', otherName)}>Open {displayName(otherName)}</Button>} />
        </div>
      )
    }
    return q.error.code === 'not_found' ? <ItemNotFound kind={kind} id={id} detail={`No company called “${id}” has a score or reports.`} /> : <ErrorState what="this company" error={q.error} onRetry={() => void q.refresh()} retrying={q.fetching} />
  }
  if (!d) return <ItemNotFound kind={kind} id={id} />
  const ev = evidence(d)
  const perks = perkLines(d.perks)
  const primary = dir === 'absorb' ? name : otherName
  const secondary = dir === 'absorb' ? otherName : name

  return (
    <div className={styles.item} data-testid="company-item">
      <RefreshFailed error={q.error} onRetry={() => void q.refresh()} />
      <div className={styles.itemPart}>
        <p className={styles.text}><span className={styles.strong}>{scoreLine(d)}</span></p>
        <StatStrip label="What the grade is built from">
          {ev.map((e) => <StatTile key={e.label} label={e.label} value={e.value} sub={e.what} />)}
        </StatStrip>
        {d.score?.updated_at || d.score?.created_at ? <p className={styles.quiet}>Score row written {formatPacific(String(d.score.updated_at || d.score.created_at))}.</p> : null}
      </div>

      <div className={styles.itemPart} aria-live="polite">
        <ResultLine state={recompute.state()} onRetry={() => recompute.retry()} onDismiss={() => recompute.dismiss()} runningText="Recomputing from its reports…" />
        <ResultLine state={exp.state()} onRetry={() => exp.retry()} onDismiss={() => exp.dismiss()} runningText="Building the evidence file…" />
        <ResultLine state={merge.state()} onUndo={() => merge.undo()} onRetry={() => merge.retry()} onDismiss={() => merge.dismiss()} runningText="Merging…" />
        <div className={styles.actions}>
          <Button variant="secondary" icon="refresh-cw" onClick={() => void recompute.run({ name })} loading={recompute.busy()} data-testid="co-recompute">Recompute the score</Button>
          <Button variant="ghost" icon="download" onClick={() => void exp.run({ company: name })} loading={exp.busy()} data-testid="co-export">Download the evidence (JSON)</Button>
        </div>
        <p className={styles.quiet}>
          The legal audit PDF and the audit package are built by their own download endpoints, which the new admin cannot save as files yet.
          They are in the <a className={styles.link} href="/admin/legacy">legacy admin</a> (Advanced tools → Company score audit), same sign-in.
        </p>
      </div>

      <div className={styles.itemPart}>
        <h3 className={styles.h2}>Merge</h3>
        {confirmMerge ? (
          <ConfirmStep title={`Merge ${displayName(secondary)} into ${displayName(primary)}?`}
            body={`${displayName(secondary)}’s reports move to ${displayName(primary)}, its page is removed and its name becomes an alias. Both are recomputed. Undo separates them again.`}
            confirmLabel="Merge" busy={merge.busy()} onCancel={() => setConfirmMerge(false)} onConfirm={() => { void merge.run({ primary, secondary }) }} />
        ) : (
          <form className={styles.form} onSubmit={(e) => { e.preventDefault(); if (otherName.length >= 2 && otherName.toLowerCase() !== key) setConfirmMerge(true) }}>
            <div className={styles.formGrid}>
              <label className={styles.field}><span>Direction</span>
                <select className="ui-input" value={dir} onChange={(e) => setDir(e.target.value as 'absorb' | 'into')} data-testid="co-merge-dir">
                  <option value="absorb">{displayName(name)} absorbs another company</option>
                  <option value="into">{displayName(name)} is merged into another company</option>
                </select></label>
              <label className={styles.field}><span>The other company’s exact name</span>
                <input className="ui-input" value={other} onChange={(e) => setOther(e.target.value)} autoComplete="off" data-testid="co-merge-other" /></label>
            </div>
            <div className={styles.actions}>
              <Button type="submit" variant="secondary" icon="layers" disabled={otherName.length < 2 || otherName.toLowerCase() === key} data-testid="co-merge">Merge…</Button>
            </div>
          </form>
        )}
      </div>

      <div className={styles.itemPart}>
        <h3 className={styles.h2}>Merge history</h3>
        {d.merges.length ? (
          <ul className={styles.lines} aria-label="Merges">
            {d.merges.map((m) => (
              <li key={m.id} className={styles.lineItem} data-testid={`co-merge-${m.id}`}>
                <span className={styles.lineMain}>{displayName(m.secondary_name)} → {displayName(m.primary_name)} · {m.created_at ? formatPacific(m.created_at, { dateStyle: 'medium' }) : ''}</span>
                {m.undone_at ? <StatusChip tone="neutral" label="Separated" /> : confirmSep === m.id ? null : (
                  <Button variant="ghost" icon="undo-2" onClick={() => setConfirmSep(m.id)} data-testid={`co-separate-${m.id}`}>Separate</Button>
                )}
                {confirmSep === m.id ? (
                  <ConfirmStep inline title={`Separate ${displayName(m.secondary_name)} again?`} body="Its reports move back and its page returns. Both are recomputed."
                    confirmLabel="Separate" busy={separate.busy(m.id)} onCancel={() => setConfirmSep(null)} onConfirm={() => { void separate.run({ merge_id: m.id }, m.id) }} />
                ) : null}
                {separate.state(m.id).status !== 'idle' ? <ResultLine state={separate.state(m.id)} onRetry={() => separate.retry(m.id)} onDismiss={() => separate.dismiss(m.id)} runningText="Separating…" /> : null}
              </li>
            ))}
          </ul>
        ) : <p className={styles.quiet}>Never merged with another company.</p>}
      </div>

      <CompanyReports name={name} onOpenReport={(rid) => open('report', rid)} />

      <div className={styles.itemPart}>
        <h3 className={styles.h2}>Employer perks</h3>
        {perks.length ? <ul className={styles.lines}>{perks.map((p) => <li key={p} className={styles.lineItem}>{p}</li>)}</ul>
          : <p className={styles.quiet}>No featured listings, badge or sponsorship. Perks never change the grade.</p>}
        {d.held ? <p className={styles.quiet}>{fmt(d.held)} of its reports wait in Review.</p> : null}
      </div>
    </div>
  )
}
