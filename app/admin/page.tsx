'use client'

import { useState, useEffect, useCallback } from 'react'
import type { AdminStats } from '@/components/admin/types'
import { AdminLogin } from '@/components/admin/AdminLogin'
import { AdminShell } from '@/components/admin/AdminShell'

const TOKEN_KEY = 'admin_token'

// Session controller: owns the admin token + stats fetch, then hands off to
// <AdminLogin> (unauthenticated) or <AdminShell> (the dashboard body).
export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [loginError, setLoginError] = useState('')

  useEffect(() => {
    const stored = sessionStorage.getItem(TOKEN_KEY)
    if (stored) {
      setToken(stored)
    } else {
      setLoading(false)
    }
  }, [])

  const load = useCallback(async (t: string) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin-stats', {
        headers: { 'X-Admin-Token': t },
      })
      if (res.status === 401 || res.status === 403) {
        const msg = res.status === 403 ? 'Access denied' : 'Session expired'
        sessionStorage.removeItem(TOKEN_KEY)
        setToken(null)
        setLoading(false)
        setLoginError(msg)
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as AdminStats
      setStats(data)
    } catch (e) {
      setError((e as Error).message)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (token) load(token)
  }, [token, load])

  function onAuthed(newToken: string) {
    sessionStorage.setItem(TOKEN_KEY, newToken)
    setToken(newToken)
  }

  async function logout() {
    const t = token
    sessionStorage.removeItem(TOKEN_KEY)
    setToken(null)
    setStats(null)
    if (t) {
      try {
        await fetch('/api/admin-stats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Admin-Token': t },
          body: JSON.stringify({ action: 'admin_logout' }),
        })
      } catch { /* ignore */ }
    }
  }

  function onUnauthorized() {
    sessionStorage.removeItem(TOKEN_KEY)
    setToken(null)
    setStats(null)
    setLoginError('Session expired')
  }

  if (!token) return <AdminLogin onAuthed={onAuthed} initialError={loginError} />

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: '.72rem', color: 'var(--muted)' }}>
      Loading data flywheel...
    </div>
  )

  if (error) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.72rem', color: 'var(--red)', marginBottom: '1rem' }}>{error}</div>
        <button onClick={() => token && load(token)} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 6, padding: '.45rem .9rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--sub)', cursor: 'pointer' }}>Retry</button>
      </div>
    </div>
  )

  if (!stats) return null

  return (
    <AdminShell
      stats={stats}
      token={token}
      reload={() => load(token)}
      onLogout={logout}
      onUnauthorized={onUnauthorized}
    />
  )
}
