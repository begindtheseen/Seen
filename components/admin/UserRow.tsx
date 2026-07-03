'use client'

import { useState } from 'react'

// One user row in the KPI drill-down, with a two-step delete (full admins only).
export function UserRow({ r, token, onDeleted, ts }: { r: Record<string, unknown>; token: string; onDeleted: (id: string) => void; ts: (i: unknown) => string }) {
  const [busy, setBusy] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [typed, setTyped] = useState('')
  const id = String(r.id ?? '')
  const email = String(r.email ?? '—')
  const canDelete = email !== '—' && typed.trim().toLowerCase() === email.trim().toLowerCase()
  // Grant-credits state
  const [grantAmt, setGrantAmt] = useState(5)
  const [granting, setGranting] = useState(false)
  const [grantMsg, setGrantMsg] = useState('')
  // Pro (subscription access) state — mirrors ai_credits.pro; set_pro flips it (full admins only).
  const [pro, setPro] = useState(Boolean(r.pro))
  const [proBusy, setProBusy] = useState(false)
  const [proMsg, setProMsg] = useState('')
  function closeModal() { if (!busy) { setShowModal(false); setTyped('') } }
  // Emergency password reset state (full admins only).
  const [showPw, setShowPw] = useState(false)
  const [newPw, setNewPw] = useState('')
  const [pwReason, setPwReason] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwErr, setPwErr] = useState('')
  const [pwDone, setPwDone] = useState(false)
  const [pwConfirm, setPwConfirm] = useState('') // type the email to confirm the right account
  const [copied, setCopied] = useState(false)
  const pwCanSubmit = email !== '—' && pwConfirm.trim().toLowerCase() === email.trim().toLowerCase() && newPw.length >= 8
  function closePw() { if (!pwBusy) { setShowPw(false); setNewPw(''); setPwReason(''); setPwErr(''); setPwDone(false); setPwConfirm(''); setCopied(false) } }
  function genPassword() {
    // Strong, unambiguous (no 0/O/1/l/I) random password using the browser CSPRNG.
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*?'
    const a = new Uint32Array(18); crypto.getRandomValues(a)
    setNewPw(Array.from(a, n => chars[n % chars.length]).join(''))
    setCopied(false)
  }
  async function setPassword() {
    if (!id || !pwCanSubmit || pwBusy) return
    setPwBusy(true); setPwErr('')
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'set_user_password', user_id: id, new_password: newPw, reason: pwReason.trim() || undefined }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok && d.ok) setPwDone(true)
      else setPwErr(d.error || 'Failed')
    } catch { setPwErr('Network error') }
    setPwBusy(false)
  }
  async function togglePro() {
    if (!id || proBusy) return
    const next = !pro
    setProBusy(true); setProMsg('')
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'set_pro', user_id: id, pro: next }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok && d.ok) { setPro(next); setProMsg(next ? '✓ Pro' : '✓ Free') }
      else setProMsg(d.error || 'Failed')
    } catch { setProMsg('Network error') }
    setProBusy(false)
  }
  async function del() {
    if (!id || !canDelete) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'delete_user', user_id: id }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok && d.ok) { onDeleted(id); return }
      alert(d.error || 'Delete failed'); setBusy(false)
    } catch { alert('Network error'); setBusy(false) }
  }
  async function grant() {
    if (!id || granting) return
    const amt = Math.round(Number(grantAmt))
    if (!Number.isInteger(amt) || amt < 1 || amt > 500) { setGrantMsg('1–500'); return }
    setGranting(true); setGrantMsg('')
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'grant_credits', user_id: id, amount: amt }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok && d.ok) setGrantMsg(`✓ +${amt} (balance ${d.balance})`)
      else setGrantMsg(d.error || 'Failed')
    } catch { setGrantMsg('Network error') }
    setGranting(false)
  }
  return (
    <div className="ac-acct">
      <div className="ac-acct-top">
        <span className="ac-acct-email">{email}{pro && <span style={{ marginLeft: '.4rem', fontFamily: 'var(--mono)', fontSize: '.48rem', color: 'var(--green)', background: 'rgba(52,211,153,.14)', border: '1px solid rgba(52,211,153,.35)', borderRadius: 100, padding: '.05rem .35rem', verticalAlign: 'middle' }}>PRO</span>}</span>
        <span className="ac-acct-age">{ts(r.created_at)}</span>
      </div>
      <div className="ac-acct-actions">
        <button onClick={togglePro} disabled={proBusy} title={pro ? 'Revoke Pro subscription access for this account' : 'Grant Pro subscription access to this account'} style={{ background: 'none', border: `1px solid ${pro ? 'rgba(245,158,11,.4)' : 'rgba(52,211,153,.4)'}`, borderRadius: 5, color: pro ? 'var(--amber)' : 'var(--green)', fontFamily: 'var(--mono)', fontSize: '.55rem', padding: '.28rem .5rem', cursor: proBusy ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>{proBusy ? '…' : pro ? '★ Revoke Pro' : '☆ Grant Pro'}</button>
        {proMsg && <span style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: proMsg.startsWith('✓') ? 'var(--green)' : 'var(--red)', whiteSpace: 'nowrap' }}>{proMsg}</span>}
        {grantMsg && grantMsg.startsWith('✓') ? (
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--green)', whiteSpace: 'nowrap' }}>{grantMsg}</span>
        ) : (
          <>
            <input type="number" min={1} max={500} value={grantAmt} onChange={e => setGrantAmt(Number(e.target.value))} disabled={granting} style={{ width: 46, background: 'var(--void)', border: '1px solid var(--line2)', borderRadius: 5, color: 'var(--white)', fontFamily: 'var(--mono)', fontSize: '.55rem', padding: '.25rem .3rem', textAlign: 'center' }} />
            <button onClick={grant} disabled={granting} title="Grant AI credits to this account" style={{ background: 'none', border: '1px solid rgba(52,211,153,.4)', borderRadius: 5, color: 'var(--green)', fontFamily: 'var(--mono)', fontSize: '.55rem', padding: '.28rem .5rem', cursor: granting ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>{granting ? '…' : '＋ Credits'}</button>
            {grantMsg && <span style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--red)', whiteSpace: 'nowrap' }}>{grantMsg}</span>}
          </>
        )}
        <button onClick={() => setShowPw(true)} title="Emergency: set a new password for this account" style={{ marginLeft: 'auto', background: 'none', border: '1px solid rgba(59,130,246,.4)', borderRadius: 5, color: 'var(--blue)', fontFamily: 'var(--mono)', fontSize: '.55rem', padding: '.28rem .55rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>🔑 Reset PW</button>
        <button onClick={() => setShowModal(true)} title="Permanently delete this user and all their data" style={{ background: 'none', border: '1px solid rgba(239,68,68,.35)', borderRadius: 5, color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: '.55rem', padding: '.28rem .55rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>🗑 Delete</button>
      </div>
      {showPw && (
        <div onClick={closePw} onKeyDown={e => { if (e.key === 'Escape') closePw() }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 10, boxShadow: '0 24px 64px rgba(0,0,0,.7)', padding: '1.1rem 1.2rem', maxWidth: 420, width: '100%', boxSizing: 'border-box' }}>
            {!pwDone ? (
              <>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.72rem', color: 'var(--blue)', fontWeight: 700, marginBottom: '.5rem' }}>Emergency password reset</div>
                <p style={{ fontSize: '.68rem', color: 'var(--sub)', lineHeight: 1.5, margin: '0 0 .7rem' }}>
                  Sets a new password for <span style={{ color: 'var(--white)' }}>{email}</span>. The account holder can then sign in with it. It is <strong>not stored</strong> — you must relay it to them securely. This action is audit-logged.
                </p>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)', marginBottom: '.2rem' }}>New password (min 8 chars)</div>
                <div style={{ display: 'flex', gap: '.4rem', marginBottom: '.6rem' }}>
                  <input autoFocus value={newPw} onChange={e => { setNewPw(e.target.value); setCopied(false) }} disabled={pwBusy} placeholder="type or generate" style={{ flex: 1, minWidth: 0, background: 'var(--bg)', border: '1px solid var(--line2)', borderRadius: 6, color: 'var(--white)', fontFamily: 'var(--mono)', fontSize: '.65rem', padding: '.4rem .5rem', boxSizing: 'border-box' }} />
                  <button onClick={genPassword} disabled={pwBusy} style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 6, color: 'var(--sub)', fontFamily: 'var(--mono)', fontSize: '.58rem', padding: '.35rem .6rem', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>Generate</button>
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)', marginBottom: '.2rem' }}>Reason (optional, for the audit log)</div>
                <input value={pwReason} onChange={e => setPwReason(e.target.value)} disabled={pwBusy} placeholder="e.g. user locked out, no email access" style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--line2)', borderRadius: 6, color: 'var(--white)', fontFamily: 'var(--mono)', fontSize: '.62rem', padding: '.4rem .5rem', marginBottom: '.7rem', boxSizing: 'border-box' }} />
                <p style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)', margin: '0 0 .3rem' }}>Type <span style={{ color: 'var(--white)' }}>{email}</span> to confirm:</p>
                <input value={pwConfirm} onChange={e => setPwConfirm(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') closePw() }} disabled={pwBusy} placeholder={email} style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--line2)', borderRadius: 6, color: 'var(--white)', fontFamily: 'var(--mono)', fontSize: '.65rem', padding: '.4rem .5rem', marginBottom: '.4rem', boxSizing: 'border-box' }} />
                {pwErr && <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--red)', marginBottom: '.5rem' }}>{pwErr}</div>}
                <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end', marginTop: '.5rem' }}>
                  <button onClick={closePw} disabled={pwBusy} style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 6, color: 'var(--dim)', fontFamily: 'var(--mono)', fontSize: '.62rem', padding: '.35rem .7rem', cursor: 'pointer' }}>Cancel</button>
                  <button onClick={setPassword} disabled={pwBusy || !pwCanSubmit} style={{ background: pwCanSubmit ? 'var(--blue)' : 'var(--line2)', border: 'none', borderRadius: 6, color: '#fff', fontFamily: 'var(--mono)', fontSize: '.62rem', padding: '.35rem .8rem', cursor: pwBusy ? 'wait' : pwCanSubmit ? 'pointer' : 'not-allowed', opacity: pwCanSubmit ? 1 : .6 }}>{pwBusy ? '…' : 'Set password'}</button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.72rem', color: 'var(--green)', fontWeight: 700, marginBottom: '.5rem' }}>✓ Password set for {email}</div>
                <p style={{ fontSize: '.68rem', color: 'var(--sub)', lineHeight: 1.5, margin: '0 0 .6rem' }}>Relay this to the account holder securely. It won&apos;t be shown again.</p>
                <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', marginBottom: '.8rem' }}>
                  <code style={{ flex: 1, minWidth: 0, background: 'var(--void)', border: '1px solid var(--line2)', borderRadius: 6, color: 'var(--white)', fontFamily: 'var(--mono)', fontSize: '.7rem', padding: '.45rem .55rem', overflowWrap: 'anywhere' }}>{newPw}</code>
                  <button onClick={() => { navigator.clipboard?.writeText(newPw).then(() => setCopied(true)).catch(() => {}) }} style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 6, color: copied ? 'var(--green)' : 'var(--sub)', fontFamily: 'var(--mono)', fontSize: '.58rem', padding: '.4rem .6rem', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>{copied ? '✓ Copied' : 'Copy'}</button>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button onClick={closePw} style={{ background: 'var(--blue)', border: 'none', borderRadius: 6, color: '#fff', fontFamily: 'var(--mono)', fontSize: '.62rem', padding: '.35rem .9rem', cursor: 'pointer' }}>Done</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {showModal && (
        <div onClick={closeModal} onKeyDown={e => { if (e.key === 'Escape') closeModal() }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 10, boxShadow: '0 24px 64px rgba(0,0,0,.7)', padding: '1.1rem 1.2rem', maxWidth: 380, width: '100%' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.72rem', color: 'var(--red)', fontWeight: 700, marginBottom: '.5rem' }}>Delete account</div>
            <p style={{ fontSize: '.68rem', color: 'var(--sub)', lineHeight: 1.5, margin: '0 0 .8rem' }}>
              This permanently deletes the account, applications, saved jobs, and credits. Reports and survey intel they contributed are kept and anonymized.
            </p>
            <p style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)', margin: '0 0 .3rem' }}>Type <span style={{ color: 'var(--white)' }}>{email}</span> to confirm:</p>
            <input autoFocus value={typed} onChange={e => setTyped(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') closeModal() }} disabled={busy} placeholder={email} style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--line2)', borderRadius: 6, color: 'var(--white)', fontFamily: 'var(--mono)', fontSize: '.65rem', padding: '.4rem .5rem', marginBottom: '.9rem', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
              <button onClick={closeModal} disabled={busy} style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 6, color: 'var(--dim)', fontFamily: 'var(--mono)', fontSize: '.62rem', padding: '.35rem .7rem', cursor: 'pointer' }}>Cancel</button>
              <button onClick={del} disabled={busy || !canDelete} style={{ background: canDelete ? 'var(--red)' : 'var(--line2)', border: 'none', borderRadius: 6, color: '#fff', fontFamily: 'var(--mono)', fontSize: '.62rem', padding: '.35rem .8rem', cursor: busy ? 'wait' : canDelete ? 'pointer' : 'not-allowed', opacity: canDelete ? 1 : .6 }}>{busy ? '…' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
