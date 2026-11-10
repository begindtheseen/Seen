'use client'

// Small pieces every Review panel uses: the kind chips (with live counts, quiet when nothing waits,
// "couldn't count" when the count failed), a status filter, a meta line, the key hint row, and the
// row wrapper that carries the keyboard cursor.
import type { ReactNode } from 'react'
import Icon from '@/components/ui/Icon'
import { KeyHint, StatusChip } from '../../ui/bits.tsx'
import { fmt, type KindKey, type Tone } from './adapter.ts'
import styles from './review.module.css'

export type KindChip = { key: KindKey; label: string; count: number | null | undefined }

/** One chip per kind. A kind with nothing waiting is still a chip, just quiet. */
export function KindChips({ chips, value, onChange }: { chips: KindChip[]; value: KindKey; onChange: (k: KindKey) => void }) {
  return (
    <div className={styles.kinds} role="group" aria-label="What to review" data-testid="review-kinds">
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
  return (
    <div className={styles.choice} role="group" aria-label={label} data-testid={testId}>
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
