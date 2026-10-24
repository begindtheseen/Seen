'use client'

// "When did you apply?" — the check-in clock starts at the real date (lib/trackCapture.ts).
// A radio group of chips; "Pick a date" opens a date field bounded to the last year and today.

import { useId } from 'react'
import { APPLIED_CHOICES, earliestAppliedDay, type AppliedChoice } from '@/lib/trackCapture'
import { todayPacific } from '@/lib/stores/applicationEdit'
import s from './track.module.css'

export default function AppliedWhen({ choice, pickedDay, onChoice, onPickedDay, legend = 'When did you apply?' }: {
  choice: AppliedChoice | null
  pickedDay: string
  onChoice: (c: AppliedChoice) => void
  onPickedDay: (day: string) => void
  legend?: string
}) {
  const id = useId()
  return (
    <div className={s.field}>
      <span className={s.label} id={`${id}-l`}>{legend}</span>
      <div className={s.chips} role="radiogroup" aria-labelledby={`${id}-l`}>
        {APPLIED_CHOICES.map(c => (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={choice === c.value}
            className={s.chip}
            data-testid={`applied-${c.value}`}
            onClick={() => onChoice(c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>
      {choice === 'date' && (
        <div className={s.field}>
          <label className={s.label} htmlFor={`${id}-d`}>Day you applied</label>
          <input
            id={`${id}-d`}
            type="date"
            className={s.input}
            value={pickedDay}
            min={earliestAppliedDay()}
            max={todayPacific()}
            onChange={e => onPickedDay(e.target.value)}
            data-testid="applied-date-input"
          />
        </div>
      )}
    </div>
  )
}
