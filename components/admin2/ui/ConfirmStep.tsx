'use client'

// A destructive action's confirmation, shown IN PLACE — as a step inside the sheet or inline in a row —
// never as a second modal and never as window.confirm (audit defect 20). It says what will change, how
// many rows, and, in plain words, what cannot be undone. The dangerous ones (the credit-system flag,
// deleting an account) ask the owner to type a word first.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import styles from './ui.module.css'

export type ConfirmStepProps = {
  /** A question naming the action and the count: "Delete this listing?", "Approve 188 reports?" */
  title: ReactNode
  /** What will change, in one or two sentences. */
  body?: ReactNode
  /** The irreversible part, in plain words. Omit when the server offers Undo. */
  irreversible?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  /** danger = destructive (outlined red); primary = the screen's one filled button. */
  tone?: 'danger' | 'primary'
  /** The owner must type this word before the confirm button works. */
  typeToConfirm?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
  /** Compact layout for a row. */
  inline?: boolean
}

/** Is the typed text the word asked for? Case-insensitive, outer spaces ignored. Pure for the test. */
export function typedMatches(typed: string, word: string | undefined): boolean {
  if (!word) return true
  return typed.trim().toLowerCase() === word.trim().toLowerCase()
}

export default function ConfirmStep({ title, body, irreversible, confirmLabel, cancelLabel = 'Cancel', tone = 'danger', typeToConfirm, busy, onConfirm, onCancel, inline }: ConfirmStepProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const [typed, setTyped] = useState('')
  const field = useRef<HTMLInputElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => { (typeToConfirm ? field.current : cancel.current)?.focus() }, [typeToConfirm])
  const ready = typedMatches(typed, typeToConfirm) && !busy
  return (
    <div
      role="group"
      aria-labelledby={`${uid}-t`}
      className={inline ? `${styles.confirm} ${styles.confirmInline}` : styles.confirm}
      data-testid="confirm-step"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!busy) onCancel() } }}
    >
      <div id={`${uid}-t`} className={styles.confirmTitle}>{title}</div>
      {body ? <div className={styles.confirmBody}>{body}</div> : null}
      {irreversible ? (
        <div className={styles.confirmWarn}>
          <Icon name="triangle-alert" size={16} />
          <span><strong>Cannot be undone.</strong> {irreversible}</span>
        </div>
      ) : null}
      {typeToConfirm ? (
        <label className={styles.confirmField}>
          <span>Type <strong>{typeToConfirm}</strong> to confirm</span>
          <input
            ref={field}
            className="ui-input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && ready) { e.preventDefault(); onConfirm() } }}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-label={`Type ${typeToConfirm} to confirm`}
            data-testid="confirm-type"
          />
        </label>
      ) : null}
      <div className={styles.confirmActions}>
        <Button ref={cancel as never} variant="ghost" onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
        <Button variant={tone === 'primary' ? 'primary' : 'danger'} onClick={onConfirm} disabled={!ready} loading={busy} data-testid="confirm-go">
          {confirmLabel}
        </Button>
      </div>
    </div>
  )
}
