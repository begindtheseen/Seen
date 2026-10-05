# Recovery Roadmap

**Mission**: Full parity restoration of the Next.js migration to match old production (`origin/main`).
**Source of truth**: `origin/main:index.html` (13,354 lines), `origin/main:employer.html` (2,647 lines), `origin/main:api/`.
**Constraint**: Do NOT add features. Do NOT redesign. Match old production exactly.
**Build rule**: `npm run build` must pass before every commit.

---

## ✅ PHASE 1 ADMIN — COMPLETE (2026-06-13)

All 16 admin sections + auth ported. API regressions restored (chart, top_companies,
outcome_breakdown, company_lookups.top). Contract drift resolved (merge names/ids, auto_merge groups).
See ADMIN_PARITY_CHECKLIST.md milestone table. 10 commits, build green, ahead 10 / behind 0, unmerged.

## ▶ NEXT — ranked site-wide parity gaps (drives the next phase)

### CRITICAL — missing user-facing functionality
- **Job detail route + AI insights** — `app/jobs/[id]/page.tsx` does NOT exist. Old `page-job-detail`
  (index.html:2274–2293) + `openJobListing` (11213) renders header, "WHAT [CO] IS HIRING FOR" AI panel
  (`/api/job-insights`, L1 localStorage 24h + L2 DB 7d cache, costs 1 credit on miss, needs Bearer token),
  "ABOUT THIS ROLE" AI summary, report placeholder, sticky footer (Check company / Save / Apply).
  `/api/job-insights` is referenced NOWHERE in the Next.js app → AI insights entirely inaccessible.
  Architecture decided: a sessionStorage `JobCache` (Next.js equivalent of old global `JOBS` array)
  populated by `/jobs` search results; detail route looks up job by id. Source already extracted (see handoff).

### IMPORTANT — missing workflows / routes / API behaviors (verify each against origin/main)
- ✅ Dashboard alerts/follow-up prompts (Day 7/14/30) — `#dashAlerts` + checks-due indicator DONE.
- ✅ Dashboard survey insight, benchmarks, pipeline insight — `#dashSurveyInsight`/`#dashBenchmarks`/`#dashPipelineInsight` DONE.
- Account settings (dashboard ⚙ `openAccountSettings`) — verify presence (still open).
- Follow-up: persist `responseTimeDays` on app resolve (so pipeline `avgRT` part returns; tracker stage updates / outcome cards / withdrew option).
- Legal page (`app/legal/page.tsx` 68 lines) — likely truncated vs index.html:2064–2108.
- Per-page functional audit (jobs filters/sort/pagination, tracker follow-up system + outcome cards,
  company profile reports/research, feed filters, report submission flow, resume optimize, demand charts,
  profile change-password/delete, employer.html content) — all 🟡 unverified in SITE_PARITY_CHECKLIST.md.

### COSMETIC — design regressions (Phase 2/3)
- Glow/glass system, neon borders, gradient backgrounds — audit `app/globals.css` vs index.html stylesheet.
- Dashboard density, original spacing, typography hierarchy.
- Mobile layouts at 375px across all pages.
- Page transition animations (`fadeIn`/`fadeUp`).

**Rule for next phase:** work CRITICAL → IMPORTANT → COSMETIC. Extract from source, port, build,
update SITE_PARITY_CHECKLIST.md, commit. Do not merge/deploy without owner approval.

---

## Session context

