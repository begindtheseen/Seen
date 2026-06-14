'use client'

// Shared AI-auth header builder — Next.js parity of the old SPA's `_aiHeaders()`.
// AI-credit-gated endpoints (/api/resume, /api/job-insights) require
// `Authorization: Bearer <supabase access_token>`; gateAI returns 401
// (credits_required) without it. Returns the bare Content-Type header when
// signed out so the caller can surface the credits_required response.

import { supabase } from './supabase'

export async function aiHeaders(): Promise<Record<string, string>> {
  const base: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    // refreshSession() returns a fresh token if the current one is close to expiry.
    // Fall back to getSession() if refresh fails (e.g. already fresh, no network, etc.)
    const { data: refreshData } = await supabase.auth.refreshSession()
    const token = refreshData?.session?.access_token
    if (token) { base.Authorization = `Bearer ${token}`; return base }
    // Refresh failed or returned nothing — try cached session
    const { data } = await supabase.auth.getSession()
    const cached = data?.session?.access_token
    if (cached) base.Authorization = `Bearer ${cached}`
  } catch {
    /* signed out / session unavailable — return base headers */
  }
  return base
}
