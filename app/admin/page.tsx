'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { AdminStats } from '@/components/admin/types'
import { AdminLogin } from '@/components/admin/AdminLogin'
import { AdminShell } from '@/components/admin/AdminShell'
import { safeSessionGet, safeSessionSet, safeSessionRemove } from '@/lib/safeStorage'

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
    const stored = safeSessionGet(TOKEN_KEY)
    if (stored) {
      setToken(stored)
    } else {
      setLoading(false)
    }
  }, [])

  // background=true (a reload after an admin action): keep the dashboard mounted while the fresh
  // numbers load. Swapping it for the full-page spinner unmounted AdminShell, which erased the
  // action's result message ("cleared N stale") and made the click look like it did nothing.
  // Every admin action refreshes in the background, so refreshes can overlap (an action, the live
  // feed, the Refresh button). Only the NEWEST request may update the dashboard — an older, slower
  // response landing last would otherwise flip the numbers back.
  const loadSeq = useRef(0)
  const load = useCallback(async (t: string, background = false) => {
    const seq = ++loadSeq.current
    if (!background) { setLoading(true); setError('') }
    try {
      const res = await fetch('/api/admin-stats', {
        headers: { 'X-Admin-Token': t },
        cache: 'no-store',
      })
      if (res.status === 401 || res.status === 403) {
        const msg = res.status === 403 ? 'Access denied' : 'Session expired'
        safeSessionRemove(TOKEN_KEY)
        setToken(null)
        setLoading(false)
        setLoginError(msg)
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as AdminStats
      if (seq !== loadSeq.current) return // a newer refresh superseded this one
      setStats(data)
    } catch (e) {
      // A failed background reload keeps the current dashboard rather than replacing it with an error.
      if (!background) setError((e as Error).message)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (token) load(token)
  }, [token, load])

  function onAuthed(newToken: string) {
    safeSessionSet(TOKEN_KEY, newToken)
    setToken(newToken)
  }

  async function logout() {
    const t = token
    safeSessionRemove(TOKEN_KEY)
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
    safeSessionRemove(TOKEN_KEY)
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
      reload={() => load(token, true)}
      onLogout={logout}
      onUnauthorized={onUnauthorized}
    />
  )
}
