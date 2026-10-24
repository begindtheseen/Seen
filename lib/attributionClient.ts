'use client'

// The browser side of first-touch signup attribution (rules in lib/attribution.js). ReferralHost calls
// captureFirstTouch() on every page load BEFORE captureRefFromUrl() takes ?ref= out of the address bar,
// and recordPendingTouch() once an account is signed in. The server (api/user-sync.js
// record_attribution) keeps the first record per account; a final answer replaces the stored touch with
// a bare "done" marker so it is never sent again from this device.

import { _syncRaw } from './sync'
import { captureTouch, markTouchDone, pendingTouchPayload } from './attribution.js'

function stores(): { local: Storage; session: Storage } | null {
  try { return { local: window.localStorage, session: window.sessionStorage } } catch { return null }
}

export function captureFirstTouch(): void {
  if (typeof window === 'undefined') return
  const s = stores()
  if (!s) return
  try {
    captureTouch({ pathname: window.location.pathname, search: window.location.search, referrer: document.referrer, host: window.location.hostname }, s.local, s.session)
  } catch { /* attribution must never break a page */ }
}

// One attempt per account per page load: a "not ready" (table not migrated yet) or a network failure
// is tried again on the next full load, never in a loop.
const attempted = new Set<string>()

export async function recordPendingTouch(userId: string | null | undefined): Promise<void> {
  if (typeof window === 'undefined' || !userId || attempted.has(userId)) return
  const s = stores()
  if (!s) return
  const payload = pendingTouchPayload(s.local)
  if (!payload) return
  attempted.add(userId)
  try {
    const r = await _syncRaw('record_attribution', payload)
    const body = r.body as { final?: boolean } | null
    if (r.ok && body?.final) markTouchDone(s.local)
  } catch { /* kept for the next load */ }
}
