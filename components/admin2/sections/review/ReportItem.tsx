'use client'

// A report's sheet (`?item=report:<id>`): the full text, where it came from (source link through the
// safe-href helper), its state and whether it counts in the grade, why it was held, the first-hand
// rules check, the audit history for this row, and every decision the server offers for its state
// (Approve / Reject / Hold / Restore) with Undo in the result line.
import { useEffect, useState } from 'react'
import { useAdminAction } from '../../core/hooks.tsx'
import Button from '@/components/ui/Button'
import type { AdminActivityRow } from '../../contract.ts'
import { useAdminQuery, useApi } from '../../core/hooks.tsx'
import type { ItemViewProps } from '../../core/items.tsx'
import { ItemNotFound } from '../../core/SheetHost.tsx'
import { ErrorState, RefreshFailed, Skeleton } from '../../ui/states.tsx'
import {
  CORRECTABLE_OUTCOMES, DECISION_TEXT, FLAG_TEXT, rulesReadings, GROUP_TEXT, STATE_TEXT, heldWhy, historyText, label, moderationFor, outcomeTone, sourceHref, when,
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
  // Correct outcome: the select starts on the report's own outcome; the reason is optional and goes to the audit row.
  const [outcome, setOutcome] = useState('')
  const [reason, setReason] = useState('')
  const correct = useAdminAction('correct_report_outcome', { onSettled: (res) => { if (res.ok) { setReason(''); void q.refresh() } } })
  const correctUndone = !!correct.state(id).undone
  useEffect(() => { if (correctUndone) void q.refresh() }, [correctUndone]) // eslint-disable-line react-hooks/exhaustive-deps
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
          {r.rules === 'passes' ? <><strong>Passes.</strong> Seen’s strict first-hand rules accept it.</>
            : r.rules === 'fails' ? <><strong>Fails.</strong> Seen’s strict first-hand rules reject it. A flag for you, not a decision.</>
              : 'Does not apply: this is not an imported public account, or it has too little text to judge.'}
        </p>
        {(() => { const rd = rulesReadings(r.rules_detail); return rd ? <ul className={styles.history} data-testid="report-rules-readings"><li>{rd.comment}</li><li>{rd.post}</li></ul> : null })()}
      </Block>
      <Block title="Correct the outcome" testId="report-correct">
        <div className={styles.toolRow}>
          <label className={styles.selectLabel}>
            <span>Outcome</span>
            <select className={`ui-input ${styles.select}`} value={outcome || String(r.outcome || '')} onChange={(e) => setOutcome(e.target.value)} data-testid="report-correct-outcome">
              {!CORRECTABLE_OUTCOMES.includes(String(r.outcome) as never) && r.outcome ? <option value={String(r.outcome)}>{label(r.outcome)} (not a value the database accepts)</option> : null}
              {CORRECTABLE_OUTCOMES.map((o) => <option key={o} value={o}>{label(o)}</option>)}
            </select>
          </label>
        </div>
        <label className={styles.field}>
          <span>Reason (optional, kept in the activity log)</span>
          <textarea className="ui-input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} data-testid="report-correct-reason" />
        </label>
        <div className={styles.itemActions}>
          <Button variant="ghost" onClick={() => void correct.run({ id, outcome: outcome || r.outcome, ...(reason.trim() ? { reason: reason.trim() } : {}) }, id)}
            disabled={correct.busy(id) || !outcome || outcome === r.outcome} loading={correct.busy(id)} data-testid="report-correct-go">
            {outcome && outcome !== r.outcome ? `Change to “${label(outcome)}”` : 'Choose a different outcome'}
          </Button>
        </div>
        <Line state={correct.state(id)} onUndo={() => correct.undo(id)} onRetry={() => correct.retry(id)} onDismiss={() => correct.dismiss(id)} runningText="Correcting the outcome…" />
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
