'use client'

import { USAGE_LIMITS, type UsageLimitKey } from './constants'
import { showToast } from './toast'

export const UsageLimits = {
  _key(): string {
    return 'seen_ul_' + new Date().toDateString()
  },

  _get(): Record<string, number> {
    try { return JSON.parse(localStorage.getItem(this._key()) || '{}') } catch { return {} }
  },

  remaining(type: UsageLimitKey): number {
    const d = this._get()
    return Math.max(0, (USAGE_LIMITS[type] || 5) - (d[type] || 0))
  },

  consume(type: UsageLimitKey): void {
    const d = this._get()
    d[type] = (d[type] || 0) + 1
    localStorage.setItem(this._key(), JSON.stringify(d))
  },

  check(type: UsageLimitKey): boolean {
    if (this.remaining(type) <= 0) {
      showToast('Daily limit reached — resets at midnight.')
      return false
    }
    this.consume(type)
    return true
  },
}
