# Site Parity Checklist

Full parity audit: old production SPA (`main:index.html` + `main:employer.html`) vs Next.js port (`next-migration`).

Source of truth: `origin/main:index.html` (13,354 lines), `origin/main:employer.html` (2,647 lines).
A page is COMPLETE only when: visual match + all old functionality + working API calls + mobile layout + `npm run build` passes.

---

## Legend
- ✅ Complete
- 🟡 Partial — exists but missing features
- ❌ Missing entirely
- ⚠️ Different behavior (intentional or needs decision)

---

## Page inventory

### 1. Landing / Homepage (`page-landing` → `app/page.tsx`)
**Old source**: `index.html:1079–1382`
**New source**: `app/page.tsx`, `components/LandingHero.tsx`, `components/LandingMarketingSections.tsx`

| Element | Status | Notes |
|---------|--------|-------|
| Hero headline + CTA | 🟡 | Exists; verify glow/glass effect matches production |
| "How it works" section | 🟡 | Check section-by-section against old |
| Stats bar (jobs, companies, users) | 🟡 | Verify live data fetch |
| Company logos / trust row | 🟡 | Check if present |
| Social proof / testimonials | 🟡 | Check if present |
| Footer links | 🟡 | Verify all links map correctly |
| Mobile hero layout | 🟡 | Needs visual verification |
| Page background glow gradients | 🟡 | Radial gradient matches old |

**Status: 🟡 — needs visual comparison against index.html:1079–1382**

---

### 2. Dashboard (`page-seeker-dash` → `app/dashboard/page.tsx`)
**Old source**: `index.html:1512–1633`

| Element | Status | Notes |
|---------|--------|-------|
| Greeting (time-of-day + first name) | ✅ | |
| Stat row (Active / Response rate / Ghosted / Hired) | ✅ | |
| Health score panel | 🟡 | Exists; old version has a more detailed callout with `seekerHealthScore` |
| Active applications list | ✅ | |
| Alerts / follow-up prompts (`dashAlerts`) | ✅ | Dynamic alerts panel: stale apps (flat >30d) + ghost-surge (Supabase `reports` read, graceful RLS fallback) + red count badge + "All clear ✓" empty state. "N checks due →" indicator added to greeting → `/tracker`. (Follow-up Q&A prompts themselves already live in the tracker.) |
| Survey insight (`dashSurveyInsight`) | ✅ | Green "✓ {feature} on" card from `profile.onboarding_survey.frustration` (5 frustration→feature mappings) |
| Benchmarks panel (`dashBenchmarks`) | ✅ | "Career Benchmarks" 2×2 grid (Response/Interview/Offer/Ghost rate vs industry avg, percentile + color); gated n≥3 & terminal≥2 |
| Badges panel (`dashBadges`) | 🟡 | BadgeStore exists in lib; verify rendering |
| Pipeline insight (`dashPipelineInsight`) | ✅ | "Your pipeline" band (checks due → / overdue / personal RR / ghosted / hired); gated apps≥2. `avgRT` omitted (responseTimeDays not tracked); overdue uses flat >33d |
| Account settings button | 🟡 | Old has ⚙ button; new may lack it |
| Sign out button on dashboard | 🟡 | Verify present |
| "Find more jobs →" CTA | ✅ | |

**Status: 🟢 — alerts, checks-due indicator, survey insight, benchmarks, pipeline insight all DONE.** Remaining minor follow-ups: account settings (⚙), and `responseTimeDays` tracking on resolve (so pipeline `avgRT` can return).

---

### 3. Jobs search (`page-jobs` → `app/jobs/page.tsx`)
**Old source**: `index.html:1684–1760`

| Element | Status | Notes |
|---------|--------|-------|
| Search bar (query + location) | ✅ | **Fixed 2026-06-13**: client now POSTs `{query,location,radius}` (was GET `?q=` → 405). DB-first→online→cache path now reachable. |
| Job cards with company, role, city, source | ✅ | |
| Save job (♡) | ✅ | SavedJobs store |
| Apply & Optimize CTA | ✅ | |
| Filter controls | 🟡 | Verify filter options match old |
| Sort controls | 🟡 | Verify |
| Pagination / infinite scroll | 🟡 | Verify |
| "Check company →" inline link | 🟡 | |
| Ghost score inline badge | 🟡 | |
| Mobile job card layout | 🟡 | |

