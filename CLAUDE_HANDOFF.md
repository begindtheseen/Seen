# Seen — Claude Handoff



> **📓 Memory vault (2026-07-06): start at `memory/` — read `memory/protocol.md`,
> then `memory/HOME.md`, then the newest note in `memory/timeline/`.** The vault
> is the fast-recall layer (temporal timeline + wiki-linked knowledge notes)
> distilled from this file and the other root docs. This handoff and the other
> `*.md` files remain the deep reference; append your session to
> `memory/timeline/YYYY-MM-DD.md` and update the relevant knowledge note at
> session end (see `memory/protocol.md`).

> **Read this first. Every session. No exceptions.**
> Then read SEEN_STRATEGY.md. Then `git status`. Then pick up exactly where this doc ends.

Last updated: **2026-07-06 (Operation 50% build — Ghost Report, outcome emails, employer engine, Seen Live realtime, employer portal)**

---

## ⚠️ CURRENT STATE (2026-07-05→06) — supersedes everything below

**Era: Operation 50% growth build.** The owner approved the "Operation 50%" plan (four
parallel revenue engines → ≥50% odds of $1–5k MRR; plan + evidence in `playbook/` and the
plan file). This session shipped a large slice of it. Deploys are still automatic (merge →
next-migration → prod), and the owner merges by **promoting the PR preview to production**
in Vercel — when a preview shows `previewUrl: seenjobs.io` while the PR is unmerged, that's
the promoted-preview/prod divergence: **merge that PR immediately** (institutional rule).

### PRs this session (all squash-merged to next-migration unless noted)
- **#157 Weekly Ghost Report** — `/ghost-report` page + `opengraph-image` share card + admin
  `GhostReportPanel` (copy-caption tool) + pure `lib/server/ghostReport.js` (8 tests). No
  owner setup; reads existing data.
- **#158 Outcome email loop** — Day-7/14/30 follow-ups. `api/outcome-followups.js` (daily
  cron 15:00 UTC, routes the Vercel cron GET), `lib/server/outcomeEmails.js` (pure, 7 tests,
  HMAC unsubscribe), `api/unsubscribe.js`. **Runs on the already-live `RESEND_KEY` + verified
  `noreply@seenjobs.io`** — works on deploy, no setup. `email_prefs` opt-out.
- **#159 report snapshot** + **#160 report view/keep/delete** — reported ephemeral (live-search
  `j_<hash>`) listings are now viewable/actionable in admin. Snapshot columns capture
  title/company/city/apply_url at report time; admin can open the posting, Keep (dismiss), or
  Delete (real suppression via `suppressed_listings`, filtered in `api/jobs.js` search).
- **#161** — search-card report snapshot fix (was only on the detail page) **+ Employer
  revenue engine E4** (checkout) **+ Seen Live** (poll-based realtime v1, global toast system).
- **#162** — **Seen Live INSTANT** (Supabase Realtime broadcast → <1s push) **+ complete
  Employer engine** (fulfillment, perks, badges).
- **#163 Employer portal** — **OPEN, preview green, NOT yet merged as of handoff.** Makes
  `/employers` an employer-first experience (seeker Nav/Footer hidden on `/employers*`),
  reputation dashboard, promote section; `account_type` separation label.

### Migrations APPLIED TO PROD this session (verified present by SQL): 045–050
`045_outcome_email_log` (outcome_email_log + email_prefs) · `046_job_report_snapshot`
(job_availability_reports += company/title/city/apply_url) · `047_suppressed_listings` ·
`048_employer_purchases` · `049_employer_perks` (company-keyed featured_until/verified_until) ·
`050_account_type` (profiles.account_type 'seeker'|'employer' DEFAULT 'seeker' + CHECK + index).
(044_pro_until was applied in the prior session.)

### Key architecture facts established this session
- **Seen Live (realtime admin).** Admin auth is a custom token + service-key reads (no Supabase
  session / no RLS) → **Supabase Realtime postgres_changes is NOT viable**; instead
  `lib/server/realtime.js` `broadcastActivity(kind)` POSTs a tiny NON-SENSITIVE ping to the
  public Realtime **broadcast** channel `seen-live` (fired from report writes, listing flags,
  employer sales). `lib/hooks/useAdminLive.ts` subscribes and, on ping, immediately fetches the
  authenticated `recent_events` cursor action in `api/admin-stats.js` (12s poll is a fallback).
  Global toast system: `lib/notify.ts` (`seen:notify` event, extends the seen:* bus) +
  `components/ToastHost.tsx` (mounted in `app/layout.tsx`); `components/admin/LiveBell.tsx`.
- **Employer engine E4 (complete, no employer accounts yet).** SKUs in
  `lib/server/employerSkus.js`: `featured30` $79/30d, `verified90` $249/90d. Email-based,
  no-login checkout: `api/stripe.js` `employer_checkout` + `employer_confirm`, routed by
  `metadata.kind==='employer'`; `lib/server/employerFulfillment.js` → idempotent insert into
  `employer_purchases` (unique `stripe_session_id`) + owner email (`OWNER_EMAIL` ||
  `ADMIN_EMAIL` || `NOTIFY_EMAIL`; no-op until set). Admin `list_employer_purchases` +
  `fulfill_employer_purchase` grant time-boxed perks into `employer_perks`
  (`components/admin/EmployerPanel.tsx`, Revenue tab). Display: company-page Transparency
  Verified/Featured badges (isolated `employer_perk` action in `api/reports.js`), JobCard
  **★ Featured** badge + search sort-first (`getFeaturedSet` in `api/jobs.js`, cached 60s).
