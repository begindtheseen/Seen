# SeenJobs — Codebase Health Audit

_Generated: 2026-06-15 · Branch: `claude/seenjobs-architecture-foundation-23bkjm`_

This audit inspects the SeenJobs Next.js migration as it stands today and records
the structural risks that keep it from being a serious, maintainable SaaS codebase.
It is descriptive (what is wrong and why) — the staged remediation lives in
`REFACTOR_PLAN.md`. No product behavior is changed by this document.

## Method

- Line counts collected with `wc -l` across `app/`, `components/`, `lib/`, `api/`.
- Duplication located with `grep` for CORS, auth/JWT, Supabase `db()` helpers,
  rate-limit, Stripe, and `process.env` usage.
- Inline-style density measured by counting `style={{` occurrences per file.
- Baseline build (`next build`), typecheck (`tsc --noEmit`) and lint (`eslint .`)
  were run to establish current quality-gate status.

## Snapshot — largest files by line count

### React pages / components / lib (`.ts`/`.tsx`)

| Lines | File |
|------:|------|
| 1583 | `app/admin/page.tsx` |
| 1551 | `app/jobs/page.tsx` |
| 1251 | `app/company/[slug]/page.tsx` |
| 739  | `components/SurveyModal.tsx` |
| 707  | `app/tracker/page.tsx` |
| 658  | `components/LandingHero.tsx` |
| 616  | `app/resume/page.tsx` |
| 506  | `app/dashboard/page.tsx` |
| 504  | `components/ApplyCheckpoint.tsx` |
| 453  | `components/ApplyOptimizeModal.tsx` |
| 441  | `app/companies/page.tsx` |

### Serverless API functions (`api/*.js`)

| Lines | File |
|------:|------|
| 1138 | `api/reports.js` |
| 791  | `api/refresh-jobs.js` |
| 723  | `api/admin-stats.js` |
| 705  | `api/resume.js` |
| 693  | `api/user-sync.js` |
| 685  | `api/jobs.js` |
| 388  | `api/demand.js` |
| 370  | `api/apply.js` |
| 262  | `api/stripe.js` |

The coding-standard ceiling (see `CODING_STANDARDS.md`) is 500 lines. **15 files
exceed it.** Six API files and three React pages exceed it by 2–3×.

---

## Findings

### F-01 — CORS policy copy-pasted across every API route

Finding: One CORS implementation re-typed in many places, three of them slightly different.
File(s): `api/demand.js`, `api/apply.js`, `api/stripe.js`, `api/resume.js`, `api/jobs.js`, `api/job-insights.js`, `api/reports.js`, `api/admin-stats.js`, `api/user-sync.js`, `lib/server/ratelimit.js` (`setCORS`).
Problem: The allowed-origins list and dev-bypass logic are duplicated. `api/stripe.js`, `api/admin-stats.js` and `api/user-sync.js` each hand-roll their own variant inline (different header sets, different method lists).
Why it matters: A change to the allowed-origin policy must be made in ~10 places; drift means some routes are stricter/looser than others, which is a security inconsistency.
Risk level: High
Category: Security / Maintainability
Safe fix: Route all CORS through `lib/security/cors.ts` (created in this PR). Migrate one route at a time.
Risk of fixing: Low — behavior is identical when the helper mirrors the existing logic (it does).
Suggested phase: Phase 3.

### F-02 — Auth / JWT verification duplicated (and forked)

Finding: `verifyJWT` / `verifyJWTLocal` / `resolveUid` reimplemented per file.
File(s): `api/stripe.js` (`verifyJWT`, `resolveUid`), `api/reports.js` (`verifyJWT`, `resolveUid`), `api/demand.js`, `api/apply.js`, `api/user-sync.js` (`verifyJWTLocal`).
Problem: The HS256 Supabase-JWT verification and the `/auth/v1/user` fallback are copy-pasted with small differences. Identity resolution is the single most security-critical path and it has five implementations.
Why it matters: A bug or hardening fix (e.g. clock-skew handling, algorithm pinning) has to be applied five times. Divergence here is an authentication risk.
Risk level: Critical
Category: Security
Safe fix: Centralize in `lib/auth/server.ts` (`resolveIdentity` / `requireUser`, created in this PR — a faithful port). Migrate routes individually with parity tests.
Risk of fixing: Medium — auth is sensitive; migrate one route at a time and verify token flows.
Suggested phase: Phase 3 (after Phase 7 auth tests exist).

