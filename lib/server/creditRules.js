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

// Per-action costs (credits deducted by gateAI). Every paid AI tool costs 1.
export const RESUME_OPTIMIZE_COST = 1; // /api/resume scanner + optimize (and the other tools)
export const HUMANPROOF_COST = 1;      // /api/optimizer humanize (only when paid-gated)
export const JOB_INSIGHTS_COST = 1;    // /api/job-insights — only on a shared-cache MISS (a hit is free)
// Résumé upload/parse is FREE (owner-facing decision 2026-10-23, decided by fact): the parse
// path (api/resume.js handleParseResume → lib/server/resumeUpload.js extractUploadText →
// resumeAnalysis.extractEmployment → lib/resume structureText) makes NO model call — it is
// file→text extraction plus rule-based structuring, rate-limited only. /pricing already listed
// "Resume parse" under Free while the handler charged a credit; this constant is the one place
// that says which it is, and every copy site renders from it.
export const RESUME_PARSE_COST = 0;    // /api/resume parse — free (no model call)

// When the free daily credit resets. The ONE wording every surface uses (CLAUDE.md
// California-time rule: the daily reset is the Pacific calendar day in code AND in SQL).
export const CREDIT_RESET_LABEL = 'midnight PT';

// Shared copy helpers — plain functions so the client bundle gets the identical words.
export function creditCostLabel(cost) {
  const n = Number(cost) || 0;
  return n === 0 ? 'free' : `${n} credit${n === 1 ? '' : 's'}`;
}
export function dailyResetLabel() {
  return `${FREE_DAILY_CREDITS} free credit${FREE_DAILY_CREDITS === 1 ? '' : 's'} reset${FREE_DAILY_CREDITS === 1 ? 's' : ''} at ${CREDIT_RESET_LABEL}`;
}

// The ONE sentence that explains a balance — rendered by the credits popover (components/
// CreditsPopover.tsx) from the same constants the server enforces. Facts it states (verified in
// lib/server/credits.js + migration 025/20261021120000 consume_credit):
//   • a new account's balance IS the welcome bonus; the free daily credit is not added on top;
//   • the ai_credits row is created on the FIRST AI action with last_reset = that Pacific day, and
//     the next day resets `balance` to FREE_DAILY_CREDITS — so unused welcome credits end at the
//     first midnight PT after that first action;
//   • afterwards balance = today's daily credits (free + earned, less spent) + purchased credits,
//     and purchased credits never reset.
/** @param {{ balance: number, daily?: number | null, purchased?: number | null, earned?: number | null, welcome?: boolean }} info */
export function balanceExplanation({ balance, daily = null, purchased = 0, earned = 0, welcome = false }) {
  const n = Math.max(0, Number(balance) || 0);
  const credits = (k) => `${k} credit${k === 1 ? '' : 's'}`;
  if (welcome) {
    return `${n} available = your ${WELCOME_CREDITS}-credit welcome bonus. Your ${credits(FREE_DAILY_CREDITS)} a day is not added on top: at the first ${CREDIT_RESET_LABEL} after your first AI action the balance resets to ${FREE_DAILY_CREDITS} free a day (plus anything you earn or buy).`;
  }
  const p = Math.max(0, Number(purchased) || 0);
  const d = daily == null ? Math.max(0, n - p) : Math.max(0, Number(daily) || 0);
  const e = Math.max(0, Number(earned) || 0);
  const today = e > 0
    ? `${d} for today (your ${credits(FREE_DAILY_CREDITS)} free plus ${e} earned, less what you have used)`
    : `${d} for today (your ${credits(FREE_DAILY_CREDITS)} free, less what you have used)`;
  const bought = p > 0 ? ` + ${p} purchased (never reset)` : '';
  return `${n} available = ${today}${bought}. Today's credits reset to ${FREE_DAILY_CREDITS} at ${CREDIT_RESET_LABEL}; purchased credits never reset.`;
}

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

// The ai_credits row a brand-new account's FIRST credit event creates, whichever path creates it
// (an AI action, tracking an application, answering a question, a résumé survey, a purchase): the
// welcome bonus is the balance, and the next Pacific-day reset brings it to FREE_DAILY_CREDITS.
// Until 2026-10-24 only the AI-action paths granted it, so a new user whose chip read "10" (get_credits
// welcome:true) and who tracked an application first was dropped to 2.
export function firstCreditsRow(today) {
  return { balance: WELCOME_CREDITS, daily_earned: 0, last_reset: today, pro: false };
}

// Earning adds to the free balance up to MAX_FREE_BALANCE and NEVER lowers it. The clamp used to be
// min(balance + award, MAX_FREE_BALANCE), so an account still holding its welcome balance (10) lost
// credits by earning one (10 → 6). `gained` is what was actually added (0 when already at the cap).
export function earnedBalance(base, award) {
  const b = Math.max(0, Number(base) || 0);
  const next = Math.max(b, Math.min(b + Math.max(0, Number(award) || 0), MAX_FREE_BALANCE));
  return { balance: next, gained: next - b };
}

