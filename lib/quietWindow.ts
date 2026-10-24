// The "quiet window": a short period after the user has just done something weighty in the
// tracker — deleted or withdrew an application, logged an outcome, cleared the list — during which
// nothing optional may pop up (user audit 2026-10-23: the micro-survey card slid in right after a
// withdrawal). Device-local, per tab (sessionStorage), carries no user data. Writers call
// markQuiet(); anything ambient (MicroSurveyHost) asks inQuietWindow() and listens for `seen:quiet`.

export const QUIET_MS = 2 * 60 * 1000
export const QUIET_KEY = 'seen_quiet_until'
export const QUIET_EVENT = 'seen:quiet'

function store(): Storage | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage } catch { return null }
}

/** Start (or extend) the quiet window from `now`. Safe anywhere — a storage failure is ignored. */
export function markQuiet(now = Date.now()): void {
  const until = now + QUIET_MS
  try { store()?.setItem(QUIET_KEY, String(until)) } catch { /* private mode — the event below still cancels a pending pop */ }
  try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(QUIET_EVENT, { detail: { until } })) } catch { /* ignore */ }
}

/** The instant the current quiet window ends, or 0 when none is set. */
export function quietUntil(): number {
  try {
    const v = Number(store()?.getItem(QUIET_KEY) || 0)
    return Number.isFinite(v) ? v : 0
  } catch { return 0 }
}

export function inQuietWindow(now = Date.now()): boolean {
  return quietUntil() > now
}
