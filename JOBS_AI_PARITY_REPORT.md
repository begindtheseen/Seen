# Jobs + AI Search System — Parity Report

Audit date: 2026-06-13. Source of truth: `origin/main:index.html`, `origin/main:api/{jobs,job-insights,parse-resume,resume}.js` vs the recovery branch (`claude/seenjobs-next-migration-recovery-ia9w59`).
Read-only audit — **no code modified.**

---

## Executive summary

The **server-side** jobs + AI logic is intact and matches production (same DB-first search flow, query expansion, coalescing, caching, stale fallback, scoring formulas, AI gating). The regressions are in the **Next.js client contract** — two endpoints are called in a way the (unchanged, production-correct) serverless functions reject:

| # | Severity | What | Effect |
|---|----------|------|--------|
| **C1** | 🔴 CRITICAL | `app/jobs/page.tsx` calls `/api/jobs` via **GET `?q=`**; `api/jobs.js` is **POST-only** and reads `body.query` | Every job search → **HTTP 405** → "Search failed." Job search is **entirely broken**. |
| **C2** | 🔴 CRITICAL | `app/resume/page.tsx` calls `/api/resume` **without an `Authorization: Bearer` header**; `gateAI` requires it | Resume parse + optimize → **HTTP 401** "Sign in to use AI features" for all users. Both AI resume features **entirely broken**. |

Both are **migration regressions** (old SPA POSTed `{query}` to `/api/jobs`, and used `_aiHeaders()` to attach the token). Job-insights (job detail) is **already correct** — fixed earlier this session to send the token.

---

## 1. Job search flow

