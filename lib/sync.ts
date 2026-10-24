'use client'

import { supabase } from './supabase'
import { handleSessionExpired } from './sessionExpired'

async function getToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession()
    return data?.session?.access_token || null
  } catch {
    return null
  }
}

/** The handler's answer when the id is not the caller's (or is already gone): a 404 with this body. */
export type NotFoundResult = { ok: false; reason: 'not_found' }
export function isNotFound(r: unknown): r is NotFoundResult {
  return !!r && typeof r === 'object' && (r as { reason?: string }).reason === 'not_found'
}

// Pure reads. Two components asking the same question at the same moment (the dashboard and the
// notifications bell both `load` at mount; Nav and a page both `get_credits`) share ONE request —
// each /api/user-sync call costs a function invocation, a rate-limit RPC and the reads behind it,
// and the 2026-10-24 audit measured 8–15 s per call on a cold path. In-flight only: nothing is
// cached once answered, so a read after a write always reaches the server.
const READ_ACTIONS = new Set(['load', 'load_profile', 'get_credits', 'inbox_status', 'get_recent_cos', 'get_employment', 'credit_history'])
const inflight = new Map<string, Promise<unknown>>()

export async function _sync(action: string, payload: Record<string, unknown> = {}): Promise<unknown> {
  if (!READ_ACTIONS.has(action)) return request(action, payload)
  const key = JSON.stringify({ action, ...payload })
  const pending = inflight.get(key)
  if (pending) return pending
  const p = request(action, payload).finally(() => { if (inflight.get(key) === p) inflight.delete(key) })
  inflight.set(key, p)
  return p
}

async function request(action: string, payload: Record<string, unknown>): Promise<unknown> {
  const token = await getToken()
  if (!token) {
    console.error('[sync] no token for action:', action)
    return null
  }
  try {
    const r = await fetch('/api/user-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, ...payload }),
    })
    if (r.status === 404) {
      // "Not yours / already gone" is an answer, not a failure: the caller decides (AppStore drops the
      // local copy and refreshes). Never a toast, never the session-expired path.
      const body = await r.json().catch(() => null) as Record<string, unknown> | null
      return { ok: false, reason: 'not_found', ...(body || {}) } as NotFoundResult
    }
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      console.error(`[sync] ${action} → ${r.status}:`, body)
      // We HAD a token and the server refused it: the session was revoked (a global sign-out on
      // another device) or its refresh token died. Without this the page just rendered empty
      // stores with the nav flipped to "Sign in" and no explanation. Fires once, never loops.
      if (r.status === 401) void handleSessionExpired()
      return null
    }
    return await r.json()
  } catch (e) {
    console.error(`[sync] ${action} network error:`, (e as Error).message)
    return null
  }
}