// ── What Seen sells (owner decisions 2026-10-25) ────────────────────────────────────────
// Interview Prep is THE lead product, sold the moment a tracked application reaches an interview
// ($9.99 for one interview; it also opens 14 days of Pro). The 30-day Job Search Pass ($19.99) replaced
// monthly/yearly Seen Pro, the 7-day no-card trial and the $4.99 Credit Pack on every surface. Both are
// one-time payments (Stripe Checkout mode:'payment', inline price_data — no dashboard product setup)
// and NEITHER RENEWS. Seen no longer starts subscriptions or trials; api/stripe.js keeps the webhook /
// cancel / portal paths so a subscription started before the change keeps working until it ends.
// (The Interview Sprint — 30 credits + 7 days Pro, $14.99 — was replaced by Interview Prep the same day
// and never sold.)
//
// Fulfillment (lib/server/stripeFulfillment.js): credits go to ai_credits.purchased_credits (NEVER
// `balance`, which is wiped to FREE_DAILY_CREDITS at the daily reset); pro_days extend
// ai_credits.pro_until through lib/server/grantProDays.js. Interview Prep keeps migration 044's
// GREATEST(pro_until, now + pro_days). The pass is ADDED after any Pro time already left —
// GREATEST(pro_until, now) + 30 days (PRO_DAYS_STACK) — so a pass bought with 10 days of Interview Prep
// still running gives the 30 days that were paid for, not 20.
//
// credits20 stays defined ONLY so a Credit Pack checkout opened before the change, or a Stripe webhook
// redelivery, is still fulfilled. It is not in SELLABLE_SKUS: no new checkout can be opened for it.
export const ONE_TIME_SKUS = {
  interview: { name: 'Interview Prep',   amount_cents: 999,  credits: 0,  pro_days: 14 },
  pass30:    { name: 'Job Search Pass',  amount_cents: 1999, credits: 0,  pro_days: 30 },
  credits20: { name: 'Credit Pack',      amount_cents: 499,  credits: 20, pro_days: 0 },
};

/** The products a checkout may be opened for today, lead product first. */
export const SELLABLE_SKUS = ['interview', 'pass30'];

/** SKUs whose Pro days are added AFTER any Pro time already left (grantProDays stack:true). */
export const PRO_DAYS_STACK = { pass30: true };

/** "$19.99" from a SKU's cents — every surface prints a price through this, never a literal. */
export function skuPrice(sku) {
  const def = ONE_TIME_SKUS[sku];
  return def ? `$${(def.amount_cents / 100).toFixed(2)}` : '';
}

/** The words under every paid button: the purchase happens once. */
export const ONE_TIME_NOTE = 'One-time · never renews';

// ── Growth rewards: Seen Pro days earned by reporting and by inviting (owner-approved 2026-10-24) ──
// Pro time lands in ai_credits.pro_until through lib/server/grantProDays.js. Rewards STACK: days are
// added after any Pro time already left (GREATEST(pro_until, now) + days), unlike an Interview Prep purchase,
// which keeps migration 044's GREATEST(pro_until, now + days). A reward never changes a score, a grade
// or how a report is weighted, and it is the same for every outcome. The DB trigger in migration
// 20261024160000_growth_rewards.sql enforces the two caps under concurrency with these same numbers
// (lib/server/growthRewards.test.mjs pins them together).

// Every outcome reported from a tracked application earns this many days of Pro, once per application.
export const REPORT_REWARD_PRO_DAYS = 3;
// At most this many report reward days per California calendar month (America/Los_Angeles).
export const REPORT_REWARD_MONTHLY_CAP_DAYS = 15;
// The application must have been on the tracker this many days before the report earns anything.
export const REPORT_REWARD_MIN_TRACKED_DAYS = 7;
// Invite a friend: when the invitee tracks their first application, BOTH get this many days.
export const REFERRAL_REWARD_PRO_DAYS = 7;
// A referrer is rewarded for at most this many invitees (the invitee's own week is not capped).
export const REFERRAL_MAX_REWARDED = 10;
// An account can be claimed as an invitee only within this many days of its sign-up.
export const REFERRAL_CLAIM_WINDOW_DAYS = 30;

/** "1 day" / "3 days". */
export function dayWord(n) {
  const d = Math.max(0, Math.round(Number(n) || 0));
  return `${d} ${d === 1 ? 'day' : 'days'}`;
}
/** "3 days of Seen Pro". */
export function proDaysLabel(n) {
  return `${dayWord(n)} of Seen Pro`;
}

// Effective Pro check — the ONE definition of "is this user Pro right now".
// Pro = subscription flag OR admin-comped (migration 051 — the Stripe lifecycle never
// touches comped accounts) OR an unexpired purchased Pro window (Interview Prep SKU, growth rewards).
// Every gating read of ai_credits.pro must go through this, never `cred.pro` directly.
export function hasProAccess(cred, nowMs = Date.now()) {
  if (!cred) return false;
  if (cred.comped === true) return true;
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
