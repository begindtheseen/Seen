# MASTER PROJECT STATE — Seen / SeenJobs
*Last updated: 2026-06-14 — Session G: flywheel architecture + admin completions*
*Branch: `next-migration`*

---

## ⚠️ BUSINESS ENGINE PRIORITY (as of Session G)

**`SEENJOBS_BEHAVIORAL_FLYWHEEL.md` is now core product architecture.**

The apply checkpoint, update loop, outcome cards, and credit reward system are NOT optional growth features. They are the data engine that makes SeenJobs valuable. Without them, there is no moat, no virality, no outcome data.

**Next implementation block (Phase 2): Apply Checkpoint MVP**

Files to create:
- `components/ApplyCheckpoint.tsx` — "Did you apply?" modal
- `api/user-sync.js` — add create_application + update_application actions
- `supabase/migrations/016_applications.sql` — applications + application_events tables
- Dashboard reminder cards in `app/dashboard/page.tsx`

Do not start this without reading `SEENJOBS_BEHAVIORAL_FLYWHEEL.md` in full.

---

## CRITICAL: TWO SEPARATE GIT HISTORIES

| Branch | Purpose | Common ancestor? |
|---|---|---|
| `main` / `claude/index-file-stability-LrIfU` | OLD static HTML production site | **NO** |
| `next-migration` + recovery branches | NEW Next.js 15 app (the future) | **NO** |

**NEVER merge `main` into `next-migration` or vice versa. They are incompatible histories.**

Work happens exclusively on `next-migration` or branches from it.

---

## ARCHITECTURE (Next.js App — `next-migration` lineage)

