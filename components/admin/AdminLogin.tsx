'use client'

import { useState } from 'react'

// Admin sign-in form. Owns its own username/password/error state and posts the
// admin_login action; on success it hands the session token back to the parent,
// which persists it (sessionStorage) and loads the dashboard.
export function AdminLogin({ onAuthed, initialError = '' }: { onAuthed: (token: string) => void; initialError?: string }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState(initialError)
  const [loggingIn, setLoggingIn] = useState(false)

  async function login(e: React.FormEvent) {
    e.preventDefault()
    setLoggingIn(true)
    setLoginError('')
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'admin_login', username, password }),
      })
      const json = await res.json()
      if (!res.ok) { setLoginError(json.error || 'Login failed'); setLoggingIn(false); return }
      onAuthed(json.token)
    } catch {
      setLoginError('Network error')
    }
    setLoggingIn(false)
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <form onSubmit={login} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '2rem', width: 320 }}
        onKeyDown={e => e.key === 'Enter' && !loggingIn && login(e as unknown as React.FormEvent)}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.22em', color: 'var(--green)', marginBottom: '.5rem' }}>Admin</div>
        <div style={{ fontFamily: 'var(--display)', fontSize: '1.4rem', fontWeight: 800, color: 'var(--white)', marginBottom: '1.5rem' }}>Sign in</div>
        <input
          type="text" placeholder="Username" autoComplete="username" required value={username}
          onChange={e => setUsername(e.target.value)}
          style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 7, padding: '.6rem .85rem', color: 'var(--white)', fontFamily: 'var(--mono)', fontSize: '.72rem', outline: 'none', marginBottom: '.65rem', boxSizing: 'border-box' }}
        />
        <input
          type="password" placeholder="Password" autoComplete="current-password" required value={password}
          onChange={e => setPassword(e.target.value)}
          style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 7, padding: '.6rem .85rem', color: 'var(--white)', fontFamily: 'var(--mono)', fontSize: '.72rem', outline: 'none', marginBottom: '1rem', boxSizing: 'border-box' }}
        />
        {loginError && <div style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--red)', marginBottom: '.75rem' }}>{loginError}</div>}
        <button type="submit" disabled={loggingIn} style={{ width: '100%', background: 'var(--blue)', border: 'none', borderRadius: 7, padding: '.65rem', color: '#fff', fontFamily: 'var(--mono)', fontSize: '.72rem', fontWeight: 600, cursor: 'pointer' }}>
          {loggingIn ? 'Signing in…' : 'Sign in →'}
        </button>
      </form>
    </div>
  )
}