### F-03 — Supabase service-role `db()` helper duplicated in 8 routes

Finding: The PostgREST fetch wrapper is re-declared in every privileged route.
File(s): `api/demand.js`, `api/stripe.js`, `api/jobs.js`, `api/job-insights.js`, `api/reports.js`, `api/admin-stats.js`, `api/refresh-jobs.js`, `api/user-sync.js`.
Problem: Each route builds `const db = (path, opts) => fetch(`${URL}/rest/v1/${path}`, { headers: { apikey, Authorization: Bearer service_key, ... }})`. Service-key handling is scattered.
Why it matters: Centralizing the service-role client is a security boundary — it makes it auditable where the service key is used and prevents accidental misuse. Duplication makes that audit impossible.
Risk level: High
Category: Security / Architecture
Safe fix: Use `lib/supabase/admin.ts` `createServiceDb()` (created in this PR — same headers/signature).
Risk of fixing: Low.
Suggested phase: Phase 3.

### F-04 — Environment variables read ad hoc everywhere

Finding: `process.env.SUPABASE_*` / `STRIPE_*` read inline in every route, no validation.
File(s): all `api/*.js` (3–11 `process.env` reads each), `lib/supabase.ts` (hardcoded URL + anon key, not env-driven).
Problem: No single place defines which env vars exist, which are required, or what happens when they are missing. Each route invents its own "not configured" fallback.
Why it matters: Misconfiguration fails in inconsistent ways (some 500, some 503, some silently degrade). New environments are hard to provision because the contract is implicit.
Risk level: Medium
Category: DX / Maintainability / Security
Safe fix: `lib/config/env.ts` (created in this PR) centralizes access and provides `requireEnv` / `requireSupabaseServer`.
Risk of fixing: Low.
Suggested phase: Phase 1 (structure) → Phase 3 (adoption).

### F-05 — Hardcoded Supabase URL and anon key in source

Finding: Project URL + anon JWT literal-embedded.
File(s): `lib/supabase.ts`.
Problem: The browser client hardcodes the URL and anon key rather than reading `NEXT_PUBLIC_*`. The anon key is public by design (RLS-protected), so this is not a secret leak, but it hardcodes environment into source and prevents per-environment configuration (staging vs prod).
Why it matters: You cannot point a preview deploy at a different Supabase project without editing source; rotating the project requires a code change.
Risk level: Low
Category: Maintainability / Security hygiene
Safe fix: `lib/config/env.ts` `publicEnv` already reads `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` with a fallback to the current literals (behavior preserved). Migrate `lib/supabase.ts` to consume it via `lib/supabase/browser.ts`.
Risk of fixing: Low — fallback keeps current behavior when env is unset.
Suggested phase: Phase 1 follow-up.

### F-06 — Rate-limiting re-implemented inline in admin-stats

Finding: A shared rate limiter exists, but `admin-stats` rolls its own.
File(s): `lib/server/ratelimit.js` (shared) vs `api/admin-stats.js` (inline `increment_rate_limit` RPC call for admin login).
Problem: Two rate-limit code paths to the same RPC, with separate windowing logic.
Why it matters: Limits and fail-open behavior can drift; the admin login limiter is security-relevant (brute-force protection).
Risk level: Medium
Category: Security / Maintainability
Safe fix: Route through `lib/security/rateLimit.ts` (typed surface over the shared limiter, created in this PR). Add an `admin-login` key to the shared `LIMITS`.
Risk of fixing: Low.
Suggested phase: Phase 3.

### F-07 — Giant React pages mixing data, business logic, and 200+ inline styles

