# Claude Handoff — Seen / SeenJobs

Last updated: 2026-06-13 (Session C, recovery)

## Active recovery branch: `claude/seenjobs-next-migration-recovery-ia9w59`

- Branched from `origin/next-migration`. **Ahead by 2 commits, behind by 0.**
- NOT yet merged into `next-migration`. NOT yet deployed. Awaiting owner review.
- `RECOVERY_ROADMAP.md` (new) drives the work: CRITICAL / IMPORTANT / COSMETIC, Phases 1–4.
- `SITE_PARITY_CHECKLIST.md` (new) tracks all 19 pages/components.

### Recovery commits so far
1. `Phase 1 admin recovery: GET payload, auth fixes, 6 new sections`
   - `api/admin-stats.js`: GET now returns `reports.chart` (30d daily), `reports.top_companies`,
     `reports.outcome_breakdown`, `company_lookups.top` — all were missing (live regression).
   - `app/admin/page.tsx`: `admin_logout` POST on sign-out; 403 handling; Jobs KPI row;
     company-lookup setup note; Recent hiring reports + ✓/?/✗ moderation; Recent tracker apps;
     API Health panel; chart date labels; zero-value outcome bars filtered.
2. `Sync package-lock.json version to 0.1.1`

### Admin sections — ALL 16 PORTED ✅ (see ADMIN_PARITY_CHECKLIST.md)
- ✅ §1 Header, §2 KPI boxes, §3 Jobs KPI, §4 setup note (earlier commits)
- ✅ §5 chart/top/outcomes (+ API GET payload restored), §6 recent reports + moderation, §7 recent apps, §14 API health (earlier commits)
- ✅ §10 Data quality issues queue (resolve/dismiss)
- ✅ §9 Reported inactive listings (remove_listing/deny_report + confirm)
- ✅ §8 Recent jobs browser (period tabs, get_recent_jobs; lazy load, 401/403 re-login)
- ✅ §12 Feature flags (set_flag/seed_flags; optimistic select, seed defaults)
- ✅ §13 Duplicate account clusters (update_cluster/detect_duplicates_by_signals)
- ✅ §11 Company deduplication (find_duplicates/merge/auto_merge) — **API contract drift resolved**: merge accepts names OR ids + returns merged_report_count; auto_merge returns groups again. Wired §10 "Open in merge tool" prefill.
- ✅ §15 Background job runner (X-Admin-Token → /api/refresh-jobs, /api/demand, /api/reports) — endpoints verified to accept X-Admin-Token

**MILESTONE: Admin parity 16/16 sections functionally complete.** Auth (login/logout/401/403) complete.
Remaining admin work is cosmetic/optional only: §2 minor (`ready:false` N/A — done), §16 (credits/set_pro/audit viewer — API-only, missing in old too, NOT a parity blocker).

### Preview-deploy readiness (as of admin milestone)
- **Safe for PREVIEW?** Yes — `npm run build` passes (19 routes); all admin changes are additive;
  the one API change (`admin-stats.js`) only ADDS GET fields + widens `merge` input (back-compatible).
  No user-facing page was modified in the admin sprint. Do NOT promote to production without owner sign-off.
- **Risks remaining:** admin sections are code-verified but NOT runtime-tested against a live admin
  session + Supabase (no creds in this env). Need to confirm: login bootstrap, X-Admin-Token round-trip,
  each POST action against real tables, reddit_import sequential calls, and that the restored GET
  aggregations match real data volumes (chart query caps at 2000 rows / 30d; top_searched at 500).
- **Admin functionality still needing live testing:** all 16 sections end-to-end, especially
  destructive/role-gated ones (merge, remove_listing, set_flag, detect_duplicates, job runners).
- **User-facing parity NOT yet restored** (next phase): Job detail route + AI insights (still missing),
  plus the page-by-page audit in SITE_PARITY_CHECKLIST.md (most pages 🟡 unverified).

### Job detail route + AI insights — ✅ PORTED
- NEW `app/jobs/[id]/page.tsx` (parity of old `page-job-detail` + `openJobListing`):
  header, AI insights ("WHAT {CO} IS HIRING FOR"), AI/raw description, report placeholder,
  sticky footer (Check company → /company/[slug], Save, external Apply), back button.
