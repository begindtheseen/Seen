'use client'

// Small pieces every Review panel uses: the kind chips (with live counts, quiet when nothing waits,
// "couldn't count" when the count failed), a status filter, a meta line, the key hint row, and the
// row wrapper that carries the keyboard cursor.
import { useEffect, useRef, type ReactNode } from 'react'
import Icon from '@/components/ui/Icon'
import Button from '@/components/ui/Button'
import type { Job } from '../../core/jobs.ts'
import { KeyHint, StatusChip } from '../../ui/bits.tsx'
import ResultLine, { type ResultLineProps } from '../../ui/ResultLine.tsx'
import { fmt, tidyMessage, type KindKey, type Tone } from './adapter.ts'
import styles from './review.module.css'

/** Keep the chosen chip in view inside a sideways-scrolling row — horizontally only, never the page. */
function useActiveInView(value: string) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const row = ref.current
    const on = row?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (!row || !on || row.scrollWidth <= row.clientWidth) return
    const left = on.offsetLeft - row.offsetLeft
    if (left < row.scrollLeft || left + on.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = Math.max(0, left - 16)
  }, [value])
  return ref
}

export type KindChip = { key: KindKey; label: string; count: number | null | undefined }

/** One chip per kind. A kind with nothing waiting is still a chip, just quiet. */
export function KindChips({ chips, value, onChange }: { chips: KindChip[]; value: KindKey; onChange: (k: KindKey) => void }) {
  const ref = useActiveInView(value)
  return (
    <div ref={ref} className={styles.kinds} role="group" aria-label="What to review" data-testid="review-kinds">
      {chips.map((c) => {
        const quiet = c.count === 0 || c.count === undefined
        return (
          <button
            key={c.key}
            type="button"
            className={`ui-chip ${styles.kindChip}${quiet ? ` ${styles.kindQuiet}` : ''}`}
            aria-pressed={c.key === value}
            onClick={() => onChange(c.key)}
            data-testid={`kind-${c.key}`}
          >
            <span>{c.label}</span>
            {c.count === null ? (
              <span className={styles.kindUnread} title="This count could not be read">
                <Icon name="circle-slash" size={14} />couldn&apos;t count
              </span>
            ) : typeof c.count === 'number' ? (
              <span className={styles.kindCount} aria-label={`${fmt(c.count)} waiting`}>{fmt(c.count)}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

/** A short choice (status / saved filter) — chips with optional counts. */
export function Choice({ options, value, onChange, label, testId }: {
  options: Array<{ value: string; label: string; count?: number | null }>; value: string; onChange: (v: string) => void; label: string; testId?: string
}) {
  const ref = useActiveInView(value)
  return (
    <div ref={ref} className={styles.choice} role="group" aria-label={label} data-testid={testId}>
      {options.map((o) => (
        <button key={o.value} type="button" className={`ui-chip ${styles.choiceChip}`} aria-pressed={o.value === value} onClick={() => onChange(o.value)} data-testid={testId ? `${testId}-${o.value}` : undefined}>
          {o.label}{typeof o.count === 'number' ? <span className={styles.kindCount}>{fmt(o.count)}</span> : null}
        </button>
      ))}
    </div>
  )
}

/** "Indeed · Nov 10, 9:02 AM PT · Imported from a review site" — empty parts dropped. */
export function Meta({ parts }: { parts: Array<ReactNode | null | undefined | false | ''> }) {
  const shown = parts.filter((p) => p !== null && p !== undefined && p !== false && p !== '')
  if (!shown.length) return null
  return (
    <span className={styles.meta}>
      {shown.map((p, i) => <span key={i} className={styles.metaPart}>{p}</span>)}
    </span>
  )
}

export function Chips({ items }: { items: Array<{ tone: Tone; label: string } | null | undefined | false> }) {
  const shown = items.filter(Boolean) as Array<{ tone: Tone; label: string }>
  if (!shown.length) return null
  return <span className={styles.chipRow}>{shown.map((c) => <StatusChip key={c.label} tone={c.tone} label={c.label} />)}</span>
}

/** The desktop key hint (hidden on touch screens). */
export function KeysHint({ keys }: { keys: Array<[string, string]> }) {
  return (
    <div className={styles.keys} aria-hidden="true" data-testid="review-keys">
      {keys.map(([k, what]) => <span key={k} className={styles.keyPart}><KeyHint keys={k} /><span>{what}</span></span>)}
    </div>
  )
}

/** Wraps a Row so the keyboard cursor can find it and ring it. */
export function CursorRow({ id, cursor, children }: { id: string; cursor: boolean; children: ReactNode }) {
  return <div data-rowid={id} className={cursor ? styles.cursor : undefined} data-cursor={cursor ? 'true' : undefined}>{children}</div>
}

/** A labelled block inside a sheet. */
export function Block({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section className={styles.block} data-testid={testId}>
      <h2 className={styles.blockTitle}>{title}</h2>
      {children}
    </section>
  )
}

/** A two-column fact list inside a sheet. */
export function Facts({ rows }: { rows: Array<[string, ReactNode] | null | false> }) {
  const shown = rows.filter(Boolean) as Array<[string, ReactNode]>
  return (
    <dl className={styles.facts}>
      {shown.map(([k, v]) => (
        <div key={k} className={styles.fact}>
          <dt>{k}</dt>
          <dd>{v === '' || v === null || v === undefined ? '—' : v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** ResultLine, with the server's sentence tidied so it never repeats the status word beside it. */
export function Line(props: ResultLineProps) {
  const st = props.state
  const msg = st.result?.message
  const state = msg && tidyMessage(msg) !== msg ? { ...st, result: { ...st.result!, message: tidyMessage(msg) } } : st
  return <ResultLine {...props} state={state} />
}

/**
 * The company-score update after a decision, said ONCE, with the real denominator from the start
 * ("0 of 71 company scores updated"): the server gives the count in the decision's answer, before the
 * job's first round has reported anything.
 */
export function RecomputeLine({ job, queued, onCancel, onResume, onDismiss }: { job: Job; queued: number | null; onCancel: () => void; onResume: () => void; onDismiss: () => void }) {
  const live = job.status === 'running' || job.status === 'cancelling'
  const total = typeof job.total === 'number' ? job.total : typeof job.remaining === 'number' ? job.changed + job.remaining : queued
  const count = total != null ? `${fmt(job.changed)} of ${fmt(Math.max(total, job.changed))} company scores updated` : `${fmt(job.changed)} company scores updated so far`
  const text = live ? count : job.message
  return (
    <div className={styles.recompute} role="status" aria-live="polite" data-testid="recompute-line" data-status={job.status}>
      {live ? <span className="ui-btn__spin" aria-hidden="true" /> : <Icon name={job.status === 'done' ? 'circle-check' : 'circle-slash'} size={16} />}
      <span className={styles.recomputeText}>{text}</span>
      {live ? <Button variant="ghost" onClick={onCancel} disabled={job.status === 'cancelling'}>{job.status === 'cancelling' ? 'Stopping…' : 'Stop'}</Button>
        : job.resumable ? <Button variant="ghost" onClick={onResume}>Continue</Button> : null}
      {!live ? <button type="button" className={styles.x} onClick={onDismiss} aria-label="Dismiss this message"><Icon name="x" size={16} /></button> : null}
    </div>
  )
}
