# Wagyu Execution Log

Source-of-truth history of the Wagyu codebase-cleanup slices. Newest entries at
the top. Each slice is small, verified, and committed separately. See
`REFACTOR_PLAN.md` for the phased strategy and `CODEBASE_HEALTH_AUDIT.md` for the
findings being burned down.

Conventions:
- Branch in use this run: `claude/seenjobs-architecture-foundation-23bkjm`
  (a feature branch, not `main`/protected; it carries the unmerged foundation +
  demand work that later slices build on).
- Gates after every slice: `npm run typecheck`, `format`, `test`, `build`,
  `check`, `lint`. Lint is allowed to stay at the pre-existing legacy baseline
  (24 problems) but must introduce **zero** new issues.

---

## Slice J-1 — Make PR #36 deployable: revert route→foundation wiring (keep foundation)

- **Date/time:** 2026-06-15 ~22:30 UTC
- **Branch:** `claude/seenjobs-architecture-foundation-23bkjm`
- **Slice name:** wagyu: revert api/demand + api/user-sync route wiring (Vercel-safe)
- **Why:** the production incident proved that on this Vercel setup the legacy
  `api/*` serverless functions **cannot import the `.ts` foundation at runtime** —
  BOTH `.js`→`.ts` (`9c0bfb1`) AND `.ts`→`.ts` (the rename, `e17a943`) crashed at
  module-load (`Unknown file extension ".ts"`) and 500'd in production. The only
  proven-safe pattern is plain `.js`, self-contained, no `.ts` imports (the
  `hotfix/demand-stabilize` route). Owner decision: revert route wiring, keep the
  foundation; defer route adoption until a proven Vercel-safe strategy exists.
- **Changes:**
  - `api/demand.ts` removed; `api/demand.js` restored from `hotfix/demand-stabilize`
    (fail-open wrapper; imports only plain `.js`). GET shape / OPTIONS / 405 /
    Cache-Control / POST cron preserved.
  - `api/user-sync.ts` removed; `api/user-sync.js` restored to the original
    `next-migration` version (imports `crypto` + `lib/server/ratelimit.js` only).
    All 24 actions back to their original inline implementations.
  - `vercel.json` keys back to `api/demand.js` / `api/user-sync.js`.
  - `tests/demand-route.test.ts` imports `../api/demand.js` (green).
  - `tests/user-sync-load-profile.test.ts` removed (tested the reverted wiring).
- **KEPT (foundation preserved):** all docs + audits + this log;
  `lib/{api,auth,config,security,supabase,demand,profile,companies}` foundation +
  services + their unit tests; quality gates + scripts. Services are library code
  now (not imported by any route) → cannot affect Vercel runtime.
- **Behavior preserved:** routes are the proven production code (+ demand fail-open
  wrapper). No `.ts` in any request path.
- **Tests/checks:** typecheck ✅, format ✅, test ✅ (62/62), build ✅, check ✅,
  lint ⚠️ 24 legacy (unchanged, zero new). Both routes load under Node.
- **PUSH HELD:** per owner instruction, not pushing until Vercel's **Production
  Branch is confirmed = `next-migration`**. Committed locally, awaiting confirmation.
- **Deferred:** foundation route adoption — to be redone via a proven Vercel-safe
  path (App Router `app/api/*` or a foundation precompile step).
- **Stop condition hit:** Yes — holding push pending the Vercel prod-branch fix.

---

## Slice I-1 — Fix Vercel runtime 500 (bundle wired routes as `.ts`)

- **Date/time:** 2026-06-15 ~21:25 UTC
- **Branch:** `claude/seenjobs-architecture-foundation-23bkjm`
- **Slice name:** wagyu: fix vercel runtime 500 — rename wired routes to .ts
- **Symptom:** `GET /api/demand` returned **500** on the Vercel preview (build was
  "Ready", but the function crashed). PR #36 preview.
- **Diagnosis (logic-confirmed, Vercel runtime logs not accessible from here):**
  the demand GET handler catches every internal failure and degrades to a `200`
  empty payload — so a 500 can only be a **module-load crash**. Cause: a plain
  **`.js`** Vercel serverless function is **not bundled** by `@vercel/node` (files
  are traced/copied as-is), so at runtime Node tries to load the imported
  `lib/**/*.ts` foundation modules and throws `Unknown file extension ".ts"`. It
  worked locally only because Node 22's type-stripping loads `.ts`. **Category:
  `.js` → `.ts` module resolution at Vercel runtime** (not env/Supabase/helper).
