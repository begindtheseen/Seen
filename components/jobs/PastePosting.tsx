'use client'
// "Paste the full posting" — the way out of a dead end. A source that gives Seen only a teaser
// (every Adzuna row: Walmart, Fry's) or a listing that states no requirements used to end at "nothing
// to analyze yet" (test user Maria, 2026-10-25). The person can paste the posting from the employer's
// site and run the same analysis on that text. Nothing is stored; the parent decides what to run.
import { useState } from 'react'

export default function PastePosting({ onAnalyze, busy = false, label = 'Analyze the pasted posting' }: {
  onAnalyze: (text: string) => void
  busy?: boolean
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const enough = text.trim().length >= 200
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} data-testid="paste-posting-open"
        style={{ alignSelf: 'flex-start', marginTop: '.55rem', background: 'none', border: '1px solid var(--line2)', color: 'var(--green)', borderRadius: 8, padding: '.5rem .85rem', fontFamily: 'var(--mono)', fontSize: '.75rem', cursor: 'pointer', minHeight: 44 }}>
        Paste the full posting to analyze it →
      </button>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', marginTop: '.6rem' }}>
      <label htmlFor="paste-posting" style={{ fontSize: '.75rem', color: 'var(--sub)', lineHeight: 1.5 }}>
        Copy the whole posting from the employer&apos;s site (requirements included) and paste it here.
      </label>
      <textarea id="paste-posting" value={text} onChange={(e) => setText(e.target.value)} rows={6} data-testid="paste-posting-text"
        style={{ width: '100%', boxSizing: 'border-box', background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 8, color: 'var(--white)', padding: '.6rem .7rem', fontSize: '.8rem', lineHeight: 1.5, fontFamily: 'inherit' }} />
      <button type="button" disabled={!enough || busy} onClick={() => onAnalyze(text.trim())} data-testid="paste-posting-run"
        style={{ alignSelf: 'flex-start', background: enough && !busy ? 'var(--green)' : 'var(--line2)', color: 'var(--ink)', border: 'none', borderRadius: 8, padding: '.55rem .95rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.8rem', cursor: enough && !busy ? 'pointer' : 'default', minHeight: 44 }}>
        {busy ? 'Reading…' : label}
      </button>
      {!enough && text.trim().length > 0 && <div style={{ fontSize: '.75rem', color: 'var(--muted)' }}>That looks too short to be the whole posting.</div>}
    </div>
  )
}