**Status: 🟡 — likely functionally complete; needs visual verification**

---

### 4. Job detail (`page-job-detail` → no standalone page)
**Old source**: `index.html:2274–2293`

| Element | Status | Notes |
|---------|--------|-------|
| Job title, company, city, source | ✅ | Header: logo, title, company · 📍location, score ring, type/level/salary chips |
| AI job insights panel (`jlInsights`) | ✅ | `/api/job-insights` with Bearer token; L1 localStorage 24h cache; what_they_want/hidden_requirements/insider_tip; credits + unavailable fallbacks |
| Job description (`jlDesc`) | ✅ | AI `description_summary` or formatted raw text (`formatDesc`), paragraph split, strips leading "Category:" |
| Report a listing section (`jlReport`) | ✅ | "Report Your Experience — COMING SOON" placeholder (parity with old) |
| "Check company →" link | ✅ | Links to `/company/[slug]` |
| Save (♡) + Apply button sticky footer | ✅ | Save toggle (SavedJobsStore) + external Apply link |
| Back to jobs nav | ✅ | `router.back()` → fallback `/jobs` |
| Availability stale/expired warnings | ✅ | Rendered only if `availability_status` present (no invented data) |

**Status: ✅ — implemented as `app/jobs/[id]/page.tsx` (new route).** Job data flows via `lib/stores/JobCache.ts` (sessionStorage — Next.js equivalent of the old global `JOBS` array), populated by `/jobs` search results. Cards route to the detail page on click + a "View details + AI insights →" link. Direct-link/refresh shows a graceful "run a search" fallback.

**Follow-up parity items (tracked, not blocking):**
- `Apply & Optimize` keeps the existing external-link behavior; the full resume-optimize modal flow (old `jlApplyClick` → `openApplyModal`) is NOT yet ported.
- Tier A quick-preview modal (`openJobDetailModal`) intentionally skipped — card goes straight to the full detail page.
- `availability_status` isn't yet returned by `/api/jobs` search mapping, so warnings stay dormant until that field is surfaced.

---

### 5. Company profile (`page-company` → `app/company/[slug]/page.tsx`)
**Old source**: `index.html:1880–1920`

| Element | Status | Notes |
|---------|--------|-------|
| Company name + score + badge | 🟡 | 274-line file exists |
| Ghost rate / interview rate / offer rate | 🟡 | |
| Hiring reports feed | 🟡 | |
| Report submission | 🟡 | |
| "Research this company" AI call | 🟡 | |
| Related jobs | 🟡 | |
| Mobile layout | 🟡 | |

**Status: 🟡 — exists; needs visual comparison against index.html:1880–1920**

---

### 6. Companies directory (`page-companies` → `app/companies/page.tsx`)
**Old source**: `index.html:1383–1409`

| Element | Status | Notes |
|---------|--------|-------|
| Company search | 🟡 | 181-line file |
| Company cards with score badges | 🟡 | |
| Score color coding (red/amber/green) | 🟡 | |
| "Most searched" / trending | 🟡 | |
| Empty state | 🟡 | |

**Status: 🟡 — exists; needs visual verification**

---

### 7. Community feed (`page-feed` → `app/feed/page.tsx`)
**Old source**: `index.html:1921–1963`

| Element | Status | Notes |
|---------|--------|-------|
| Hiring reports cards | 🟡 | 219-line file |
| Outcome color coding | 🟡 | |
| Company/role/city labels | 🟡 | |
| Relative timestamps | 🟡 | |
| Filter by outcome | 🟡 | |
| Load more / pagination | 🟡 | |

**Status: 🟡 — exists; needs verification**

---

### 8. Report submission (`page-report` → `app/report/page.tsx`)
**Old source**: `index.html:1964–2020`

| Element | Status | Notes |
|---------|--------|-------|
| Company + role + city + platform fields | 🟡 | 315-line file |
| Outcome selector (ghosted/rejected/interview/offer) | 🟡 | |
| Report text area | 🟡 | |
| Anonymous toggle | 🟡 | |
| Auth gate (must be logged in) | 🟡 | |
| Thank you / success state | 🟡 | |

**Status: 🟡 — exists; needs verification**

---

### 9. Resume builder (`page-resume` → `app/resume/page.tsx`)
**Old source**: `index.html:1781–1879`

