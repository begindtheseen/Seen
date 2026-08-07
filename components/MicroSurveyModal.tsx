'use client'

import { useEffect, useRef, useState } from 'react'
import styles from './MicroSurveyModal.module.css'

// The compact, bottom-corner, NO-incentive micro-survey card — the low-friction complement to the
// incented SurveyModal.tsx. ONE question, one tap, dismissible, no reward. It is purely
// presentational: MicroSurveyHost.tsx owns WHEN it appears (randomization + once-per-day cap) and
// what happens on answer/dismiss. Aura-Glass tokens, light + unobtrusive, reduced-motion aware.

export interface MicroQuestion {
  key: string
  text: string
  choices: string[]
  /** Present only for the contextual question ("Did {company} get back to you?"). */
  company?: string
}

interface Props {
  question: MicroQuestion
  onAnswer: (choice: string) => void
  onDismiss: () => void
}

export default function MicroSurveyModal({ question, onAnswer, onDismiss }: Props) {
  const [leaving, setLeaving] = useState(false)
  const [acted, setActed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear a pending close timer if we unmount first (e.g. host tears us down).
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  // Play the brief leave animation, then hand control back to the host. Guarded so a double-tap
  // (answer then dismiss, or two choices) only ever fires once.
  function close(run: () => void) {
    if (acted) return
    setActed(true)
    setLeaving(true)
    timer.current = setTimeout(run, 180)
  }

  return (
    <div
      className={`${styles.card} ${leaving ? styles.leaving : ''}`}
      role="dialog"
      aria-label="Quick question"
    >
      <button className={styles.dismiss} onClick={() => close(onDismiss)} aria-label="Dismiss">
        ×
      </button>

      <div className={styles.eyebrow}>Quick question · one tap</div>

      <div className={styles.question}>{question.text}</div>

      <div className={styles.choices}>
        {question.choices.map((choice) => (
          <button
            key={choice}
            className={styles.choice}
            onClick={() => close(() => onAnswer(choice))}
          >
            {choice}
          </button>
        ))}
      </div>

      <div className={styles.footnote}>No signup. No reward. Just helping the next applicant.</div>
    </div>
  )
}