Finding: Pages are 500–1583 lines and own data fetching, derived calculations, and full markup.
File(s): `app/admin/page.tsx` (1583), `app/jobs/page.tsx` (1551), `app/company/[slug]/page.tsx` (1251), `app/tracker/page.tsx` (707), `app/resume/page.tsx` (616), `app/dashboard/page.tsx` (506).
Problem: These are `'use client'` pages that fetch, transform, and render in one file. They cannot be reasoned about, unit-tested, or code-reviewed in isolation.
Why it matters: This is the core spaghetti risk. Every change is high-blast-radius; merge conflicts are guaranteed; nothing is reusable.
Risk level: High
Category: Architecture / Maintainability
Safe fix: Extract data hooks into `lib/<feature>/`, extract sub-sections into `components/<feature>/`, keep the page as a thin composition. Done page-by-page with visual-parity verification.
Risk of fixing: Medium — high line count means careful, incremental extraction with screenshots.
Suggested phase: Phase 4.

### F-08 — Giant API files with many responsibilities

Finding: Single serverless files act as multi-action routers spanning hundreds of lines.
File(s): `api/reports.js` (1138), `api/refresh-jobs.js` (791), `api/admin-stats.js` (723), `api/resume.js` (705), `api/user-sync.js` (693), `api/jobs.js` (685).
Problem: Each file dispatches on an `action` field and inlines DB access, validation, business logic, and external API calls (Stripe, Anthropic, Adzuna). `api/resume.js` also absorbed `parse-resume` as an `action` branch.
Why it matters: No separation between transport (HTTP) and domain logic; impossible to unit-test the logic; the `action` dispatch hides many independent endpoints in one function.
Risk level: High
Category: Architecture / Maintainability
Safe fix: Move domain logic into `lib/<feature>/` services; keep the route as a thin dispatcher using `lib/api/handler.ts`. On Vercel Pro (500 functions) the merged routes can also be split back out.
Risk of fixing: Medium.
Suggested phase: Phase 3.

### F-09 — Inline-style overload

Finding: Thousands of inline `style={{…}}` objects; no shared style primitives.
File(s): `app/admin/page.tsx` (226), `app/jobs/page.tsx` (179), `app/company/[slug]/page.tsx` (178), `app/dashboard/page.tsx` (102), `app/tracker/page.tsx` (100), plus most other pages/components.
Problem: Styling is embedded per-element. There is no `Button`/`Card`/`Badge` primitive, so the same visual treatments are re-expressed inline repeatedly.
Why it matters: Visual inconsistency, no theme reuse, huge files, and any design tweak is a find-and-replace across hundreds of literals.
Risk level: Medium
Category: UI Consistency / Maintainability
Safe fix: Extract a `components/ui/` primitive set; replace inline styles incrementally WITHOUT changing the rendered result (visual parity).
Risk of fixing: Medium — must preserve exact appearance.
Suggested phase: Phase 5 (primitives) → Phase 6 (CSS cleanup).

### F-10 — No shared types between API and frontend

Finding: API is untyped `.js`; frontend is `.tsx`; request/response shapes are not shared.
File(s): all `api/*.js` ↔ `app/**`, `lib/types.ts` (frontend-only domain types).
Problem: The contract between client and server is implicit. The client hand-builds request bodies and casts responses; nothing fails at compile time when they drift.
Why it matters: Silent breakage on shape changes; no autocomplete; validation must be re-derived on both ends.
Risk level: Medium
Category: Architecture / DX
Safe fix: Introduce `types/db/` and per-feature request/response types; validate inbound bodies with `lib/security/validation.ts`; type outbound with `lib/api/response.ts`.
Risk of fixing: Low (additive).
Suggested phase: Phase 3 onward.

### F-11 — Missing input validation on API routes