| Element | Status | Notes |
|---------|--------|-------|
| Resume upload (PDF) | ✅ | **Fixed 2026-06-13**: parse call now sends `Authorization: Bearer` via `lib/aiHeaders.ts` (was 401) |
| AI parse → structured data | ✅ | POST `/api/resume` action:parse + Bearer token; `credits_required` handled |
| Employment history display | 🟡 | |
| Skills section | 🟡 | |
| Resume-optimize for job (AI) | ✅ | scanner/coach/proposal tools now send Bearer token; `credits_required` surfaced |
| Credit cost label | 🟡 | |
| Download optimized resume | 🟡 | |

**Status: 🟡 — exists; needs verification**

---

### 10. Application tracker (`page-tracker` → `app/tracker/page.tsx`)
**Old source**: `index.html:2207–2273`

| Element | Status | Notes |
|---------|--------|-------|
| Add application form | 🟡 | 319-line file |
| Applications list (kanban or table) | 🟡 | |
| Stage labels (Applied/Screening/Interview/Offer/Rejected/Ghosted) | 🟡 | |
| Status update (swipe/click) | 🟡 | |
| Event history per application | 🟡 | EventStore in lib |
| Follow-up prompts (Day 7/14/30) | 🟡 | |
| Filter by status | 🟡 | |
| Outcome card generation | 🟡 | |

**Status: 🟡 — exists; needs verification of follow-up system completeness**

---

### 11. Market demand (`page-demand` → `app/demand/page.tsx`)
**Old source**: `index.html:1761–1780`

| Element | Status | Notes |
|---------|--------|-------|
| Role demand heatmap / chart | 🟡 | 280-line file |
| City breakdown | 🟡 | |
| Demand score by role | 🟡 | |
| Date range controls | 🟡 | |

**Status: 🟡 — exists; needs verification**

---

### 12. Profile (`page-profile` → `app/profile/page.tsx`)
**Old source**: `index.html:2109–2206`

| Element | Status | Notes |
|---------|--------|-------|
| Name / email display | 🟡 | 204-line file |
| Change password | 🟡 | |
| Account type (seeker/employer) | 🟡 | |
| Delete account | 🟡 | |
| Notification preferences | 🟡 | |

**Status: 🟡 — exists; needs verification against index.html:2109–2206**

---

### 13. Employers / Recruiters (`page-recruiters` → `app/employers/page.tsx`)
**Old source**: `index.html:2021–2038` + `main:employer.html`

| Element | Status | Notes |
|---------|--------|-------|
| Employer hero | 🟡 | 136-line file |
| Pricing tiers for employers | 🟡 | |
| Feature list | 🟡 | |
| Contact/CTA | 🟡 | |
| employer.html full content | 🟡 | Old had a separate file (2,647 lines); verify all content is ported |

**Status: 🟡 — exists; employer.html content needs full verification**

---

### 14. FAQ (`page-faq` → `app/faq/page.tsx`)
**Old source**: `index.html:2039–2057`

| Element | Status | Notes |
|---------|--------|-------|
| Question/answer accordion | 🟡 | 124-line file |
| All FAQ items from old | 🟡 | Verify count and content |

**Status: 🟡 — exists; content needs verification**

---

### 15. Pricing (`page-pricing` → `app/pricing/page.tsx`)
**Old source**: `index.html:2058–2063`

| Element | Status | Notes |
|---------|--------|-------|
| Free vs Pro tiers | 🟡 | 191-line file |
| Feature comparison | 🟡 | |
| CTA buttons | 🟡 | |

**Status: 🟡 — exists; needs verification**

---

### 16. Legal (`page-legal` → `app/legal/page.tsx`)
**Old source**: `index.html:2064–2108`

| Element | Status | Notes |
|---------|--------|-------|
| Terms of service | 🟡 | 68-line file (very short — may be truncated) |
| Privacy policy | 🟡 | |
| Cookie policy | 🟡 | |

**Status: 🟡 — 68 lines is very short; verify full content is present**

---

### 17. Login / Auth (`page-login` → `app/login/page.tsx`)
**Old source**: `index.html:1410–1511`

| Element | Status | Notes |
|---------|--------|-------|
| Sign in (email + password) | ✅ | |
| Sign up (seeker vs employer flow) | ✅ | |
| Email verification step | ✅ | |
| Password reset | ⚠️ | Old: custom 8-digit OTP code. New: Supabase email link. Different UX — acceptable. |
| "Forgot password" link | ✅ | |
| Enter key submits | 🟡 | Verify |
| Error states | 🟡 | Verify all error messages match |

