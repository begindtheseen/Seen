'use client'

// A report's sheet (`?item=report:<id>`): the full text, where it came from (source link through the
// safe-href helper), its state and whether it counts in the grade, why it was held, the first-hand
// rules check, the audit history for this row, and every decision the server offers for its state
// (Approve / Reject / Hold / Restore) with Undo in the result line.
import { useEffect, useState } from 'react'
import Button from '@/components/ui/Button'
import type { AdminActivityRow } from '../../contract.ts'
import { useAdminQuery, useApi } from '../../core/hooks.tsx'
import type { ItemViewProps } from '../../core/items.tsx'
import { ItemNotFound } from '../../core/SheetHost.tsx'
import { ErrorState, RefreshFailed, Skeleton } from '../../ui/states.tsx'
import {
  DECISION_TEXT, FLAG_TEXT, GROUP_TEXT, STATE_TEXT, heldWhy, historyText, label, moderationFor, outcomeTone, sourceHref, when,
  type ModDecision, type ReportRow,
} from './adapter.ts'
import { Block, Chips, Facts, Line } from './parts.tsx'
import { useModerate } from './RecentPanel.tsx'
import styles from './review.module.css'

type Detail = ReportRow & { history?: AdminActivityRow[] }

export default function ReportItem({ kind, id, setTitle, open }: ItemViewProps) {
  const api = useApi()
  const q = useAdminQuery<{ rows?: Detail[] }>(`report:${id}`, () => api<{ rows?: Detail[] }>('report_detail', { id }), { staleMs: 10_000 })
  const [lastDecision, setLastDecision] = useState<ModDecision | null>(null)
  // The decision's touched keys re-read the lists; this sheet re-reads its own row.
  const mod = useModerate((res) => { if (res.ok) void q.refresh() })
  const r = q.data?.rows?.[0]
  // An Undo pressed here changes this row too: read it again once the Undo has landed.
  const undone = !!mod.state(id).undone
  useEffect(() => { if (undone) void q.refresh() }, [undone]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (r) setTitle(`${r.company_name || 'Unknown company'} report`, `${label(r.outcome) || 'No outcome'} · ${r.state ? STATE_TEXT[r.state].label.toLowerCase() : 'state unknown'} · ${when(r.created_at)}`)
  }, [r, setTitle])

  if (q.loading) return <Skeleton rows={4} label="Reading the report" />
  if (q.error && !r) return q.error.code === 'not_found' || q.error.code === 'bad_request' ? <ItemNotFound kind={kind} id={id} detail={q.error.error} /> : <ErrorState what="this report" error={q.error} onRetry={() => void q.refresh()} retrying={q.fetching} />
  if (!r) return <ItemNotFound kind={kind} id={id} />

  const href = sourceHref(r)
  const st = r.state ? STATE_TEXT[r.state] : null
  const flags = (r.review?.flags || []).map((f) => FLAG_TEXT[f]).filter(Boolean)
  const options = moderationFor(r.state)
  const busy = mod.busy(id)
  const decide = (d: ModDecision) => { setLastDecision(d); void mod.run({ id, decision: d }, id) }

  return (
    <div className={styles.item} data-testid="report-item">
      <RefreshFailed error={q.error} onRetry={() => void q.refresh()} />
      <Chips items={[
        st ? { tone: st.tone, label: st.label } : null,
        r.counted ? { tone: 'info', label: 'Counts in grade' } : { tone: 'neutral', label: 'Not counted in the grade' },
        { tone: outcomeTone(r.outcome), label: label(r.outcome) || 'No outcome' },
        r.review?.group && r.state === 'held' ? { tone: r.review.group === 'positive' ? 'good' : r.review.group === 'employee_review' ? 'info' : 'neutral', label: GROUP_TEXT[r.review.group] } : null,
        ...flags,
      ]} />
      <Block title="What they wrote">
        <p className={styles.fullText} data-testid="report-text">{r.report_text || 'No text.'}</p>
      </Block>
      <Facts rows={[
        ['Company', r.company_name ? <Button key="c" variant="ghost" iconRight="arrow-right" onClick={() => open('company', String(r.company_name))}>{r.company_name}</Button> : '—'],
        ['Role', r.role || '—'],
        ['Where it came from', r.platform || r.source || '—'],
        ['Source link', href ? <a key="s" className={styles.link} href={href} target="_blank" rel="noopener noreferrer nofollow" data-testid="report-source">Open the source</a> : 'None in the report'],
        ['Reported', when(r.created_at) || '—'],
        ['Why it is held', r.state === 'held' ? heldWhy(r) : '—'],
        ['Trust weight', typeof r.outcome_weight === 'number' ? String(r.outcome_weight) : '—'],
        ['Report id', <span key="i" className={styles.note}>{r.id}</span>],
      ]} />
      <Block title="Rules check" testId="report-rules">
        <p className={styles.note}>
          {r.rules === 'passes' ? <><strong>Passes.</strong> Seen’s strict first-hand rules accept it, read as a comment or as the post itself.</>
            : r.rules === 'fails' ? <><strong>Fails.</strong> Seen’s strict first-hand rules reject it both as a comment and as the post itself. A flag for you, not a decision.</>
              : 'Does not apply: this is not an imported public account, or it has too little text to judge.'}
        </p>
      </Block>
      <Block title="History" testId="report-history">
        {r.history?.length ? (
          <ul className={styles.history}>
            {r.history.map((h) => <li key={h.id}><time>{when(h.at)}</time><span>{historyText(h.action)}</span><span>by {h.admin || 'an admin'}</span></li>)}
          </ul>
        ) : <p className={styles.note}>No admin has decided anything about this report yet.</p>}
      </Block>
      {lastDecision ? (
        <Line state={mod.state(id)} onUndo={() => mod.undo(id)} onRetry={() => mod.retry(id)} onDismiss={() => { mod.dismiss(id); setLastDecision(null) }}
          runningText={DECISION_TEXT[lastDecision].running} />
      ) : null}
      {options.length ? (
        <div className={styles.itemActions}>
          {options.map((d, i) => (
            <Button key={d} variant={i === 0 ? 'secondary' : 'ghost'} onClick={() => decide(d)} loading={busy && lastDecision === d} disabled={busy} data-testid={`report-item-${d}`}>
              {DECISION_TEXT[d].label}
            </Button>
          ))}
        </div>
      ) : <p className={styles.note}>No decision applies to a report in this state.</p>}
      {r.state === 'live' || r.state === 'held' ? (
        <p className={styles.note}>
          {r.state === 'held' ? 'Approve makes it public; Reject keeps it stored but hidden and out of every grade.' : 'Hold sends it back to the review queue; Reject hides it and takes it out of the grade.'} Both can be undone.
        </p>
      ) : null}
    </div>
  )
}
