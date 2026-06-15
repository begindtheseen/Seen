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
