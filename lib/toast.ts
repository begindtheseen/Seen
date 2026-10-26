'use client'

import { notify } from '@/lib/notify'

/**
 * A one-line confirmation ("Synced to your account."). Routed through the ONE toast surface
 * (components/ToastHost via lib/notify) — there used to be a second, bottom-centred #toast pill
 * with its own look and timer.
 */
export function showToast(message: string): void {
  notify({ title: message, severity: 'info', duration: 3200 })
}
