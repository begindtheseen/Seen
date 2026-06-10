'use client'

import { supabase } from './supabase'

async function getToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession()
    return data?.session?.access_token || null
  } catch {
    return null
  }
}

export async function _sync(action: string, payload: Record<string, unknown> = {}): Promise<unknown> {
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
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      console.error(`[sync] ${action} → ${r.status}:`, body)
      return null
    }
    return await r.json()
  } catch (e) {
    console.error(`[sync] ${action} network error:`, (e as Error).message)
    return null
  }
}