- **Fix (smallest that addresses the root cause):** rename the two wired routes to
  `.ts` so `@vercel/node` uses its TypeScript build path (esbuild **bundles** the
  function, inlining the `.ts` imports → no runtime `.ts` loads):
  - `git mv api/demand.js api/demand.ts`, `git mv api/user-sync.js api/user-sync.ts`
  - Added `// @ts-nocheck` to each (ported-JS routes; never strict-typed as `.js`;
    fully typing 700+ lines of admin/user code would be the forbidden broad rewrite).
  - `vercel.json`: function keys `api/demand.js`→`api/demand.ts`,
    `api/user-sync.js`→`api/user-sync.ts` (maxDuration values unchanged — required
    so the function config still matches the files; explicitly authorized).
  - Test imports updated to the `.ts` paths.
- **Behavior preserved:** Yes — only filenames + a top comment changed; route logic
  (GET shape, OPTIONS, 405, Cache-Control, POST/admin/cron, all user-sync actions)
  is byte-for-byte unchanged. `user-sync` got the **identical mechanical runtime
  fix only — no action migrated** (it already carried the same `.ts` imports and
  would have 500'd too).
- **Tests/checks run:** typecheck ✅, format ✅, test ✅ (64/64), build ✅,
  check ✅, lint ⚠️ 24 legacy (unchanged, zero new). Both routes confirmed to load
  under Node.
- **Known risk / open gate:** the fix's correctness on Vercel can only be confirmed
  by the NEW preview build for this push. Awaiting `GET /api/demand` → JSON + the
  Cache-Control header on the new preview.
- **Stop condition hit:** Yes — per instructions, stopping after the fix; will NOT
  continue user-sync migration until the owner confirms the new demand preview is
  green.

---

## Slice H-1 — Migrate user-sync read actions: get_employment, get_recent_cos

- **Date/time:** 2026-06-15 ~20:55 UTC
- **Branch:** `claude/seenjobs-architecture-foundation-23bkjm`
- **Slice name:** wagyu: migrate user-sync get_employment + get_recent_cos
- **Goal:** Continue Phase E down the safest read-only actions, extracting logic to
  services and keeping response shapes byte-for-byte.
- **Files changed:** `lib/profile/service.ts` (+`getEmployment`),
  `lib/companies/service.ts` (new, `getRecentCompanies`), `api/user-sync.js`
  (two action bodies → service calls, using the in-scope verified `uid` + `db`),
  `tests/user-sync-reads.test.ts` (new, 6 tests), `package.json` (format scope
  +`lib/companies`).
- **Behavior preserved:** Yes — exact response shapes: `get_employment` →
  `{ employment: rows }`, `get_recent_cos` → `{ recent: rows }`; same queries
  (`resume_employment …limit=15`, `user_recent_cos …limit=6`); same uid scoping;
  `[]` fallback on DB failure. Used the existing top-level `uid`/`db` (no redundant
  re-resolve). All other 21 actions and every write untouched.
- **Why safe:** pure single-table reads of the caller's OWN data, scoped by the
  verified uid — no writes, no money/credits, no cross-user exposure.
- **Tests/checks run:** typecheck ✅, format ✅, test ✅ (64/64), build ✅,
  check ✅, lint ⚠️ 24 legacy (unchanged, zero new). `api/user-sync.js` also
  confirmed to load under Node (the `.js`→`.ts` imports resolve).
- **Known risks:** Same single open gate as the rest of the branch — the
  `.js`→`.ts` import pattern is unconfirmed on a real Vercel deploy.
- **Deliberately NOT migrated:** `credit_history` / `get_credits` (touch the
  credits/money table + have reset side-effects — need a credits audit), `load`
  (multi-table + credit reset + login-signal write), and every write/destructive
  action. These are STOP-gated.
- **Next safest slice:** owner verifies the Vercel preview; then either continue
  with low-risk writes (`save_job`/`unsave_job`/`log_search_event`) with parity
  tests, or do the credits audit before any credits action.
- **Stop condition hit:** No.

---

## Slice G-1 — Consolidate session-2 user-sync wiring (branch merge)

- **Date/time:** 2026-06-15 ~20:25 UTC
- **Branch:** `claude/seenjobs-architecture-foundation-23bkjm` (merge commit `de8a930`)
- **Slice name:** wagyu: consolidate session-2 user-sync load_profile wiring
- **Goal:** Fold a parallel session's work back onto the single integration branch
  so there is one source of truth. (A second session ran the "next-session" handoff
  prompt and did the `load_profile` wiring this session had deferred.)
- **What was merged (`architecture/auth-helper-tests-and-usersync-prep`, f63867b):**
  - `api/user-sync.js` — `load_profile` action now: `requireUser(req)` →
    `loadProfile(createServiceDb(), uid)`; boundary CORS/rate-limit via foundation.
    Response shape unchanged: `{ profile: rows[0] || null }`. Other 23 actions and
    all writes untouched.
  - `lib/supabase/admin.ts` — `../config/env` → `../config/env.ts` (resolvability
    hardening; no logic change).
  - `tests/user-sync-load-profile.test.ts` — parity test (real handler + minted
    HS256 JWT + mocked fetch).
- **Merge safety:** merge base `c152300`; the two sides touched **disjoint files**
  (session-2: user-sync/admin/test; this branch: the audit docs). Clean `ort` merge,
  no conflicts, no force-push.
- **Behavior preserved:** Yes — verified `load_profile` shape + verified-token
  identity (not request body).
- **Tests/checks run:** typecheck ✅, format ✅, test ✅ (58/58), build ✅,
  check ✅, lint ⚠️ 24 legacy (unchanged, zero new).
- **Result:** PASS. Single consolidated branch; one session continues from here.
- **Known risks:** (1) `load_profile` now re-resolves identity inside the action via
  `requireUser` in addition to the route's top-level auth gate — redundant but
  behavior-equivalent (same verified uid); worth simplifying in a later slice.
  (2) Both `api/demand.js` and the `user-sync` `load_profile` wiring still depend on
  the `.js`→`.ts`-on-Vercel import pattern, **not yet confirmed on a real preview
  deploy** — the single open gate before either is production-ready.
- **Next safest slice:** confirm the Vercel preview (manual, owner) OR continue
  additive work (more read-only user-sync services + parity tests, e.g.
  `get_recent_cos` / `get_employment` / `credit_history`) without wiring.
- **Stop condition hit:** No (consolidation complete; awaiting owner direction).

---

## Slice F-1 — Pre-flight audits: payments, admin, reports (Phase 5)

- **Date/time:** 2026-06-15 ~20:00 UTC
- **Branch:** `claude/seenjobs-architecture-foundation-23bkjm`
- **Slice name:** wagyu: audit payments, admin, reports
- **Goal:** Write the required pre-change audits for the three dangerous areas so
  future migrations there are evidence-based. Pure documentation.
- **Files changed:** `docs/PAYMENTS_AUDIT.md`, `docs/ADMIN_AUDIT.md`,
  `docs/REPORTS_AUDIT.md` (new). No code touched.
- **Behavior preserved:** Yes — docs only.
- **Tests/checks run:** typecheck ✅, format ✅, test ✅ (56/56), build ✅,
  check ✅, lint ⚠️ 24 legacy (unchanged, zero new).
- **Result:** PASS. Each audit documents auth model, endpoints, security
  invariants, risks, a safe (tests-first) migration plan, and STOP conditions.
- **Why this work (not wiring):** the demand Vercel preview is still unverified
  from this environment, so per the plan I did NOT wire any `.ts` code into
  critical user-data routes. Audits are zero-runtime-risk and unblock later work.
- **Concurrency note:** a second Claude session may be working this same branch.
  This slice is isolated to three new files to minimize conflict surface; pushed
  with fetch+rebase (no force-push). See session summary — recommend coordinating
  one-session-per-branch before further slices.
- **Stop condition hit:** Yes — pausing autonomous slicing pending (a) demand
  preview confirmation and (b) concurrency coordination.

---

## Slice E-0 — user-sync inventory + load_profile service (Phase E prep)

- **Date/time:** 2026-06-15 ~20:05 UTC
- **Branch:** `claude/seenjobs-architecture-foundation-23bkjm`
- **Slice name:** wagyu: inventory user-sync + build load_profile service (unwired)
- **Goal:** Map every `api/user-sync.js` action and build the first (lowest-risk)
  read action as a tested service — **without wiring it into the live route yet.**
- **Files changed:** `docs/USER_SYNC_AUDIT.md` (new, inventory of 24 actions),
  `lib/profile/service.ts` (new `loadProfile` service, unwired),
  `tests/profile-service.test.ts` (new), `package.json` (format scope +
  `lib/profile`). `api/user-sync.js` **NOT touched.**
- **Behavior preserved:** Yes — additive only; the live route is byte-for-byte
  unchanged.
- **Tests/checks run:** typecheck ✅, format ✅, test ✅ (56/56), build ✅,
  check ✅, lint ⚠️ 24 legacy (unchanged, zero new).
- **Result:** PASS. `loadProfile(db, uid)` is a faithful port of the `load_profile`
  action (`profiles?id=eq.${uid}&limit=1` → `{ profile: rows[0] || null }`), with
  5 tests proving the query is uid-scoped (ownership) and the response shape.
- **Known risks:** None to runtime — service is not imported by the route.
- **Stop condition hit:** **Yes — deliberate soft stop on wiring.** Wiring the
  `.ts` service into `api/user-sync.js` reuses the `.js`→`.ts` import pattern that
  is **not yet proven on a real Vercel deploy** (the `api/demand.js` preview check,
  Phase A5, is outstanding). Because `user-sync` is the critical user-data route
  (a resolution failure would break ALL sync), wiring is held until the demand
  preview confirms the pattern in a production-like deploy. See
  STOP CONDITIONS / human-review note in the session summary.
- **Next safest slice (after preview is green):** wire `loadProfile` into the
  `load_profile` action behind `requireUser` + `createServiceDb` (or the existing
  `db`), preserving the exact response shape; then proceed down the audit's read
  actions. Do NOT touch `consume_credit`/`earn_credit`/`submit_answer` (money) or
  `delete_account` (destructive) without dedicated, explicitly-approved slices.

---

## Slice D-1 — Auth helper tests (Phase D)

- **Date/time:** 2026-06-15 ~19:55 UTC
- **Branch:** `claude/seenjobs-architecture-foundation-23bkjm`
- **Slice name:** wagyu: add auth helper tests
- **Goal:** Prove the centralized server-auth helpers before any authenticated
  route (user-sync) is migrated. No production behavior change.
- **Files changed:** `tests/auth-server.test.ts` (new); `lib/auth/server.ts`
  (`.ts` import-extension hardening only — behavior-neutral).
- **Behavior preserved:** Yes — additive tests + import-extension hardening.
- **Tests/checks run:** typecheck ✅, format ✅, test ✅ (51/51), build ✅,
  check ✅, lint ⚠️ 24 legacy (unchanged, zero new).
- **Result:** PASS. 11 new tests covering: missing auth rejected; tampered /
  wrong-secret / expired / malformed tokens rejected; valid token accepted; the
  `/auth/v1/user` fallback path; `requireUser` 401 vs success; and the security
  invariant that **identity comes from the verified token, never from
  `body.user_id`**.
- **Known risks:** None. (Admin-blocking and paid/ownership helpers are NOT yet
  implemented in the foundation — see Next slice — so those Phase-D items are
  deferred until those helpers exist.)
- **Next safest slice:** Phase E prep — inventory `api/user-sync.js` actions and
  classify them (read-only / user-owned write / profile / credits / saved jobs /
  applications / resume). Then migrate ONE low-risk read action (e.g.
  `load_profile`) behind `requireUser` + a service, with an ownership test.
  Do NOT migrate writes until ownership rules are proven.
- **Stop condition hit:** No.

---

## Slice B-1 — Foundation helper tests (Phase B)

- **Date/time:** 2026-06-15 ~19:45 UTC
- **Branch:** `claude/seenjobs-architecture-foundation-23bkjm`
- **Slice name:** wagyu: add foundation helper tests
- **Goal:** Lock in the behavior of the foundation layer with unit tests before
  it is wired into more routes. No production code behavior change.
- **Files changed:** `tests/api-response.test.ts`, `tests/security-cors.test.ts`,
  `tests/security-validation.test.ts`, `tests/config-env.test.ts`,
  `tests/security-rateLimit.test.ts` (new); `lib/security/validation.ts`
  (`.ts` import-extension hardening only).
- **Behavior preserved:** Yes — additive tests only, plus behavior-neutral `.ts`
  import-extension hardening on `lib/security/validation.ts` so it is loadable by
  the Node test runner and resolvable from `api/*.js`.
- **Tests/checks run:** typecheck ✅, format ✅, test ✅ (40/40), build ✅,
  check ✅, lint ⚠️ 24 legacy (unchanged, zero new).
- **Result:** PASS. 26 new tests covering response helpers, CORS, validation,
  env access, and rate-limit fail-open.
- **Known risks:** None — no runtime/route behavior touched.
- **Next safest slice:** Auth helper tests (Phase D).
- **Stop condition hit:** No.

---

## Slice A — Verify foundation + demand adoption (Phase A)

- **Date/time:** 2026-06-15 ~19:40 UTC
- **Branch:** `claude/seenjobs-architecture-foundation-23bkjm`
- **Slice name:** wagyu: verify demand foundation adoption
- **Goal:** Confirm the prior foundation PR and `api/demand.js` GET migration are
  sound before moving to riskier routes.
- **Findings:**
  - **A1 Branch/commits:** HEAD `1318c7b` (demand migration) on top of `e843ee3`
    (foundation). Branch pushed and in sync with origin. No commits after the
    demand slice. `main` never touched.
  - **A2 Foundation files exist:** `lib/config/env.ts`, `lib/supabase/{browser,
    server,admin}.ts`, `lib/api/{types,errors,response,handler}.ts`,
    `lib/security/{cors,rateLimit,validation}.ts`, `lib/auth/server.ts` — all
    present and type-checked.
  - **A3 demand migration:** boundary + public GET on the foundation; admin POST
    **byte-for-byte identical** (md5 `caee3dfd87ecf79653ed12a156779c78` in base and
    HEAD). `vercel.json` unchanged; file not renamed.
  - **A4 Local checks:** typecheck ✅, format ✅, test ✅ (14/14), build ✅,
    check ✅, lint ⚠️ 24 legacy issues (unchanged, zero new).
  - **A5 Vercel preview:** **Cannot be verified from this environment** — no Vercel
    API/CLI access and no open PR. Per `CLAUDE.md`, Vercel does not auto-deploy
    claude-authored commits, so a preview must be triggered manually.
  - **A6 Manual preview steps:** see below.
- **Behavior preserved:** Yes (verification only; no code changed in this slice).
- **Result:** PASS locally. Preview confirmation outstanding (manual).
- **Known risks:** One — root `api/*.js` is not built/typechecked by Next locally,
  so Vercel's resolution of the `.ts` foundation imports from a `.js` function is
  only proven by a preview deploy (Node loads it locally, strong but not Vercel
  proof). Fallback if it ever failed: rename `api/demand.js`→`.ts` + update the one
  `vercel.json` functions key.
- **Next safest slice:** Foundation helper tests (Phase B), then auth helper tests
  (Phase D). Do not migrate authenticated routes until those tests exist.
- **Stop condition hit:** No (preview is a documented manual step, not a blocker
  for additive test slices).

### A6 — Manual Vercel preview verification (owner action)

1. Trigger a **Preview** deploy of `claude/seenjobs-architecture-foundation-23bkjm`
   (open a PR with the Vercel Git integration, or `npx vercel` — **not** `--prod`).
2. Vercel dashboard → project → Deployments → the deployment for commit `1318c7b`
   → Visit (a `*.vercel.app` preview URL).
3. `curl -i https://<preview-url>/api/demand`
4. Expect JSON: `{ ok, demand:[{city,urg,src,jobs:[{t,n,l,count,di,note}]}],
   generated_at, bls_period, row_count }` — or the graceful
   `{ ok:true, demand:[], generated_at }` if the preview has no Supabase env.
5. Confirm header `Cache-Control: public, max-age=21600, stale-while-revalidate=86400`.
6. **Failure** = HTTP 500 / `FUNCTION_INVOCATION_FAILED`, a module-resolution error
   in function logs, a missing/changed `Cache-Control`, or a changed JSON shape.
7. Confirm the deployment is a Preview (not Production); no env/settings changes.
