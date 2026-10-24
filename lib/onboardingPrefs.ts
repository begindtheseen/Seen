// The dashboard's first-run checklist ("Welcome to Seen · 3 steps") remembers a dismissal PER USER,
// on every device. The device copy is localStorage `seen_onboarding_hidden_<uid>`; the account copy
// rides inside `profiles.onboarding_survey` (a JSON blob the profile save already accepts and the
// dashboard already reads) under one namespaced key, so a second device does not re-show the guide
// (user audit 2026-10-23). The blob may arrive as a string (text column) or an object (jsonb) —
// both are read; it is always written back as a JSON string, which either column type stores.

export const CHECKLIST_DISMISSED_KEY = 'seen_dashboard_checklist_dismissed_at'

type Blob = string | Record<string, unknown> | null | undefined

export function parseSurveyBlob(v: Blob): Record<string, unknown> {
  if (!v) return {}
  if (typeof v === 'object') return { ...v }
  try {
    const o = JSON.parse(v)
    return o && typeof o === 'object' && !Array.isArray(o) ? o as Record<string, unknown> : {}
  } catch { return {} }
}

/** True when this account dismissed the dashboard checklist on some device. */
export function isChecklistDismissed(v: Blob): boolean {
  const at = parseSurveyBlob(v)[CHECKLIST_DISMISSED_KEY]
  return typeof at === 'string' && at.length > 0
}

/** The blob to save back: everything it already held plus the dismissal timestamp. */
export function withChecklistDismissed(v: Blob, now = new Date()): string {
  return JSON.stringify({ ...parseSurveyBlob(v), [CHECKLIST_DISMISSED_KEY]: new Date(now).toISOString() })
}
