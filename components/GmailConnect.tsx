'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { captureToApplication } from '@/lib/gmailCaptureMap'
import { AppStore } from '@/lib/stores/AppStore'

// Gmail auto-capture panel (stage 2). Connect Gmail → sync → review suggested captures → confirm into
// the tracker (reuses user-sync add_application) or dismiss. Renders nothing until the owner has
// configured Google OAuth creds (status.configured), so it stays invisible until the feature is live.

type Status = { configured: boolean; connected: boolean; email: string | null; last_sync_at: string | null; suggested: number }
type Capture = { id: number; message_id: string; company: string; event: string; outcome: string; confidence: string; sender_domain: string; received_at: string }

const EVENT_LABEL: Record<string, string> = {
  application_submitted: 'Applied', response_received: 'Response', assessment_received: 'Assessment',
  interview_received: 'Interview', offer_received: 'Offer', rejected: 'Rejected',
}

export function GmailConnect() {
  const { token, isLoggedIn } = useAuth()
  const [status, setStatus] = useState<Status | null>(null)
  const [captures, setCaptures] = useState<Capture[]>([])
  const [busy, setBusy] = useState<string>('')
  const [note, setNote] = useState<string>('')

  const authFetch = useCallback(async (url: string, opts: RequestInit = {}) => {
    const t = await token()
    if (!t) return null
    return fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}`, ...(opts.headers || {}) } })
  }, [token])

  const loadStatus = useCallback(async () => {
    const r = await authFetch('/api/gmail?action=status')
    if (r && r.ok) setStatus(await r.json())
  }, [authFetch])

  const loadCaptures = useCallback(async () => {
    const r = await authFetch('/api/gmail?action=captures')
    if (r && r.ok) setCaptures((await r.json()).captures || [])
  }, [authFetch])

  useEffect(() => { loadStatus() }, [loadStatus])
  useEffect(() => { if (status?.connected) loadCaptures() }, [status?.connected, loadCaptures])

  // Surface the OAuth round-trip result (?gmail=connected|error) and clear it from the URL.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const g = p.get('gmail')
    if (!g) return
    setNote(g === 'connected' ? 'Gmail connected — syncing your inbox…' : g === 'error' ? 'Could not connect Gmail. Try again.' : '')
    p.delete('gmail')
    window.history.replaceState({}, '', `${window.location.pathname}${p.toString() ? `?${p}` : ''}`)
    if (g === 'connected') { loadStatus(); setTimeout(() => sync(), 600) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function connect() {
    setBusy('connect')
    const r = await authFetch('/api/gmail?action=connect', { method: 'POST', body: JSON.stringify({ action: 'connect' }) })
    const d = r && await r.json().catch(() => null)
    if (d?.url) window.location.href = d.url
    else { setNote('Gmail connect is not available yet.'); setBusy('') }
  }

  async function sync() {
    setBusy('sync'); setNote('')
    const r = await authFetch('/api/gmail?action=sync', { method: 'POST', body: JSON.stringify({ action: 'sync' }) })
    if (r && r.ok) { await loadStatus(); await loadCaptures(); setNote('Inbox synced.') }
    else setNote('Sync failed — try reconnecting Gmail.')
    setBusy('')
  }

  async function confirm(cap: Capture) {
    setBusy(`c${cap.id}`)
    const application = captureToApplication(cap)
    if (application) {
      // AppStore.add persists locally AND syncs via add_application → the tracker updates instantly.
      await AppStore.add(application, isLoggedIn)
      await authFetch('/api/gmail?action=confirm', { method: 'POST', body: JSON.stringify({ action: 'confirm', id: cap.id }) })
      setCaptures(cs => cs.filter(c => c.id !== cap.id))
      window.dispatchEvent(new Event('seen:applications-updated'))
    }
    setBusy('')
  }

  async function dismiss(cap: Capture) {
    setBusy(`d${cap.id}`)
    await authFetch('/api/gmail?action=dismiss', { method: 'POST', body: JSON.stringify({ action: 'dismiss', id: cap.id }) })
    setCaptures(cs => cs.filter(c => c.id !== cap.id))
    setBusy('')
  }

  // Invisible until the owner has provisioned Google OAuth creds.
  if (!status || !status.configured) return null

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '1.1rem 1.25rem', marginBottom: '1.4rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.7rem', flexWrap: 'wrap' }}>
        <span aria-hidden style={{ fontSize: '1.1rem' }}>📥</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--display)', fontSize: '.92rem', fontWeight: 700, color: 'var(--white)' }}>Auto-capture from Gmail</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)', marginTop: '.15rem' }}>
            {status.connected ? `Connected${status.email ? ` · ${status.email}` : ''} — we read only recruiter email headers, never message bodies.` : 'Connect Gmail to auto-detect applications, interviews, and rejections. Headers only — never your message bodies.'}
          </div>
        </div>
        {status.connected ? (
          <button onClick={sync} disabled={!!busy} style={btnGhost}>{busy === 'sync' ? 'Syncing…' : 'Sync now'}</button>
        ) : (
          <button onClick={connect} disabled={!!busy} style={btnPrimary}>{busy === 'connect' ? 'Opening…' : 'Connect Gmail'}</button>
        )}
      </div>

      {note && <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--sub)', marginTop: '.7rem' }}>{note}</div>}

      {status.connected && captures.length > 0 && (
        <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--dim)' }}>
            {captures.length} suggestion{captures.length === 1 ? '' : 's'} — confirm to add to your tracker
          </div>
          {captures.map(cap => (
            <div key={cap.id} style={{ display: 'flex', alignItems: 'center', gap: '.7rem', padding: '.6rem .75rem', background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 9 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontFamily: 'var(--display)', fontSize: '.82rem', fontWeight: 600, color: 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cap.company}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)', marginTop: '.1rem' }}>
                  {EVENT_LABEL[cap.event] || cap.event} · {cap.sender_domain}{cap.confidence === 'high' ? ' · high confidence' : ''}
                </div>
              </div>
              <button onClick={() => confirm(cap)} disabled={!!busy} style={btnConfirm}>{busy === `c${cap.id}` ? '…' : 'Add'}</button>
              <button onClick={() => dismiss(cap)} disabled={!!busy} style={btnDismiss} aria-label="Dismiss">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const btnPrimary: React.CSSProperties = { flexShrink: 0, background: 'linear-gradient(135deg,#1d4ed8,#7c3aed)', border: 'none', borderRadius: 8, padding: '.5rem 1.1rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.74rem', color: '#fff', cursor: 'pointer' }
const btnGhost: React.CSSProperties = { flexShrink: 0, background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 8, padding: '.5rem 1rem', fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--sub)', cursor: 'pointer' }
const btnConfirm: React.CSSProperties = { flexShrink: 0, background: 'var(--green)', border: 'none', borderRadius: 7, padding: '.4rem .9rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.68rem', color: '#04120a', cursor: 'pointer' }
const btnDismiss: React.CSSProperties = { flexShrink: 0, background: 'none', border: '1px solid var(--line2)', borderRadius: 7, padding: '.4rem .6rem', fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)', cursor: 'pointer' }