- **INTEGRITY (load-bearing):** money NEVER changes a transparency score. Featured = paid
  placement; Transparency Verified = a displayed commitment the admin grants after review.
- **Employer/seeker separation:** `/employers` hides the seeker Nav/Footer; the portal creates
  NO seeker records (reputation is read-only; checkout writes only employer tables);
  `profiles.account_type` is the DB label so employer accounts can never mix into seeker views.
- **Candidate sourcing = deliberate PHASE-2** (owner chose "portal on real data first"). It
  needs a candidate-profile opt-in model (seekers publishing a hireable profile) before
  employers can browse talent. NOT built/faked.

### Owner activations still pending (env only — code is no-op-safe without them)
- `NEXT_PUBLIC_POSTHOG_KEY` — analytics (PostHog). `OWNER_EMAIL` — employer-sale alert emails.
  (`RESEND_KEY` is already live; outcome emails + employer notifications use it.)

### State: 259/259 tests pass, tsc clean, build 91/91 pages. Test cmd:
`node --test --test-reporter=spec "**/*.test.mjs"` (or `npm test`).

### Next-session candidates
- Merge/confirm #163 landed. Phase-2 candidate profiles + employer sourcing (owner-gated).
  Company-page GEO restructure (real-data-first for AI citations) still pending from the plan.
  Distribution/cadence (owner posts Ghost Report, DMs, outreach) is the human half of the plan.

---

## ⚠️ CURRENT STATE (2026-07-02) — historical; superseded by the 2026-07-05→06 section above

**The parity era is over.** Between 2026-06-30 and 07-02, 50 PRs (#75–#124) landed on
`next-migration`: SeenFit/HumanProof résumé engines, landing + dashboard redesigns
(intentional — do NOT restore these pages to old-site parity), SEO/GEO growth surfaces,
Stripe subscriptions (no trial — charge immediately, in-app cancel), keyless job
aggregation (all Anthropic removed from the job pipeline), credit-farming RLS lockdown
(migrations 035/036), and the PR #124 full-app repair (tracker sync, intel flywheel,
auth flows, slugs, Stripe webhook raw-body).

**Flywheel status: BUILT.** ApplyCheckpoint, OutcomeCard, SurveyModal, ResumeSurveyModal,
credit rewards, day-7/14/30 check-ins, and quick_submit → community-report intel all
exist and were repaired end-to-end in PR #124. "Apply Checkpoint MVP" below is stale.

**Deploys are automatic.** Merging a PR into `next-migration` auto-deploys production
(seenjobs.io). There is NO manual promote step anymore. Corollary learned 2026-07-02:
if a PR *preview* gets promoted to production from the Vercel dashboard, MERGE THAT PR
immediately — otherwise the next unrelated merge to next-migration rolls production back.

### Session 2026-07-02 B (Claude B, branch `claude/codebase-review-o344hb`)
- Independently reviewed PR #124 (all 31 files, local build + 44/44 tests) and merged it
  (squash `7e2b274`) after discovering production was ALREADY serving its preview build —
  merging closed a git/prod divergence; it did not change site behavior.
- Live audit of seenjobs.io: 19/19 routes healthy (SSR titles correct, /company/coca-cola
  slug resolves, jobs/demand/feed/batch_scores APIs all good).
- Migration `037_applications_events_jobid_text.sql`: codifies the hand-applied prod
  schema repairs (applications.events jsonb, job_id→text + FK drop) for fresh environments.
  **Prod already matches — do not re-run there; apply only to new/restored environments.**
- Follow-up fix to PR #124: freshly-aggregated search results + nearestListings returned
  `id:null` (verified live — 49/49 results on a fresh query), so /jobs/<id> permalinks
  from those paths couldn't resolve. aggregateForQuery now stitches upsert-returned
  ids/created_at back onto results; nearestListings selects id/created_at and maps
  posted_at. Also restored the NUL-strip in pdfText.js cleanupText (Postgres rejects \x00).
- Doc refresh: this file, CLAUDE.md (mission history corrected), staleness banners on
  SITE_PARITY_CHECKLIST.md and ADMIN_PARITY_CHECKLIST.md.

**Read order now:** this file → CLAUDE.md session notes (2026-07-02 A + B) →
`SEEN_STRATEGY.md` → `git status`.

---

## Historical sections below (pre-2026-06-30) — context only, NOT current priorities

**~~Current~~ implementation priority order (STALE — see CURRENT STATE above):**
1. ~~Parity restoration~~ — done
2. ~~Flywheel Phase 2: Apply Checkpoint MVP~~ — BUILT (see above)
3. ~~Visual parity remaining items~~ — landing/dashboard since redesigned intentionally

## Current reality (as of 2026-06-14 — partially stale)

- **seenjobs.io is LIVE** on the Next.js app, deployed from `next-migration` via Vercel
- `main` = old HTML SPA. Historical reference only (redesigned pages moved past it). **Never touch it.**
- Active branch: `next-migration` — merging a PR to it auto-deploys production
- ~~Brandon promotes previews to production from the Vercel dashboard~~ (no longer needed)

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
- **Serverless cap**: **Vercel Pro — 500 function limit. No constraint.** Currently 9 declared api/*.js files. New files can be added freely. parse-resume was merged into resume.js historically to work around what was thought to be a Hobby plan — it can be split back out for cleaner code if needed.
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
