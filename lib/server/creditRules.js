// Credit rules — the SINGLE SOURCE OF TRUTH for every credit constant in the app.
//
// OWNER DECISION (2026-07-02, supersedes the same-day "3/day" note in CLAUDE.md): the
// free tier grants ONE AI credit per day. This file is the one place those numbers live;
// every server path (lib/server/credits.js, api/user-sync.js, api/resume.js,
// api/optimizer.js) imports from here, and the isomorphic re-export in lib/creditRules.ts
// gives client components the identical literals so UI copy can never drift from the code.
//
// This module is plain JS (no types) so BOTH the Vercel serverless api/*.js files AND the
// TypeScript client can import it directly with no build step. Keep it dependency-free and
// side-effect-free — it must stay safe to import from a client bundle.

// Welcome bonus granted on a user's first AI action (the ai_credits row is created lazily).
export const WELCOME_CREDITS = 10;

// Daily reset baseline. Free users reset to this each calendar day; Pro is effectively
// unlimited. NOTE: the DB column DEFAULT stays 1 (migration 031); code resets converge to
// FREE_DAILY_CREDITS within a day, so we never migrate the column.
export const FREE_DAILY_CREDITS = 1;
export const PRO_DAILY_CREDITS = 999;

// Per-action costs (credits deducted by gateAI). All AI tools currently cost 1.
export const RESUME_OPTIMIZE_COST = 1; // /api/resume scanner + optimize (and the other tools)
export const HUMANPROOF_COST = 1;      // /api/optimizer humanize (only when paid-gated)
export const RESUME_PARSE_COST = 1;    // /api/resume parse

// Earn-back awards (credits granted for supplying data).
export const RESUME_SURVEY_AWARD = 2;     // completing a résumé survey about a past employer
export const TRACK_APPLICATION_AWARD = 1; // tracking an application / answering one question

// Ceiling on credits a free user can EARN per day (across surveys + tracking + questions).
// Prevents farming; Pro bypasses it entirely.
export const MAX_DAILY_EARN = 5;

// The most credits a free user can hold at once = today's baseline + a full day of earns.
// Used to clamp earn-back so a runaway loop can never inflate a balance past the cap.
// (Purchased credits live in ai_credits.purchased_credits and are NOT subject to this cap.)
export const MAX_FREE_BALANCE = FREE_DAILY_CREDITS + MAX_DAILY_EARN;

// ── Monetization (owner-approved 2026-07-04 — Operation 50%, Engine E2+E3) ──────────────

// Subscription free trial: 7 days, NO card required (Stripe payment_method_collection:
// 'if_required' + trial end_behavior missing_payment_method: 'cancel' — access simply ends
// if no payment method was added; nobody is charged without one).
export const PRO_TRIAL_DAYS = 7;

// One-time purchase SKUs (Stripe Checkout mode:'payment', inline price_data — no dashboard
// product setup). Fulfillment: credits go to ai_credits.purchased_credits (NEVER `balance`,
// which is wiped to FREE_DAILY_CREDITS at the daily reset); pro_days extends
// ai_credits.pro_until by GREATEST(existing, now + pro_days). See migration 044.
export const ONE_TIME_SKUS = {
  sprint:    { name: 'Interview Sprint', amount_cents: 1499, credits: 30, pro_days: 7 },
  credits20: { name: 'Credit Pack',      amount_cents: 499,  credits: 20, pro_days: 0 },
};

// Effective Pro check — the ONE definition of "is this user Pro right now".
// Pro = subscription flag OR an unexpired purchased Pro window (sprint SKU).
// Every gating read of ai_credits.pro must go through this, never `cred.pro` directly.
export function hasProAccess(cred, nowMs = Date.now()) {
  if (!cred) return false;
  if (cred.pro === true) return true;
  if (cred.pro_until) {
    const t = Date.parse(cred.pro_until);
    if (Number.isFinite(t) && t > nowMs) return true;
  }
  return false;
}

// Total spendable credits = daily balance + purchased (never-resetting) credits.
// Tolerates rows from a DB where migration 044 isn't applied yet (fields undefined).
export function creditBalance(cred) {
  if (!cred) return 0;
  return Math.max(0, cred.balance || 0) + Math.max(0, cred.purchased_credits || 0);
}
