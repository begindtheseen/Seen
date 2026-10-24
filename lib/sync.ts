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

/**
 * The same call with the status kept: the tracker's writes need to tell "refused as stale (409)" and
 * "row gone (410)" from "failed/offline" — _sync folds all of those into null.
 */
export async function _syncRaw(action: string, payload: Record<string, unknown> = {}): Promise<SyncResult> {
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
    if (!r.ok) {
      console.error(`[sync] ${action} → ${r.status}:`, text.slice(0, 300))
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
