'use client'

// THE in-app confirmation shell for an account-level action that cannot be taken back lightly
// ("Sign out of all devices", "Delete my account" — components/profile/DeleteAccountDialog composes
// it). Replaces the browser's native confirm(): that dialog cannot be styled, is dismissed by habit,
// and is auto-dismissed by automation — the 2026-10-24 audit measured a dismissed confirm() and
// reported "Sign out everywhere" as "does nothing". Same surface rules as CreditConfirmDialog: solid
// #0e111c (never translucent over content), portaled above everything, focus trapped
// (lib/hooks/useFocusTrap), Escape / backdrop = cancel, the confirm button is the only red thing.
//
// `typeToConfirm`: when set, the confirm button stays disabled until the person types that word
// (`matchesTyped` decides; default = case-insensitive, whitespace ignored) — for the irreversible ones.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import ModalPortal from '@/components/ModalPortal'
import { useFocusTrap } from '@/lib/hooks/useFocusTrap'

export default function DangerConfirmDialog({
  eyebrow = 'Please confirm', title, body, children, confirmLabel, cancelLabel = 'Cancel', typeToConfirm, matchesTyped,
  confirmDisabled = false, busy = false, busyLabel, error, onConfirm, onCancel, testId = 'danger-confirm', confirmTestId, maxWidth = 400,
}: {
  eyebrow?: string
  title: ReactNode
  /** One or two plain sentences: exactly what happens, and what does not. */
  body?: string | string[]
  /** Anything richer than sentences (a list of consequences, a blocking notice), shown under `body`. */
  children?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  /** A word the person must type before the confirm button enables (e.g. "DELETE"). */
  typeToConfirm?: string
  /** How the typed text is judged against `typeToConfirm`. */
  matchesTyped?: (typed: string) => boolean
  /** The action is not allowed right now (the caller explains why in `children`). */
  confirmDisabled?: boolean
  /** True while the action runs: both buttons lock, the confirm button reads `busyLabel`. */
  busy?: boolean
  busyLabel?: string
  /** The action failed — shown above the buttons, the dialog stays open. */
  error?: string
  onConfirm: () => void
  onCancel: () => void
  testId?: string
  confirmTestId?: string
  maxWidth?: number
}) {
  const [typed, setTyped] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const typedOk = !typeToConfirm || (matchesTyped
    ? matchesTyped(typed)
    : typed.trim().toLowerCase() === typeToConfirm.toLowerCase())
  const armed = typedOk && !confirmDisabled
  // Focus the field when there is one, else the confirm button — the dialog is keyboard-complete, and
  // focus returns to the button that opened it on close.
  useFocusTrap(boxRef, true, { initialFocus: typeToConfirm ? inputRef : confirmRef })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, busy])

  const paragraphs = body == null ? [] : Array.isArray(body) ? body : [body]
  const fire = () => { if (armed && !busy) onConfirm() }

  return (
    <ModalPortal>
      <div role="dialog" aria-modal="true" aria-labelledby={`${testId}-title`} data-testid={testId}
        style={{ position: 'fixed', inset: 0, zIndex: 9950, background: 'rgba(0,0,0,.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
        onClick={() => { if (!busy) onCancel() }}>
        <div ref={boxRef} tabIndex={-1} onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth, maxHeight: 'calc(100vh - 2rem)', overflowY: 'auto', background: '#0e111c', border: '1px solid rgba(239,68,68,.35)', borderRadius: 16, padding: '1.15rem 1.2rem 1rem', boxShadow: '0 30px 80px rgba(0,0,0,.7)', outline: 'none' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', textTransform: 'uppercase', letterSpacing: '.1em', color: '#f87185', marginBottom: '.5rem' }}>{eyebrow}</div>
          <h2 id={`${testId}-title`} style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-lead)', fontWeight: 800, color: 'var(--white)', lineHeight: 1.3, margin: '0 0 .45rem' }}>{title}</h2>
          {paragraphs.map((p, i) => (
            <p key={i} style={{ fontSize: 'var(--fs-meta)', color: 'var(--sub)', lineHeight: 1.6, margin: i === paragraphs.length - 1 && !children ? '0 0 1rem' : '0 0 .5rem' }}>{p}</p>
          ))}
          {children}
          {typeToConfirm && !confirmDisabled && (
            <label style={{ display: 'block', marginBottom: '1rem' }}>
              <span style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--dim)', marginBottom: '.35rem' }}>Type {typeToConfirm} to confirm</span>
              <input
                ref={inputRef}
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                value={typed}
                disabled={busy}
                onChange={e => setTyped(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') fire() }}
                placeholder={typeToConfirm}
                aria-label={`Type ${typeToConfirm} to confirm`}
                style={{ width: '100%', boxSizing: 'border-box', minHeight: 44, background: 'var(--surface)', border: '1.5px solid var(--line2)', borderRadius: 8, padding: '.6rem .85rem', color: 'var(--white)', fontFamily: 'var(--mono)', fontSize: 'var(--fs-lead)', letterSpacing: '.08em', outline: 'none' }}
              />
            </label>
          )}
          {error && <div role="alert" style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', lineHeight: 1.6, color: '#f87185', marginBottom: '.7rem' }}>{error}</div>}
          <div style={{ display: 'flex', gap: '.5rem', flexDirection: 'column' }}>
            <button
              ref={confirmRef}
              type="button"
              onClick={fire}
              disabled={!armed || busy}
              aria-disabled={!armed || busy}
              data-testid={confirmTestId || `${testId}-confirm`}
              style={{ width: '100%', minHeight: 44, padding: '.75rem 1rem', background: armed ? 'linear-gradient(135deg,#ef4444 0%,#b91c1c 100%)' : 'rgba(239,68,68,.15)', color: armed ? '#fff' : 'rgba(255,255,255,.55)', border: 'none', borderRadius: 10, fontFamily: 'var(--display)', fontWeight: 800, fontSize: 'var(--fs-ui)', cursor: armed && !busy ? 'pointer' : 'not-allowed', opacity: busy ? .7 : 1 }}
            >
              {busy ? (busyLabel || confirmLabel) : confirmLabel}
            </button>
            <button type="button" onClick={onCancel} disabled={busy} style={{ width: '100%', minHeight: 44, padding: '.6rem 1rem', background: 'none', border: '1px solid var(--line2)', color: 'var(--muted)', borderRadius: 10, fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', cursor: busy ? 'not-allowed' : 'pointer' }}>
              {cancelLabel}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