Finding: Request bodies parsed with `JSON.parse` + `||` fallbacks; fields used without checking type/shape.
File(s): `api/reports.js`, `api/user-sync.js`, `api/resume.js`, `api/apply.js`, others.
Problem: Routes read `body.action`, `body.plan`, free-text fields directly. There is no central validation layer; malformed input reaches business/DB logic.
Why it matters: Robustness and security — unvalidated input is the root of many injection/DoS/data-quality issues, and SeenJobs explicitly treats submissions as untrusted claims.
Risk level: High
Category: Security / Maintainability
Safe fix: Validate at the route boundary with `lib/security/validation.ts` (created in this PR); reject with `BadRequestError`.
Risk of fixing: Low–Medium (must not reject currently-valid payloads — port the implicit rules faithfully).
Suggested phase: Phase 3 (consider adopting `zod` — see standards).

### F-12 — Missing quality gates (partially addressed in this PR)

Finding: `package.json` shipped with only `dev` / `build` / `start`. No typecheck, lint, format, or test script; no ESLint or Prettier config.
File(s): `package.json`, repo root.
Problem: Nothing stops a type error, lint regression, or unformatted code from merging. There was no automated signal of health.
Why it matters: Quality gates are the mechanism that keeps a refactor from regressing; without them "clean" is unenforceable.
Risk level: High
Category: DX
Safe fix: Added in this PR — `typecheck`, `lint`, `lint:fix`, `format`, `format:write`, `test`, `check` scripts; `eslint.config.mjs`; `.prettierrc.json`; foundation tests. See `REFACTOR_PLAN.md` Phase 2.
Risk of fixing: Low.
Suggested phase: Phase 2 (done; legacy lint burn-down ongoing).

### F-13 — Risky client-side trust patterns

Finding: Profile/state reconciliation and gating decisions made in the browser.
File(s): `lib/auth.tsx` (local-vs-DB profile merge with "localWins" precedence), `lib/stores/*` (localStorage-backed app/saved-job/event stores), `components/HiringProbability.tsx` / `SurveyModal.tsx` (credit logic client-side).
Problem: Some trust/state lives in the client. The auth/payment paths are server-verified (Stripe webhook signatures + idempotency, server JWT verification — good), but business state like credits/probabilities is computed and partly persisted client-side.
Why it matters: Anything the client can compute, the client can forge. The strategy requires server-authoritative trust/confidence — client-side computation undermines data quality and gating.
Risk level: Medium
Category: Security
Safe fix: Keep authoritative credit/subscription/trust state server-side; treat client values as display-only. Audit each gate during feature-area refactors.
Risk of fixing: Medium — touches product behavior; do deliberately, not speculatively.
Suggested phase: Phase 3+ (per feature), not this PR.

### F-14 — Mixed module systems and inconsistent style

Finding: `api/*.js` (ESM-in-JS, semicolons) vs `app/**`/`lib/**` `.ts(x)` (no semicolons); `"type": "module"` set globally.
File(s): repo-wide.
Problem: Two style worlds with no enforced formatter; the server half is untyped.
Why it matters: Cognitive overhead, inconsistent review standards, and the server half gets no compiler help.
Risk level: Low
Category: Maintainability / DX
Safe fix: Prettier config added (this PR). Migrate `api/*.js` to typed handlers under the foundation layer over Phase 3; expand formatter scope in Phase 6.
Risk of fixing: Low.
Suggested phase: Phase 3 / Phase 6.

---

## What is already healthy (do not "fix")

- **Stripe webhook security is solid** — `api/stripe.js` verifies signatures with a
  constant-time compare, enforces a 5-minute replay window, refuses unsigned
  webhooks (503 when secret missing), and is idempotent via a
  `stripe_events_processed` table. Preserve this exactly.
- **Server-side JWT verification** uses `timingSafeEqual` and checks `exp`.
- **Security headers** — `middleware.ts` sets a real CSP, HSTS, frame-ancestors,
  COOP/CORP, and no-store on `/admin`. This is above-average for a prototype.
- **Rate limiting** is centralized in `lib/server/ratelimit.js` with atomic
  Supabase upserts and fail-open degradation (only `admin-stats` forks it — F-06).
- **Service-role key is server-only** — no service key in the frontend.

## Safest first refactor opportunities (lowest risk, highest leverage)

