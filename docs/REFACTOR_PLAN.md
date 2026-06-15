# SeenJobs — Staged Refactor Plan

A safe, incremental path from the current migration/prototype to the architecture
in `ARCHITECTURE.md`. Each phase is independently shippable, preserves product
behavior and visual parity, and leaves every quality gate green.

**Golden rules for every phase**
- Do not change product behavior, pricing, payment flow, or visual output unless a
  finding explicitly calls for a security-structure fix.
- Do not delete working code until it is proven unused.
- Never let a phase merge with a broken build, type error, or new lint error.
- Refactor in small PRs. One feature area or one concern per PR.
- Verify visual parity with screenshots when touching pages/components.

---

## Phase 0 — Baseline _(done)_

- Inventoried build, scripts, and env assumptions (`CODEBASE_HEALTH_AUDIT.md`).
- Confirmed baseline `next build` passes (21 routes).
- Recorded current risks (F-01 … F-14).
- **No behavior changed.**

## Phase 1 — Foundation layer _(done in this PR — files created, not yet wired)_

Created the centralized layer. Nothing imports it from production paths yet, so
there is zero runtime impact; it is type-checked and tested.

- `lib/config/env.ts` — centralized env access + validation.
- `lib/supabase/browser.ts` — canonical anon-client import path.
- `lib/supabase/server.ts` — user-scoped (RLS) client factory.
- `lib/supabase/admin.ts` — service-role `createServiceDb()` + `serviceRpc()` with
  a browser-import guard.
- `lib/api/response.ts` — `ok` / `created` / `noContent` / `fail`.
- `lib/api/errors.ts` — typed `ApiError` hierarchy (5xx never leaks detail).
- `lib/api/handler.ts` — `createHandler()` composing the whole pipeline.
- `lib/api/types.ts` — dep-free `ApiRequest` / `ApiResponse` / `ApiHandler`.
- `lib/security/cors.ts` — single CORS policy.
- `lib/security/rateLimit.ts` — typed surface over the shared limiter.
- `lib/security/validation.ts` — dep-free body validators.
- `lib/auth/server.ts` — `resolveIdentity` / `requireUser` (the one JWT verifier).

**Phase 1 follow-up (next PR):** migrate `lib/supabase.ts` to read from
`publicEnv` via `lib/supabase/browser.ts` (F-05), preserving the current literal
values as fallback.

## Phase 2 — Quality gate _(done in this PR)_

Added to `package.json`:
- `typecheck` → `tsc --noEmit`
- `lint` / `lint:fix` → `eslint .` (flat config `eslint.config.mjs`,
  `next/core-web-vitals` + `next/typescript`)
- `format` / `format:write` → Prettier (`.prettierrc.json`), scoped to the new
  foundation code so legacy is not mass-reformatted in this PR
- `test` → `node --test` over `tests/**/*.test.ts` (native TS, zero new deps)
- `check` → `typecheck && test && build` (the must-pass aggregate)

ESLint is decoupled from `next build` (`eslint.ignoreDuringBuilds: true`) so the
build stays a pure compilation gate while lint is tracked separately.

**Current status:** typecheck / format / test / build / check all green. `lint`
reports 24 pre-existing legacy problems (19 errors, 5 warnings); foundation code
is lint-clean. These are tracked debt, burned down within the phases that touch
the relevant files.

**Phase 2 follow-up:** widen Prettier scope and add a CI workflow that runs
`npm run check` + `npm run lint` on every PR.

## Phase 3 — API cleanup (gradual)

Migrate routes one at a time onto the foundation layer. For each route: wrap with
`createHandler`, replace inline CORS/auth/db/env/rate-limit with the shared
helpers, add body validation, move domain logic into a `lib/<feature>` service,
and add/verify parity tests **before** merging.

Suggested order (lowest risk → highest):
1. `api/demand.js` (public reads) — proves the pattern end to end. ✅ **Done.**
2. `api/user-sync.js` — auth + service-db heavy; high duplication payoff. ← _next_
3. `api/admin-stats.js` — fold its inline rate limiter into the shared one (F-06).
4. `api/reports.js` — largest file; split actions into `lib/reports/` services.
5. `api/resume.js` — extract AI calls into `lib/ai/`; consider splitting
   `parse-resume` back out (Vercel Pro has headroom).
