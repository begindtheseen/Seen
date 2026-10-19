# Seen — Claude Code Instructions

## ⚡ START HERE EVERY SESSION — memory boot (do this first)
This project uses the shared Chronos brain. **Use it every session so you recall where things
stand instead of re-reading everything — that is the token save.**

**Local vs cloud — how you reach the brain (Chronos):**
- **Local (Mac) session:** use the private, user-owned MCP registration for exact source
  `claude-seenjobs`. The shared project `.mcp.json` is intentionally empty so a checkout can never
  inherit another principal's credential or an ungated legacy server.
- **Cloud / repo-connected session:** there is no checked-in `memory/` directory and no guaranteed
  `memory_*` MCP catalog. The protected environment reaches the always-on online brain through
  `lib/server/brainCloud.js` with `BRAIN_API_URL`, `BRAIN_API_TOKEN`, `BRAIN_CLIENT=claude-seenjobs`,
  and its unique `BRAIN_CLIENT_TOKEN`. Every call is credential-bound and audited as exactly
  **`claude-seenjobs`**; `claude-session` and fallback identities are forbidden and denied. Never
  paste either token into a prompt, log, source file, command argument, or Brain entry.

**Use the `brain` skill (`.claude/skills/brain/SKILL.md`) — every call below is one command via
`node scripts/brain.mjs <status|ping|search|fact|timeline|contradictions>`; no hand-written snippets.**

1. **Orient, don't download the vault.** Run `npm run memory:status`. In cloud mode it calls the
   compact server-side `briefing` op; it does not transfer every note into the container.
2. **Drill down when needed.** Use the authenticated helpers `searchFactsCloud(filters)` and
   `contradictionsCloud()` exported by `lib/server/brainCloud.js`. Search requires at least one of
   `query`, `subject`, or `predicate`; optional `as_of` is an ISO date and `limit` is 1–100.
3. **At session end, write it back.** Use `recordFactCloud(fact,{note})` for durable facts and
   `appendTimelineCloud(date,heading,text)` for the session episode, then run
   `contradictionsCloud()` and report any conflict. These calls preserve supersede-not-overwrite
   history and authoritative credential attribution. If you skip this, the next session pays the
   context cost you just saved.

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

