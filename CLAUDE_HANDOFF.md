# Seen — Claude Handoff


> **Read this first. Every session. No exceptions.**
> Then read SEEN_STRATEGY.md. Then `git status`. Then pick up exactly where this doc ends.

Last updated: **2026-06-14 (Session G — Flywheel)**

---

## ⚠️ PRIORITY SHIFT — READ THIS FIRST

**SEENJOBS_BEHAVIORAL_FLYWHEEL.md now exists and is CORE BUSINESS ARCHITECTURE.**

The flywheel document defines the apply checkpoint, update loop, outcome card system, credit rewards, and Pro conversion. It is not a marketing idea. It is the data engine that makes SeenJobs valuable long-term.

**Before starting any session, read:**
1. This file
2. `SEEN_STRATEGY.md`
3. `SEENJOBS_BEHAVIORAL_FLYWHEEL.md` (new — session G)
4. `git status`

**Current implementation priority order:**
1. ~~Parity restoration~~ — functional parity is ~95% done
2. **Flywheel Phase 2: Apply Checkpoint MVP** — the critical missing loop
3. Visual parity remaining items (tracker handleCheckAnswer, minor gaps)

---

## Current reality

- **seenjobs.io is LIVE** on the Next.js app, deployed from `next-migration` via Vercel
- `main` = old HTML SPA. Source of truth for design parity. **Never touch it.**
- Active branch: `next-migration` — push here, Vercel auto-builds a preview
- Brandon promotes previews to production from the Vercel dashboard
- Mission: **apply checkpoint + flywheel loop + outcome cards** (parity is ~done)

---

## What Session G shipped (latest push, branch `next-migration`)

| Commit | What shipped |
|--------|-------------|
| `cd35710` | Intro splash animation: rolling-letter SEEN canvas port from origin/main — spring bounce, green glow lock, scanning beam, progress bar, first-visit-only localStorage gate |
| `72cecc8` | HiringProbability component, SurveyModal, Nav credit auto-refresh, company/[slug] locations tab, apply/page.tsx company risk intel, admin 2-col KPI grid |
| `6d7e84a` | AllJobsBrowser replaces RecentJobsBrowser — company-grouped, lazy-load per company, all 5k+ jobs, search filter; api/admin-stats.js: get_jobs_grouped + get_company_jobs |
| `26e4e9e` | Supabase migration 015: job_availability_reports table (was missing — reports were silently failing); user-sync.js error handling for insert failures |
| (docs) | **SEENJOBS_BEHAVIORAL_FLYWHEEL.md** — full product architecture spec for apply checkpoint, update loop, outcome cards, credit rewards, Pro conversion |

**Build status**: ✅ PASSING — 19 routes, zero TS errors

**Supabase migrations needed (run in SQL Editor):**
- `015_job_availability_reports.sql` — creates job_availability_reports table
- `014_job_dedup.sql` — run AFTER cleaning up duplicate jobs

---

## What Session F shipped (latest push, branch `next-migration`)

| Commit | What shipped |
|--------|-------------|
| `0f10a8b` | Docs: added PREVIEW_DEPLOY_CHECKLIST, SMOKE_TEST_RUNBOOK |
| `0d974a2` | Fix hero text clipped on mobile — removed `white-space: nowrap` from hero spans |
| `6999d70` | Jobs page: empty state illustration + "Check company" link in job cards |
| `e95ef21` | Visual parity batch: resume results render real API JSON (typed ScannerResult/CoachResult/ProposalResult), nav credit balance badge (blue pill, anon-safe), VerdictFeed live leaderboard data + 3.8s ticker, LandingMarketingSections scroll-reveal via IntersectionObserver, admin KPI layout fix (removed mob state + inline gridTemplateColumns that fought CSS media queries) |
| `ee6b416` | Admin: jobs total count (API + 4-card row), section labels → adm-section-lbl class, API Health → adm-panel glass card, 2-col panels → adm-2col responsive class, chart height 56px, adm-2col mobile stacking |
| `47c303a` | Admin mobile polish: KPI numbers 0.95→1.4rem, taller card padding, header buttons wrap not clip, InactiveRow/ReportRow flex-wrap overflow guards, clusters signal text truncation |

