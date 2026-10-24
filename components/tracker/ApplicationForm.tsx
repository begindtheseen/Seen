'use client'

// The ONE form for "+ Track application" and a card's "Edit": company, role, location, applied via,
// and the day it was applied (California calendar, defaults to today). Validation and the
// appliedAt arithmetic live in lib/stores/applicationEdit.ts so they are unit-tested.

import { useEffect, useState } from 'react'
import ModalPortal from '@/components/ModalPortal'
import { PLATFORM_OPTIONS, todayPacific, validateForm, COMPANY_MAX, ROLE_MAX, LOCATION_MAX, type ApplicationForm as FormValues } from '@/lib/stores/applicationEdit'
import s from './tracker.module.css'

/** "57/120" under a field once it is three-quarters full — the cap is visible before it bites (audit 3 M9). */
function Counter({ id, value, max }: { id: string; value: string; max: number }) {
  if (value.length < Math.floor(max * 0.75)) return null
  return <span id={id} className={`${s.counter}${value.length >= max ? ' ' + s.counterFull : ''}`} aria-live="polite">{value.length}/{max}</span>
}

export default function ApplicationForm({ title, initial, notice, submitLabel, busyLabel, onSubmit, onClose }: {
  title: string
  initial: FormValues
  /** Shown above the fields — e.g. "Updated on another device — showing the latest" after a 409. */
  notice?: string
  submitLabel: string
  busyLabel: string
  onSubmit: (values: FormValues) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState<FormValues>(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const today = todayPacific()
  const platforms: string[] = PLATFORM_OPTIONS.includes(form.platform as typeof PLATFORM_OPTIONS[number]) ? [...PLATFORM_OPTIONS] : [form.platform, ...PLATFORM_OPTIONS]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  const set = (k: keyof FormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }))

  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    const problem = validateForm(form)
    if (problem) { setErr(problem); return }
    setErr(''); setBusy(true)
    try { await onSubmit(form) } catch { setErr('Could not save — please try again'); setBusy(false) }
  }

  return (
    <ModalPortal>
      <div className={s.backdrop} onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
        <form role="dialog" aria-modal="true" aria-label={title} className={s.dialog} onSubmit={submit}>
          <div className={s.dialogHead}>
            <span className={s.dialogTitle}>{title}</span>
            <button type="button" className={s.close} onClick={onClose} aria-label="Close" disabled={busy}>✕</button>
          </div>
          <div className={s.dialogBody}>
            {notice && <div role="status" className={s.notice}>{notice}</div>}
            <div className={s.field}>
              <label htmlFor="af-company">Company *</label>
              <input id="af-company" className={s.input} value={form.company} onChange={set('company')} placeholder="e.g. Target" autoFocus maxLength={COMPANY_MAX} aria-describedby="af-company-n" />
              <Counter id="af-company-n" value={form.company} max={COMPANY_MAX} />
            </div>
            <div className={s.field}>
              <label htmlFor="af-role">Role *</label>
              <input id="af-role" className={s.input} value={form.role} onChange={set('role')} placeholder="e.g. Cashier" maxLength={ROLE_MAX} aria-describedby="af-role-n" />
              <Counter id="af-role-n" value={form.role} max={ROLE_MAX} />
            </div>
            <div className={s.field}>
              <label htmlFor="af-location">Location</label>
              <input id="af-location" className={s.input} value={form.location} onChange={set('location')} placeholder="e.g. Phoenix, AZ or Remote" maxLength={LOCATION_MAX} aria-describedby="af-location-n" />
              <Counter id="af-location-n" value={form.location} max={LOCATION_MAX} />
            </div>
            <div className={s.two}>
              <div className={s.field}>
                <label htmlFor="af-platform">Applied via</label>
                <select id="af-platform" className={s.select} value={form.platform} onChange={set('platform')}>
                  {platforms.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className={s.field}>
                {/* Owner decision 2026-10-21: every day on Seen is the California calendar — said, not assumed (M8). */}
                <label htmlFor="af-date">Applied on (California time)</label>
                <input id="af-date" type="date" className={s.input} value={form.appliedOn} max={today} onChange={set('appliedOn')} required />
              </div>
            </div>
            {err && <div role="alert" className={s.err}>{err}</div>}
            <div className={s.dialogBtns}>
              <button type="button" className={s.act} onClick={onClose} disabled={busy}>Cancel</button>
              <button type="submit" className={`${s.act} ${s.actPrimary}`} disabled={busy || !form.company.trim() || !form.role.trim()}>{busy ? busyLabel : submitLabel}</button>
            </div>
          </div>
        </form>
      </div>
    </ModalPortal>
  )
}
