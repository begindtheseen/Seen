'use client'

// "Fix N bullets safely" — the diff FIRST, then a confirm. The 2026-10-24 audits found one click
// rewriting "Handled billing questions" into "Bill questions", autosaving it to the account with
// no preview and no undo while the toast said "nothing new was invented" (and "Rewrote 3" when
// seven bullets had changed). Every proposed change is listed here with a checkbox; rule-based
// rewrites are selected by default, punctuation-only changes are shown but off; nothing is
// written until "Apply" is pressed, and the page keeps an Undo.

import { useState } from 'react'
import s from './studio.module.css'
import type { RewriteLogEntry } from '@/lib/resume/types'

type Props = { log: RewriteLogEntry[]; onApply: (bulletIds: string[]) => void; onCancel: () => void }

export const isPunctuationOnly = (l: RewriteLogEntry) => l.changes.length > 0 && l.changes.every((c) => c.rule === 'hygiene')

export default function FixPreview({ log, onApply, onCancel }: Props) {
  const entries = log.filter((l) => l.changes.length > 0 && l.to !== l.from)
  const [picked, setPicked] = useState<Set<string>>(() => new Set(entries.filter((l) => !isPunctuationOnly(l)).map((l) => l.bulletId)))
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  return (
    <div className={s.card} data-testid="fix-preview">
      <span className={s.secTitle}>Review before anything changes · {picked.size} of {entries.length} selected</span>
      <div className={s.dim} style={{ margin: '.35rem 0 .6rem' }}>Each line shows your bullet and the proposed wording. Untick anything you do not want. Nothing is saved until you press Apply, and you can undo afterwards.</div>
      {entries.map((l) => (
        <label key={l.bulletId} className={s.finding} style={{ cursor: 'pointer', alignItems: 'flex-start' }}>
          <input type="checkbox" checked={picked.has(l.bulletId)} onChange={() => toggle(l.bulletId)} style={{ marginTop: '.2rem' }} />
          <div className={s.findingBody}>
            <div className={s.diff}><span className={s.del}>{l.from}</span><br /><span className={s.ins}>{l.to}</span></div>
            <div className={s.muted} style={{ marginTop: '.2rem' }}>{isPunctuationOnly(l) ? 'Punctuation only' : [...new Set(l.changes.map((c) => c.rule))].join(', ')}</div>
          </div>
        </label>
      ))}
      <div className={s.findingActions} style={{ marginTop: '.6rem' }}>
        <button type="button" className={s.btnGreen} data-testid="fix-apply" disabled={picked.size === 0} onClick={() => onApply([...picked])}>Apply {picked.size} change{picked.size === 1 ? '' : 's'}</button>
        <button type="button" className={s.btn} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
