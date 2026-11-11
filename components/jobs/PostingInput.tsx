'use client'
// THE "paste a job" box (UX audit F8 / §2b, 2026-11-10) — the Optimize sheet's needs-posting and
// no-requirements steps, /resume, Studio Tailor and the job page's analysis all use it.
//
//  1. One label, one textarea that takes the posting's LINK or its TEXT, and a live hint that says which
//     Seen sees ("Link — Seen will open it" / "Text — 1,840 characters").
//  2. Its own action button only where the caller asks for one (`onSubmit`); the filled style only where
//     the caller says it is the screen's one action (`primary`).
//  3. After a read, <PostingReadRow> says WHAT SEEN READ — title · employer · where from · how many
//     requirements — with "Not this job?" to correct the title and employer before anything else is done.
import { useId, useState } from 'react'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import s from './PostingInput.module.css'
import { postingPasteReady, isPostingLink } from '@/lib/postingPaste'
import { readLine } from '@/lib/postingRead.js'

export const POSTING_LABEL = 'The job — paste its link or its text'
const SHORT_HINT = 'That looks too short to be the whole posting — paste its link or all of its text.'

export function postingHint(text: string): string {
  const t = String(text || '').trim()
  if (!t) return 'A link to the posting (Seen opens it) or the whole posting, requirements included.'
  if (isPostingLink(t)) return 'Link — Seen will open it and read the posting.'
  if (!postingPasteReady(t)) return SHORT_HINT
  return `Text — ${t.length.toLocaleString('en-US')} characters.`
}

export default function PostingInput({
  value, onChange, onSubmit, busy = false, submitLabel = 'Read this job', primary = false,
  label = POSTING_LABEL, rows = 4, testId = 'posting-paste', autoFocus = false, disabled = false,
}: {
  /** Controlled text (omit to let the box hold its own). */
  value?: string
  onChange?: (text: string) => void
  /** Shows the box's own button; called with the trimmed text. Omit when the page's own button reads it. */
  onSubmit?: (text: string) => void
  busy?: boolean
  submitLabel?: string
  /** The filled style — only where this is the screen's one action. */
  primary?: boolean
  label?: string
  rows?: number
  testId?: string
  autoFocus?: boolean
  disabled?: boolean
}) {
  const id = useId()
  const [own, setOwn] = useState('')
  const text = value ?? own
  const set = (t: string) => { if (value === undefined) setOwn(t); onChange?.(t) }
  const ready = postingPasteReady(text)
  const hint = postingHint(text)
  return (
    <div className={s.box}>
      <label htmlFor={id} className={s.label}>{label}</label>
      <textarea
        id={id} value={text} rows={rows} data-testid={testId} autoComplete="off" spellCheck={false}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus} disabled={disabled}
        placeholder="https://… or the whole posting"
        onChange={(e) => set(e.target.value)}
        className={s.text}
        aria-describedby={`${id}-hint`}
      />
      <p id={`${id}-hint`} className={s.hint} data-short={hint === SHORT_HINT ? '1' : undefined}>{hint}</p>
      {onSubmit && (
        <Button variant={primary ? 'primary' : 'secondary'} full disabled={!ready || disabled} loading={busy}
          onClick={() => onSubmit(text.trim())} data-testid={`${testId}-run`}>
          {busy ? 'Reading the posting…' : submitLabel}
        </Button>
      )}
    </div>
  )
}

export interface PostingRead {
  title: string
  company: string
  source: string
  requirements: number | null
  fromLink?: boolean
  host?: string | null
}

/** "✓ Read: Area Operations Manager · Saxbys · read from jobs.lever.co · 14 requirements read" + "Not this job?" */
export function PostingReadRow({ read, onCorrect, onPasteAnother, note }: {
  read: PostingRead
  /** Re-run with a corrected title / employer. Omit to hide the correction. */
  onCorrect?: (v: { title: string; company: string }) => void
  /** Go back to the paste box. */
  onPasteAnother?: () => void
  /** One extra sentence (e.g. "This sheet is now about this posting, not Sales Associate · Petco."). */
  note?: string
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(read.title)
  const [company, setCompany] = useState(read.company)
  const tid = useId()
  return (
    <div className={s.read} data-testid="posting-read" role="status">
      <p className={s.readLine}>
        <Icon name="circle-check" size={16} className={s.readIco} />
        <span><span className={s.readKey}>Seen read:</span> {readLine(read)}</span>
      </p>
      {note && <p className={s.readNote}>{note}</p>}
      {!editing && (onCorrect || onPasteAnother) && (
        <div className={s.readActs}>
          {onCorrect && <button type="button" className={s.textBtn} onClick={() => setEditing(true)} data-testid="posting-read-edit">Not this job? Fix the title or employer</button>}
          {onPasteAnother && <button type="button" className={s.textBtn} onClick={onPasteAnother}>Paste a different posting</button>}
        </div>
      )}
      {editing && onCorrect && (
        <div className={s.fix}>
          <label className={s.fixLabel} htmlFor={`${tid}-t`}>Job title</label>
          <input id={`${tid}-t`} className={s.input} value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off" />
          <label className={s.fixLabel} htmlFor={`${tid}-c`}>Employer</label>
          <input id={`${tid}-c`} className={s.input} value={company} onChange={(e) => setCompany(e.target.value)} autoComplete="off" />
          <div className={s.fixActs}>
            <Button variant="secondary" size="sm" disabled={!title.trim()} onClick={() => { setEditing(false); onCorrect({ title: title.trim(), company: company.trim() }) }}>Check again with these · free</Button>
            <button type="button" className={s.textBtn} onClick={() => { setEditing(false); setTitle(read.title); setCompany(read.company) }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
