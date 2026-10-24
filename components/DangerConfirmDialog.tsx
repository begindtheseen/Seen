'use client'

// The in-app confirmation for an account-level action that cannot be taken back lightly ("Sign out of
// all devices", "Delete my account"). Replaces the browser's native confirm(): that dialog cannot be
// styled, is dismissed by habit, and is auto-dismissed by automation — the 2026-10-24 audit measured a
// dismissed confirm() and reported the button as "does nothing". Same surface rules as
// CreditConfirmDialog: solid #0e111c (never translucent over content), portaled above everything,
// Escape / backdrop = cancel, the confirm button is the only red thing on screen.
//
// `typeToConfirm`: when set, the confirm button stays disabled until the person types that word
// (case-insensitive) — for the irreversible ones (deletion).

import { useEffect, useRef, useState } from 'react'
import ModalPortal from '@/components/ModalPortal'

export default function DangerConfirmDialog({ title, body, confirmLabel, cancelLabel = 'Cancel', typeToConfirm, busy = false, busyLabel, onConfirm, onCancel, testId = 'danger-confirm' }: {
  title: string
  /** One or two plain sentences: exactly what happens, and what does not. */
  body: string | string[]
  confirmLabel: string
  cancelLabel?: string
  /** A word the person must type before the confirm button enables (e.g. "DELETE"). */
  typeToConfirm?: string
  /** True while the action runs: both buttons lock, the confirm button reads `busyLabel`. */
  busy?: boolean
  busyLabel?: string
  onConfirm: () => void
  onCancel: () => void
  testId?: string
}) {
  const [typed, setTyped] = useState('')
  const confirmRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const armed = !typeToConfirm || typed.trim().toLowerCase() === typeToConfirm.toLowerCase()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel() }
    window.addEventListener('keydown', onKey)
    // Focus the field when there is one, else the confirm button — the dialog is keyboard-complete.
    ;(inputRef.current || confirmRef.current)?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, busy])

  const paragraphs = Array.isArray(body) ? body : [body]

  return (
    <ModalPortal>
      <div role="dialog" aria-modal="true" aria-labelledby={`${testId}-title`} data-testid={testId}
        style={{ position: 'fixed', inset: 0, zIndex: 9950, background: 'rgba(0,0,0,.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
        onClick={() => { if (!busy) onCancel() }}>
        <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 400, background: '#0e111c', border: '1px solid rgba(239,68,68,.35)', borderRadius: 16, padding: '1.15rem 1.2rem 1rem', boxShadow: '0 30px 80px rgba(0,0,0,.7)' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.1em', color: '#f87185', marginBottom: '.5rem' }}>Please confirm</div>
          <div id={`${testId}-title`} style={{ fontFamily: 'var(--display)', fontSize: '1rem', fontWeight: 800, color: 'var(--white)', lineHeight: 1.3, marginBottom: '.45rem' }}>{title}</div>
          {paragraphs.map((p, i) => (
            <p key={i} style={{ fontSize: '.78rem', color: 'var(--sub)', lineHeight: 1.6, margin: i === paragraphs.length - 1 ? '0 0 1rem' : '0 0 .5rem' }}>{p}</p>
          ))}
          {typeToConfirm && (
            <label style={{ display: 'block', marginBottom: '1rem' }}>
              <span style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: '.58rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--dim)', marginBottom: '.35rem' }}>Type {typeToConfirm} to continue</span>
              <input
                ref={inputRef}
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                value={typed}
                disabled={busy}
                onChange={e => setTyped(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && armed && !busy) onConfirm() }}
                placeholder={typeToConfirm}
                aria-label={`Type ${typeToConfirm} to continue`}
                style={{ width: '100%', boxSizing: 'border-box', minHeight: 44, background: 'var(--surface)', border: '1.5px solid var(--line2)', borderRadius: 8, padding: '.6rem .85rem', color: 'var(--white)', fontFamily: 'var(--mono)', fontSize: '1rem', letterSpacing: '.08em', outline: 'none' }}
              />
            </label>
          )}
          <div style={{ display: 'flex', gap: '.5rem', flexDirection: 'column' }}>
            <button
              ref={confirmRef}
              type="button"
              onClick={() => { if (armed && !busy) onConfirm() }}
              disabled={!armed || busy}
              aria-disabled={!armed || busy}
              style={{ width: '100%', minHeight: 44, padding: '.75rem 1rem', background: armed ? 'linear-gradient(135deg,#ef4444 0%,#b91c1c 100%)' : 'rgba(239,68,68,.18)', color: '#fff', border: 'none', borderRadius: 10, fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.86rem', cursor: armed && !busy ? 'pointer' : 'not-allowed', opacity: busy ? .7 : 1 }}
            >
              {busy ? (busyLabel || confirmLabel) : confirmLabel}
            </button>
            <button type="button" onClick={onCancel} disabled={busy} style={{ width: '100%', minHeight: 44, padding: '.6rem 1rem', background: 'none', border: '1px solid var(--line2)', color: 'var(--muted)', borderRadius: 10, fontFamily: 'var(--mono)', fontSize: '.7rem', cursor: busy ? 'not-allowed' : 'pointer' }}>
              {cancelLabel}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
