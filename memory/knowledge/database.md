---
title: Database
tags: [db]
updated: 2026-07-06
facts:
  - id: latest-migration
    subject: Seen database
    predicate: latest_migration
    object: 050_account_type
    valid_from: 2026-07-06
    valid_to: null
    confidence: high
    source: "[[database]]"
    recorded: 2026-07-06
---

# Database (Supabase)

Migrations live in `supabase/migrations/`. Applied to prod via the Supabase MCP
`apply_migration` (or SQL editor). **Latest applied: `050_account_type`
(2026-07-06).** Full range `001`–`050` is present on `next-migration`.

## Verified prod schema truths (do not assume — these were probed)
*Established [[timeline/2026-07-02]]; re-verify with SQL before selecting/inserting.*
- `applications`: has `events jsonb`, `job_id` is **text** (not uuid),
  `applied_at` exists. (Migration 037 codifies these hand-applied repairs
  idempotently — prod already matches; run only on fresh/restored envs.)
- `IF NOT EXISTS` migrations **silently no-op over pre-existing drift** — a
  migration file saying a column is `text` does not prove prod matches.

## Recent migrations (Operation 50%, applied 2026-07-05→06)
- `044_pro_until` — `ai_credits.pro_until` (Pro window for one-time SKUs).
- `045_outcome_email_log` — `outcome_email_log` + `email_prefs` (opt-out).
- `046_job_report_snapshot` — `job_availability_reports` += company/title/city/
  apply_url (snapshot at report time).
- `047_suppressed_listings` — real suppression of deleted ephemeral listings.
- `048_employer_purchases` — unique `stripe_session_id` (idempotent fulfillment).
- `049_employer_perks` — company-keyed `featured_until` / `verified_until`.
- `050_account_type` — `profiles.account_type` `'seeker'|'employer'` DEFAULT
  `'seeker'` + CHECK + index.

## Integrity / RLS
- `035`/`036` locked AI-credit + credit-farming tables (RLS). `038` intel
  survives account deletion; `039` reports `user_id` SET NULL on delete.
- RLS-no-policy INFO lints on server-only tables are **intentional**.
- Free daily credits reset to **1/day** (migration 031/044 RPC;
  `lib/server/creditRules.js` `FREE_DAILY_CREDITS = 1`). See [[decisions/log]].

## Related
[[employer-engine]] (purchases/perks), [[behavioral-flywheel]] (applications/
events, outcome_email_log), [[architecture]].

## Source docs
`CLAUDE.md` (Migration Status / schema facts), `CLAUDE_HANDOFF.md`,
`MASTER_PROJECT_STATE.md` (Database), `SCORING.md`.