1. **Quality gates** (F-12) — _done in this PR._ Zero behavior risk, unlocks everything else.
2. **Foundation layer** (F-01–F-06 structure) — _created in this PR, not yet wired._ Pure addition.
3. **Adopt `lib/security/cors.ts` in one low-traffic route** (e.g. `api/demand.js`) — F-01.
4. **Adopt `lib/supabase/admin.ts` `createServiceDb()`** in the same route — F-03.
5. **Migrate `lib/supabase.ts` to `publicEnv`** behind `lib/supabase/browser.ts` — F-05.

## Current quality-gate status (this PR)

| Gate | Command | Status |
|------|---------|--------|
| Typecheck | `npm run typecheck` | ✅ pass |
| Format (foundation scope) | `npm run format` | ✅ pass |
| Unit tests | `npm test` | ✅ 5/5 pass |
| Build | `npm run build` | ✅ pass (21 routes) |
| Aggregate | `npm run check` | ✅ pass |
| Lint | `npm run lint` | ⚠️ 24 problems (19 errors, 5 warnings) — all in legacy files; foundation code is clean. Tracked debt, burned down in Phases 3–6. |

## Appendix A — Exact lint debt (24 known issues)

All 24 are pre-existing and live in legacy files. None are in the new foundation
layer (`lib/api`, `lib/auth`, `lib/config`, `lib/security`, `lib/supabase`,
`tests`). They are intentionally **not fixed in this PR** because each one lives in
a file owned by a later phase (pages → Phase 4, components → Phase 5, stores →
Phase 3), and several require behavior/visual decisions (`<a>`→`<Link>` changes
navigation; `<img>`→`<Image>` changes rendering) that must not be made
speculatively. Errors marked `[warn]` are warnings; the rest are errors.

| File | Loc | Rule | Issue | Owning phase |
|------|-----|------|-------|------|
| `app/admin/page.tsx` | 1385:14 | no-unused-vars | `'e'` unused | 4 |
| `app/apply/page.tsx` | 154:9 | no-html-link-for-pages | `<a>`→`/jobs/` should be `<Link>` | 4 |
| `app/apply/page.tsx` | 408:13 | no-html-link-for-pages | `<a>`→`/jobs/` should be `<Link>` | 4 |
| `app/company/[slug]/page.tsx` | 549:31 | exhaustive-deps | unused eslint-disable directive `[warn]` | 4 |
| `app/jobs/page.tsx` | 805:9 | no-unused-vars | `'scoreColor'` unused | 4 |
| `app/jobs/page.tsx` | 955:9 | no-unused-vars | `'router'` unused | 4 |
| `app/jobs/page.tsx` | 1093:20 | exhaustive-deps | unused eslint-disable directive `[warn]` | 4 |
| `app/layout.tsx` | 33:9 | no-page-custom-font | custom font not in `_document` `[warn]` | 6 |
| `app/pricing/page.tsx` | 106:142 | no-unescaped-entities | unescaped `'` | 4 |
| `app/pricing/page.tsx` | 245:18 | no-unescaped-entities | unescaped `'` | 4 |
| `app/tracker/page.tsx` | 637:13 | no-html-link-for-pages | `<a>`→`/jobs/` should be `<Link>` | 4 |
| `components/ApplyCheckpoint.tsx` | 54:59 | no-unused-vars | `'_optimized'` unused | 5 |
| `components/ApplyOptimizeModal.tsx` | 192:14 | no-unused-vars | `'_'` unused | 5 |
| `components/ApplyOptimizeModal.tsx` | 443:28 | no-unescaped-entities | unescaped `'` | 5 |
| `components/HiringProbability.tsx` | 32:84 | no-unused-vars | `'_overallScore'` unused | 5 |
| `components/LandingHero.tsx` | 68:11 | no-unused-vars | `'isLoggedIn'` unused | 5 |
| `components/Nav.tsx` | 73:9 | no-unused-vars | `'isDashboard'` unused | 5 |
| `components/OutcomeCard.tsx` | 222:13 | exhaustive-deps | unused eslint-disable directive `[warn]` | 5 |
| `components/OutcomeCard.tsx` | 294:11 | no-img-element | `<img>` could be `<Image>` `[warn]` | 5 |
| `components/SurveyModal.tsx` | 639:20 | no-unescaped-entities | unescaped `'` | 5 |
| `components/SurveyModal.tsx` | 651:150 | no-unescaped-entities | unescaped `'` | 5 |
| `components/SurveyModal.tsx` | 706:22 | no-unescaped-entities | unescaped `'` | 5 |
| `lib/stores/AppStore.ts` | 4:10 | no-unused-vars | `'supabase'` unused | 3 |
| `lib/stores/AppStore.ts` | 9:10 | no-unused-vars | `'isLoggedIn'` unused | 3 |

