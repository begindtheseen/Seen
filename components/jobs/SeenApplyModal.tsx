'use client'

// Apply on Seen — the application form for listings whose employer takes applications here
// (apply_mode 'seen' | 'both', lib/server/seenApply.js). Sign-in required. Prefills name + email
// from the account and offers the résumé saved on Seen, or a file upload (PDF / Word / text,
// ≤ 3 MB). POSTs /api/apply { action:'seen_apply' } with the Bearer token; on success the
// application is also in the applicant's tracker (synced from the DB).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import ModalPortal from '@/components/ModalPortal'
import { useAuth } from '@/lib/auth'
import { AppStore } from '@/lib/stores/AppStore'

const MAX_BYTES = 3 * 1024 * 1024

type Status = {
  available?: boolean
  accepts_seen?: boolean
  company?: string | null
  already_applied?: { at: string } | null
  prefill?: { name: string; email: string; has_saved_resume: boolean; saved_resume_file_name: string | null }
}

export default function SeenApplyModal({ job, onClose, onApplied }: {
  job: { id: string; title: string; company: string; location?: string }
  onClose: () => void
  onApplied?: () => void
}) {
  const { ready, isLoggedIn, token } = useAuth()
  const [status, setStatus] = useState<Status | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [source, setSource] = useState<'saved' | 'upload'>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!ready || !isLoggedIn) return
    let cancelled = false
    ;(async () => {
      try {
        const t = await token()
        const r = await fetch('/api/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
          body: JSON.stringify({ action: 'seen_apply_status', job_id: job.id }),
        })
        const d = await r.json().catch(() => ({})) as Status & { error?: string }
        if (cancelled) return
        if (!r.ok) { setLoadErr(d.error || 'Could not load the application form'); return }
        setStatus(d)
        if (d.prefill) {
          setName(d.prefill.name || '')
          setEmail(d.prefill.email || '')
          if (d.prefill.has_saved_resume) setSource('saved')
        }
      } catch { if (!cancelled) setLoadErr('Could not load the application form') }
    })()
    return () => { cancelled = true }
  }, [ready, isLoggedIn, token, job.id])

  async function submit() {
    setErr('')
    if (!consent) { setErr(`Confirm you agree to share your application with ${job.company}`); return }
    if (source === 'upload' && !file) { setErr('Attach your résumé'); return }
    if (file && file.size > MAX_BYTES) { setErr('That file is over 3 MB — try a smaller PDF'); return }
    setBusy(true)
    try {
      let file_base64: string | undefined
      if (source === 'upload' && file) {
        file_base64 = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader()
          fr.onload = () => resolve(String(fr.result || '').replace(/^data:[^,]*,/, ''))
          fr.onerror = () => reject(new Error('read'))
          fr.readAsDataURL(file)
        })
      }
      const t = await token()
      const r = await fetch('/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
        body: JSON.stringify({
          action: 'seen_apply', job_id: job.id, name, email, phone, note,
          resume_source: source, file_base64, file_name: file?.name, mime_type: file?.type, consent,
        }),
      })
      const d = await r.json().catch(() => ({})) as { ok?: boolean; error?: string; reason?: string }
      if (!r.ok || !d.ok) {
        if (d.reason === 'already_applied') { setStatus(s => ({ ...(s || {}), already_applied: { at: new Date().toISOString() } })); return }
        setErr(d.error || 'Could not send your application — please try again')
        return
      }
      setDone(true)
      AppStore.syncFromDb(true).catch(() => {}) // the server added it to your tracker
      onApplied?.()
    } catch {
      setErr('Could not send your application — please try again')
    } finally {
      setBusy(false)
    }
  }

  const label: React.CSSProperties = { display: 'block', fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)', margin: '.75rem 0 .3rem' }
  const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 8, padding: '.6rem .75rem', color: 'var(--white)', fontFamily: 'var(--body)', fontSize: 'var(--fs-ui)', outline: 'none' }
  const primary: React.CSSProperties = { width: '100%', background: 'var(--green)', color: 'var(--ink)', border: 'none', borderRadius: 9, padding: '.75rem 1rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: 'var(--fs-ui)', cursor: busy ? 'wait' : 'pointer', opacity: busy ? .7 : 1, marginTop: '1rem' }

  let content: React.ReactNode
  if (!ready) {
    content = <p style={{ color: 'var(--muted)', fontSize: 'var(--fs-sm)' }}>Loading…</p>
  } else if (!isLoggedIn) {
    const next = typeof window !== 'undefined' ? encodeURIComponent(window.location.pathname + window.location.search) : ''
    content = (
      <>
        <p style={{ color: 'var(--sub)', fontSize: 'var(--fs-ui)', lineHeight: 1.6, margin: '0 0 1rem' }}>Sign in to apply on Seen. Your application goes straight to {job.company}, and it lands in your tracker so you can see if they respond.</p>
        <Link href={`/login?next=${next}`} style={{ ...primary, display: 'block', textAlign: 'center', textDecoration: 'none' }}>Sign in to apply →</Link>
      </>
    )
  } else if (loadErr) {
    content = <p style={{ color: 'var(--red)', fontSize: 'var(--fs-sm)' }}>{loadErr}</p>
  } else if (!status) {
    content = <p style={{ color: 'var(--muted)', fontSize: 'var(--fs-sm)' }}>Loading…</p>
  } else if (status.available === false || status.accepts_seen === false) {
    content = <p style={{ color: 'var(--sub)', fontSize: 'var(--fs-ui)' }}>This listing doesn’t take applications on Seen.</p>
  } else if (done) {
    content = (
      <>
        <div style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: 'var(--fs-lead)', color: 'var(--green)', marginBottom: '.4rem' }}>✓ Application sent</div>
        <p style={{ color: 'var(--sub)', fontSize: 'var(--fs-ui)', lineHeight: 1.6, margin: '0 0 1rem' }}>{job.company} has your application. It’s in your tracker — we’ll check in if you don’t hear back.</p>
        <Link href="/tracker" style={{ ...primary, display: 'block', textAlign: 'center', textDecoration: 'none' }}>Open my tracker →</Link>
      </>
    )
  } else if (status.already_applied) {
    content = (
      <>
        <p style={{ color: 'var(--sub)', fontSize: 'var(--fs-ui)', lineHeight: 1.6, margin: '0 0 1rem' }}>You already applied to this listing on Seen.</p>
        <Link href="/tracker" style={{ ...primary, display: 'block', textAlign: 'center', textDecoration: 'none' }}>See it in my tracker →</Link>
      </>
    )
  } else {
    const hasSaved = !!status.prefill?.has_saved_resume
    content = (
      <>
        <label style={label} htmlFor="sa-name">Full name</label>
        <input id="sa-name" style={input} value={name} onChange={e => setName(e.target.value)} autoComplete="off" />
        <label style={label} htmlFor="sa-email">Email</label>
        <input id="sa-email" style={input} type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="off" />
        <label style={label} htmlFor="sa-phone">Phone (optional)</label>
        <input id="sa-phone" style={input} type="tel" value={phone} onChange={e => setPhone(e.target.value)} autoComplete="off" />

        <span style={label}>Résumé</span>
        {hasSaved && (
          <label style={{ display: 'flex', gap: '.5rem', alignItems: 'center', fontSize: 'var(--fs-sm)', color: 'var(--sub)', marginBottom: '.35rem', cursor: 'pointer' }}>
            <input type="radio" name="sa-src" checked={source === 'saved'} onChange={() => setSource('saved')} />
            Use my résumé on Seen{status.prefill?.saved_resume_file_name ? ` (${status.prefill.saved_resume_file_name})` : ''}
          </label>
        )}
        <label style={{ display: 'flex', gap: '.5rem', alignItems: 'center', fontSize: 'var(--fs-sm)', color: 'var(--sub)', cursor: 'pointer' }}>
          {hasSaved && <input type="radio" name="sa-src" checked={source === 'upload'} onChange={() => setSource('upload')} />}
          {hasSaved ? 'Upload a different file' : 'Upload your résumé'}
        </label>
        {source === 'upload' && (
          <input
            type="file"
            accept=".pdf,.doc,.docx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            onChange={e => setFile(e.target.files?.[0] || null)}
            style={{ marginTop: '.45rem', fontSize: 'var(--fs-meta)', color: 'var(--sub)' }}
          />
        )}
        <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--muted)', marginTop: '.3rem' }}>PDF, Word or text · up to 3 MB</div>

        <label style={label} htmlFor="sa-note">Note to {job.company} (optional)</label>
        <textarea autoComplete="off" id="sa-note" style={{ ...input, minHeight: 80, resize: 'vertical' }} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} />

        <label style={{ display: 'flex', gap: '.55rem', alignItems: 'flex-start', fontSize: 'var(--fs-meta)', color: 'var(--sub)', lineHeight: 1.5, marginTop: '.85rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} style={{ marginTop: '.2rem' }} />
          <span>Your name, email, résumé and note will be shared with {job.company}.</span>
        </label>

        {err && <div role="alert" style={{ color: 'var(--red)', fontSize: 'var(--fs-meta)', marginTop: '.6rem' }}>{err}</div>}
        <button type="button" onClick={submit} disabled={busy} style={primary}>{busy ? 'Sending…' : `Send application to ${job.company}`}</button>
      </>
    )
  }

  return (
    <ModalPortal>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(2,4,10,.90)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 1rem', overflowY: 'auto' }}>
        <div role="dialog" aria-modal="true" aria-label={`Apply to ${job.title} at ${job.company}`} onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 16, padding: '1.25rem 1.25rem 1.4rem', boxShadow: '0 30px 90px rgba(0,0,0,.6)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.75rem', marginBottom: '.4rem' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--green)' }}>Apply on Seen</div>
              <div style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: 'var(--fs-lead)', color: 'var(--white)', marginTop: '.2rem' }}>{job.title}</div>
              <div style={{ fontSize: 'var(--fs-meta)', color: 'var(--sub)' }}>{job.company}{job.location ? ` · ${job.location}` : ''}</div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 8, width: 32, height: 32, color: 'var(--muted)', cursor: 'pointer', flexShrink: 0 }}>✕</button>
          </div>
          {content}
        </div>
      </div>
    </ModalPortal>
  )
}
