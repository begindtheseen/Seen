'use client'

// "We hired — close this listing" (owner request 2026-10-18). Two clear steps inside the
// applications inbox, nothing sent until the employer confirms:
//   1. Who did you hire? Tick everyone. Already-hired people are ticked and locked.
//   2. Review: who is marked hired (no message), who gets the decline message (editable), who is
//      left alone (already declined / withdrew), and that the listing closes. A required checkbox
//      ("I've selected everyone I hired") arms the send button.
// Server: api/employer-listings.js fill_listing.

import { useMemo, useState } from 'react'
import { declineTemplates, DECLINE_MESSAGE_MAX } from '@/lib/server/seenApply.js'

export type FillApp = { id: string; name: string; status: string }
type Template = { id: string; label: string; text: string }

/**
 * Pick a recommended decline message or write your own. Choosing a recommendation fills the box;
 * editing it (or "Write your own") makes it the employer's own. Shared by the close-out flow and
 * the single "Not moving forward" prompt.
 */
export function DeclineMessagePicker({ templates, value, onChange, allowNone }: {
  templates: Template[]
  value: string
  onChange: (v: string) => void
  /** Offer "No message" (single decline only — the close-out always sends one). */
  allowNone?: boolean
}) {
  const match = templates.find(t => t.text === value)
  const [mode, setMode] = useState<string>(match ? match.id : value ? 'custom' : allowNone ? 'none' : templates[0]?.id || 'custom')
  const chip = (id: string, label: string, onPick: () => void) => (
    <button key={id} type="button" aria-pressed={mode === id} onClick={() => { setMode(id); onPick() }}
      style={{ padding: '.32rem .65rem', borderRadius: 999, fontSize: 'var(--fs-meta)', cursor: 'pointer', border: `1px solid ${mode === id ? 'var(--blue)' : 'var(--line2)'}`, background: mode === id ? 'rgba(59,130,246,.12)' : 'none', color: mode === id ? 'var(--white)' : 'var(--sub)' }}>
      {label}
    </button>
  )
  return (
    <div>
      <div style={{ ...mono('.52rem', 'var(--dim)'), textTransform: 'uppercase', letterSpacing: '.09em', marginBottom: '.35rem' }}>Recommended messages</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem', marginBottom: '.5rem' }}>
        {templates.map(t => chip(t.id, t.label, () => onChange(t.text)))}
        {chip('custom', '✎ Write your own', () => onChange(''))}
        {allowNone && chip('none', 'No message', () => onChange(''))}
      </div>
      {mode !== 'none' && (
        <textarea autoComplete="off" value={value} onChange={e => { onChange(e.target.value); if (mode !== 'custom') setMode('custom') }} maxLength={DECLINE_MESSAGE_MAX} rows={4}
          aria-label="Decline message" placeholder={mode === 'custom' ? 'Write your message — it goes to the applicant as written.' : undefined}
          style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 8, padding: '.55rem .65rem', color: 'var(--white)', fontSize: 'var(--fs-meta)', lineHeight: 1.5, fontFamily: 'var(--body)' }} />
      )}
      <div style={{ ...mono('.52rem', 'var(--muted)'), marginTop: '.3rem' }}>
        {mode === 'none' ? 'They’ll see “Not selected” on their tracker and get the standard update email.' : 'It shows on their Seen tracker and is emailed to them. They can’t reply.'}
      </div>
    </div>
  )
}
type Result = { hired: number; declined: number; skipped: number; closed: boolean }

