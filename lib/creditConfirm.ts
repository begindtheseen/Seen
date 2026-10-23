'use client'

// One-time "this uses a credit" confirmation — remembered per ACCOUNT per DEVICE.
//
// The key carries the user id, so a second account on the same device is asked again and a
// signed-out visitor never inherits a confirmation. Because the key is user-scoped it does not
// need to be swept on sign-out (lib/auth.tsx SESSION_LOCAL_KEYS sweeps shared keys); the same
// person signing back in on the same device keeps their answer, which is the intended
// "once per account per device" behaviour. Reads and writes are wrapped: localStorage can be
// unavailable (private mode) and the answer then simply defaults to "ask".

export const CREDIT_CONFIRM_PREFIX = 'seen_credit_ok_'

export function hasConfirmedCreditUse(userId: string | null | undefined): boolean {
  if (!userId) return false
  try { return localStorage.getItem(CREDIT_CONFIRM_PREFIX + userId) === '1' } catch { return false }
}

export function markCreditUseConfirmed(userId: string | null | undefined): void {
  if (!userId) return
  try { localStorage.setItem(CREDIT_CONFIRM_PREFIX + userId, '1') } catch { /* ignore */ }
}