Totals: **19 errors + 5 warnings = 24.** Most are trivial (`--fix`-able unused
vars / entity escapes); they are deferred to keep this foundation PR scoped to
additive changes only.

## Appendix B — Foundation PR scope (this change set)

### Files added (foundation layer — created, not yet wired into any route/page)
- `lib/config/env.ts`
- `lib/supabase/browser.ts`, `lib/supabase/server.ts`, `lib/supabase/admin.ts`
- `lib/api/types.ts`, `lib/api/errors.ts`, `lib/api/response.ts`, `lib/api/handler.ts`
- `lib/security/cors.ts`, `lib/security/rateLimit.ts`, `lib/security/validation.ts`
- `lib/auth/server.ts`
- `tests/api-errors.test.ts`
- `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`
- `docs/CODEBASE_HEALTH_AUDIT.md`, `docs/ARCHITECTURE.md`, `docs/REFACTOR_PLAN.md`, `docs/CODING_STANDARDS.md`

### Files modified (config only — no product logic touched)
- `package.json` — added `typecheck`, `lint`, `lint:fix`, `format`, `format:write`,
  `test`, `check` scripts + `eslint`, `eslint-config-next`, `@eslint/eslintrc`,
  `prettier` devDependencies. `package-lock.json` updated to match.
- `tsconfig.json` — added `"allowImportingTsExtensions": true`.
- `next.config.ts` — added `eslint.ignoreDuringBuilds: true`.

### Why the `tsconfig.json` change is safe
`allowImportingTsExtensions` only *permits* writing an explicit `.ts` extension in
an import path; it does not require it and changes nothing about how existing
extensionless imports resolve. It is allowed only because `noEmit: true` is already
set (the flag's precondition). It is needed because the test runner (`node --test`
with native TS type-stripping) resolves real files and therefore needs the explicit
extension in `tests/api-errors.test.ts`, while `tsc` would otherwise reject that
extension. No application import was changed; no emit behavior exists to affect.
The baseline `next build` still produces the identical 21 routes.

### Behavior preserved (verified)
- `next build` produces the same 21 routes as the pre-change baseline; bundle
  sizes unchanged.
- No `api/*.js` route, no page, no component was modified — runtime behavior of the
  app and all serverless functions is byte-for-byte unchanged.
- Stripe / payment / admin / AI code paths untouched.
- The foundation modules are imported by nothing in production paths, so they add
  no runtime code to any route or page (confirmed: build output identical).
- `lib/supabase.ts` (hardcoded anon client) left exactly as-is; `publicEnv` uses the
  same literals as fallback, so even the future migration is behavior-neutral.

### Intentionally NOT touched (deferred to later phases)
- No API route migrated onto the foundation (Phase 3).
- `app/admin`, `app/jobs`, `app/company/[slug]` and other giant pages not split (Phase 4).
- `api/stripe.js` / payment behavior not refactored or altered (Phase 3, last).
- Admin auth/behavior (`api/admin-stats.js`) not changed (Phase 3).
- No UI redesign, no inline-style removal, no visual change (Phases 5–6).
- The 24 legacy lint issues not fixed (owned by their phases above).
- Prettier scope limited to the new foundation files (no legacy reformat).
