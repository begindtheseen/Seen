'use client'
// Legacy name for the one "paste a job" box: components/jobs/PostingInput.tsx (UX audit F8). A collapsed
// opener, then the shared box with its own outlined button. Nothing is stored; the parent decides what to run.
import { useState } from 'react'
import Button from '@/components/ui/Button'
import PostingInput from './PostingInput'
import s from './PastePosting.module.css'

export default function PastePosting({ onAnalyze, busy = false, label = 'Read this job · free' }: {
  onAnalyze: (text: string) => void
  busy?: boolean
  label?: string
}) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <div className={s.row}>
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)} data-testid="paste-posting-open" iconRight="arrow-right">Paste the posting&apos;s link or text</Button>
      </div>
    )
  }
  return <div className={s.form}><PostingInput onSubmit={onAnalyze} busy={busy} submitLabel={label} testId="paste-posting-text" /></div>
}
