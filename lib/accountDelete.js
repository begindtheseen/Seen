// The rules of the "Delete my account" dialog (components/profile/DeleteAccountDialog.tsx), kept pure
// so they are testable without React.
//
// What `delete_account` (api/user-sync.js) actually does, traced 2026-10-24:
//   • deletes this user's rows in applications, application_events, saved_jobs, ai_credits (daily AND
//     purchased credits, pro_until), credit_transactions, user_recent_cos, login_signals,
//     answered_questions, resume_employment, resume_skills, job_availability_reports, search_events;
//   • removes uploaded résumé files (resumes + application-resumes buckets) and the profile row
//     (profiles.resume_text with it);
//   • keeps the user's public reports and résumé-survey answers, de-linked (user_id → null);
//   • deletes the Supabase auth user (seen_applications cascade with it).
// It does NOT touch Stripe: an active subscription keeps billing the Stripe customer after the Seen
// account is gone. So the dialog refuses to proceed while a subscription is live and sends the user to
// cancel it first.

export const DELETE_CONFIRM_WORD = 'DELETE'

/** True once the user has typed the confirmation word exactly (surrounding whitespace ignored). */
export function deleteConfirmReady(typed) {
  return String(typed == null ? '' : typed).trim() === DELETE_CONFIRM_WORD
}

/**
 * Whether deletion may proceed given the live subscription state, and why not.
 * `sub` is the Settings page's subscription summary (null when there is no Stripe subscription).
 */
export function deleteBlockedBySubscription(sub) {
  if (!sub) return false
  if (sub.cancel_at_period_end) return false // already ending — nothing will renew
  return ['active', 'trialing', 'past_due'].includes(String(sub.status || ''))
}

/** What the user loses — the dialog lists exactly these (and nothing softer). */
export const DELETE_CONSEQUENCES = [
  'Your profile, résumé and uploaded files',
  'Every tracked application and saved job',
  'Your AI credits — the daily ones and any you purchased — and any unused Pro time; none of it is refunded',
  'Your sign-in. Reports you submitted stay published with no link to you.',
]
