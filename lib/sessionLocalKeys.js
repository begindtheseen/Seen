// Device-local storage that belongs to the SIGNED-IN PERSON and must leave with them. Swept by
// lib/auth.tsx on SIGNED_OUT (local sign-out included) so a shared or borrowed device never
// shows one account's data to the next person. lib/sessionLocalKeys.test.mjs enumerates every
// localStorage write in app/, lib/ and components/ and fails when a key pattern is missing here
// — the 2026-10-23 audit found the résumé text (seen_resume_<uid>) still readable after sign-out
// because only two of the five résumé prefixes were swept.
//
// Plain JS (no types) so the node:test guard and the TSX provider import the same list.

// Exact keys (unscoped stores that hold the current person's data).
export const SESSION_LOCAL_KEYS = [
  'seen_applications_v1', 'seen_saved_v1', 'seen_hevents_v1', 'seen_check_snooze',
  'seen_apply_reminders', 'seen_avoided_apps', 'seen_skip_reasons', 'seen_recent_cos',
  '_seen_survey_done',
  // Device-local search state — must clear on sign-out so the next account on a
  // shared device doesn't inherit the previous user's recent searches / job cache /
  // sticky job-search location.
  'seen_recent_v1', 'seen_job_cache_v1', 'seen_job_location_v1',
];

// Prefixes of per-user keys (`<prefix><user id>` or `<prefix><user id>:<hash>`). Every key that
// starts with one of these is removed, whatever user id it carries.
export const SESSION_LOCAL_PREFIXES = [
  'seen_resume_',            // ResumeStore text + meta, ResumeDocStore doc cache + variants
  'seen_profile_v2_',        // Settings page profile cache (name, city, level)
  'seen_credit_ok_',         // "we only ask once" credit confirm — the next person is asked again
  'seen_onboarding_hidden_', // dashboard checklist dismissal
  'seen_notif_seen_',        // notifications bell last-seen stamp
  'seen_optimized_',         // job ids this person optimized (job-card "cached" hint, lib/optimizedJobs.ts)
];

// Keys that are deliberately NOT swept: device-wide or public caches with no personal data. The
// test requires every write site to be either swept or named here with its reason.
export const DEVICE_SCOPED_KEYS = {
  'ji_': 'job-insights cache — public, shared for everyone for 7 days (api/job-insights.js)',
  'seen_ul_': 'per-device daily usage limits (lib/usage.ts), keyed by date, no user data',
  'seen_msurvey_v1': 'micro-survey daily cap per device (components/MicroSurveyHost.tsx)',
  'seen:employer-notifs:lastvisit:': 'employer notifications last-visit stamp per company page',
  'seen_deploy_hook_url': 'admin deploy hook URL (components/admin/panels.tsx; admin token, not a site session)',
  'seen_opened': 'sessionStorage first-paint marker (app/layout.tsx), not localStorage',
  'seen_notif_refreshed': 'sessionStorage refresh throttle (components/NotificationsBell.tsx) — dies with the tab',
  'seen_last_page': 'legacy key: only ever REMOVED (app/profile/page.tsx), never written',
};

export function isSessionLocalKey(key) {
  if (!key) return false;
  if (SESSION_LOCAL_KEYS.includes(key)) return true;
  return SESSION_LOCAL_PREFIXES.some((p) => key.startsWith(p));
}
