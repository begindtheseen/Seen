// Isomorphic credit-rules re-export for client components (React/TS).
//
// The literals live ONCE in lib/server/creditRules.js (plain JS so the Vercel api/*.js
// serverless functions can import them with no build step). This file re-exports the same
// values so client components import a typed surface — guaranteeing UI copy (e.g. "N AI
// credits/day") is generated from the SAME constants the server enforces, never a
// hand-typed number that drifts. See the CLAUDE.md credit-rules owner decision.
//
// Safe to import from a client bundle: creditRules.js is dependency-free and side-effect
// free (pure constants, no server-only imports).

export {
  WELCOME_CREDITS,
  FREE_DAILY_CREDITS,
  PRO_DAILY_CREDITS,
  RESUME_OPTIMIZE_COST,
  HUMANPROOF_COST,
  RESUME_PARSE_COST,
  JOB_INSIGHTS_COST,
  CREDIT_RESET_LABEL,
  creditCostLabel,
  priceLabel,
  usageLine,
  PRO_COST_LABEL,
  dailyResetLabel,
  balanceExplanation,
  RESUME_SURVEY_AWARD,
  TRACK_APPLICATION_AWARD,
  MAX_DAILY_EARN,
  MAX_FREE_BALANCE,
  ONE_TIME_SKUS,
  SELLABLE_SKUS,
  PRO_DAYS_STACK,
  skuPrice,
  ONE_TIME_NOTE,
  hasProAccess,
  creditBalance,
  firstCreditsRow,
  earnedBalance,
  REPORT_REWARD_PRO_DAYS,
  REPORT_REWARD_MONTHLY_CAP_DAYS,
  REPORT_REWARD_MIN_TRACKED_DAYS,
  REFERRAL_REWARD_PRO_DAYS,
  REFERRAL_MAX_REWARDED,
  REFERRAL_CLAIM_WINDOW_DAYS,
  dayWord,
  proDaysLabel,
} from './server/creditRules.js';