**Build status**: ✅ PASSING after 47c303a — 19 routes, zero TS errors

---

## What Session E shipped (latest push, branch `next-migration`)

| Commit | What shipped |
|--------|-------------|
| `68a1b91` | Visual parity: cosmos bg intensity restored, feed CTA order fixed, companies header/controls, `jd-grid` stat row, tracker eyebrow |
| `bca94eb` | Visual parity pass 2: feed filter emojis, companies description copy, sort button CSS classes |
| `22a5875` | Global footer component — restores nav links to FAQ, Legal, Employers, Pricing, Contact (was missing entirely from Next.js migration) |

---

## What Session D shipped (latest push `a685441`, branch `next-migration`)

Session D ran 5 parallel agents + direct edits to knock out the entire Tier 1–3 parity list.

| Commit | What shipped |
|--------|-------------|
| `c41d327` | Company detail: 7 tabs + hiring funnel + data quality badge + web reviews + timeline + ghost surge alert + TrackCTA |
| `c41d327` | Dashboard: Settings link + Sign out button |
| `c41d327` | Feed: CTA strip above filters |
| `c41d327` | Resume: `· 1 credit` cost labels on all 3 action buttons |
| `8ffa296` | Jobs list: stale (`⚠ may be closed`) / expired (`✕ likely closed`) badges from `availability_status` |
| `8ffa296` | Jobs list: location autocomplete dropdown (25 US cities) |
| `8ffa296` | Job detail: "Report Your Experience" — 4 outcome quick-links pre-filled with company+role |
| `8ffa296` | Job detail: "Apply & Optimize" modal (optimize resume first vs skip) |
| `bae3e21` | Feed: ghost surge banner above CTA strip with 5 high-risk company pills |
| `bae3e21` | Demand: "Find these jobs →" per-job link to /jobs?q=+loc= |
| `bae3e21` | Demand: "Best companies ↗" link per city card → /companies |
| `bae3e21` | Demand: DI label color-coding (Critical/High/Active/Moderate) |
| `c929287` | Companies: industry label + ghost rate + response rate badges on each tile |
| `c929287` | Report: 2-step progress bar (The listing / What happened) |
| `c929287` | Report: recent community reports section (last 5) at bottom |
| `c929287` | Profile: ← Dashboard back link |
| `c929287` | Resume: drag-and-drop upload (isDragging visual feedback) |
| `c929287` | Dashboard: recently checked companies from localStorage |
| `c929287` | Company detail: share buttons (Reddit + Web Share API), live viewer count, pre-filled CTAs |
| `a685441` | Landing: company autocomplete (50 major companies, shows on 2+ chars without job keywords) |
| `a685441` | Landing: location autocomplete (30 US cities, under location field) |
| `a685441` | Landing: ghost surge strip (pulsing red dot + 5 company pills) |
| `a685441` | Landing: verdict feed rows → navigate to /company/[slug] |
| `a685441` | Landing: 5-layer cosmos radial-gradient overlay |

---

## Admin parity reconciliation (2026-06-14)

A contradiction existed between two checklist documents:

- `VISUAL_PARITY_CHECKLIST.md` claimed admin was 12/16 sections missing
- `ADMIN_PARITY_CHECKLIST.md` claimed admin was 16/16 complete

**Resolution:** The VISUAL_PARITY_CHECKLIST.md was stale. It was written at commit `572b886` before the admin recovery commits were merged into `next-migration`. All 9 admin recovery commits (`6f79d84` through `9fff826`) are confirmed present on `next-migration`. `app/admin/page.tsx` is 1,176 lines and contains all 16 admin sections. No cherry-pick or merge was needed.

**`ADMIN_PARITY_CHECKLIST.md` is authoritative for admin functionality.**