## Session 2026-10-19: Motion v2 — the "crisp" kit (claude/motion-graphics-update-yw7ei4)
- **All motion lives in `app/motion.css`** (imported after globals.css in app/layout.tsx, so it wins the
  cascade) + `components/motion/` (`MotionLayer` = the ONE pointer listener for `.spot` spotlight /
  `.tilt` + the `.grain` layer; `KineticText` = per-word clip reveal; `Odometer` = rolling digits).
  Transform/opacity/clip-path only, fine-pointer-only cursor effects, everything neutralized under
  `prefers-reduced-motion` (block at the end of motion.css). The 2026-10-17 phone-performance rules and
  the no-backdrop-filter-on-overlays rule (PR #322) are untouched.
- **There is NO blocking intro splash any more** (owner call 2026-10-19). `IntroSplash.tsx`, the
  `#intro-guard` cover and the `intro-seen` script are deleted. The opening is in the page: on the FIRST
  load of a session `app/layout.tsx` marks `html.seen-first` before first paint (sessionStorage
  `seen_opened`), and pure CSS rises the nav wordmark letter by letter + draws a hairline under the nav
  while the hero choreography runs. `useIntroGate()` now just flips once the display font is ready
  (≤300ms) — the API is unchanged for HomeHero. Rationale: the cover played on EVERY page's first
  load, including Google landings on company pages, and hid readable content for 1.4–3s.
- **Floating menus/panels over content are SOLID (#0e111c), never translucent glass.** The nav
  account/More menu used `--glass-strong` (72% alpha) + backdrop-filter nested inside the blurred
  nav; iOS Safari does not composite nested backdrop-filters, so the hero showed straight through and
  the menu was unreadable (owner screenshot 2026-10-19). Same rule already held for `.co-sticky` and
  CompanyScoreModal. Glass stays only on surfaces that sit over the static background.
- **Homepage v3** (owner asked for the "future concept" direction, not its colors or features): centered
  hero (`components/HomeHero.tsx`, same search routing + proof refresh) → `components/home/WorkspacePreview`
  — a window with Dashboard / Tracker / Company intel / Résumé AI tabs that each MIRROR A REAL SCREEN.
  Dashboard/Tracker/Résumé use labeled EXAMPLE data (fictional companies); Company intel shows REAL live
  Amazon data (the old proof card). Never add visitor/community counts — Seen has none (brain
  seen:growth). `LandingMarketingSections` = 4 feature cards (grades, tracker check-ins, SeenFit,
  Agency Ghost Index) + final CTA. Gotcha hit here: never use `<nav>` inside page content —
  globals.css styles every `nav` element as the fixed site bar.
- **Dashboard v2** (owner's second reference: "less clutter, less noise", look capable of 10k MRR):
  `app/dashboard/page.tsx` render rewritten on `dashboard.module.css` — intro (hello + one primary
  "+ Track application" → `/tracker?add=1`, which opens the add form) → row [health card with a
  one-sentence verdict + 4 Odometer pills | next best move] → row [active pipeline | signals] →
  benchmarks (only when enough data) → toolkit tiles (résumé status lives on its tile) → quiet
  recently-checked/badges rows. All data logic unchanged. Settings/sign-out left the hero (the nav
  account menu has them). Nav on ≤480px shows "★ PRO" (the long pill pushed logo + avatar off-screen).
- **Tracker check-ins live on the application card** (owner request 2026-10-19). `EventStore.dueChecks`
  returns ONE check per application — the earliest unanswered in schedule order; a snoozed one holds
  the app back rather than letting a later check jump it. The old full-card stack above the list (and
  its duplicate response+interview questions per old app) is gone; a one-line counter jumps to the first.
- **Jobs filters** (`components/jobs/JobFilters.tsx` + `.module.css`): one "Filters" button with a
  count badge opens a panel with the four selects; active filters show as self-clearing chips next to
  the button. Filter state/behaviour in `useJobSearch` is untouched.
- **Shared keyframe `fadeUp` was reshaped** (snap-in + settle) in motion.css — all 21 inline
  `animation: fadeUp …` call sites got crisper without edits. Nav active underline is ONE sliding
  indicator (`Nav.module.css .ind`, measured in Nav.tsx). Toasts carry `--dur`/`--acc` + `.timed`
  (draining hairline).
- **Fixed in passing (pre-existing):** `lib/hooks/useCountUp.ts` initialised from the reduced-motion
  media query inside `useState`, so the client's first render differed from the server HTML → React
  #418 hydration error on every hero figure under reduced motion; and the first rAF timestamp could
  precede the setTimeout start, flashing "-1%" in the hero gauge. Both verified with Playwright
  against the production build (`next start` + API calls proxied to prod).
- Company page: the page-local rAF score count-up is gone — `Odometer` renders the grade score and
  the integer metric tiles. Dashboard stat pills are Odometers too.
- Test suite: 1223/1231 pass; the 8 failures are `api/brain.timeline.test.mjs` (need the live brain)
  and fail identically on the untouched base commit.
- **Phone overflow rule (owner iPhone screenshot: "my toolkit gets cut off"):** a `1fr` grid track has
  `min-width:auto`, so one nowrap child (a résumé file name, "Report an outcome →") widens the whole
  column past the viewport and `.page-full{overflow-x:hidden}` just clips it. Every grid track in
  `dashboard.module.css`, `WorkspacePreview.module.css` and `LandingMarketingSections.module.css` is now
  `minmax(0, …)` and tiles carry `min-width:0`; the tracker's `.stage-step` flex items got the same
  (`min-width:0` + ellipsis, tighter at ≤400px — "Phone Screen"/"Final Round" clipped the last step at 360px).
  `document.scrollWidth` does NOT catch this class of bug; check per element (any non-fixed, non-decorative
  element with `getBoundingClientRect().right > clientWidth`) at 360/390/430 — verified clean on
  /dashboard, /, /tracker, /jobs, /companies, /company/amazon, /pricing.
- **The connected shell (owner: "the whole site needs to feel connected… like one product"):** `components/shell/`.
  `PageHeader` is THE header for every inner page (crumbs → eyebrow → title → sub → actions; `Crumbs` alone
  on the company page above its hero) — the root crumb is Dashboard for signed-in seekers, Home otherwise,
  so "back to the dashboard" is the same tap on every page. Used on tracker, companies, company, jobs,
  résumé, report, saved, profile, feed, demand, agencies, faq; do NOT hand-roll a new page header.
  `TabBar` = phone (≤768px) bottom tabs (Dashboard/Jobs/Track/Companies/Résumé; guests get
  Home/Jobs/Companies/Pricing/Sign in), solid #0e111c, hidden on /employers /login /reset /admin, ducks while
  a field is focused (`html.kb`), and sets `html.tabbar` which pads `.site-main`/`footer` and lifts the
  legacy bottom `.toast` (globals.css next to `.site-main`). `CommandPalette` = ⌘K / Ctrl+K (pages, actions,
  "Check “X”" → /company/slug, "Find “X” jobs", the user's tracked applications from `AppStore.loadSync()`,
  recently checked companies from `seen_recent_cos`) + `g` then d/j/t/c/r/s/h jumps; opened by the nav's
  "Jump to…" pill (desktop only) and the footer via `window.dispatchEvent(new Event('seen:palette'))`.
  `RouteProgress` = 2px top hairline on internal link clicks that change the pathname (and on
  `seen:nav-start`), completed by the pathname effect. Nav wordmark → /dashboard for signed-in seekers.
  Footer is a real site map (Product / Intel / Company / Legal). Verified with Playwright
  (`scratchpad/shell.mjs`: crumb click, g-t, Ctrl+K search/route, tab bar tap/duck, guest tabs, footer
  clearance) + the per-element overflow check on 15 pages at 360/390/430.

## Session 2026-10-19 B: logic fact-check of every non-résumé surface (owner: "fact check logics… bring the site to life")
Four read-only audits (dashboard+tracker, company page+scoring, explore/homepage/pricing, jobs) traced every
frontend→API→DB contract and probed prod. ~50 verified defects fixed in ONE pass (PR #328). Ground truth now:
- **Leaderboard** (`api/reports.js` + `lib/growth.ts`): the 150-row cap ran BEFORE the grade gate, ordered by the
  FUSED count, so web-claim rows filled the slots — /companies showed 66 while ≥150 were gradeable. Now
  `first_party_report_count=gte.1`, ordered by first-party. `order:'first_party'` is the only ordering.
- **Company reports list** was a first-word wildcard (`*general*` → Dollar General, Mass General under General
  Motors) with no post-filter; now wildcard-between-tokens + exact `sameCompany` key, and `needs_review` rows
  (anti-gaming holds) are never public. `company_jobs` (api/jobs.js) same class (Amazon Flex under Amazon).
- **Fusion** reads `wait_days,rounds` so `avg_wait_days`/`avg_rounds` are real (were null for every reports-
  derived score; the share PNG printed "0d"). Volume bonus + confidence use `effN` (trust-weighted), not raw row
  count — 8 Reddit rows ≠ "Moderate confidence · 8 reports". Stored rows only pick this up on the next recompute
  (new report, or the admin rescore). Fresh/populate saves now write `mention_count`, so the view-time
  self-repair no longer rewrites a web-researched row into `data_source:'reports', web_report_count:0`.
- **No invented numbers:** the company page "N Seen users checked this week" (a hash) is gone; the "Viewed"
  funnel bar (response×1.8) is gone — "Where they ghost" is built from reports' `ghost_stage` or hidden;
  tracker never says "their 21-day average" without `avg_wait_days`; HiringProbability no longer defaults a
  real 0% to 55% (`||`→ real values; it is the response rate, labeled "company-wide estimate");
  dashboard benchmark references come from GET `/api/reports?type=industry` (one server constant set, labeled
  "reference estimates"), never a second local table; the health verdict waits for ≥2 real outcomes and never
  says "beating the average". Dashboard ghost surges are served by `action:'ghost_surges'` (the browser's
  reports SELECT is DENIED in prod — the anon grant was revoked by hand; record in a migration if touched).
- **Tracker semantics:** "I withdrew" → `status:'withdrawn'` (was recorded as REJECTED and filed against the
  company). ONE community report per terminal outcome via `quick_submit` (hired now included; the day-30
  EventStore duplicate is gone). `dueChecks` asks only `active` apps. `AppStore.update/remove` await the sync
  (the un-awaited PATCH raced the reload and reverted clicks). Funnel "Screened" excludes ghosted/withdrawn;
  stats row has Withdrawn; "Clear dupes" is active-only, newest kept, confirmed.
- **Outcome follow-up cron** (`api/outcome-followups.js`) selected `applications.company` — the column is
  `company_name` — so it 400'd on every run since it shipped. Fixed; needs ONE fire with `?secret=` to confirm
  `sent>0` (not done from this session — no CRON_SECRET here). Env var is `RESEND_KEY` (not RESEND_API_KEY).
- **Feed:** SCORABLE filter + `count=exact`; the "ghost surges this week" banner (any 2 companies with a ghosted
  row on page 1) is gone; raw platform chip hidden when a provenance badge exists.
- **Demand:** `/api/demand` had been stale since 2026-08-14 (monthly cron silent for Sep + Oct — NOT verified
  why; Vercel log retention too short). The page now shows a stale banner, "~" on modeled totals, and the
  eyebrow drops "+ live Seen listings" unless a live city exists. The refresh log is read with the service key
  (it is service_role-only; the anon read returned null forever).
- **Jobs:** Remote = only listings that say remote (page fills from corpus and says `remote_thin`); the API
  returns `fallback: 'outside_radius'|'remote_thin'|'unrelated'` and the hook words each honestly ("No matches
  for X — showing N other openings"); a search requires a title (location-only ran an unfiltered Adzuna path);
  "Most recent" sorts by `posted_at`; zero-filter matches show an empty state, not every row; "Contract" option
  removed (no source emits it); the Posted filter is labeled "Added to Seen" (it is `created_at`); the listing
  scorer no longer carries hand-written KNOWN_GOOD/KNOWN_BAD company lists; the deck uses `Score.risk` thresholds;
  JobCard passes `isLoggedIn` to save/unsave (was hard-coded false → unsave resurrected); "Applied" badge keys
  on jobId/apply_url, not company; 60-row pages read "60+ results".
- **Copy:** FAQ rewritten to what the code does (no 47k companies, no surge emails, no per-location scoring, no
  hashed session id); grade bar wording = "enough evidence (≥1 report to Seen, 5 pieces; mentions ½)" via
  `notEnoughReviewsLabel`; "helps thousands" → "warns the next applicant"; landing names ranked agencies
  (Insight Global, Randstad, Addison Group); credits chip says "available" (balance includes purchased).
- **Homepage LivePulse** (`components/home/LivePulse.tsx`): real feed rows gliding by, worded "compiled
  applicant accounts" (brain seen:growth); dashboard greets by local hour (set after mount — SSR is UTC).
- **Prod data to clean (owner):** this session's demo wrote 4 `rejected` reports (Hilton ×2, Advatix, Goodwill
  SoCal, 2026-10-19 06:21–06:30 UTC, platform Seen) via the anonymous submit path, plus owner test rows
  ("Seen Jobs"/"test2"/"Test run"). Delete them and rescore those companies. The demo harness
  (`scratchpad/mockuser.mjs`) must stub `action:'submit'` and `quick_submit` — never proxy writes to prod.
- Deferred (larger product changes, listed in PR #328): capture source post dates as `posted_at`; level as a
  badge instead of a hard filter; a scored-company ghost badge on listings; pagination past 60; per-report
  `needs_review` badge for the submitter's own held reports; `profiles.onboarding_survey` has no writer.

## Session 2026-10-17: self-filling company pages read the Arctic Shift archive when Reddit refuses
- Verified on prod: the first enrichment cron run (Sheetz) got `reddit_429` from www.reddit.com on
  Vercel; cloud runners get 403. `ENRICH_SOURCE` (default `auto`) now switches the rest of a run to the
  Arctic Shift archive (`api/_utils/arcticShift.js`) after Reddit's first refusal. Reports keep the
  Reddit shape and permalink (the content is Reddit's). `reddit` / `arctic` pin one source.
- Archive facts (live 2026-10-17): posts/search needs `subreddit`; full-text search in big subs needs
  a time window; overload = HTTP 422 `{"error":"Timeout. Maybe slow down a bit"}` (fall back
  `query`→`title`); rate limit = "Too many requests" + `x-ratelimit-reset` seconds.

## Session 2026-09-29: stale-job protocol (one batched DB sweep) — facts verified on prod

- **Stale backlog was 95,505 rows (67% of `jobs`)** because all three stale paths silently died on
  the 8s `statement_timeout` service_role inherits: `deleteExpired()` (one unbounded, unchecked
  DELETE), admin `purge_stale_jobs` (one unbounded PATCH — button said "cleared N", wrote nothing),
  and `markStaleJobs()` (correct but 2 REST round trips / 200 rows). All replaced.
- **The protocol now lives in ONE place: `public.sweep_stale_jobs(p_mode, p_batch)`** (migration
  `20260929120000_stale_job_protocol.sql`, applied to prod), driven by `lib/server/staleSweep.js`
  from both the refresh-jobs cron (`'scheduled'`: active unseen 7d → stale+hidden; stale unseen 14d
  or `expired` → DELETE) and the admin "Clear stale" button (`'all'`: delete every unreferenced
  stale row now). Rows referenced by saved_jobs/applications are kept as hidden `expired`;
  employer-posted rows are never touched. Every candidate query is a partial-index range scan —
  OR-predicates made the planner seq-scan (8.4s/page), so keep the UNION ALL branches.
- Prod after the clear-out: 0 stale, 1 expired (referenced), ~49k active. A no-op sweep is 79–151ms.
- Admin: "Clear stale" no longer waits on a full `refresh-jobs?all=1` re-ingest (up to 300s); only
  the crisis banner re-ingests, with the clear in parallel. `jobs(created_at)` index took the admin
  "added today" count from 6,852ms → 8ms.
- Behaviour change: expired EMPLOYER-posted rows are no longer hard-deleted by the cron (the old
  unbounded delete did not exclude them); they stay hidden and visible in the employer's manager.

## Session 2026-07-04 (OPERATION 50%): growth plan approved — business decisions LOCKED

The owner approved the "Operation 50%" growth plan (target: ≥50% probability of $1–5k MRR
in 24–36 months via FOUR parallel revenue engines + weekly cadence + kill-gates). The full
plan and evidence live in the probability-assessment report + `playbook/` (weekly routine,
outreach scripts, content engine, 90-day calendar). **Locked owner decisions (rule 6 —
do NOT relitigate or unwind):** 7-day NO-CARD trial (rebuild approved) · one-time SKUs
(Interview Sprint $14.99 = +30 credits + 7-day Pro via `ai_credits.pro_until`; Credit Pack
$4.99 = +20 credits) · PostHog analytics (`NEXT_PUBLIC_POSTHOG_KEY`, no-op without key) ·
Resend outcome emails (`RESEND_API_KEY`) · beachhead niche = staffing-agency-ghosted /
r/recruitinghell audience with the Staffing Agency Ghost Index (/agencies) as hero asset ·
employer-side revenue (featured listings, sponsorships, Transparency Verified badge —
money NEVER changes a score). Prior context: 2026-07-03 shipped listing-score integrity
(#144), legal-audit source inventory (#145), Application Intelligence V2 (#146, industry-
agnostic), admin rescore endpoint (#147), V2 UI (#148), reported-listings admin (#149,
delete fixed in #150), admin jump fix (#151), instant autocomplete (#152).

## Session 2026-07-02 C (PR #127): conversion pass + jobs-page extraction (all facts verified)

Owner decisions taken this session (rule 6 — decided BEFORE building):
- **Free tier = 3 AI credits/day.** ⚠ SUPERSEDED — the CURRENT owner decision is **1/day**
  (see `lib/server/creditRules.js` FREE_DAILY_CREDITS = 1 and `app/pricing/page.tsx`'s
  "owner decision 2026-07-02" comment; all copy renders from the constant, and migration
  031/044's RPC resets to 1). Do NOT "restore" 3/day from this stale note.
  <s>Original note: code had reset to 1 while copy promised 3; baselines were set to 3.</s>
- **"Stealth Mode" is renamed "Human Voice" in ALL UI strings** (authenticity framing —
  never use evade/bypass/detection language). The `stealth` API field, code identifiers,
  and the separate HumanProof feature keep their names. Do not reintroduce "Stealth" copy.
- Paywall hero: "You already know who ghosts. Now get through to the ones who don't."
  Pro features are ordered intel-first (ghost alerts, company analysis) before Human Voice.
- Post-win upsell: non-Pro users see a dismissible "1 of your 3 daily credits" strip on
  optimize RESULTS (ApplyOptimizeModal review step + resume page) — tri-state pro gating.

Structure: **app/jobs/page.tsx is extracted** (1,608 → 347 lines): search state machine
lives in `lib/hooks/useJobSearch.ts`; UI in `components/jobs/` (JobCard, JobDetailDrawer,
SwipeJobDeck, JobFilters, CoPreviewModal). Effect ORDER inside useJobSearch is
load-bearing (URL-params effect claims autoSearchedRef before GPS/recent-search) — do not
reorder. The radius select (incl. Remote value="0") stays in the page's search bar.

Delegation lesson (recorded after a caught failure): **worktree subagents start on the
repo's DEFAULT branch (`main` = old HTML app), NOT your working branch.** An extraction
agent silently built on a 22-PR-stale tree and would have reverted the #124/#125 jobs
fixes — green build + 44/44 tests did NOT catch it. When delegating: pin the EXACT base
sha, and give the agent marker strings that must exist in the source before it starts and
in its output when done. Verify the markers yourself in the merged result.

Doc corrections: MONETIZATION_TODO.md item 1 falsely said the 7-day trial was "✅ BUILT" —
it was deleted in #93 (verified: no trial_period_days in api/stripe.js, no trial copy).
Corrected. Grep before trusting any feature-status claim in docs.

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

### Vercel deploy: auto-deploy USUALLY works but is NOT guaranteed (updated 2026-08-13):
- Vercel is connected to the GitHub repo and normally every PR gets a preview and merging to
  `next-migration` deploys production (seenjobs.io) within ~2 minutes. **But it silently
  fails.** On 2026-08-13 the merge of #274 produced NO production deployment at all: commit
  `58c02f6` carried **zero GitHub statuses** — the integration never fired — and production
  served five-hour-old code while the database had already been migrated ahead of it. The
  previous wording here ("do NOT tell the owner to manually trigger deploys — merging the PR
  is the deploy") is what made that invisible, so it is now retracted.
- **VERIFY, then conclude. A merge that never deployed is indistinguishable from a fix that
  did not work** — you will misread it as "my change didn't help". After merging anything you
  intend to observe in production, confirm a **production** deployment exists for the merged
  sha before drawing any conclusion:
  `gh api repos/begindtheseen/Seen/commits/<sha>/status` (0 statuses = never fired), or check
  Vercel for `target: production` on that sha. **A green Vercel check on a PR is a PREVIEW,
  not production** — that exact confusion cost hours.
- If it did not fire, create the deployment for the merged sha (Vercel API `POST /v13/deployments`
  with `target: production` and a `gitSource` ref, or `vercel --prod`). The command-os repo now
  checks this automatically every hour (`scripts/deploy-drift.mjs`) and records the verdict as a
  brain fact, so drift is visible in Chronos → Brain rather than depending on memory.
- **Ordering rule, learned the hard way the same day: deploy code BEFORE schema**, or make the
  schema change backward-compatible so both the old and new build work against it. Migration 069
  was applied ahead of its code and every `append_timeline` failed — worse than the bug it fixed.
  Schema-first also has no cheap rollback: the old unique index could no longer be recreated once
  a row exceeded its size limit.
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

## MANDATORY THOUGHT PROCESS (added 2026-07-02 after auditing PRs #75–#123)

A post-hoc audit found ~30 features that "looked built but had never once worked" —
every one failed at a seam this checklist would have caught. These are not suggestions;
run them on EVERY change. The root cause was always the same: reasoning about code in
isolation instead of verifying the whole path it lives on.

**1. Trace the full contract before writing OR trusting any code.**
For any frontend→API→DB path you touch, open BOTH sides and verify with file:line
evidence: exact field names in the request body vs what the handler destructures; auth
header sent vs auth the handler requires; HTTP method vs methods the handler routes
(Vercel crons fire GET); response fields vs what the client reads. Bugs shipped by
skipping this: tracker quick_submit sent no Bearer token (401'd silently for weeks),
company-page Track CTA sent a flat body the handler couldn't read (never worked once),
demand cron was POST-only, Stripe used an invalid expand[] param (502 on every call).

**2. Verify the actual DB schema, not the schema you assume.**
Before selecting/inserting a column, confirm it exists with the right type — read the
migrations AND, when in doubt, probe prod. The single worst bug (tracker dead for every
signed-in user) was a select on a column (`events`) that didn't exist in prod; another
was job_id being uuid in prod despite migration 016 saying text. Migrations with
`IF NOT EXISTS` silently no-op over pre-existing drift.

**3. Exercise the runtime path once, honestly, before calling it done.**
"The code reads correctly" is not verification. curl the endpoint / click the flow /
run the cron handler locally. A filter that was rendered but never applied (Posted
filter), a "Remote" option that silently ran a 25-mile local search, and a credit
response that reported a different balance than it persisted all pass code-reading and
fail one real invocation. State explicitly what you did NOT verify live.

**4. When you find a bug, hunt the CLASS, not the instance.**
Grep for the same pattern everywhere before closing the issue. The cross-user cache
bleed was fixed twice in two days (#118 résumé, #121 profile) because the first fix
patched one key instead of auditing every localStorage/cache key for user-scoping. Slug
generation existed in 3 divergent copies. One bug found = one pattern search owed.

**5. Never ship a known approximation.**
If you catch yourself writing a comment like "no created_at filter, assume recent" —
STOP. That exact comment shipped the lifetime-vs-daily credit cap bug that permanently
killed the earn incentive after 3 uses. Do it right or surface the blocker; an honest
TODO-and-ask beats silently-wrong logic every time.

**6. Decide once, then build once.**
The free-trial feature was built (#86), patched (#89), rebuilt key-only (#90), and
deleted (#93) in a single day because building started before the business decision was
settled. If a change hinges on an owner decision (pricing, trial policy, email infra),
ask first or put it behind MONETIZATION_TODO.md — don't iterate product strategy in code.

**7. Fixes ride with proof.**
Every fix PR names how it was verified (test added/re-run, live probe, build). If a fix
chain on the same file reaches attempt #3 (#78→#81 résumé exports), stop patching:
re-derive the requirement end-to-end, then make ONE correct change.

**8. Leave ground truth better than you found it.**
Update CLAUDE_HANDOFF.md + this file's session notes with FACTS you verified (paths you
opened, commands you ran) — never from memory. A prior session recorded a credits path
that didn't exist and later sessions built on the error. If prod state diverges from git
(promoted previews, hand-applied SQL), record it immediately and reconcile (merge the PR,
codify the migration) before anything else lands.

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
1. Read the memory vault: `memory/protocol.md` → `memory/HOME.md` → the newest
   note in `memory/timeline/` (the fast-recall layer; see below)
2. Run `git status` to see current state
3. Read SEEN_STRATEGY.md
4. Pick up exactly where previous session left off

At session END: append what happened to `memory/timeline/YYYY-MM-DD.md` and edit
any knowledge note whose facts changed (`memory/protocol.md` has the full loop).

## Memory Vault (`memory/`)
An Obsidian-compatible vault is the persistent, structured memory for this
project — an upgrade over relying on model context + this file alone. It splits
**temporal memory** (`memory/timeline/`, append-only dated session notes) from
**knowledge** (`memory/knowledge/`, `memory/decisions/`, `memory/people/` —
wiki-linked entity notes). Start at `memory/protocol.md`. The root docs
(this file, CLAUDE_HANDOFF.md, SEEN_STRATEGY.md, SEENJOBS_BEHAVIORAL_FLYWHEEL.md,
…) remain the deep reference the vault links back to.