- **Framework**: Next.js 15.3.9, React 19, App Router
- **Auth & DB**: Supabase (anon key public, service_role server-only — NEVER in frontend)
- **Styling**: Custom CSS variables in `app/globals.css` — no Tailwind
- **State**: React Context (`AuthProvider`), localStorage stores (`lib/stores/`)
- **API routes**: `api/*.js` — Vercel serverless functions (plain JS, not Next.js routes)
- **Deploy**: Vercel — `"framework": "nextjs"` in `vercel.json`
- **Function limit**: Vercel Pro = 500 max. Current: 9 declared (parse-resume was merged into resume.js historically — can be split back out if cleaner). No constraint on adding new api/*.js files.

### Directory structure (Next.js app)
```
app/              — Next.js App Router pages
  layout.tsx      — Root layout + AuthProvider + toast
  globals.css     — 857-line CSS from original index.html
  page.tsx        — Landing (/)
  admin/          — Admin dashboard
  companies/      — Company listing
  company/[slug]/ — Company profile
  dashboard/      — Seeker dashboard
  demand/         — Job demand map
  employers/      — Employers page
  faq/            — FAQ (stub)
  feed/           — Community feed
  jobs/           — Job search + /jobs/[id] detail
  legal/          — Legal (stub)
  login/          — Auth
  pricing/        — Pricing
  profile/        — User profile
  report/         — Submit report
  resume/         — Resume + AI tools
  tracker/        — Application tracker

lib/              — Shared utilities
  supabase.ts     — Supabase client singleton
  types.ts        — Shared TypeScript interfaces
  constants.ts    — STAGES, EVENT_TYPES, USAGE_LIMITS
  score.ts        — Scoring engine
  sync.ts         — DB sync proxy
  auth.tsx        — AuthContext + useAuth
  toast.ts        — Toast utility
  usage.ts        — UsageLimits
  aiHeaders.ts    — Shared auth headers for AI calls
  stores/         — AppStore, EventStore, BadgeStore, SavedJobs, ResumeStore, RecentSearches, JobCache

api/              — Vercel serverless functions (plain JS)
  jobs.js         — Job search (POST only)
  job-insights.js — AI job insights
  resume.js       — Resume storage + AI (merged parse-resume)
  apply.js        — Application submission
  admin-stats.js  — Admin dashboard data + all POST actions
  demand.js       — Job demand map data
  refresh-jobs.js — Cron: refresh job listings
  reports.js      — Reddit import pipeline
  user-sync.js    — User profile sync

components/       — Shared React components
types/            — TypeScript types
```

---

## ACTIVE BRANCH

```
next-migration
```

**Status**: Active production branch — seenjobs.io serves from here via Vercel
**Latest commit**: `e95ef21` — visual parity batch (resume results, nav credits, vfeed, scroll-reveal, admin density)
**Build**: ✅ PASSING — 19 routes, 0 TS errors (last verified Session F, 2026-06-14)
**Deployed**: YES — Brandon promotes Vercel previews to production from dashboard

### Build output (19 routes, all passing)
```
/                       (static)
/_not-found             (static)
/admin                  (static)
/companies              (static)
/company/[slug]         (dynamic)
/dashboard              (static)
/demand                 (static)
/employers              (static)
/faq                    (static)
/feed                   (static)
/jobs                   (static)
/jobs/[id]              (dynamic)
/legal                  (static)
/login                  (static)
/pricing                (static)
/profile                (static)
/report                 (static)
/resume                 (static)
/tracker                (static)
```

---

## RECOVERY HISTORY

### Session A (before any Claude context)
- Original static HTML site working in production
- Next.js migration started on `next-migration` branch
- Multiple Vercel preview failures

### Session B (Claude B — recovery)
- Identified and fixed: Next.js 15.3.9 upgrade (CVE blocker)
- Fixed: Function count exceeding Hobby limit (merged parse-resume into resume.js)
- Fixed: Vercel deploy trigger (claude-authored commits don't auto-trigger Vercel)
- Fixed: Hidden page pattern (display:none without .active class)
- Fixed: Admin auth (X-Admin-Token vs Supabase Bearer)
- Fixed: Admin crash (null-safe outcome_breakdown)
- Restored: 16/16 admin sections
- Added: CLAUDE_HANDOFF.md, ADMIN_PARITY_CHECKLIST.md

### Session C (Claude B — recovery continued)
- Ported: Job detail route `/jobs/[id]` + AI insights
- Added: `lib/stores/JobCache.ts`
- Ported: Dashboard alerts panel + checks-due indicator
- Ported: Dashboard survey insight, benchmarks, pipeline insight
- Fixed CRITICAL C1: jobs page was GET, server requires POST → 405 error fixed
- Fixed CRITICAL C2: resume AI missing Authorization header → 401 fixed
- Added: `lib/aiHeaders.ts` shared helper
- Added: SITE_PARITY_CHECKLIST.md, RECOVERY_ROADMAP.md, JOBS_AI_PARITY_REPORT.md

### This session (Claude A — re-bootstrap, stale context correction)
- Was incorrectly working on `claude/index-file-stability-LrIfU` (old static HTML branch)
- Incorrectly: pushed `"framework": null` to old main (low impact — that branch is being replaced)
- Incorrectly: created bad MASTER_PROJECT_STATE.md on old branch (low impact)
- Now: switched to correct recovery branch, verified build passes
- Now: creating this document

---

## PARITY STATUS

### ✅ COMPLETE
| System | Status |
|---|---|
| Admin auth (login/logout/401/403) | ✅ |
| Admin 16/16 sections | ✅ |
| Job detail `/jobs/[id]` + AI insights | ✅ |
| Dashboard alerts + checks-due | ✅ |
| Dashboard benchmarks + pipeline + survey | ✅ |
| Jobs client: GET→POST fix | ✅ |
| Resume AI auth header fix | ✅ |
| Resume results: typed JSON rendering | ✅ |
| Nav credit balance badge (anon-safe) | ✅ |
| VerdictFeed live leaderboard + ticker | ✅ |
| LandingMarketingSections scroll-reveal | ✅ |
| Landing hero mobile text clip fix | ✅ |
| Jobs empty state + Check company link | ✅ |
| Global footer (FAQ, Legal, Pricing, etc) | ✅ |
| Admin KPI mobile 2-col layout fix | ✅ |
| Build (19 routes) | ✅ |

### 🟡 IMPORTANT (remaining)
| Gap | Notes |
|---|---|
| Tracker: outcome flow | `showOutcomeCard`, offer rounds prompt, "I withdrew" |
| Tracker: stage updates on check-in | Interview/Phone Screen stage not updated |
| Admin visual polish | Command-center aesthetics: card density, grid, section spacing, metric color hierarchy |
| Legal/FAQ page content | Stub pages only |
| T3: report page unpaid work labels | Minor copy difference |

**Functional parity estimate: ~95%** | **Visual parity estimate: ~70%**

### ⚪ COSMETIC (post-parity)
- Glow/glass design system
- Framer Motion animations
- 21st.dev components
- Higgsfield MCP
- Mobile layout polish
- Nav active state

---

## DATABASE

Supabase migrations in `/supabase/migrations/`:
- `001_rate_limits.sql`
- `003_demand_data.sql`
- `004_performance_indexes.sql`
- `005_api_errors.sql`
- `006_company_verification.sql`
- `007_user_issues.sql`

**No destructive migrations found** (no DROP TABLE, TRUNCATE, or schema rewrites). Historical data preserved.

---

## DEPLOYMENT PROCESS

Vercel connects to `next-migration` branch via GitHub integration.
**Known issue**: Vercel does NOT auto-trigger on commits authored by "claude" — requires either:
1. Owner to manually trigger redeploy in Vercel dashboard
2. Or use Vercel deploy hook URL (set up separately)

**vercel.json** (on this branch):
- `"framework": "nextjs"` ✅
- 9 serverless functions (Vercel Pro — no meaningful limit)
- Proper cron schedules

---

## ENVIRONMENT VARIABLES (Vercel)

| Var | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public, intentionally exposed |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only, NEVER in frontend |
| `ANTHROPIC_API_KEY` | AI features |
| `ADMIN_EMAIL` | Controls /api/admin-stats access |
| `REDDIT_CLIENT_ID` | Reddit OAuth |
| `REDDIT_CLIENT_SECRET` | Reddit OAuth |

---

## APPLICATION DATA MODEL

Every application must have:
- `id`, `company`, `role`, `city`, `platform`
- `status` (active/ghosted/hired/rejected)
- `stage` (Applied/Screening/Interview/Offer/Rejected/Ghosted)
- `addedAt`, `updatedAt`
- `events[]` — array of hiring events

Event types: `application_submitted`, `response_received`, `assessment_received`, `interview_received`, `interview_completed`, `offer_received`, `rejected`, `ghosted`, `withdrawn`

Every event: `source`, `confidence`, `trust_weight`, `timestamp`, `anomaly_flags`

---

## WORKFLOW RULES

1. No coding until docs are read
2. No merging without owner approval
3. No deploying without owner approval
4. Prefer modifying existing endpoints — avoid new API function files
5. Keep helpers outside `/api/` (use `lib/`)
6. Build must pass before every commit (`npm run build`)
7. Small commits only
8. Update MASTER_PROJECT_STATE.md + CLAUDE_HANDOFF.md every session
9. Repository docs override memory

---

## DO NOT

- Merge `main` into `next-migration` (incompatible histories)
- Push to `claude/index-file-stability-LrIfU` or `main` (old static HTML app)
- Add api/*.js files carelessly without considering the clean separation of concerns (but the 12-function cap is NOT a constraint — Vercel Pro allows 500)
- Put service_role key in any frontend/client code
- Start new features before parity is complete
