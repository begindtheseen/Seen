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
// Before any of that it cancels every live Stripe subscription immediately (lib/server/stripeCancel.js)
// and deletes nothing if it cannot (2026-10-24, owner decision: deletion cancels billing). So the dialog
// never blocks on a subscription; it says the subscription ends right away with no refund.

export const DELETE_CONFIRM_WORD = 'DELETE'

/** True once the user has typed the confirmation word exactly (surrounding whitespace ignored). */
export function deleteConfirmReady(typed) {
  return String(typed == null ? '' : typed).trim() === DELETE_CONFIRM_WORD
}

/**
 * True when deleting will cancel a live subscription (the dialog then says so before the user confirms).
 * `sub` is the Settings page's subscription summary (null when there is no Stripe subscription). A
 * subscription already set to end at the period's close is cancelled immediately too.
 */
export function deletionCancelsSubscription(sub) {
  if (!sub) return false
  return ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'].includes(String(sub.status || ''))
}

/** The line the dialog shows when deletion will cancel a subscription. */
export const SUBSCRIPTION_CANCEL_NOTICE =
  'Your Seen Pro membership is cancelled right away. The rest of the current billing period is not refunded, and nothing is charged after today.'

/** What the user loses — the dialog lists exactly these (and nothing softer). */
export const DELETE_CONSEQUENCES = [
  'Your profile, résumé and uploaded files',
  'Every tracked application and saved job',
  'Your AI credits — the daily ones and any you purchased — and any unused Pro time; none of it is refunded',
  'Any Seen Pro membership, cancelled immediately so nothing is charged again',
  'Your sign-in. Reports you submitted stay published with no link to you.',
]
