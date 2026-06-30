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

## CURRENT MISSION: Full parity restoration (as of 2026-06-12 evening)
We are NOT adding features. The Next.js migration lost design and functionality vs the old site.
- Read `CLAUDE_HANDOFF.md` for deployment workflow + constraints
- Work through `SITE_PARITY_CHECKLIST.md` and `ADMIN_PARITY_CHECKLIST.md` page by page
- Source of truth: `origin/main:index.html` and `origin/main:employer.html` (extract with `git show origin/main:index.html`)
- Do not redesign, simplify, or invent UI. Port the old design exactly.
- A page is complete only when: visual match + all old functionality + APIs work + mobile works + build passes + checklist updated.

## Migration Status (as of 2026-06-14)

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
