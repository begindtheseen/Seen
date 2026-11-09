'use client'
// "Paste the full posting" — the way out of a dead end. A source that gives Seen only a teaser
// (every Adzuna row: Walmart, Fry's) or a listing that states no requirements used to end at "nothing
// to analyze yet" (test user Maria, 2026-10-25). The person can paste the posting from the employer's
// site and run the same analysis on that text. Nothing is stored; the parent decides what to run.
// One outlined button on its own line (DESIGN.md §5: the page's filled button is Apply).
import { useState } from 'react'
import Button from '@/components/ui/Button'
import s from './PastePosting.module.css'
import { postingPasteReady, isPostingLink } from '@/lib/postingPaste'

export default function PastePosting({ onAnalyze, busy = false, label = 'Analyze the pasted posting' }: {
  onAnalyze: (text: string) => void
  busy?: boolean
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const enough = postingPasteReady(text)
  if (!open) {
    return (
      <div className={s.row}>
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)} data-testid="paste-posting-open" iconRight="arrow-right">
          Paste the full posting to analyze it
        </Button>
      </div>
    )
  }
  return (
    <div className={s.form}>
      <label htmlFor="paste-posting" className={s.label}>
        Paste the listing&apos;s link, or copy the whole posting from the employer&apos;s site (requirements included) and paste it here.
      </label>
      <textarea id="paste-posting" value={text} onChange={(e) => setText(e.target.value)} rows={6} data-testid="paste-posting-text" className={s.text} />
      <div className={s.row}>
        <Button variant="secondary" size="sm" disabled={!enough || busy} loading={busy} onClick={() => onAnalyze(text.trim())} data-testid="paste-posting-run">
          {busy ? 'Reading…' : label}
        </Button>
      </div>
      {!enough && text.trim().length > 0 && !isPostingLink(text) && <p className={s.hint}>That looks too short to be the whole posting — paste its link or all of its text.</p>}
    </div>
  )
}