- Live site: seenjobs.io serves from `next-migration` (deployed via `npx vercel --prod` from owner's Mac)
- Vercel constraint: max 12 serverless functions (currently 9 api/*.js + 1 Next.js runtime = 10)
- `main` and `next-migration` have no common ancestor — never merge; sync files individually
- Admin auth: username/password → X-Admin-Token (NOT Supabase auth)

---

## CRITICAL — Broken functionality

These are regressions that affect what currently renders or functions incorrectly on the live site.

### C1. Admin GET payload gap (api/admin-stats.js)
**File**: `api/admin-stats.js`
**Impact**: Admin chart, outcome bars, top-reported list, most-researched list all render empty.
**Missing from GET response**:
- `reports.chart` — 30-day daily bar chart data
- `reports.top_companies` — most reported companies (30d)
- `reports.outcome_breakdown` — ghosted/rejected/interview/offer counts (30d)
- `company_lookups.top` — most researched companies (7d)
**Fix**: Add these 4 aggregations to the GET handler in `api/admin-stats.js`. Edit in place (do not add files).
**Source**: `ADMIN_PARITY_CHECKLIST.md §5`

### C2. Admin logout doesn't call API
**File**: `app/admin/page.tsx`
**Impact**: Server session stays alive 8h after UI logout. Security regression.
**Fix**: Add `POST /api/admin-stats {action:'admin_logout'}` call in `logout()` before clearing sessionStorage.
**Source**: `ADMIN_PARITY_CHECKLIST.md §Auth`

### C3. Admin 403 not handled
**File**: `app/admin/page.tsx`
**Impact**: 403 "Access denied" leaves user stuck on loading/broken state.
**Fix**: Handle `res.status === 403` same as 401 — clear token, show login with "Access denied" message.

### C4. 12 admin sections missing
**File**: `app/admin/page.tsx`
**Impact**: Admin dashboard is 4 sections when old production had 16. Moderator/ops workflows completely broken.
**Missing sections** (porting order per ADMIN_PARITY_CHECKLIST.md):
1. Jobs KPI row (§3) — 2 stat cards; pure GET data, no new API
2. Recent tracker applications feed (§7) — read-only; GET data already returned
3. API Health panel (§14) — errors today/week/DAU; GET data already returned
4. Company-lookup setup note (§4) — conditional amber callout; GET data
5. Recent hiring reports + moderation (§6) — approve/investigate/deny actions
6. Data quality issues queue (§10) — resolve/dismiss actions
7. Reported inactive listings (§9) — remove_listing/deny_report with confirm()
8. Recent jobs browser with period tabs (§8) — POST get_recent_jobs
9. Company deduplication (§11) — scan/auto/manual merge; API contract drift to fix
10. Feature flags (§12) — set_flag/seed_flags selects
11. Duplicate account clusters (§13) — update_cluster/detect_duplicates_by_signals
12. Background job runner (§15) — X-Admin-Token hits /api/refresh-jobs, /api/demand, /api/reports

---

## IMPORTANT — Missing pages and workflows

These are pages or interactions present in old production but absent or incomplete in Next.js.

### I1. Job detail page
**Old**: `page-job-detail` in index.html:2274–2293 — full detail page with AI insights, job description, report section, sticky apply/save footer.
**Current**: No `/jobs/[id]` route exists. Job cards in `/jobs` likely link nowhere for detail view.
**Fix**: Create `app/jobs/[id]/page.tsx` with: header, AI insights panel (POST /api/job-insights), description, report section, sticky apply footer.

### I2. Dashboard alerts panel
**Old**: `#dashAlerts` — follow-up prompts at Day 7/14/30 ("Did they respond?", "Got an interview?", "What happened?"). Core to data acquisition loop.
**Current**: Not rendered in `app/dashboard/page.tsx`.
**Fix**: Compute pending follow-ups from AppStore apps and render alert cards in dashboard.

### I3. Dashboard benchmarks + pipeline insight
**Old**: `#dashBenchmarks` and `#dashPipelineInsight` — industry comparison, smart pipeline insight.
**Current**: Missing from `app/dashboard/page.tsx`.

### I4. Legal page content completeness
**Old**: `index.html:2064–2108` — full ToS + privacy + cookie policy (44 lines of HTML = substantial text).
**Current**: `app/legal/page.tsx` is 68 lines — likely incomplete.
**Fix**: Verify and restore full legal text from `index.html:2064–2108`.

### I5. Account settings modal (dashboard)
**Old**: `openAccountSettings()` — accessible from dashboard ⚙ button.
**Current**: Unclear if the ⚙ button is present on the new dashboard.

---

## COSMETIC — Design regression

Visual/motion/layout issues that don't break functionality but degrade experience vs old production.

### D1. Glow / glass system
**Old**: Radial gradient backgrounds on key pages (jobs, dashboard, admin), card glass effects.
**Current**: Most gradient backgrounds are present inline, but global glass system may have gaps.
**Fix**: Audit `app/globals.css` against old CSS (`index.html:1–1078` stylesheet). Verify all `--card`, `--surface`, box-shadow, border-radius values match.

### D2. Dashboard density
**Old**: Compact dashboard with many info panels visible above the fold.
**Current**: May have excess whitespace. Verify padding/gap values.

### D3. Mobile layouts
**Old**: Responsive breakpoints at 600px for nav, page, stats.
**Current**: Verify all pages have correct mobile behavior.

### D4. Nav active state styling
**Old**: Active page link had specific styling.
**Current**: Verify `components/Nav.tsx` applies active styles.

### D5. Page transition animation
**Old**: `fadeIn .2s ease` on `.page.active`, `fadeUp` on some modals.
**Current**: Next.js page transitions may not have these.

---

## Execution order

### Phase 1 — Admin + API regressions (do first — highest impact, live breakage)

| Task | File(s) | Effort |
|------|---------|--------|
| C1: Fix GET payload (chart, top_cos, outcomes, lookups.top) | `api/admin-stats.js` | M |
| C2+C3: Admin logout API + 403 handling | `app/admin/page.tsx` | S |
| C4a: Jobs KPI + recent apps + API health + setup note | `app/admin/page.tsx` | S |
| C4b: Recent reports + moderation | `app/admin/page.tsx` | M |
| C4c: Issues queue | `app/admin/page.tsx` | M |
| C4d: Inactive listings | `app/admin/page.tsx` | M |
| C4e: Recent jobs browser | `app/admin/page.tsx` | M |
| C4f: Company deduplication | `app/admin/page.tsx` | L |
| C4g: Feature flags | `app/admin/page.tsx` | M |
| C4h: Duplicate clusters | `app/admin/page.tsx` | M |
| C4i: Background job runner | `app/admin/page.tsx` | M |

### Phase 2 — Design parity

| Task | File(s) | Effort |
|------|---------|--------|
| D1: Audit globals.css vs old stylesheet | `app/globals.css` | M |
| D3: Mobile layout audit per page | all pages | L |
| D2: Dashboard density | `app/dashboard/page.tsx` | S |
| D4: Nav active state | `components/Nav.tsx` | S |
| D5: Page transitions | `app/layout.tsx` | S |

### Phase 3 — Missing pages + workflows

| Task | File(s) | Effort |
|------|---------|--------|
| I1: Job detail page | `app/jobs/[id]/page.tsx` (new) | L |
| I2: Dashboard alerts/follow-ups | `app/dashboard/page.tsx` | M |
| I3: Benchmarks + pipeline insight | `app/dashboard/page.tsx` | M |
| I4: Legal page completeness | `app/legal/page.tsx` | S |
| I5: Account settings | `app/dashboard/page.tsx` or modal | M |

### Phase 4 — UX/Pro Max + integrations

- Framer Motion integration (page transitions, micro-animations)
- 21st.dev component audit
- Higgsfield MCP integration
- Premium visual upgrades

---

## Verification protocol

Before marking any section complete:
1. `npm run build` passes
2. Visual comparison against old production source
3. All API calls verified (correct endpoint, auth, response fields)
4. Mobile layout checked at 375px width
5. Update checklist status in this file and relevant checklist doc

---

*Last updated: 2026-06-13. Update as tasks complete.*
