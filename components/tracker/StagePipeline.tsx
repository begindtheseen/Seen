'use client'

// The stage control on an active card. Wide screens: six real buttons (≥44px tall) — tap one to
// set the stage. ≤480px (tracker.module.css): one current-stage chip + "Next: Phone screen →",
// because six 47×23px cells reading "PHONE S… / INTERVI… / FINAL R…" were neither readable nor
// tappable (user audit 2026-10-23). Both go through the same onStage → AppStore.update path.

import { STAGES } from '@/lib/constants'
import s from './tracker.module.css'

/** Reads at 6-across on a tablet; the full name is the title. */
export const SHORT_STAGE: Record<string, string> = {
  'Applied': 'Applied', 'Viewed': 'Viewed', 'Phone Screen': 'Screen', 'Interview': 'Interview', 'Final Round': 'Final', 'Offer': 'Offer',
}

export function nextStage(stage: string): string | null {
  const i = STAGES.indexOf(stage as typeof STAGES[number])
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1] : null
}

export default function StagePipeline({ stage, onStage }: { stage: string; onStage: (stage: string) => void }) {
  const idx = STAGES.indexOf(stage as typeof STAGES[number])
  const next = nextStage(stage)
  return (
    <>
      <div className={s.pipe} role="group" aria-label="Stage" onClick={e => e.stopPropagation()}>
        {STAGES.map((st, i) => {
          const current = i === idx
          return (
            <button
              key={st}
              type="button"
              className={`${s.step}${i < idx ? ' ' + s.done : ''}${current ? ' ' + s.current : ''}`}
              aria-current={current ? 'step' : undefined}
              aria-label={current ? `${st} (current stage)` : `Set stage to ${st}`}
              title={st}
              onClick={() => { if (!current) onStage(st) }}
            >
              {SHORT_STAGE[st]}
            </button>
          )
        })}
      </div>
      <div className={s.pipePhone} onClick={e => e.stopPropagation()}>
        <span className={s.chip} aria-label={`Current stage: ${stage}`}>{stage}</span>
        {next
          ? <button type="button" className={`${s.act} ${s.nextBtn}`} onClick={() => onStage(next)}>Next: {next} →</button>
          : <span className={s.pipeHint}>Final stage — tap “Got the job” below when it lands.</span>}
      </div>
    </>
  )
}
