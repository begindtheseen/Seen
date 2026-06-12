# Claude Handoff — Seen / SeenJobs

Last updated: 2026-06-12 (Session B, post-launch)

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