### Original behavior (`origin/main`)
- Client (`index.html:4264/4315/4364`): `fetch('/api/jobs', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ query, location, radius }) })`. No auth (search isn't credit-gated). A pre-fired request (`_prefiredApi`) warms the call.
- Server (`api/jobs.js`, POST-only): **DB-first** → query expansion (`getQueryExpansion`) + keyword fallback in parallel → parallel per-term DB lookups (`jobs?search_query=ilike.&expires_at=gt.now`) → if ≥3 fresh cached rows, return `_src:'cache'` → else **coalesce** concurrent identical searches (`_inflight`) → Claude Haiku web-search (3 attempts, 429/529 backoff) → on rate-limit, serve **stale (expired) cache** → parse/score/sort → **save** to `jobs` with `merge-duplicates` + 7-day `expires_at` → `_logSearch`.
- Fuzzy/related: `getQueryExpansion` (canonical + related terms) and `buildFallbackFilter` (stopword-stripped keyword `ilike`, company-aware) — **not exact-only**.
- Location: `handleLocationJobs` (merged from `fetch-location-jobs.js`) — Adzuna by industry categories, `_normalizeLoc` state-abbrev, radius→km, city-only retry.
- Stale/expired labels: `availability_status` colors (active/stale/expired/removed) shown in admin + job-detail.
- Apply URL: `apply_url || url`.

### Current Next.js behavior
- Server `api/jobs.js`: **identical** flow (POST-only; cache→expansion→coalesce→Claude→stale-fallback→save). `handleLocationJobs` merged in. ✅
- Client `app/jobs/page.tsx`: builds `URLSearchParams({ q, location, radius, niche, level, type, posted })` and does **`fetch('/api/jobs?'+params)` (GET)**. ❌
- Filters (niche/level/type/posted) + sorting (transparency/waste/recent) are applied **client-side** (`applyFilters`/`applySort`) — fine, but moot while search is broken.
- Pagination/loading: search sets `status` loading/done/error with `AbortController`. No infinite scroll (old wasn't either — single batch).

### Status
| Item | Status | Note |
|------|--------|------|
| DB-first search | ✅ server | unchanged |
| Online fallback (Claude web search) | ✅ server | unchanged |
| Save/cache online results | ✅ server | merge-duplicates, 7-day TTL |
| Related/fuzzy matching | ✅ server | expansion + keyword fallback |
| Location handling | ✅ server | Adzuna path merged |
| **Client→server contract** | 🔴 **MISSING** | **GET vs POST-only `query` → 405 (C1)** |
| Filters | ✅ client | not sent to server (client-side filter) — parity-neutral |
| Sorting | ✅ client | transparency/waste/recent |
| Stale/expired labels | 🟡 partial | UI supports it; `/api/jobs` search mapping doesn't surface `availability_status` (dormant) |
| Apply URL | ✅ | `apply_url \|\| url` |

**Files:** `app/jobs/page.tsx` (client, broken), `api/jobs.js` (server, OK), `lib/server/expand.js`, `lib/server/ratelimit.js`.
**Endpoints:** `POST /api/jobs` (search), `POST /api/jobs {action:'location'}` (Adzuna).

---

## 2. AI features

### Resume parsing
- **Original:** `parse-resume.js` (PDF/docx base64 → text), called via `_aiHeaders()` (Bearer token), credit-gated.
- **Current:** merged into `api/resume.js` (`action:'parse'`), POST-only, `gateAI('parse_resume')`. Client `app/resume/page.tsx:165` POSTs **without Authorization header**. ❌
- **Status:** 🔴 **MISSING (C2)** — 401 for all users. Server logic OK; client omits token.

### Resume optimization
- **Original:** `resume.js` (`tool:'optimize'`) — JD-priority + optimized bullets + keywords; `_aiHeaders()`, credit-gated.
- **Current:** `api/resume.js` (`tool:'optimize'`), POST-only, `gateAI('resume_optimize')`. Client `callApi` (`app/resume/page.tsx:191`) POSTs **without Authorization header**. ❌
- **Status:** 🔴 **MISSING (C2)** — 401. Server logic OK; client omits token.

### Job insights
- **Original:** `job-insights.js` — DB cache (7d, shared) → Claude Haiku on miss (1 credit) → L1 localStorage 24h.
- **Current:** `api/job-insights.js` near-identical (+6 lines, import paths). Client `app/jobs/[id]/page.tsx` **correctly attaches Bearer** via `supabase.auth.getSession()` (fixed this session) + L1 localStorage 24h + credits/unavailable fallbacks.
- **Status:** ✅ **COMPLETE**.

### Company scoring
- **Original:** `company-score.js` — `calcScore`/`calcWaste`, web-research via Claude, cache in `company_scores` (TTL), match-confidence candidates.
- **Current:** merged into `api/reports.js` (`action:'company_score'|'research'|'resolve'|'populate'`), `_calcScore`/`_calcWaste` **byte-identical**. **Not** `gateAI`-gated (uses service key) — so the company client correctly needs no token. Clients (`app/report`, `app/company/[slug]`) POST with `action` ✅.
- **Status:** ✅ **COMPLETE** (formulas verified identical; see DATA-PRESERVATION report).

### AI credits / gating
- **Original & current:** `lib/server/credits.js` `gateAI` — requires `Authorization: Bearer`, verifies JWT (or `/auth/v1/user`), checks/decrements credits per feature, respects `ai_credit_system_enabled` flag.
- **Gated endpoints:** only `resume.js` + `job-insights.js`. `jobs.js` and company scoring are NOT credit-gated.
- **Status:** ✅ server gating intact; ❌ resume client doesn't send the token (C2). job-insights client does.

### Cache behavior
- Jobs: DB cache (7d) + per-instance coalescing + stale fallback. Insights: DB (7d) + L1 localStorage (24h). Company: `company_scores` TTL cache. **All intact.** ✅

### Fallbacks when Claude rate-limited
- Jobs: 3 attempts w/ `retry-after` backoff → serve **stale cache** → else 500. ✅
- Insights: 3 attempts → return empty insights (`_src:'api_err'`). ✅
- Resume optimize: 3 attempts → 429 "optimizer is busy". ✅

---

## 3. Protection systems

| System | Status | Evidence |
|--------|--------|----------|
| Rate limits | ✅ | `lib/server/ratelimit.js` `applyRateLimit`/`rateLimit` called in `jobs.js` (job-search, fetch-location-jobs), `resume.js` (parse-resume), `job-insights.js` |
| Request coalescing | ✅ | `jobs.js` `_inflight` Map (`canonical::loc`, 90s TTL) — identical to prod |
| Stale cache fallback | ✅ | `jobs.js` serves expired `jobs` rows on 429/529 before failing |
| No excessive API calls | ✅ | cache-first (≥3 fresh rows short-circuits), coalescing, 7-day TTL, query expansion to maximize cache hits |

All server-side protections are **fully intact**. (They simply aren't being exercised for job search because the client never reaches the function — C1.)

---

## 4. Data preservation

- **No incorrect overwrite of job records:** saves use `Prefer: resolution=merge-duplicates` → re-searched jobs get `expires_at` refreshed, not clobbered; existing rows preserved. ✅
- **No incorrect overwrite of reports:** see DATA-PRESERVATION report — additive only, formulas identical. ✅
- **Cached job results read & reused:** server cache-read logic intact — **but** because the client uses GET (C1), the Next.js app currently **never triggers** the cache-read or the cache-save path. So: existing cached `jobs` rows are **not corrupted**, but they're **not being served or refreshed** through the app. Fixing C1 restores both read and write. ✅ (preserved) / 🟡 (unused until C1 fixed)

---

## Risks

1. **C1/C2 mean two flagship flows are dark in production** (search returns 405, resume AI returns 401) — likely user-visible breakage on the live site right now.
2. Fixing C1 will immediately resume **cache writes** + **Claude/Adzuna spend** — verify rate limits/credits are configured before/at deploy.
3. `availability_status` not surfaced by `/api/jobs` search mapping → stale/expired labels stay dormant on job cards/detail (cosmetic, low).
4. C2 fix must attach the **Supabase access token** the same way the job-detail page does (`supabase.auth.getSession()`); there is **no shared `_aiHeaders()` helper** in the Next.js app — recommend creating one to avoid repeating the bug.

---

## Recommended fix order

1. **C1 — Job search contract (highest impact).** `app/jobs/page.tsx`: change `searchJobs` to `fetch('/api/jobs', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ query, location, radius }) })` (param `query`, not `q`). Keep client-side filters/sort. Verify cache hit/miss + save in logs.
2. **Shared AI auth helper.** Add `lib/aiHeaders.ts` (`supabase.auth.getSession()` → `{ 'Content-Type', Authorization? }`) — the Next.js parity of old `_aiHeaders()`.
3. **C2 — Resume parse + optimize.** `app/resume/page.tsx`: attach the AI auth header (from step 2) to both `/api/resume` calls; handle `credits_required` (sign-in / out-of-credits messaging) like the job-detail page.
4. **(Low) Surface `availability_status`** in the `/api/jobs` result mapping (or search select) so stale/expired labels render on cards + detail.
5. **(Tracking, non-blocking)** persist `responseTimeDays` on app resolve (pipeline `avgRT`); Apply & Optimize modal flow; tracker stage updates/outcome cards.

---

*All findings are code-level (verified against `origin/main` and the current branch). Runtime confirmation (live 405/401) requires a deploy/preview — not performed. No code was modified for this report.*
