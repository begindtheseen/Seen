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

export type SyncResult = {
  ok: boolean
  /** HTTP status; 0 = no token or network failure (nothing reached the server). */
  status: number
  body: unknown
}

// Pure reads. Two components asking the same question at the same moment (the dashboard and the
// notifications bell both `load` at mount; Nav and a page both `get_credits`) share ONE request —
// each /api/user-sync call costs a function invocation, a rate-limit RPC and the reads behind it,
// and the 2026-10-24 audit measured 8–15 s per call on a cold path. In-flight only: nothing is
// cached once answered, so a read after a write always reaches the server. WRITES ARE NEVER
// SHARED: two update_application calls are two sends (AppStore's per-application queue orders them).
const READ_ACTIONS = new Set(['load', 'load_profile', 'get_credits', 'inbox_status', 'get_recent_cos', 'get_employment', 'credit_history'])
const inflight = new Map<string, Promise<SyncResult>>()

/**
 * The call with the status kept: the tracker's writes need to tell "refused as stale (409)", "row gone
 * (410)" and "not this account's / already removed (404)" from "failed/offline" — _sync folds all of
 * those into null.
 */
export async function _syncRaw(action: string, payload: Record<string, unknown> = {}): Promise<SyncResult> {
  if (!READ_ACTIONS.has(action)) return request(action, payload)
  const key = JSON.stringify({ action, ...payload })
  const pending = inflight.get(key)
  if (pending) return pending
  const p = request(action, payload).finally(() => { if (inflight.get(key) === p) inflight.delete(key) })
  inflight.set(key, p)
  return p
}

async function request(action: string, payload: Record<string, unknown>): Promise<SyncResult> {
  const token = await getToken()
  if (!token) {
    console.error('[sync] no token for action:', action)
    return { ok: false, status: 0, body: null }
  }
  try {
    const r = await fetch('/api/user-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, ...payload }),
    })
    const text = await r.text().catch(() => '')
    let body: unknown = null
    try { body = text ? JSON.parse(text) : null } catch { body = null }
    // A 404 ("not yours / already gone") or 409/410 (compare-and-set: stale / gone) is an answer, not a
    // failure: the caller decides (AppStore drops or replaces the local copy). No error log, and never
    // the session-expired path.
    if (!r.ok) {
      if (r.status !== 404 && r.status !== 409 && r.status !== 410) console.error(`[sync] ${action} → ${r.status}:`, text.slice(0, 300))
      // We HAD a token and the server refused it: the session was revoked (a global sign-out on
      // another device) or its refresh token died. Without this the page just rendered empty
      // stores with the nav flipped to "Sign in" and no explanation. Fires once, never loops.
      if (r.status === 401) void handleSessionExpired()
    }
    return { ok: r.ok, status: r.status, body }
  } catch (e) {
    console.error(`[sync] ${action} network error:`, (e as Error).message)
    return { ok: false, status: 0, body: null }
  }
}

export async function _sync(action: string, payload: Record<string, unknown> = {}): Promise<unknown> {
  const r = await _syncRaw(action, payload)
  return r.ok ? r.body : null
}
