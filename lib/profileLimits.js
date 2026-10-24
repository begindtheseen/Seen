// The Settings → Profile free-text limits, shared by the form (app/profile/page.tsx) and the server
// (api/user-sync.js save_profile) so a value the form accepts is never cut on the way to the row and
// a value that bypasses the form never lands uncapped (audit 2026-10-24, P1). Plain JS: imported by a
// Vercel function and a TSX page.
export const PROFILE_LIMITS = { name: 60, city: 80, industry: 80 };
export const PROFILE_NAME_REQUIRED = 'Add your first name — we use it to greet you.';

/** Trim + cap one profile text field. */
export function clampProfileField(field, value) {
  return String(value ?? '').trim().slice(0, PROFILE_LIMITS[field] || 120);
}