6. `api/jobs.js` + `api/refresh-jobs.js` — extract `lib/jobs/` services.
7. `api/stripe.js` → `lib/payments/` — **last and most carefully**; keep signature
   verification + idempotency byte-for-byte; cover with tests first.

### Slice 3.1 — `api/demand.js` (done)

First foundation-adoption slice. Scope was deliberately narrow: the public GET
boundary only; the admin/cron POST path and `vercel.json` were left untouched.

- **Migrated:** inline CORS → `lib/security/cors.ts` (`handlePreflight`); rate-limit
  now imported from `lib/security/rateLimit.ts`; GET env reads → `lib/config/env.ts`
  (`serverEnv` / `optionalEnv`); GET success/empty responses → `lib/api/response.ts`
  (`ok`); GET grouping logic extracted to a pure, unit-tested service
  `lib/demand/grouping.ts`.
- **Kept as `api/demand.js` (not renamed to `.ts`)** so the `vercel.json` function
  entry (`api/demand.js`, `maxDuration: 60`) stays valid — no production-settings
  change. Foundation modules are imported with explicit `.ts` extensions so they
  resolve under both Vercel's serverless bundler and Node's native TS loader.
- **Hardened:** `lib/api/response.ts` now imports `./errors.ts` (explicit extension)
  so it is resolvable from a plain-JS serverless function.
- **Unchanged:** the entire POST/admin/BLS/upsert path; every response shape (200
  grouped, 200 empty-degrade, 429, 405, OPTIONS); the `Cache-Control` header; the
  anon-key read in GET.
- **Tests added:** `tests/demand-grouping.test.ts` (grouping unit tests) and
  `tests/demand-route.test.ts` (route integration tests with a mocked `fetch`).
- **Not used here:** `createHandler` / `lib/api/errors` / `lib/security/validation`
  — GET takes no params (nothing to validate) and intentionally degrades to a
  `200` empty payload rather than erroring, so the error/validation helpers did
  not apply. They remain the standard for routes that reject on bad input.

## Phase 4 — Giant page splitting

Split the 500+ line pages with strict visual parity. For each page: extract data
fetching into a hook/service, extract sub-sections into `components/<feature>/`,
and reduce the page to thin composition. Verify with before/after screenshots.

Order: `app/admin/page.tsx` → `app/jobs/page.tsx` →
`app/company/[slug]/page.tsx` → `app/tracker/page.tsx` →
`app/resume/page.tsx` → `app/dashboard/page.tsx`.

## Phase 5 — Shared UI system

Extract `components/ui/` primitives from repeated inline patterns, swapping them in
without changing rendered output: `Button`, `Card`, `Badge`, `Input`, `Modal`,
`Table`, `KpiCard`, `SectionHeader`, `EmptyState`, `LoadingState`, `ErrorState`.

## Phase 6 — CSS cleanup

Reduce inline-style density (F-09) and global CSS sprawl by leaning on the Phase 5
primitives and CSS variables already in `app/globals.css`. No redesign. Widen
Prettier scope to the whole repo here.

## Phase 7 — Tests

Grow `tests/` to cover the security- and money-critical paths:
- auth helpers (`resolveIdentity`, `verifySupabaseJwt`, `requireUser`)
- admin blocking / admin-token enforcement
- user ownership (a user cannot read/write another user's rows)
- API request validation (`lib/security/validation.ts`)
- Stripe webhook signature verification + idempotency
- rate limiting (allow/deny, fail-open)
- core domain services as they are extracted in Phase 3

---

## Dependency between phases

Phase 1 + 2 (this PR) unblock everything. Phase 7 auth/payment tests should land
**before or alongside** the Phase 3 migrations of `auth`, `user-sync`, and
`stripe`, so those sensitive migrations are protected by parity tests.