**Status: 🟡 — functionally complete; reset flow is intentionally different (link vs OTP)**

---

### 18. Admin (`page-admin` → `app/admin/page.tsx`)
**See ADMIN_PARITY_CHECKLIST.md for full audit.**

> ⚠️ **STALE TABLE BELOW — superseded 2026-06-14.** The rows below were written before admin recovery commits merged. Admin is now **16/16 functionally complete** on `next-migration`. Do not act on the ❌ rows. See `ADMIN_PARITY_CHECKLIST.md` milestone section for the authoritative current state.

| Element | Status |
|---------|--------|
| Auth (login/logout) | ✅ |
| Header + KPI boxes | ✅ |
| Jobs KPI | ✅ |
| Reports chart + outcomes | ✅ |
| Recent hiring reports + moderation | ✅ |
| Recent tracker apps | ✅ |
| Recent jobs browser | ✅ |
| Reported inactive listings | ✅ |
| Data quality issues queue | ✅ |
| Company deduplication | ✅ |
| Feature flags | ✅ |
| Duplicate account clusters | ✅ |
| API Health | ✅ |
| Background job runner | ✅ |

**Status: ✅ — 16/16 sections complete. Remaining work is visual polish only. See ADMIN_PARITY_CHECKLIST.md.**

---

### 19. Navigation (`<nav>` → `components/Nav.tsx`)
**Old source**: `index.html:1–78` (nav HTML) + JS nav helpers

| Element | Status | Notes |
|---------|--------|-------|
| Logo + wordmark | 🟡 | |
| Nav links (Jobs / Companies / Feed / Demand / Resume) | 🟡 | |
| Auth state: logged in vs out | 🟡 | |
| Mobile hamburger menu | 🟡 | |
| Active page highlight | 🟡 | |
| Employer mode nav | 🟡 | |
| Credit balance display | 🟡 | |

**Status: 🟡 — exists; needs verification**

---

## Summary table

| # | Page | Old ID | Next.js route | Status |
|---|------|--------|---------------|--------|
| 1 | Landing | page-landing | `/` | 🟡 |
| 2 | Dashboard | page-seeker-dash | `/dashboard` | 🟢 (account settings = follow-up) |
| 3 | Jobs | page-jobs | `/jobs` | 🟡 |
| 4 | Job detail | page-job-detail | `/jobs/[id]` | ✅ (Apply-optimize modal = follow-up) |
| 5 | Company profile | page-company | `/company/[slug]` | 🟡 |
| 6 | Companies | page-companies | `/companies` | 🟡 |
| 7 | Feed | page-feed | `/feed` | 🟡 |
| 8 | Report | page-report | `/report` | 🟡 |
| 9 | Resume | page-resume | `/resume` | 🟡 |
| 10 | Tracker | page-tracker | `/tracker` | 🟡 |
| 11 | Demand | page-demand | `/demand` | 🟡 |
| 12 | Profile | page-profile | `/profile` | 🟡 |
| 13 | Employers | page-recruiters | `/employers` | 🟡 |
| 14 | FAQ | page-faq | `/faq` | 🟡 |
| 15 | Pricing | page-pricing | `/pricing` | 🟡 |
| 16 | Legal | page-legal | `/legal` | 🟡 |
| 17 | Login/Auth | page-login + page-reset | `/login` | 🟡 |
| 18 | Admin | page-admin | `/admin` | ✅ 16/16 complete |
| 19 | Nav | `<nav>` | `components/Nav.tsx` | 🟡 |

**Job detail page now exists at `/jobs/[id]`. Admin 16/16 functionally complete. All other pages exist; visual/behavioral verification remains.**

---

## Highest priority site gaps (outside admin)

1. **Job detail page** (`page-job-detail`) — full SPA page with AI insights, description, report section, sticky apply footer. Needs `/jobs/[id]/page.tsx` or inline expansion.
2. **Dashboard alerts panel** — follow-up prompts at Day 7/14/30 are core to the app's data acquisition loop.
3. **Legal page** (68 lines) — likely truncated; verify ToS + privacy are complete.
4. **Dashboard benchmarks + pipeline insight** — important for user engagement.

---

*Last updated: 2026-06-13. Update status as pages are completed.*
