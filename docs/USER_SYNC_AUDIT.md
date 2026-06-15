# `api/user-sync.js` — Action Inventory & Migration Classification

_Audit date: 2026-06-15 · 693 lines · 24 actions · POST-only._

Purpose: a safe, evidence-based map of every action in the user-data sync route so
Phase E migrations can proceed one micro-slice at a time without risking user data.
This is an inventory only — **no behavior is changed by this document.**

## Auth & ownership model (shared by all actions)

- The route resolves `uid` once at the top: local HS256 verify of the Supabase JWT
  (`SUPABASE_JWT_SECRET`), else the `/auth/v1/user` fallback. Identical to the
  centralized `lib/auth/server.ts` (`resolveIdentity` / `requireUser`).
- **Ownership is enforced everywhere by filtering on the verified `uid`**
  (`user_id=eq.${uid}` or `id=eq.${uid}`) while using the service-role key. The
  `uid` is **never** taken from the request body.
- Writes are rate-limited per-uid (300/hour); reads are not.
- All DB access goes through one inline `db(path, opts)` service-role helper
  (equivalent to `lib/supabase/admin.ts` `createServiceDb`).

## Classification

| Action | Type | Tables | Risk | Notes |
|---|---|---|---|---|
| `load` | read (multi) | applications, saved_jobs, user_recent_cos, ai_credits, feature_flags | Med | also daily credit reset + fire-and-forget login_signal; paginated |
| `load_profile` | **read** | profiles | **Low** | `profiles?id=eq.uid&limit=1` → `{profile}`. ← first slice |
| `get_credits` | read | ai_credits | Med | money-adjacent; daily reset side-effect |
| `credit_history` | read | credit_transactions | Low | |
| `get_employment` | read | (profile/employment) | Low | |
| `get_recent_cos` | read | user_recent_cos | Low | |
| `get_question` | read | survey | Med | survey/credits flow |
| `add_application` | write | applications | Med | |
| `create_application` | write | applications | Med | validates company_name/role |
| `update_application` | write | applications | Med | allow-lists stage/status/events |
| `remove_application` | write | applications | Med | scoped delete by id+uid |
| `save_job` / `unsave_job` | write | saved_jobs | Low–Med | upsert / scoped delete |
| `save_profile` | write | profiles | Med | SAFE_FIELDS allow-list |
| `save_resume` / `clear_resume` | write | profiles | Med | resume PII |
| `log_search_event` | write (analytics) | search_events | Low | fire-and-forget |
| `report_job_availability` | write (community) | job_availability_reports, jobs | Med | upsert + counter |
| `consume_credit` / `earn_credit` | **write (credits/money)** | ai_credits, credit_transactions | **High** | do NOT touch without dedicated tested slice |
| `submit_answer` | write (credits) | survey, credits | High | grants credits |
| `save_employment` | write | employment | Med | |
| `log_recent_co` | write | user_recent_cos | Low | |
| `company_survey` | write | survey | Med | |
| `delete_account` | **destructive** | applications, profiles, auth user | **Critical** | deletes the auth user — **STOP-condition; human review required** |

## Migration order (safest first)

1. `load_profile` — single-table read, trivial shape. **(service built this slice;
   wiring deferred — see below.)**
2. `get_recent_cos`, `get_employment`, `credit_history` — simple reads.
3. `load` — multi-read with a credit-reset side-effect (preserve carefully).
4. Low-risk writes (`save_job`/`unsave_job`, `log_search_event`).
5. Application writes (`add`/`create`/`update`/`remove_application`).
6. Profile/resume writes (PII — careful).
7. Credits/survey writes (money — dedicated tested slices).
8. `delete_account` — **only with explicit human review** (irreversible).

## Gating dependency (why wiring is deferred)

`user-sync.js` is the core user-data route; if anything broke it, all sync fails.
The migration depends on importing `.ts` foundation/service modules from a `.js`
serverless function — a pattern that is proven locally (Node + tests) but **not yet
confirmed on a real Vercel deploy** (the `api/demand.js` preview check from Phase A5
is still outstanding). Therefore this slice **builds and tests the `load_profile`
service but does not wire it into the live route.** Wire-up happens only after the
demand preview confirms the pattern in a production-like deploy.
