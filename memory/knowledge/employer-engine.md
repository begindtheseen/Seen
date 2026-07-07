---
title: Employer Engine
tags: [revenue, product]
updated: 2026-07-06
facts:
  - id: sku-featured30
    subject: featured30 SKU
    predicate: price_usd
    object: 79
    valid_from: 2026-07-05
    valid_to: null
    confidence: high
    source: "[[employer-engine]]"
    recorded: 2026-07-06
  - id: sku-verified90
    subject: verified90 SKU
    predicate: price_usd
    object: 249
    valid_from: 2026-07-05
    valid_to: null
    confidence: high
    source: "[[employer-engine]]"
    recorded: 2026-07-06
---

# Employer Engine (E4)

Employer-side revenue. **Complete as of PR #162; the employer portal (#163) was
OPEN / preview-green / not-yet-merged at the 2026-07-06 handoff — confirm it
landed.** See [[timeline/2026-07-05]].

## The load-bearing integrity rule
**Money NEVER changes a transparency score.**
- **Featured** = paid placement (a sort boost + ★ badge).
- **Transparency Verified** = a displayed commitment the admin grants *after
  review* — never bought.
Keep these strictly separate in code and copy.

## SKUs (`lib/server/employerSkus.js`)
- `featured30` — $79 / 30 days.
- `verified90` — $249 / 90 days.

## Checkout & fulfillment
- Email-based, **no-login** checkout: `api/stripe.js` `employer_checkout` +
  `employer_confirm`, routed by `metadata.kind === 'employer'`.
- `lib/server/employerFulfillment.js` → idempotent insert into
  `employer_purchases` (unique `stripe_session_id`) + owner alert email
  (`OWNER_EMAIL` || `ADMIN_EMAIL` || `NOTIFY_EMAIL`; no-op until set — see
  [[environment]]).
- Admin `list_employer_purchases` + `fulfill_employer_purchase` grant time-boxed
  perks into `employer_perks` (`components/admin/EmployerPanel.tsx`, Revenue tab).

## Display
- Company-page Transparency **Verified** / **Featured** badges (isolated
  `employer_perk` action in `api/reports.js`).
- JobCard **★ Featured** badge + search sort-first (`getFeaturedSet` in
  `api/jobs.js`, cached 60s).

## Employer / seeker separation
- `/employers*` hides the seeker Nav/Footer (employer-first experience).
- The portal creates **no seeker records** (reputation is read-only; checkout
  writes only employer tables).
- `profiles.account_type` (`'seeker'|'employer'`, migration `050`) is the DB
  label so employer accounts never mix into seeker views. See [[database]].

## Phase 2 (deliberately NOT built)
Candidate sourcing (employers browsing talent) needs a candidate-profile opt-in
model first. Owner chose "portal on real data first." Not built / not faked.
[[decisions/log]].

## Source docs
`CLAUDE_HANDOFF.md` (Employer engine E4), `MONETIZATION_TODO.md`,
`OPPORTUNITY_ENGINE.md`.
