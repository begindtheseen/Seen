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
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (token) base.Authorization = `Bearer ${token}`
  } catch {
    /* signed out / session unavailable — return base headers */
  }
  return base
}
