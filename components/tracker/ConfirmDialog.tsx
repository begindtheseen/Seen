'use client'

// A small confirm step for the tracker's destructive buttons (Delete, Clear all). The copy says
// exactly what happens — a Delete files nothing anywhere — so a mistaken entry can be removed
// without passing through any review prompt.

import { useEffect, useState } from 'react'
import ModalPortal from '@/components/ModalPortal'
import s from './tracker.module.css'

export default function ConfirmDialog({ title, body, confirmLabel, busyLabel = 'Working…', danger = true, onConfirm, onClose }: {
  title: string
  body: React.ReactNode
  confirmLabel: string
  busyLabel?: string
  danger?: boolean
  onConfirm: () => Promise<void> | void
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  async function go() {
    setBusy(true); setErr('')
    try { await onConfirm() } catch { setErr('That didn’t go through — please try again'); setBusy(false) }
  }

  return (
    <ModalPortal>
      <div className={s.backdrop} onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
        <div role="alertdialog" aria-modal="true" aria-label={title} className={s.dialog}>
          <div className={s.dialogHead}>
            <span className={s.dialogTitle}>{title}</span>
            <button type="button" className={s.close} onClick={onClose} aria-label="Close" disabled={busy}>✕</button>
          </div>
          <div className={s.dialogBody}>
            <p className={s.hint} style={{ color: 'var(--sub)', fontSize: 'var(--fs-sm)' }}>{body}</p>
            {err && <div role="alert" className={s.err}>{err}</div>}
            <div className={s.dialogBtns}>
              <button type="button" className={s.act} onClick={onClose} disabled={busy}>Keep it</button>
              <button type="button" className={`${s.act} ${danger ? s.actRed : s.actPrimary}`} onClick={go} disabled={busy} autoFocus>{busy ? busyLabel : confirmLabel}</button>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
