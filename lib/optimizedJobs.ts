'use client'

// Which listings this person already paid to optimize on this device — a HINT for the job card
// label ("Optimize · cached"). The server cache (lib/server/optimizeCache.js, 7 days, keyed by user
// + job + posting + résumé) is the truth: the modal always probes it before offering to charge, so
// a stale hint can never cost a credit. Per-user key, swept on sign-out (lib/sessionLocalKeys.js).

export const OPTIMIZED_PREFIX = 'seen_optimized_'
const DAYS = 7

function read(userId: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(OPTIMIZED_PREFIX + userId)
    const o = raw ? JSON.parse(raw) : {}
    return o && typeof o === 'object' ? o : {}
  } catch { return {} }
}

export function markOptimized(userId: string | null | undefined, jobId: string | null | undefined): void {
  if (!userId || !jobId) return
  try {
    const now = Date.now()
    const o = read(userId)
    o[String(jobId)] = now
    // keep the map small: drop entries older than the cache window
    for (const [k, t] of Object.entries(o)) if (now - Number(t) > DAYS * 86400000) delete o[k]
    localStorage.setItem(OPTIMIZED_PREFIX + userId, JSON.stringify(o))
  } catch { /* private mode — the label just stays "Optimize · 1 credit" */ }
}

export function wasOptimized(userId: string | null | undefined, jobId: string | null | undefined): boolean {
  if (!userId || !jobId) return false
  const t = read(userId)[String(jobId)]
  return !!t && Date.now() - Number(t) < DAYS * 86400000
}