Remaining admin work is **visual polish only** (command-center aesthetics, colored KPI borders, section separators) — not missing functionality.

Functional parity estimate revised upward: **~95%** (was 88% before admin reconciliation). Visual parity remains ~65%.

---

## Remaining parity gaps (not yet done)

Very few significant gaps remain after Session D. These are the known outstanding items:

### Functional
- `handleCheckAnswer` in `app/tracker/page.tsx`: stage updates (Interview/Phone Screen), `showOutcomeCard`, offer `_showRoundsPrompt`, "↩ I withdrew" option (tracker follow-up system)
- T3-2: Report page — unpaid work option labels differ from old HTML
- T3-4: Tracker "Clear dupes" always visible (old) vs conditional (new)
- T3-5: Resume text-paste flow (was separate view, now combined)
- T3-10: Jobs GPS location button (auto-fill from device)
- T3-11: Jobs instant-search as you type (debounced, no explicit button)

### Visual
- ~~Intro splash animation~~ ✅ Done — `components/IntroSplash.tsx`, mounted in layout.tsx
- T3-6: Landing hero sweep (gradient flash after line 2 locks) — `swept` state is wired; `#rotatingHero.swept::after` CSS exists; just confirm the `heroSweep` keyframe is present
- Company detail: `seen_recent_cos` localStorage write on visit (needed for dashboard "recently checked" to populate) — check if written in company/[slug]/page.tsx

---

## Deployment workflow

```bash
# Claude pushes to next-migration — Vercel auto-builds preview
git push -u origin next-migration

# Brandon promotes the preview in Vercel dashboard → production
# OR trigger via deploy hook:
curl -X POST "https://api.vercel.com/v1/integrations/deploy/prj_P2SoPxsy9RpdoJfVUqqg6RslWXV5/6kpPtZBS1w"
```

**Never deploy to production without Brandon verifying the preview first.**

---

## Architecture facts (know these cold)

- **API**: `api/*.js` Vercel serverless — NOT `app/api/`. No App Router API routes exist.
- **Serverless cap**: 11 declared + 1 Next.js runtime (dynamic `/company/[slug]`) = 12 (at Vercel Pro limit). Never add a new `api/*.js` without merging one.
- **Merged endpoints**:
  - parse-resume → `POST /api/resume` `{action:'parse', base64, fileName, mimeType}`
  - company-score → `POST /api/reports` (action: company_score | research | resolve | populate)
  - fetch-location-jobs → `POST /api/jobs` `{action:'location'}` or `{location}` without `{query}`
- **Auth**: Supabase. `anon` key is public intentionally. `service_role` key **never** in frontend.
- **Admin auth**: separate username/password → `POST /api/admin-stats {action:'admin_login'}` → `X-Admin-Token`. NOT Supabase.
- **Styling**: CSS variables in `app/globals.css`. No Tailwind.
- **Git**: `main` and `next-migration` have no common ancestor. Never `git merge` between them. Sync files: `git show origin/main:path > path`
- **Worktree agents**: when spawning agents with `isolation:"worktree"`, they sometimes write to /home/user/Seen directly AND the worktree. If cherry-pick fails (add/add conflict), copy files from worktree manually and commit.

---

## Operating mode (Fable principles)

- **Parallelize aggressively.** Independent work → parallel agents. Don't serialize what doesn't need to be.
- **Build first, verify after.** `npm run build` must pass before every push. 19 routes, zero TS errors.
- **Don't ask, ship.** Reasonable calls get made and shipped. Brandon redirects if wrong.
- **CSS**: inline styles for one-offs, `globals.css` for reusable classes. No Tailwind. CSS vars: `--blue, --red, --green, --amber, --white, --sub, --muted, --dim, --mono, --display, --card, --line, --line2, --surface, --ink`.

---

## Build status

✅ PASSING — 19 routes, zero TypeScript errors (last verified: Session F, commit `e95ef21`)