const mono = (size: string, color: string): React.CSSProperties => ({ fontFamily: 'var(--mono)', fontSize: size, color })
const btn: React.CSSProperties = { borderRadius: 9, padding: '.6rem 1rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: 'var(--fs-sm)', cursor: 'pointer' }

export default function FillListingPanel({ listing, apps, call, onDone, onCancel, initialPicked }: {
  listing: { id: string; title: string; company: string }
  apps: FillApp[]
  /** Pre-ticked as hired — the applicant whose "Hired" status opened this flow. */
  initialPicked?: string[]
  call: (body: object) => Promise<Record<string, unknown>>
  onDone: (r: Result) => void
  onCancel: () => void
}) {
  const [step, setStep] = useState<1 | 2>(1)
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initialPicked || []))
  const templates = useMemo(() => declineTemplates({ title: listing.title, company: listing.company }, 'filled'), [listing.title, listing.company])
  const [message, setMessage] = useState(() => templates[0].text)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const open = (a: FillApp) => a.status === 'new' || a.status === 'reviewed' || a.status === 'interviewing'
  const groups = useMemo(() => {
    const hired = apps.filter(a => a.status === 'hired' || picked.has(a.id))
    const decline = apps.filter(a => open(a) && !picked.has(a.id))
    const declinedBefore = apps.filter(a => a.status === 'rejected' && !picked.has(a.id))
    const withdrew = apps.filter(a => a.status === 'withdrawn')
    return { hired, decline, declinedBefore, withdrew }
  }, [apps, picked])

  function toggle(id: string) {
    setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
    setConfirmed(false)
  }

  async function send() {
    setBusy(true); setErr('')
    try {
      const d = await call({ action: 'fill_listing', job_id: listing.id, hired_ids: [...picked], message, confirm_hired: true })
      onDone({ hired: Number(d.hired) || 0, declined: Number(d.declined) || 0, skipped: Number(d.skipped) || 0, closed: d.closed === true })
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const names = (list: FillApp[]) => list.map(a => a.name || 'Applicant').join(', ')
  const box: React.CSSProperties = { background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 11, padding: '.75rem .85rem' }

  if (step === 1) {
    const choosable = apps.filter(a => a.status !== 'withdrawn')
    return (
      <div>
        <div style={{ ...mono('.55rem', 'var(--green)'), textTransform: 'uppercase', letterSpacing: '.1em' }}>Step 1 of 2</div>
        <div style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: 'var(--fs-lead)', color: 'var(--white)', margin: '.2rem 0 .3rem' }}>Who did you hire?</div>
        <div style={{ ...mono('.6rem', 'var(--sub)'), lineHeight: 1.6, marginBottom: '.8rem' }}>
          Tick everyone you hired for this role. Everyone you don’t tick who is still waiting will get a decline message in the next step.
        </div>
        {choosable.length === 0 && <div style={{ ...mono('.6rem', 'var(--muted)'), marginBottom: '.8rem' }}>No applications on Seen — the listing will just close.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
          {choosable.map(a => {
            const locked = a.status === 'hired'
            const on = locked || picked.has(a.id)
            return (
              <label key={a.id} style={{ ...box, display: 'flex', alignItems: 'center', gap: '.6rem', cursor: locked ? 'default' : 'pointer', borderColor: on ? 'var(--green)' : 'var(--line2)' }}>
                <input type="checkbox" checked={on} disabled={locked} onChange={() => toggle(a.id)} style={{ width: 16, height: 16, accentColor: 'var(--green)' }} />
                <span style={{ flex: 1, fontSize: 'var(--fs-ui)', color: 'var(--white)' }}>{a.name || 'Applicant'}</span>
                <span style={mono('.55rem', locked ? 'var(--green)' : a.status === 'rejected' ? 'var(--muted)' : 'var(--sub)')}>
                  {locked ? 'Hired' : a.status === 'rejected' ? 'Already declined' : a.status === 'interviewing' ? 'Interviewing' : a.status === 'reviewed' ? 'Reviewed' : 'New'}
                </span>
              </label>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: '.5rem', marginTop: '1rem' }}>
          <button type="button" onClick={onCancel} style={{ ...btn, background: 'none', border: '1px solid var(--line2)', color: 'var(--sub)' }}>Cancel</button>
          <button type="button" onClick={() => setStep(2)} style={{ ...btn, flex: 1, border: 'none', background: 'var(--blue)', color: '#fff' }}>Next: review before sending →</button>
        </div>
      </div>
    )
  }

  const n = groups.decline.length
  return (
    <div>
      <div style={{ ...mono('.55rem', 'var(--green)'), textTransform: 'uppercase', letterSpacing: '.1em' }}>Step 2 of 2</div>
      <div style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: 'var(--fs-lead)', color: 'var(--white)', margin: '.2rem 0 .8rem' }}>Review before anything is sent</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
        <div style={box}>
          <div style={mono('.58rem', 'var(--green)')}>✓ Marked hired · no message</div>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--white)', marginTop: '.25rem' }}>{groups.hired.length ? names(groups.hired) : 'Nobody from Seen'}</div>
        </div>

        <div style={{ ...box, borderColor: n ? 'rgba(239,68,68,.35)' : 'var(--line2)' }}>
          <div style={mono('.58rem', n ? 'var(--red)' : 'var(--muted)')}>✉ {n ? `${n} applicant${n === 1 ? '' : 's'} will get this message and be marked “not selected”` : 'Nobody is waiting — no message will be sent'}</div>
          {n > 0 && (
            <>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--white)', margin: '.25rem 0 .6rem' }}>{names(groups.decline)}</div>
              <DeclineMessagePicker templates={templates} value={message} onChange={setMessage} />
            </>
          )}
        </div>

        {(groups.declinedBefore.length > 0 || groups.withdrew.length > 0) && (
          <div style={{ ...mono('.58rem', 'var(--muted)'), lineHeight: 1.6 }}>
            Not messaged again: {[groups.declinedBefore.length ? `${groups.declinedBefore.length} already declined` : '', groups.withdrew.length ? `${groups.withdrew.length} withdrew` : ''].filter(Boolean).join(' · ')}
          </div>
        )}

        <div style={{ ...mono('.58rem', 'var(--sub)'), lineHeight: 1.6 }}>
          Then <strong style={{ color: 'var(--white)' }}>{listing.title}</strong> closes: it leaves search and shows “Position filled”. Applications stay in this inbox.
        </div>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '.55rem', cursor: 'pointer', ...box, borderColor: confirmed ? 'var(--green)' : 'var(--amber)' }}>
          <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} style={{ width: 16, height: 16, marginTop: 2, accentColor: 'var(--green)' }} />
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--white)', lineHeight: 1.5 }}>
            I’ve selected everyone I hired. {n ? `The ${n} other${n === 1 ? '' : 's'} listed above will get the message.` : ''}
          </span>
        </label>
      </div>

      {err && <div role="alert" style={{ ...mono('.6rem', 'var(--red)'), marginTop: '.7rem' }}>{err}</div>}
      <div style={{ display: 'flex', gap: '.5rem', marginTop: '1rem' }}>
        <button type="button" onClick={() => setStep(1)} disabled={busy} style={{ ...btn, background: 'none', border: '1px solid var(--line2)', color: 'var(--sub)' }}>← Back</button>
        <button type="button" onClick={send} disabled={!confirmed || busy || (n > 0 && !message.trim())}
          style={{ ...btn, flex: 1, border: 'none', background: confirmed ? 'var(--green)' : 'var(--raised)', color: confirmed ? 'var(--ink)' : 'var(--muted)', cursor: confirmed && !busy ? 'pointer' : 'not-allowed' }}>
          {busy ? 'Sending…' : n ? `Send ${n} decline${n === 1 ? '' : 's'} & close listing` : 'Close listing'}
        </button>
      </div>
    </div>
  )
}
