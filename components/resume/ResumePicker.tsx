'use client'

// "Résumé: <name> ▾" — which saved résumé this optimize / application uses. Shown only when the
// account has saved résumés (the table is live); one résumé shows just its name; a résumé that needs
// Pro is listed but cannot be picked. Picking never charges anything.
import { useId } from 'react'
import type { ResumeList, SavedResume } from '@/lib/resumeLibrary'
import { pickerMode, optionLabel } from '@/lib/resumeChoice.js'

const wrap: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.75rem', minWidth: 0 }
const lab: React.CSSProperties = { fontFamily: 'var(--mono)', fontSize: 'var(--fs-65)', color: 'var(--dim)', flexShrink: 0 }

export default function ResumePicker({ list, selectedId, onPick, disabled, note }: {
  list: ResumeList | null
  selectedId: string | null
  onPick: (r: SavedResume) => void
  disabled?: boolean
  /** A short line under the control (e.g. "Switching re-checks your fit · free"). */
  note?: string
}) {
  const id = useId()
  const mode = pickerMode(list)
  if (mode === 'hidden' || !list) return null
  const rows = list.resumes
  if (mode === 'name') {
    return <div style={wrap} data-testid="resume-picker-name"><span style={lab}>Résumé:</span><span style={{ fontSize: 'var(--fs-ui)', color: 'var(--white)', overflowWrap: 'anywhere', minWidth: 0 }}>{rows[0].name}</span></div>
  }
  const locked = rows.some(r => !r.usable)
  return (
    <div style={{ marginBottom: '.75rem' }}>
      <div style={{ ...wrap, marginBottom: 0 }}>
        <label htmlFor={id} style={lab}>Résumé:</label>
        <select
          id={id}
          data-testid="resume-picker"
          className="ui-input"
          value={selectedId || ''}
          disabled={disabled}
          onChange={e => { const r = rows.find(x => x.id === e.target.value); if (r && r.usable) onPick(r) }}
          style={{ flex: '1 1 12rem', minWidth: 0, minHeight: 44, fontSize: 'var(--fs-ui)' }}
        >
          {rows.map(r => <option key={r.id} value={r.id} disabled={!r.usable}>{optionLabel(r)}</option>)}
        </select>
      </div>
      {(note || locked) && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-60)', color: 'var(--muted)', marginTop: '.25rem', lineHeight: 1.5 }}>
          {[note, locked ? 'Résumés marked Pro stay saved — only your default can be used without Pro.' : ''].filter(Boolean).join(' ')}
        </div>
      )}
    </div>
  )
}
