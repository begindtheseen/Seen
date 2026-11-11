'use client'

// Small admin primitives: the section header (the screen's one <h1>), the stat strip, a work-queue row,
// a status chip (tint + word + icon — never colour alone), key hints, the search field and filter chips.
import { forwardRef, useEffect, useState, type ReactNode } from 'react'
import Icon, { type IconName } from '@/components/ui/Icon'
import { RefreshHairline } from './states.tsx'
import styles from './ui.module.css'

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

export function SectionHeader({ title, sub, actions, fetching }: { title: string; sub?: ReactNode; actions?: ReactNode; fetching?: boolean }) {
  return (
    <header className={styles.sectionHead}>
      <RefreshHairline active={!!fetching} />
      <div className={styles.sectionTitles}>
        <h1 className={styles.h1}>{title}</h1>
        {sub ? <p className={styles.sectionSub}>{sub}</p> : null}
      </div>
      {actions ? <div className={styles.sectionActions}>{actions}</div> : null}
    </header>
  )
}

export function StatStrip({ children, label }: { children: ReactNode; label: string }) {
  return <dl className={styles.stats} aria-label={label}>{children}</dl>
}

/** One number. `value === null` means it could not be read — shown as words, never as 0. */
export function StatTile({ label, value, format = fmt, sub, testId }: { label: string; value: number | null | undefined; format?: (n: number) => string; sub?: ReactNode; testId?: string }) {
  const unread = value === null || value === undefined
  return (
    <div className={styles.stat} data-testid={testId}>
      <dt className={styles.statLabel}>{label}</dt>
      <dd className={unread ? `${styles.statValue} ${styles.statUnread}` : styles.statValue}>
        {unread ? <><Icon name="circle-slash" size={16} /> couldn&apos;t read</> : format(value as number)}
      </dd>
      {sub ? <dd className={styles.statSub}>{sub}</dd> : null}
    </div>
  )
}

/** A work queue: its name, its count, a chevron. The whole row is one 56px target. */
export const QueueRow = forwardRef<HTMLButtonElement, { label: string; count: number | null; hint?: string; onOpen: () => void; testId?: string }>(
  function QueueRow({ label, count, hint, onOpen, testId }, ref) {
    return (
      <button ref={ref} type="button" className={styles.queue} onClick={onOpen} data-testid={testId}>
        <span className={styles.queueText}>
          <span className={styles.queueLabel}>{label}</span>
          {hint ? <span className={styles.queueHint}>{hint}</span> : null}
        </span>
        <span className={count === null ? `${styles.queueCount} ${styles.statUnread}` : styles.queueCount}>
          {count === null ? "couldn't read" : fmt(count)}
        </span>
        <Icon name="chevron-right" size={20} className={styles.queueChevron} />
      </button>
    )
  },
)

export type Tone = 'good' | 'caution' | 'bad' | 'info' | 'neutral'
const TONE_ICON: Record<Tone, IconName> = { good: 'circle-check', caution: 'triangle-alert', bad: 'circle-x', info: 'info', neutral: 'circle-dot' }

/** A state, as a tinted chip with its word and icon (semantic colour never stands alone). */
export function StatusChip({ tone = 'neutral', label, icon }: { tone?: Tone; label: string; icon?: IconName }) {
  return (
    <span className={`${styles.chip} ${styles[`chip_${tone}`]}`}>
      <Icon name={icon || TONE_ICON[tone]} size={14} />{label}
    </span>
  )
}

/** A desktop shortcut hint. Hidden on touch screens. */
export function KeyHint({ keys }: { keys: string }) {
  return <kbd className={styles.kbd} aria-hidden="true">{keys}</kbd>
}

/**
 * The placeholder for a narrow field: whole words only, at most `max` characters, never cut mid-word
 * ("Search companies, roles…" → "Search companies…"). Pure for the test.
 */
export function shortPlaceholder(text: string, max = 18): string {
  if (text.length <= max) return text
  const words = text.replace(/[,.;:]+/g, ' ').split(/\s+/).filter(Boolean)
  let out = ''
  for (const w of words) { if ((out ? out.length + 1 : 0) + w.length > max) break; out = out ? `${out} ${w}` : w }
  return `${out || words[0]}…`
}

/** True on phones (under 560px), following resizes. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 559px)')
    const on = () => setNarrow(mq.matches)
    on(); mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}

export const SearchField = forwardRef<HTMLInputElement, {
  value: string; onChange: (v: string) => void; placeholder: string; label: string; onEnter?: () => void; onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>; testId?: string
  /** The placeholder on a phone; by default the long one shortened at a word boundary (never "Search comp"). */
  placeholderShort?: string
}>(function SearchField({ value, onChange, placeholder, label, onEnter, onKeyDown, testId, placeholderShort }, ref) {
  const narrow = useNarrow()
  return (
    <div className={styles.search}>
      <Icon name="search" size={18} className={styles.searchIcon} />
      <input
        ref={ref}
        type="search"
        className={`ui-input ${styles.searchInput}`}
        value={value}
        placeholder={narrow ? (placeholderShort || shortPlaceholder(placeholder)) : placeholder}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter() } onKeyDown?.(e) }}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="search"
        data-testid={testId}
      />
      {value ? (
        <button type="button" className={styles.searchClear} onClick={() => onChange('')} aria-label="Clear the search">
          <Icon name="x" size={16} />
        </button>
      ) : null}
    </div>
  )
})

import { checkingText, isChecking, type Checking } from '../core/words.ts'
export { checkingText, isChecking, type Checking }

export type ChipOption = { value: string; label: string; count?: number | null; checking?: Checking | null }

/** One choice out of a few. The chosen chip is the accent tint; the value lives in the URL. */
export function FilterChips({ options, value, onChange, label }: { options: ChipOption[]; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className={styles.chips} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className="ui-chip" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}{isChecking(o.checking) ? <span className={styles.chipCount}>{checkingText(o.checking)}</span> : typeof o.count === 'number' ? <span className={styles.chipCount}>{fmt(o.count)}</span> : null}
        </button>
      ))}
    </div>
  )
}
