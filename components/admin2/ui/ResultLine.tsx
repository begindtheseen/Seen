'use client'

// What an action did, said in place, in one line (audit §3.3): a glyph and a word for the state, the
// server's own sentence, the skipped rows as links ("46 skipped as possible duplicates — Review them"),
// Undo when the server offers it, Retry when the error is retryable. It stays until dismissed or until
// the next press — no toast that vanishes before it is read, no page reload.
import Icon from '@/components/ui/Icon'
import type { AdminSkipped } from '../contract.ts'
import type { ActionState } from '../core/action.ts'
import { withFollowUp, type Job } from '../core/jobs.ts'
import styles from './ui.module.css'

export type SkipLink = { label: string; onSelect: () => void }

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

/** "possible_duplicate" → "possible duplicates" (for counts ≠ 1). Pure for the test. */
export function skipReasonText(reason: string, count: number): string {
  const words = reason.replace(/[_-]+/g, ' ').trim()
  // "already decided", "not found", "employee reviews" read the same for any count.
  if (count === 1 || /(?:s|ed|ing|found)$/i.test(words)) return words
  return `${words}s`
}

export type ResultLineProps = {
  state: ActionState
  onUndo?: () => void
  onRetry?: () => void
  onDismiss?: () => void
  /** Per skip reason, a link that shows those rows (sets the filter). */
  skipLinks?: Record<string, SkipLink>
  /** While running: "Approving 188 reports…" (default "Working…"). Never shown while undoing or checking. */
  runningText?: string
  /**
   * A follow-up job this result announced ("… · 53 company scores still updating"). When the job finishes the
   * line is REPLACED by the finished sentence — the "still updating" part is never left on screen.
   */
  followUp?: Job
  /** While an Undo runs as a job: its live progress ("Undoing… 420 of 1,040"). The word stays "Undoing". */
  undoingProgress?: string
}

/** What the line says while the Undo runs: never the original action's "Approving…". Pure for the test. */
export function undoingText(state: ActionState): string {
  const n = state.result?.changed || 0
  // one change (a credit grant, one report) is just "Undoing…": "putting 1 back" reads wrong for a number that was changed
  return n > 1 ? `Undoing — putting ${fmt(n)} back…` : 'Undoing…'
}

export default function ResultLine({ state, onUndo, onRetry, onDismiss, skipLinks, runningText, followUp, undoingProgress }: ResultLineProps) {
  if (state.status === 'idle') return null
  const running = state.status === 'running' || state.undoing
  const err = state.error
  const failed = state.status === 'error' || (!!err && !running)
  const res = state.result
  const tone = running ? styles.lineRun : failed ? styles.lineBad : styles.lineGood
  const unknown = failed && err?.code === 'unknown_outcome'
  const undoUnknown = failed && state.status === 'done' && err?.code === 'unknown_outcome'
  const word = running ? (state.undoing ? (state.checking ? 'Checking' : 'Undoing') : state.checking ? 'Checking' : 'Working') : failed ? (state.status === 'done' ? (undoUnknown ? 'Not known yet' : 'Undo failed') : unknown ? 'Not known yet' : 'Not done') : state.undone ? 'Undone' : 'Done'
  const skipped: AdminSkipped[] = !failed && res ? res.skipped.filter((s) => s.count > 0) : []
  return (
    <div className={`${styles.line} ${tone}`} role="status" aria-live="polite" data-testid="result-line" data-state={running ? 'running' : failed ? 'error' : 'done'}>
      <span className={styles.lineWord}>
        {running ? <span className={styles.spin} aria-hidden="true" /> : <Icon name={failed ? 'circle-x' : 'circle-check'} size={16} />}
        {word}
      </span>
      <span className={styles.lineText}>
        {running ? (state.undoing ? (state.checking ? 'No answer yet — asking the server whether the Undo went through…' : (undoingProgress || undoingText(state))) : state.checking ? 'No answer yet — asking the server whether it went through…' : (runningText || 'Working…')) : failed ? (
          <>
            {err?.error}
            {err && (err.changed || 0) > 0 ? ` ${fmt(err.changed!)} ${err.changed === 1 ? 'row was' : 'rows were'} changed before it stopped.` : ''}
          </>
        ) : withFollowUp(res?.message || 'Done.', followUp)}
        {skipped.map((s) => {
          const link = skipLinks?.[s.reason]
          const already = res?.message.includes(fmt(s.count)) || res?.message.includes(String(s.count))
          if (!link && already) return null
          return (
            <span key={s.reason} className={styles.lineSkip}>
              {already ? '' : ` ${fmt(s.count)} skipped as ${skipReasonText(s.reason, s.count)}.`}
              {link ? <> <button type="button" className={styles.lineLink} onClick={link.onSelect}>{link.label}</button></> : null}
            </span>
          )
        })}
      </span>
      <span className={styles.lineActions}>
        {!running && !failed && res?.undo && onUndo ? (
          <button type="button" className={styles.lineBtn} onClick={onUndo} data-testid="result-undo">
            <Icon name="undo-2" size={16} />{res.undo.label || 'Undo'}
          </button>
        ) : null}
        {undoUnknown && res?.undo && onUndo ? (
          <button type="button" className={styles.lineBtn} onClick={onUndo} data-testid="result-undo-check">
            <Icon name="refresh-cw" size={16} />Check again
          </button>
        ) : null}
        {!running && state.status === 'error' && err?.retryable && onRetry ? (
          <button type="button" className={styles.lineBtn} onClick={onRetry} data-testid="result-retry">
            <Icon name="refresh-cw" size={16} />{unknown ? 'Check again' : 'Retry'}
          </button>
        ) : null}
        {!running && onDismiss ? (
          <button type="button" className={styles.lineX} onClick={onDismiss} aria-label="Dismiss this message" data-testid="result-dismiss">
            <Icon name="x" size={16} />
          </button>
        ) : null}
      </span>
    </div>
  )
}
