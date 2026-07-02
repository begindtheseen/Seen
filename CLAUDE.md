# Seen — Claude Code Instructions

## North Star
Read SEEN_STRATEGY.md at the start of every session. That document is the product strategy.
Every code change must serve the strategy. When in doubt, re-read it.

## Core Mission
Build Seen as a hiring intelligence platform where the application tracker is the primary data acquisition engine, outcome cards drive virality, and trust/confidence systems keep data quality high.

## Active Development Branch
- Migration work is on: `next-migration`
- `main` is the OLD production HTML app — now the SOURCE OF TRUTH for design/functionality parity. DO NOT merge into main, DO NOT push to main, DO NOT delete it.
- **seenjobs.io now serves the Next.js app from next-migration** (deployed via Vercel CLI from owner's Mac)

## MISSION HISTORY: parity restoration is DONE — feature/growth era since 2026-06-30
The "full parity restoration" mission (2026-06-12 → ~06-23) is complete. Since 2026-06-30
the work has been feature, growth, monetization, and reliability development on
`next-migration` — 50 PRs (#75–#124) landed 2026-06-30 → 07-02. The landing page (PR #77)
and dashboard (PRs #122/#123) were intentionally REDESIGNED beyond the old site; do NOT
"restore" them back to `origin/main` parity. `origin/main` remains useful history but is no
longer the design source of truth for redesigned pages. `SITE_PARITY_CHECKLIST.md` /
`ADMIN_PARITY_CHECKLIST.md` are frozen pre-06-30 records, not an active work queue.

## Session 2026-07-02 B (claude/codebase-review-o344hb): review + merge of PR #124

- Full independent review of PR #124 (all 31 files read, build + 44/44 tests re-run
  locally, claims traced to code). Verdict: solid; merged as squash `7e2b274`.
- **Discovery: production had been running the PR #124 preview build since ~03:46 UTC
  (promoted via Vercel) while the PR sat unmerged** — merging closed the git/prod
  divergence. Lesson recorded: if a preview is promoted to production, merge the PR
  immediately, or the next unrelated merge to next-migration will silently roll prod back.
- Live-site audit of seenjobs.io: all 19 routes 200 with correct SSR titles;
  /company/coca-cola resolves (hyphenated-slug fix verified live); /api/jobs,
  batch_scores, demand, leaderboard, feed, sitemap, llms.txt all healthy.
- Added migration 037: codifies the 2026-07-02 hand-applied prod schema repairs
  (applications.events jsonb; job_id uuid→text + FK drop) idempotently — prod already
  matches; this is for fresh/restored environments.
- Fixed a follow-up gap in the PR #124 permalink fix: freshly-aggregated search results
  and nearestListings fallbacks still returned id:null (verified live — 49/49 results).
  aggregateForQuery now stitches upsert-returned DB ids/created_at back onto results;
  nearestListings selects id,created_at and maps posted_at.
- Restored the \x00 (NUL) strip in pdfText.js cleanupText (Postgres text columns reject
  NULs) alongside the newer \xa0→space normalize.

## Session 2026-07-02 A (PR #124): full-app audit — corrects older notes below

Six parallel audits swept every frontend→API contract, data round-trip, page flow, cron,
and import graph; 30 confirmed breaks fixed. Ground truth established this session:

- **`applications` schema (prod, verified by SQL)**: has `events jsonb` (added 2026-07-02 —
  its absence had been 400ing the tracker `load` for every signed-in user), `job_id` is
  **text** (was uuid + unusable FK), `applied_at` exists. `add_application` persists
  job_id/applied_at/events; the `load` select returns them.
- **Credits gate lives at `lib/server/credits.js`** — the `api/_utils/credits.js` path in
  the Session B notes below does NOT exist. `api/_utils/` holds companyIntel/companyScore/
  reportWrite/resumeSurvey/opportunityEngine.
- **Auth pattern**: `useAuth()` exposes `ready`. Any page that redirects on `!isLoggedIn`
  MUST wait for `ready` first, or it bounces signed-in deep-links while the session loads.
- **Sign-out data isolation**: `lib/auth.tsx` clears SESSION_LOCAL_KEYS (applications,
  saved, events, recent-cos, …) on SIGNED_OUT. Never re-introduce auto-import of
  device-local data into a signed-in account — that was the cross-user bleed vector.
- **Company slugs**: ONE scheme everywhere — `encodeURIComponent(name.toLowerCase()
  .replace(/\s+/g,'-'))`, decoded by /company/[slug] as decodeURIComponent + hyphens→spaces.
  Server name lookups in api/reports.js have a token-wildcard fallback for hyphenated names.
  Do not add punctuation-stripping slug functions.
- **Scoring weights** (api/_utils/companyIntel.js SOURCE_TRUST): direct 1.0 · survey
  (seen_intel) 1.0 · ingest 0.55 · reddit 0.3 · web prior 0.5. Fusion classifies by
  `platform` string, not the stored `source` column. Survey/report writes trigger
  recomputeCompanyScoreFromReports (reportWrite.js) so the company page updates instantly.
- **Vercel crons fire as GET** — any cron handler must route GET (x-vercel-cron header)
  into its refresh logic (see api/demand.js and api/reports.js patterns).
- **Stripe**: api/stripe.js disables the body parser and reads the raw stream (webhook
  HMAC needs the exact signed bytes); subscription reads must NOT use expand[]=items
  (invalid — 502'd all subscription management until 2026-07-02).
- **PDF extraction** (lib/server/pdfText.js): parses ToUnicode CMaps for subset fonts;
  looksLikeGarbledText() gates unreadable extractions with an honest 422.
- **Résumé employment parser** (lib/server/resumeAnalysis.js): COMMON_TITLE_WORDS must
  stay \b-anchored; company = single segment, cleaned by cleanCompany(). Tests:
  `node --test lib/server/*.test.mjs api/_utils/*.test.mjs` (44 tests — keep green).
- Remaining manual dashboard item: enable Auth leaked-password protection (HaveIBeenPwned).
- Deferred (known, acceptable): EventStore check-in ledger is device-local only (re-prompts
  on a new device); RLS-no-policy INFO lints are intentional (server-only tables).

## Migration Status (as of 2026-06-14 — HISTORICAL; see sessions above for current state)

### What was fixed in Session G (claude/index-file-stability-LrIfU):
- **HiringProbability component**: new `components/HiringProbability.tsx` — compact/full modes, calculates 3–70% probability from ghost/response rates + level match multiplier
- **SurveyModal component**: new `components/SurveyModal.tsx` — 4-phase survey (loading→intro→question→done/no-surveys), Zeigarnik effect, credit pop animation, dispatches `seen:credits-updated` event
- **Nav.tsx**: credit balance auto-refreshes on `seen:credits-updated` event via `useCallback` + `window.addEventListener`
- **company/[slug]/page.tsx**: Locations tab shows real city breakdown, Compare tab is functional, viewer count is stable hash (not random)
- **apply/page.tsx**: handleNotYetReason shows company risk intel when reason is comparing/unsure
- **admin/page.tsx**: 2-column KPI grid, colored left borders on cards, large numbers, section labels, build SHA stamp, DeployPanel
- **vercel.json**: Cache-Control no-store on /admin and /admin/(.*) to prevent stale CDN caching
- **DeployPanel in admin**: paste Vercel Deploy Hook URL once → deploy from admin UI going forward

### What was fixed in Session B (claude/seenjobs-migration-audit-pgszu3):
- **Next.js version**: upgraded 15.3.7 → 15.3.9 on next-migration (15.3.7 was flagged vulnerable by npm and blocked by Vercel)
- **package-lock.json**: restored on next-migration (was deleted by Session A, needed for deterministic Vercel builds)
- **api/_utils/credits.js, errlog.js**: added to next-migration (were missing, required by production API files)
- **All api/ files**: synced from main to next-migration (50 commits of production fixes)
- **Supabase migrations 004–012**: added to next-migration (were missing)
- **vercel.json**: updated on next-migration to match production (Reddit crons, reports.js maxDuration 300s)
- **parse-resume history**: `api/parse-resume.js` was merged into `api/resume.js` as `action:'parse'` branch — this was done under an incorrect assumption of Vercel Hobby 12-function limit. We are on **Vercel Pro (500 functions)**. Can be split back out any time.
  - `app/resume/page.tsx` currently calls `/api/resume` with `{action:'parse', base64, fileName, mimeType}`
- **Build verified**: `npm run build` succeeds — `✓ Compiled successfully`, all 19 pages build, zero TypeScript errors

### Critical Architecture Facts:
- `main` and `next-migration` have NO common git ancestor — they are unrelated histories
- Do NOT run `git merge origin/main` on next-migration — it requires `--allow-unrelated-histories` and will create mass conflicts
- To sync specific changes from main → next-migration: copy individual files with `git show origin/main:path > path`
- Production API files live in `api/*.js` (Vercel serverless), NOT `app/api/` (there are no Next.js App Router API routes yet)
- **Vercel Pro — 500 serverless function limit. No constraint on adding new api/*.js files.**
- Currently 9 declared api/*.js functions. Add new ones freely as needed.

### Vercel deploy: RESOLVED — auto-deploys are working (updated 2026-06-30):
- The old "Vercel won't build claude-authored commits" problem (2026-06-12, Session B) is
  **no longer true.** Vercel is now fully connected to the GitHub repo: every PR gets a
  preview deployment, and **merging to `next-migration` auto-deploys to production
  (seenjobs.io)** with no manual step. Do NOT tell the owner to manually trigger deploys —
  merging the PR is the deploy.
- Evidence: in the 2026-06-30 session, PRs #82–#87 each produced a green Vercel preview
  ("Ready/DEPLOYED" status checks) and the owner confirmed merged changes were live on the site.
- `"type": "module"` is set in package.json (fixes Vercel's ESM→CJS compile warning)
- Only genuinely-manual items left are dashboard settings, not deploys: e.g. confirming the
  Stripe webhook endpoint subscribes to the events the code handles
  (`customer.subscription.updated` for the trial flow), and Supabase migrations applied via
  the Supabase MCP `apply_migration`.

## Architecture
- **Framework**: Next.js 15.3.9 with React 19, App Router — MIGRATION IN PROGRESS
- **Current production**: Still running from `main` (HTML/JS single-page app with Vercel serverless)
- **API**: Vercel serverless functions in `api/*.js` — NOT `app/api/` (no App Router API routes exist yet)
- **Auth & DB**: Supabase (anon key is public, service key is server-only — NEVER in frontend)
- **Styling**: Custom CSS variables in app/globals.css — no Tailwind
- **State**: React Context (auth), localStorage stores (apps, saved jobs)
- **Deploy**: Vercel

## Code Principles
- Don't make rushed changes. Do it correctly the first time.
- No half-finished implementations.
- No backwards-compatibility hacks.
- Security: service_role key NEVER in frontend. anon key is intentionally public.
- `ADMIN_EMAIL` env var controls /api/admin-stats access.

## Application Data Model
Every application must have:
- `id`, `company`, `role`, `city`, `platform`
- `status` (active/ghosted/hired/rejected)
- `stage` (Applied/Screening/Interview/Offer/Rejected/Ghosted)
- `addedAt`, `updatedAt`
- `events[]` — array of hiring events (see Event System in SEEN_STRATEGY.md)

## Event System (Critical)
Store event history, NOT just status changes:
```
application_submitted, response_received, assessment_received,
interview_received, interview_completed, offer_received,
rejected, ghosted, withdrawn
```

## Follow-Up System
- Day 7: "Did they respond?" [Yes/No]
- Day 14: "Got an interview?" [Yes/No]
- Day 30: "What happened?" [Offer/Rejected/Ghosted/Still Active]

## Anti-Gaming
- Treat submissions as CLAIMS, not facts
- Every event needs: source, confidence, trust_weight, timestamp, anomaly_flags
- Never present weak data as fact — use confidence labels

## Session Continuity
Before starting any session:
1. Run `git status` to see current state
2. Read SEEN_STRATEGY.md
3. Pick up exactly where previous session left off