- NEW `lib/stores/JobCache.ts` — sessionStorage cache = Next.js equivalent of old global `JOBS`.
- `app/jobs/page.tsx`: stores results in JobCache; cards route to `/jobs/[id]` (click + "View details" link).
- `lib/types.ts`: promoted shared `Job` interface (was local to jobs page).
- AI: `/api/job-insights` unchanged; Bearer token via `supabase.auth.getSession()`; L1 localStorage 24h.
- CSS note: used inline `minHeight:100vh; paddingTop:58` (NOT `className="page"`, which is `display:none`
  without `.active` — see globals.css:114). Fixed footer bg `--bg`(nonexistent)→`--ink`.
- **Follow-up parity items:** (1) `Apply & Optimize` keeps external link — resume-optimize modal flow
  (`openApplyModal`) not yet ported; (2) Tier A quick-preview modal intentionally skipped;
  (3) `/api/jobs` doesn't surface `availability_status`, so stale/expired warnings stay dormant.

### Dashboard alerts/follow-ups — ✅ PORTED (this commit)
- `app/dashboard/page.tsx` only. Added: "N checks due →" indicator in greeting → /tracker
  (reads `EventStore.dueChecks(apps)`); dynamic Alerts panel replacing the static placeholder —
  stale apps (flat >30d threshold, top 3, → /tracker) + ghost-surge alerts (anon `supabase`
  read of public `reports`, ≥3 ghosted/7d for tracked companies, → /company/[slug], graceful
  RLS/empty fallback to stale-only) + red count badge + "All clear ✓" empty state. Kept the
  existing "Pro" email-alerts upsell footer row. No API/serverless changes.
- NOTE: the Day 7/14/30 follow-up Q&A *prompts* were already ported in the **tracker**
  (`app/tracker/page.tsx` CheckCard/handleCheckAnswer) — this task was the dashboard surfacing.
- Follow-up gaps (tracker-side, tracked): tracker `handleCheckAnswer` omits old stage updates
  (Interview/Phone Screen), the viral `showOutcomeCard`, offer `_showRoundsPrompt`, and the
  "↩ I withdrew" outcome option.

### Dashboard insights — ✅ PORTED (this commit)
- `app/dashboard/page.tsx` only. Added 3 panels (parity of index.html 9272/9355/9516):
  - `dashSurveyInsight`: green "✓ {feature} on" card from `profile.onboarding_survey.frustration`
    (5 mappings: ghosting/fake/salary/rounds/all). Hidden if no frustration key.
  - `dashBenchmarks`: "Career Benchmarks" 2×2 grid (Response/Interview/Offer/Ghost rate vs
    industry AVG {22,10,4,55}, percentile + color). Gated n≥3 && terminal≥2. Pure local.
  - `dashPipelineInsight`: "Your pipeline" band (checks due → / overdue / personal RR /
    ghosted / hired). Gated apps≥2. **avgRT OMITTED** (responseTimeDays not tracked);
    overdue uses flat >33d (no COS client data).
- No API/serverless/store changes.
- DASHBOARD PARITY NOW 🟢 (alerts + checks-due + survey + benchmarks + pipeline all done).

### Dashboard follow-up gaps (tracked, not blocking)
- Account settings (⚙ `openAccountSettings`) — not yet present.
- Persist `responseTimeDays` on app resolve → unlocks pipeline `avgRT` "avg response: Nd".
- Tracker `handleCheckAnswer`: old stage updates (Interview/Phone Screen), `showOutcomeCard`,
  offer `_showRoundsPrompt`, "↩ I withdrew" option.

### Next up (SITE_PARITY_CHECKLIST.md — Phase 2 IMPORTANT)
- Legal page completeness; account settings
- Per-page functional audit (jobs filters/sort, tracker, company, feed, report, resume,
  demand, profile, employer.html — most pages 🟡 unverified)

