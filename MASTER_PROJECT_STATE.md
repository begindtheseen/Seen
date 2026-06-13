# MASTER PROJECT STATE
*Last updated: 2026-06-13 — Claude A bootstrap*

---

## CRITICAL: ARCHITECTURE MISMATCH

CLAUDE.md says "Framework: Next.js 15 with React 19, App Router" — **THIS IS WRONG.**

The actual deployed codebase is a **monolithic static HTML site** with Vercel serverless functions.

| What CLAUDE.md says | What actually exists |
|---|---|
| Next.js 15 / React 19 | Single `index.html` (13,354 lines) |
| App Router (`app/api/*.ts`) | Vercel serverless (`api/*.js`) |
| `app/globals.css` | Inline CSS in index.html |
| TypeScript | Plain JavaScript |

The Next.js migration (`next-migration` branch) was started by a previous session, never successfully deployed, and the PR (#35) was closed on 2026-06-12. **The migration is abandoned.** No Next.js code is in production.

---

## CURRENT STATE

### Branch
```
Active:  claude/index-file-stability-LrIfU  (= remote/main, fully synced)
Latest:  05d00ec — Remove GitHub Actions deploy workflow
```

### What's Deployed (Production)
- Static HTML app: `index.html` (seeker dashboard, all features)
- Static HTML: `employer.html` (employer-facing)
- 13 Vercel serverless functions in `/api/`
- No build step — Vercel serves files as-is

### Vercel Deployment Status: **BROKEN**
- Vercel is not responding to GitHub pushes
- Root cause: Unknown — could be framework preset set to "Next.js" in Vercel project settings
- What was done: Added `"framework": null` to `vercel.json` (should fix if Vercel picks it up)
- What's needed: Owner must go to vercel.com → seen project → Settings → General → Framework Preset → set to "Other" → Redeploy
- GitHub Actions fallback: Removed (was failing due to missing VERCEL_TOKEN secret)

---

## WHAT EXISTS IN PRODUCTION

### index.html (the entire app)
A 13,354-line monolithic file containing:
- Auth (Supabase anon key, Google OAuth)
- Application tracker (add/edit/delete applications)
- Job search (via `/api/jobs.js`)
- Company score modal (via `/api/company-score.js`)
- Resume upload and AI parsing (via `/api/parse-resume.js` + `/api/resume.js`)
- Admin dashboard (via `/api/admin-stats.js`)
- Saved jobs
- Follow-up system UI (Day 7 / 14 / 30 prompts)
- Outcome card UI

### API Functions (`/api/`)
| File | Purpose |
|---|---|
| `jobs.js` | Job listings from DB |
| `company-score.js` | AI company score (Claude) |
| `job-insights.js` | AI job insights |
| `admin-stats.js` | Admin dashboard data |
| `apply.js` | Application submission |
| `demand.js` | Job demand map data |
| `fetch-location-jobs.js` | Location-based job fetch |
| `parse-resume.js` | AI resume parsing |
| `resume.js` | Resume storage |
| `refresh-jobs.js` | Cron job: refresh job listings |
| `reports.js` | Reddit import pipeline |
| `user-sync.js` | User profile sync to Supabase |
| `_utils/` | Shared: credits, errlog, expand, merge, ratelimit |

### Database (Supabase)
Migrations in `/supabase/migrations/`:
- `001_rate_limits.sql`
- `003_demand_data.sql`
- `004_performance_indexes.sql`
- `005_api_errors.sql`
- `006_company_verification.sql`
- `007_user_issues.sql`

---

## PARITY GAPS (Priority Order)

### P0 — Deployment Broken
Vercel not deploying. User must fix in Vercel dashboard:
1. vercel.com → seen project → Settings → General → Framework Preset → "Other"
2. Trigger manual redeploy
*Cannot be fixed by Claude — requires owner dashboard access.*

### P1 — CLAUDE.md Architecture Lie
CLAUDE.md describes a Next.js app that doesn't exist. Any future Claude instance reading it will be confused and may attempt to build Next.js components that have no runtime.
**Fix: Update CLAUDE.md to describe the actual static HTML architecture.**
*Requires approval before changing.*

### P2 — Application Data Model Not Implemented
CLAUDE.md and SEEN_STRATEGY.md describe a full event system with `events[]`, trust scores, confidence fields. The actual `index.html` stores applications in localStorage with a simplified model. The full event system (`application_submitted`, `response_received`, etc.) exists in the UI but may not be fully wired to Supabase.
*Needs audit of actual localStorage schema vs. strategy spec.*

### P3 — Follow-Up System Exists in UI but Outcome Pipeline Incomplete
Day 7/14/30 check-ins are present. Outcome cards are partially built. Full viral share flow and confidence labels need verification.

### P4 — No CLAUDE_HANDOFF.md exists yet
*(Creating alongside this file.)*

---

## WHAT WAS DONE THIS SESSION

1. Found: Vercel failing due to Next.js vulnerability detection
2. Added `"framework": null` to `vercel.json` — pushed to main
3. Found: GitHub Actions workflow failing (missing VERCEL_TOKEN secret)
4. Deleted GitHub Actions workflow (it was adding noise, not helping)
5. Closed PR #35 (dead Next.js migration — 14 commits, all failed Vercel preview)
6. Deployment still broken — requires Vercel dashboard fix by owner

---

## BRANCHES

| Branch | State | Notes |
|---|---|---|
| `claude/index-file-stability-LrIfU` | Active, synced | = production main |
| `main` (remote) | Synced | Same as above |
| `next-migration` | Stale, PR closed | Abandoned Next.js attempt |
| `fix/job-modal-clean` | Behind 268 | Stale, likely abandon |

---

## ENV VARS REQUIRED

| Var | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel | Public, intentionally exposed |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel | Server-only, NEVER in frontend |
| `ANTHROPIC_API_KEY` | Vercel | AI features |
| `ADMIN_EMAIL` | Vercel | Controls /api/admin-stats access |
| `REDDIT_CLIENT_ID` | Vercel | Reddit OAuth for reports pipeline |
| `REDDIT_CLIENT_SECRET` | Vercel | Reddit OAuth |

---

## DO NOT

- Do not attempt to build Next.js components — there is no Next.js runtime in production
- Do not push to `next-migration` branch
- Do not merge `fix/job-modal-clean` without rebasing
- Do not add new features until Vercel deployment is confirmed working
- Do not touch CLAUDE.md architecture section without explicit user approval
