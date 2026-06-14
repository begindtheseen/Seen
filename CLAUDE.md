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

## Migration Status (as of 2026-06-12)

### What was fixed in this session (Session B / claude/seenjobs-migration-audit-pgszu3):
- **Next.js version**: upgraded 15.3.7 → 15.3.9 on next-migration (15.3.7 was flagged vulnerable by npm and blocked by Vercel)
- **package-lock.json**: restored on next-migration (was deleted by Session A, needed for deterministic Vercel builds)
- **api/_utils/credits.js, errlog.js**: added to next-migration (were missing, required by production API files)
- **All api/ files**: synced from main to next-migration (50 commits of production fixes)
- **Supabase migrations 004–012**: added to next-migration (were missing)
- **vercel.json**: updated on next-migration to match production (Reddit crons, reports.js maxDuration 300s)
- **Serverless function cap fix**: `api/parse-resume.js` folded into `api/resume.js` as `action: 'parse'` branch
  - REASON: framework:nextjs adds the Next.js runtime as 1 additional function, pushing total from 12→13 (over limit)
  - FIX: merged parse-resume into resume.js, reducing declared functions from 12→11. Total is now 11+1=12 (at limit)
  - `app/resume/page.tsx` fetch updated: `/api/parse-resume` → `/api/resume` with `{action:'parse', base64, fileName, mimeType}`
- **Build verified**: `npm run build` succeeds — `✓ Compiled successfully`, all 19 pages build, zero TypeScript errors

### Critical Architecture Facts:
- `main` and `next-migration` have NO common git ancestor — they are unrelated histories
- Do NOT run `git merge origin/main` on next-migration — it requires `--allow-unrelated-histories` and will create mass conflicts
- To sync specific changes from main → next-migration: copy individual files with `git show origin/main:path > path`
- Production API files live in `api/*.js` (Vercel serverless), NOT `app/api/` (there are no Next.js App Router API routes yet)
- **Serverless function count: 11 declared + 1 Next.js runtime = 12 total (at plan limit)**
- NEVER add a new api/*.js file without first removing or merging an existing one
- The Next.js runtime itself uses 1 slot because `/company/[slug]` is a dynamic (ƒ) route
- If `/company/[slug]` is ever converted to fully static (no dynamic routing), the Next.js slot goes away and you can have 12 api/*.js again

### Vercel deploy trigger problem (discovered 2026-06-12, Session B):
- **Vercel does NOT create deployments for commits authored by the `claude` bot.**
  Evidence: the only next-migration deployments Vercel ever created were the owner's two
  GitHub web-UI commits (f85fd9c "Update package.json", f9ab769 "Delete package-lock.json").
  Every claude-authored push (Session A's empty "force redeploy" commit, all of Session B's
  pushes) produced NO deployment — not even a failed one.
- Session A hit this same wall and tried a GitHub Actions fallback (`.github/workflows/deploy.yml`,
  `npx vercel --prod --token`). Both runs FAILED: secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`,
  `VERCEL_PROJECT_ID` are NOT configured in the repo. The workflow was then deleted.
- **To trigger a deployment after a claude push, the owner must do ONE of:**
  1. Make any trivial commit to next-migration from their own GitHub account (web UI edit) — Vercel builds the full tree
  2. Create a Vercel Deploy Hook (Project Settings → Git → Deploy Hooks, branch next-migration) and curl it
  3. Add VERCEL_TOKEN / VERCEL_ORG_ID / VERCEL_PROJECT_ID repo secrets and restore an Actions workflow
- `"type": "module"` is set in package.json (fixes Vercel's ESM→CJS compile warning)

### What the next session needs to do:
1. Confirm Vercel picked up the next-migration push and triggered a preview build
2. Verify the preview deployment is green (no vulnerability block, no build errors)
3. Check environment variables are configured in Vercel for the next-migration preview
4. Begin evaluating what Next.js App Router pages need real data connections (currently most pages are ported UI only, calling the same `/api/` endpoints as the HTML version)

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
