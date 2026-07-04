# Monetization TODO — owner decisions (NOT yet built)

These are high-leverage conversion levers that were intentionally **left out** of the
`claude/conversion-funnel` work because each one requires a business, pricing, or
infrastructure decision (a paid service, API keys, or an email/Stripe configuration the
owner controls). Implement once the prerequisite decision is made.

---

## ⚡ OPERATION 50% DECISIONS — LOCKED BY OWNER 2026-07-04 (approved plan)

The owner approved the "Operation 50%" plan on 2026-07-04. The following are now
**settled business decisions** (rule 6 satisfied — decide once, build once):

1. **7-day NO-CARD free trial — APPROVED, rebuild.** Variant: `payment_method_collection:
   'if_required'` + `trial_settings.end_behavior.missing_payment_method: 'cancel'`.
   Revisit card-required only at meaningful traffic volume.
2. **One-time SKUs — APPROVED.** "Interview Sprint" $14.99 (+30 credits + 7-day Pro via
   new `ai_credits.pro_until`), "Credit Pack" $4.99 (+20 credits). Inline `price_data`,
   fulfilled in the `checkout.session.completed` webhook.
3. **Analytics — DECIDED: PostHog** (free tier). Key-activated via `NEXT_PUBLIC_POSTHOG_KEY`;
   code no-ops without it. Closes item 2 below.
4. **Email — DECIDED: Resend** for the Day-7/14/30 outcome loop. Key-activated via
   `RESEND_API_KEY`; owner does the one-time domain DNS verification.
5. **Beachhead niche — DECIDED:** staffing-agency-ghosted + entry-level/service seekers
   (r/recruitinghell audience). Hero asset: the Staffing Agency Ghost Index (/agencies).
6. **Employer-side revenue — APPROVED to build:** featured listings, niche sponsorships,
   "Transparency Verified" badge (verified against outcome data; money NEVER changes a score).

Operating manual: `playbook/` (weekly routine, outreach scripts, content engine, 90-day
calendar with kill/scale gates).

---

## 1. 7-day free trial — ✅ DECISION MADE 2026-07-04, no-card variant (see Operation 50% block) — was: ❌ REMOVED (built #86, deleted #93)
**Status correction (2026-07-02, verified against code):** the trial described below was built
in PR #86, patched (#89), rebuilt (#90), and **deleted in PR #93** in the same day because the
business decision wasn't settled first (see CLAUDE.md mandatory rule 6 — this feature is the
canonical example). As of today `trial_period_days` appears NOWHERE in `api/stripe.js`, and no
trial CTA/disclosure copy exists in `app/pricing/page.tsx` or `components/UpgradeModal.tsx`
(verified by grep). The stale "✅ BUILT" note that previously lived here is exactly the
ground-truth rot rule 8 warns about — do not trust feature-status claims in docs without a grep.

If the owner decides to reintroduce a trial, the original design (card-required, via Stripe)
is preserved below as the implementation sketch:

**Expected lift:** Large. Free trials on a $9.99–$83.88 SaaS commonly lift paid conversion
2–4× by moving the payment decision *after* the user has felt Pro value (unlimited credits,
Stealth Mode, HumanProof).

**Why it's an owner decision:** Requires a pricing/Stripe-trial decision —
- Card-required vs no-card trial (card-required converts better but reduces trial starts).
- `trial_period_days` on the Stripe Checkout Session / Price, plus handling
  `customer.subscription.trial_will_end` and the first `invoice.payment_failed`.
- Decide whether to grant Pro entitlement immediately on trial start (set `ai_credits.pro`
  on `checkout.session.completed`) and revoke it if the trial subscription never converts.

**Files involved:**
- `api/stripe.js` — add `trial_period_days` to the `checkout` session; in `webhook`, handle
  trial lifecycle events and only keep `ai_credits.pro=true` while the sub is `trialing` or
  `active`.
- `components/UpgradeModal.tsx` + `app/pricing/page.tsx` — CTA copy ("Start 7-day free
  trial", "then $6.99/mo"), trial disclosure for FTC/ARL compliance.
- `lib/server/credits.js` — no change if `pro` flag already drives unlimited; confirm a
  cancelled/expired trial flips `pro` back to false via the webhook.

---

## 2. Conversion / funnel analytics
**Expected lift:** Indirect but compounding — you can't optimize what you can't measure.
Lets you see paywall-view → checkout-start → paid drop-off per trigger context
(credits vs pro vs generic) and per plan (monthly vs yearly).

**Why it's an owner decision:** Needs a tool + keys (e.g. PostHog, Plausible, or GA4) and a
privacy/consent decision. No analytics dependency or key currently exists in the repo.

**Files involved:**
- A new `lib/analytics.ts` client wrapper + env keys (e.g. `NEXT_PUBLIC_POSTHOG_KEY`).
- Instrument `components/UpgradeModal.tsx` (`paywall_viewed`, `plan_selected`,
  `checkout_started`), `app/pricing/page.tsx`, and the 402 paths in
  `components/ApplyOptimizeModal.tsx` / `components/HumanProofPanel.tsx` / `app/resume/page.tsx`.
- `api/stripe.js` webhook → server-side `subscription_started` event for accurate paid counts.

---

## 3. Abandoned-checkout email capture / win-back
**Expected lift:** Moderate. Recovering even 5–15% of users who open checkout and bounce is
a direct MRR add. Most valuable once trial + analytics exist.

**Why it's an owner decision:** Needs email infrastructure (e.g. Resend/Postmark/SendGrid)
with an API key and a sending domain — none configured. Also a consent/marketing-email
decision.

**Files involved:**
- `api/stripe.js` — listen for `checkout.session.expired`; enqueue a win-back email.
- A new `api/email-winback.js` (or extend existing email sending in `api/resume.js`'s
  `email_analysis` path) using the chosen provider's key.
- Optional: a `checkout_intents` table to dedupe and rate-limit sends.

---

## 4. New Pro-only feature gating (beyond what exists today)
**Expected lift:** Variable — only worth it if a genuinely valuable feature is reserved.
Over-gating free features can *reduce* top-of-funnel activation and word-of-mouth.

**Why it's an owner decision:** Changing what's free vs Pro is a product/business-model
decision. Current gating (3 free credits/day, Stealth Mode auto-applied for Pro, HumanProof
behind the `HUMANPROOF_PAID_ONLY` flag) is intentional and was left untouched.

**Files involved (when a decision is made):**
- `lib/server/credits.js` `gateAI(req, reason, { proOnly: true })` for any new Pro-only endpoint.
- The relevant `api/*.js` handler.
- Surface via `components/UpgradeModal.tsx` with `reason="pro"` + `featureName` (already supported).

---

_Generated alongside the `claude/conversion-funnel` branch. The SAFE wins (annual-default
pricing, contextual paywall copy, funnel coherence, pricing polish) are already implemented
on that branch._