### Working agreement this session
- Admin parity only, one section at a time, small commits.
- Before each section: name old section, source lines, files, API endpoints, risk.
- After each section: `npm run build`, update ADMIN_PARITY_CHECKLIST.md + this file, commit.
- Do NOT merge into next-migration. Do NOT deploy. Owner reviews first.

## Current state (verified)

- **seenjobs.io is LIVE on the Next.js app** deployed from `next-migration` via Vercel CLI (`npx vercel --prod` from the owner's Mac).
- Old production (`main`, HTML SPA) is no longer what's serving seenjobs.io — but `main` remains the **source of truth for design and functionality**. DO NOT delete or modify `main`.
- The migration is **technically deployed but NOT at feature/design parity** with the old site. Restoring full parity is the current mission.

## The mission: FULL PARITY restoration

We are NOT adding features. Every page must match old production exactly:
- Source of truth: `origin/main:index.html`, `origin/main:employer.html`, `origin/main:api/*`
- Parity tracking: `SITE_PARITY_CHECKLIST.md` and `ADMIN_PARITY_CHECKLIST.md` (in repo root)
- Update the checklists as pages are completed. A page is complete ONLY when:
  visual match + all old functionality + working API calls + mobile layout + `npm run build` passes.

## Deployment workflow (IMPORTANT — hard-won knowledge)

Vercel does NOT create deployments for commits authored by the `claude` bot.
GitHub web-UI dummy commits are an emergency fallback only. The working flow:

1. Claude edits code, runs `npm run build` (must pass)
2. Claude commits and pushes to `next-migration`
3. Trigger deploy ONE of two ways:
   - Deploy hook (preview of latest next-migration commit):
     `curl -X POST "https://api.vercel.com/v1/integrations/deploy/prj_P2SoPxsy9RpdoJfVUqqg6RslWXV5/6kpPtZBS1w"`
     NOTE: this returned PENDING but produced no visible deployment once — verify in dashboard; may need recreating for the right branch.
   - Owner runs on their Mac (the reliable path):
     ```
     cd ~/Seen && git pull origin next-migration && npx vercel        # preview
     npx vercel --prod                                               # production, only after preview verified
     ```
4. NEVER deploy to production without owner verifying the preview first.

## Vercel constraints (Hobby plan)

- **Max 12 serverless functions.** Current: 9 declared api/*.js + 1 Next.js runtime (= /company/[slug] dynamic route) = 10 total. Keep it ≤ 10–11.
- NEVER add a new `api/*.js` file without merging/removing another.
- Merged endpoints (client must use these):
  - `parse-resume` → `POST /api/resume` with `{action:'parse', base64, fileName, mimeType}`
  - `company-score` → `POST /api/reports` (action: company_score | research | resolve | populate, or body.name)
  - `fetch-location-jobs` → `POST /api/jobs` (action: location, or body.location without body.query)
- Server helpers live in `lib/server/` (NOT `api/_utils/` — moved to avoid function counting).
- Cron expressions in vercel.json must have exactly 5 single-space-separated fields (double spaces break `vercel` CLI validation).

## Git facts

- `main` and `next-migration` have NO common ancestor. Never merge between them.
  Sync individual files: `git show origin/main:path > path`.
- Owner's Mac has a clone at `~/Seen` tracking next-migration; Vercel CLI is linked to project `begindtheseens-projects/seen`.

## Admin notes

- Admin auth is username/password → `POST /api/admin-stats {action:'admin_login'}` → returns token used as `X-Admin-Token` header. NOT Supabase auth.
- First login bootstraps the account from `ADMIN_USERNAME` / `ADMIN_PASSWORD` Vercel env vars.
- The current `app/admin/page.tsx` is a minimal port (login + stats). The old admin had ~10 more tools — see ADMIN_PARITY_CHECKLIST.md.

## Recent fixes already shipped (don't redo)

- Next.js 15.3.9 (vulnerability fix), `"type": "module"` in package.json, package-lock.json restored
- Serverless function reduction 13 → 10 (see merged endpoints above)
- Homepage `display:none` bug: `.page-full` CSS no longer needs `.active` class
- Admin page crash: null-safe `outcome_breakdown` access
