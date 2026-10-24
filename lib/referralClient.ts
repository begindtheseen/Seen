'use client'

// The browser side of invite links. A visitor who arrives with ?ref=<code> keeps the code on this
// device (seen_ref_pending_v1, with the time it arrived) until an account signs in here; that sign-in
// claims it once (api/user-sync.js claim_referral) and the key is removed on any final answer. The
// code expires after REFERRAL_CLAIM_WINDOW_DAYS, the same window the server allows a new account.
// The signed-in person's OWN code is never stored: it is read from the server and kept in memory for
// this tab only, per account.

import { _syncRaw } from './sync'
import { safeLocalGet, safeLocalSet } from './safeStorage'
import { isReferralCode, refFromSearch, referralUrl, REF_PARAM } from './referral.js'
import { REFERRAL_CLAIM_WINDOW_DAYS } from './creditRules'

export const PENDING_REF_KEY = 'seen_ref_pending_v1'
const WINDOW_MS = REFERRAL_CLAIM_WINDOW_DAYS * 86400e3

type Pending = { code: string; at: number }

function readPending(): Pending | null {
  const raw = safeLocalGet(PENDING_REF_KEY)
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Pending
    if (!p || !isReferralCode(p.code) || !Number.isFinite(p.at) || Date.now() - p.at > WINDOW_MS) { clearPendingRef(); return null }
    return p
  } catch { clearPendingRef(); return null }
}

export function clearPendingRef(): void {
  try { window.localStorage.removeItem(PENDING_REF_KEY) } catch { /* storage blocked */ }
}

/** Keep ?ref= from the current URL (the latest link clicked wins) and take it out of the address bar. */
export function captureRefFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  const code = refFromSearch(window.location.search)
  if (!code) return null
  safeLocalSet(PENDING_REF_KEY, JSON.stringify({ code, at: Date.now() }))
  try {
    const u = new URL(window.location.href)
    u.searchParams.delete(REF_PARAM)
    window.history.replaceState(window.history.state, '', `${u.pathname}${u.search}${u.hash}`)
  } catch { /* the code is kept either way */ }
  return code
}

let claiming: Promise<void> | null = null

/** Claim the pending code for the signed-in account. Final answers (claimed, own link, unknown code,
 *  account too old, already claimed) clear it; a network failure or "not ready" keeps it for later. */
export function claimPendingRef(): Promise<void> {
  if (claiming) return claiming
  const p = readPending()
  if (!p) return Promise.resolve()
  claiming = (async () => {
    const r = await _syncRaw('claim_referral', { code: p.code })
    const body = r.body as { final?: boolean } | null
    if (r.ok && body?.final) clearPendingRef()
  })().finally(() => { claiming = null })
  return claiming
}

export type ReferralStatus = {
  ready: boolean
  code?: string | null
  joined?: number
  waiting?: number
  rewarded?: number
  cap?: number
  pro_days_earned?: number
  report_days_this_month?: number
  report_month_cap?: number
  pro_until?: string | null
}

// One request per account per tab (the company page share and the invite card ask the same thing).
const statusByUser = new Map<string, Promise<ReferralStatus | null>>()

export function referralStatus(userId: string | null | undefined, { fresh = false } = {}): Promise<ReferralStatus | null> {
  if (!userId) return Promise.resolve(null)
  if (!fresh && statusByUser.has(userId)) return statusByUser.get(userId)!
  const p = _syncRaw('referral_status').then(r => (r.ok ? (r.body as ReferralStatus) : null)).catch(() => null)
  statusByUser.set(userId, p)
  // A failed read is not remembered, so the next ask tries again.
  p.then(s => { if (!s && statusByUser.get(userId) === p) statusByUser.delete(userId) })
  return p
}

/** The signed-in person's invite link to `path` (their code), or the plain link. */
export async function myInviteUrl(userId: string | null | undefined, path = '/'): Promise<string> {
  const s = await referralStatus(userId)
  return referralUrl(s?.ready ? s.code : null, path)
}
