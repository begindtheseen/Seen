# Smoke Test Runbook — Seen Preview Deploy
**Branch:** `next-migration`  
**Purpose:** Manual validation of critical paths before promoting to production.  
**Env:** Preview URL from Vercel (triggered per `PREVIEW_DEPLOY_CHECKLIST.md` §2).

Run all four user-type sections in order. Do not skip. Each test row: **Action → Expected → Pass → Fail**.

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Pass |
| ❌ | Fail — stop and log |
| ⚠️ | Degraded — note and continue |
| 🔑 | Requires credentials |

---

## 1. Anonymous User

> No account. Not logged in. Tests the public funnel.

---

### 1.1 Landing Page Loads

| | |
|---|---|
| **Action** | Navigate to preview URL root `/` |
| **Expected** | Hero renders with headline, subhead, search inputs (job title + city), CTA button. Ticker strip visible below hero. Nav shows "Sign In" and "Get Started" links. |
| **Pass** | All above elements render within 3s. No console errors. |
| **Fail** | Blank page, 500 error banner, missing hero, ticker absent, or nav links absent. |

---

### 1.2 Job Search

| | |
|---|---|
| **Action** | Enter "Software Engineer" in job title field, "Austin, TX" in city field. Click "Search" (or press Enter). |
| **Expected** | Spinner appears, then job cards render. Each card shows: job title, company name, location, score ring, waste badge. |
| **Pass** | ≥1 card renders. Network tab shows `/api/jobs` → 200. No 401/403/500. |
| **Fail** | 0 cards with no "no results" message, `/api/jobs` returns non-200, or error banner appears. |

---

### 1.3 Job Detail — From Search

| | |
|---|---|
| **Action** | Click any job card from step 1.2. |
| **Expected** | Routes to `/jobs/[id]`. Renders: job title, company, stat grid, apply button in sticky footer. AI insights section renders (may show "sign in for insights" if unauthenticated). |
| **Pass** | All sections render. No 404, no blank screen, no JS error in console. |
| **Fail** | Fallback "job not found" screen shown, 404 page, or any section is a blank box. |

---

### 1.4 Job Detail — Direct URL / Hard Refresh

| | |
|---|---|
| **Action** | Copy the URL from step 1.3. Open a new private browser tab, paste the URL, press Enter. |
| **Expected** | Page loads from DB (no session cache). Same content as step 1.3. |
| **Pass** | Job detail renders completely from cold load. No fallback screen. |
| **Fail** | "Job not found" fallback shown, or blank page. (This was a known bug — fixed in `4ee7ac4`.) |

---

### 1.5 Company Scoreboard

| | |
|---|---|
| **Action** | Navigate to `/companies`. |
| **Expected** | Table or card list of companies with grade letters, score bars, ghost rate, wait time. Sort controls visible. |
| **Pass** | ≥1 company row renders. Sort by "Ghost rate" changes order. Search input filters list. |
| **Fail** | Empty list with no "no data" message, sort controls absent, or network error banner. |

---

### 1.6 Company Detail — From Scoreboard

| | |
|---|---|
| **Action** | Click any company from step 1.5. |
| **Expected** | Routes to `/company/[slug]`. Score ring, company name, 7 tabs (Overview, Reports, Process Score, Ghost Surge, etc.) render. |
| **Pass** | Tabs render and are clickable. "Reports" tab shows report cards (may be empty). "Process Score" tab shows funnel. No JS errors. |
| **Fail** | 404, blank page, tabs missing, or any tab click throws an error. |

---

### 1.7 Report Submission — Anonymous

| | |
|---|---|
| **Action** | Navigate to `/report`. Fill: Company = "Test Co", Role = "Engineer", City = "Austin TX". Select outcome = "Ghosted". Click "Submit anonymously →". |
| **Expected** | Spinner (moderation), then success state: ✅ card with company name + "View feed →" link. |
| **Pass** | Success card renders. Network tab shows `/api/reports` → 200 (or 201). No auth prompt. |
| **Fail** | Auth redirect (page should allow anonymous submit), 500 error, or form hangs after submit. |

---

### 1.8 Feed Visible

| | |
|---|---|
| **Action** | Navigate to `/feed`. |
| **Expected** | Report cards visible with outcome color-coding (Ghosted = red, Hired = green, etc.). |
| **Pass** | ≥1 card renders (the report from 1.7 should appear at top). Filter buttons visible. |
| **Fail** | Blank feed, auth gate on page load, or submitted report from 1.7 absent after 30s. |

---

### 1.9 Sign-In Gate on Protected Routes

| | |
|---|---|
| **Action** | Navigate to `/tracker` while not logged in. |
| **Expected** | Redirect to `/login` or sign-in gate renders inside the page. NOT a crash or blank page. |
| **Pass** | Sign-in prompt or redirect. Page does not throw JS error. |
| **Fail** | Blank white page, JS crash, or full tracker UI exposed without auth. |

---

### 1.10 Footer Navigation

| | |
|---|---|
| **Action** | Scroll to page footer. Click each footer link: Jobs, Resume AI, Employers, Pricing, FAQ, Legal, Contact. |
| **Expected** | Each link navigates to its target page. No 404s. |
| **Pass** | All 7 links resolve to a page with actual content (not blank). |
| **Fail** | Any link returns 404, blank page, or footer links are absent. |

---

## 2. New User (Account Registration)

> Fresh account. Tests signup, onboarding, and first-use of key features.

---

### 2.1 Sign-Up Flow

| | |
|---|---|
| **Action** | Navigate to `/signup` (or click "Get Started" in nav). Fill email + password. Submit. |
| **Expected** | Account created. Either: (a) email confirmation sent + confirmation page, or (b) auto-logged in + redirected to dashboard/tracker. |
| **Pass** | No 400/500 error. User is either shown confirmation instructions or lands on an authenticated page. |
| **Fail** | Form submits to 500, duplicate-email error on fresh address, or redirect loop. |

> **Note:** If email confirmation is enabled in Supabase Auth, confirm the email before continuing. Check `PREVIEW_DEPLOY_CHECKLIST.md` §4 for Supabase Auth settings.

---

### 2.2 Sign-In After Registration

| | |
|---|---|
| **Action** | Sign in with the credentials from 2.1. |
| **Expected** | Authenticated session established. Nav shows user avatar or account indicator. |
| **Pass** | `/api/auth` (or Supabase session) returns 200. User identifier visible in nav. |
| **Fail** | "Invalid credentials" on correct password, session not established, or redirect loop. |

---

### 2.3 Tracker — First Application

| | |
|---|---|
| **Action** | Navigate to `/tracker`. Click "+ Track manually". Fill: Company = "Acme Corp", Role = "PM", City = "Remote", Platform = "LinkedIn". Submit. |
| **Expected** | Application card appears with status "Applied", stage "Applied". |
| **Pass** | Card renders immediately. Hard refresh → card persists (localStorage or DB backed). |
| **Fail** | Card absent after submit, or disappears on refresh. |

---

### 2.4 Resume Upload

| | |
|---|---|
| **Action** | Navigate to `/resume`. Drag-and-drop or file-select a PDF < 1MB. |
| **Expected** | File name appears in UI. "Parse resume · 1 credit" button enabled. |
| **Pass** | Button enabled, file name visible, no JS error. |
| **Fail** | File rejected, button disabled with no explanation, or JS crash on drop. |

---

### 2.5 AI Credits — Zero-Credit State

| | |
|---|---|
| **Action** | Click "Parse resume · 1 credit" with a new account (0 AI credits). |
| **Expected** | Response shows "credits required" message or "You're out of AI credits" — NOT a crash or blank response. |
| **Pass** | User-readable message rendered. No JS exception. No 500 in network tab. |
| **Fail** | Blank UI, uncaught exception, or 500 error without message. |

> **To seed credits:** Use admin panel → `POST /api/admin-stats { action: 'set_pro', user_id: '...' }` or set `ai_credits.balance = 10` in Supabase directly. Then re-run tests 2.6–2.7.

---

### 2.6 Resume Parse (With Credits)

| | |
|---|---|
| **Action** | After seeding credits, click "Parse resume · 1 credit". |
| **Expected** | Spinner → structured output: experience sections, skills, education. |
| **Pass** | Structured output renders. Network tab: `/api/resume` → 200, `Authorization: Bearer ...` header present. No 401. |
| **Fail** | 401 (Bearer token not attached), 500, or response renders empty. |

---

### 2.7 Job Save (Bookmark)

| | |
|---|---|
| **Action** | From `/jobs`, search and open a job. Click the save/bookmark (♡) button. Navigate away and return to the job. |
| **Expected** | ♡ stays filled/saved across navigation. |
| **Pass** | Save state persists after route change. No 500 on save action. |
| **Fail** | Save state resets on navigation, or button throws an error. |

---

### 2.8 "Optimize Resume" → Resume Page Link

| | |
|---|---|
| **Action** | On any job detail page, click "✨ Optimize resume first →". |
| **Expected** | Routes to `/resume?company=...&role=...`. Query params pre-populate job context. |
| **Pass** | URL has `company` and `role` params. Resume page acknowledges the job context (e.g., pre-filled or visible label). |
| **Fail** | Link absent, 404, or query params absent from URL. |

---

### 2.9 Sign Out

| | |
|---|---|
| **Action** | Click sign out from nav or profile menu. |
| **Expected** | Session cleared. Redirected to `/` or `/login`. Protected routes no longer accessible without re-auth. |
| **Pass** | Supabase session cookie/token cleared. `/tracker` redirect to login after sign out. |
| **Fail** | Session persists after sign out, or page crashes on sign-out click. |

---

## 3. Existing User

> Account with prior data: saved jobs, applications, submitted reports. Tests persistence, follow-up system, and report history.

> **Setup:** Either use a seeded test account or the account from §2 after completing §2.3.

---

### 3.1 Tracker Loads With Existing Data

| | |
|---|---|
| **Action** | Sign in. Navigate to `/tracker`. |
| **Expected** | Existing application cards load. Stages, companies, and dates match what was entered. |
| **Pass** | Cards render without flash. Data matches source (localStorage or DB). |
| **Fail** | Tracker empty when data should exist, or data belongs to wrong user. |

---

### 3.2 Follow-Up Prompt (7-Day)

| | |
|---|---|
| **Action** | Find an application added 7+ days ago (or seed one with `addedAt` backdated). |
| **Expected** | Follow-up card appears: "Did they respond?" with [Yes] / [No] buttons. |
| **Pass** | Prompt card visible. Clicking "No" moves app to Ghosted and shows outcome card. |
| **Fail** | Follow-up never appears, or buttons crash on click. |

---

### 3.3 Ghosted → Outcome Card

| | |
|---|---|
| **Action** | Click "No" on a 7-day follow-up prompt (from 3.2). |
| **Expected** | Application moves to "Ghosted" stage. Outcome card renders with ghost icon and elapsed time. |
| **Pass** | Stage pill shows "Ghosted". Outcome card visible. No JS error. |
| **Fail** | Card disappears, stage doesn't update, or outcome card absent. |

---

### 3.4 Follow-Up → Interview Path

| | |
|---|---|
| **Action** | On a different application, click "Yes" on the follow-up prompt. |
| **Expected** | App moves to "Interviewing" stage. Stage pill updates. |
| **Pass** | Stage shows "Interviewing" immediately. Persists on hard refresh. |
| **Fail** | Stage doesn't update or reverts on refresh. |

---

### 3.5 Tracker Persistence (Hard Refresh)

| | |
|---|---|
| **Action** | Add a new application. Hard-refresh the page (Ctrl+Shift+R). |
| **Expected** | All applications still present including the one just added. |
| **Pass** | Data unchanged after refresh. (localStorage-backed — tab-local; DB-backed — any device.) |
| **Fail** | Any application disappears on refresh. |

---

### 3.6 Report History in Feed

| | |
|---|---|
| **Action** | Navigate to `/feed`. Look for a report submitted by the test account. |
| **Expected** | Report visible in feed with correct company, outcome, and role. |
| **Pass** | Report found. Company name and outcome match what was submitted. |
| **Fail** | Report absent, or data scrambled (wrong company/outcome shown). |

---

### 3.7 Company Score Updated by Report

| | |
|---|---|
| **Action** | Navigate to `/company/[slug]` for the company used in the test report. |
| **Expected** | Report count includes the submitted report. If multiple Ghosted reports exist, ghost rate reflects them. |
| **Pass** | Report count ≥ 1. "Reports" tab shows the submitted report. |
| **Fail** | Report count unchanged after submission, or "Reports" tab empty when it shouldn't be. |

---

### 3.8 Profile Page

| | |
|---|---|
| **Action** | Navigate to `/profile` (or account settings). |
| **Expected** | Name, city, experience level fields visible and editable. Change password form present. Delete account option present. |
| **Pass** | All fields render. Edit + save cycle works (field value persists after save). |
| **Fail** | 404, blank page, or save throws a 500. |

---

### 3.9 AI Insights on Job Detail (With Credits)

| | |
|---|---|
| **Action** | Sign in with an account that has AI credits. Navigate to any job detail. |
| **Expected** | AI insights panel loads (not "unavailable", not "sign in"). Shows insights, strengths, or analysis. |
| **Pass** | Insights panel renders content. Network tab: relevant API call → 200 with `Authorization: Bearer ...` header. |
| **Fail** | 401 in network tab, blank insights box, or "unavailable" shown when credits are present. |

---

### 3.10 AI Credits — Depletion Message

| | |
|---|---|
| **Action** | With a zero-credit account, navigate to `/jobs/[id]`. |
| **Expected** | AI insights panel shows "You're out of AI credits" (or equivalent) — not a blank box or crash. |
| **Pass** | User-readable credit depletion message. No JS exception. |
| **Fail** | Blank box, uncaught exception, or same output as a creditted account. |

---

## 4. Admin User

> Uses admin credentials (`ADMIN_USERNAME` / `ADMIN_PASSWORD`). Tests the admin dashboard, all panels, and session management.

> Admin auth is **separate from Supabase** — it uses `admin_sessions` table with username/password.

---

### 4.1 Admin Login

| | |
|---|---|
| **Action** | Navigate to `/admin`. Enter `ADMIN_USERNAME` and `ADMIN_PASSWORD`. Click "Sign in". |
| **Expected** | Dashboard loads. KPI boxes render: total users, total reports, total applications (numbers or 0). |
| **Pass** | Dashboard loads without redirect loop. KPI boxes populated (any number ≥ 0). |
| **Fail** | "Invalid credentials" on correct creds, redirect loop, blank page, or KPI boxes show NaN/undefined. |

---

### 4.2 KPI Refresh

| | |
|---|---|
| **Action** | Click "↻ Refresh" button in the dashboard. |
| **Expected** | Timestamp updates. KPI numbers reload (may be same values — that's fine). |
| **Pass** | Timestamp changes to current time. Network tab: `/api/admin-stats` → 200 with `X-Admin-Token` header. |
| **Fail** | Button does nothing, 403 on refresh, or timestamp doesn't update. |

---

### 4.3 Reports Chart

| | |
|---|---|
| **Action** | View the reports chart panel. |
| **Expected** | Bar chart renders (may have 0 bars if no data). No error state. |
| **Pass** | Chart canvas or SVG renders. No "chart failed to load" message. |
| **Fail** | Blank chart area, JS exception on chart render, or error message. |

---

### 4.4 Recent Jobs Browser — Today Tab

| | |
|---|---|
| **Action** | Find "Recent Jobs" panel. Click "Today" tab. |
| **Expected** | Job rows appear, or "0 today" message. Either is acceptable. |
| **Pass** | Tab content renders (rows or empty state). No crash on tab click. |
| **Fail** | Tab click throws error, blank panel, or "Today" tab absent. |

---

### 4.5 Feature Flags Panel

| | |
|---|---|
| **Action** | Find the feature flags panel in the admin dashboard. |
| **Expected** | Feature flags listed with toggle switches. "Seed defaults" button present. |
| **Pass** | ≥1 flag visible. Toggle click fires a network request and updates state. |
| **Fail** | Flags panel absent, toggles don't fire requests, or "Seed defaults" absent. |

---

### 4.6 Background Job Runner — Refresh Jobs

| | |
|---|---|
| **Action** | Find background job runner panel. Click "▶ Run" next to "Refresh Jobs". |
| **Expected** | Button changes to "⏳ Running…". After completion, a result line appears showing success or count. |
| **Pass** | Status changes and result line renders. Network tab shows the job API call → 200. |
| **Fail** | Button stays "▶ Run" with no state change, or 500 on job trigger. |

---

### 4.7 User Management (if present)

| | |
|---|---|
| **Action** | Navigate to the Users section of admin (if tab exists). Search for the test account email. |
| **Expected** | User record found. AI credit balance visible. Role/status visible. |
| **Pass** | User row renders with email, credits, and basic metadata. |
| **Fail** | Search returns no results for a known account, or user table absent. |

---

### 4.8 Set Pro / Seed Credits via Admin

| | |
|---|---|
| **Action** | From admin, trigger `action: 'set_pro'` for the test user account (via Users panel or direct API call with admin token: `POST /api/admin-stats { "action": "set_pro", "user_id": "..." }` with `X-Admin-Token` header). |
| **Expected** | User's AI credit balance updated to a non-zero value. |
| **Pass** | API returns 200. Verified by checking `ai_credits` in Supabase or by re-running test 2.6. |
| **Fail** | 403 (admin token not attached), 400 (bad payload), or 500 (DB error). |

---

### 4.9 Admin Session Expiry Check

| | |
|---|---|
| **Action** | Open browser DevTools → Application → sessionStorage. Find `admin_token` key. |
| **Expected** | Token is present and is a non-empty string while logged in. |
| **Pass** | `admin_token` key exists with a value. |
| **Fail** | `admin_token` absent while dashboard is displayed (auth check would fail on next action). |

---

### 4.10 Admin Sign-Out — Clean Session

| | |
|---|---|
| **Action** | Click "Sign out" in admin. |
| **Expected** | Server-side session invalidated via `POST /api/admin-stats { action: 'logout' }`. Redirected to `/admin` login form. `admin_token` cleared from sessionStorage. |
| **Pass** | Network tab shows logout POST → 200. Login form renders. DevTools sessionStorage: `admin_token` absent. Navigating to `/admin/[protected-section]` redirects back to login. |
| **Fail** | Logout fires no network request, session persists (dashboard accessible without re-login), or `admin_token` remains in sessionStorage. |

---

## Sign-Off

Complete all 4 sections before promoting to production:

| Section | Tests | Tester | Result | Notes |
|---------|-------|--------|--------|-------|
| 1. Anonymous | 1.1–1.10 | | | |
| 2. New User | 2.1–2.9 | | | |
| 3. Existing User | 3.1–3.10 | | | |
| 4. Admin | 4.1–4.10 | | | |

**Total: 39 test cases**

Any ❌ is a **blocking failure** — do not promote until resolved.  
Any ⚠️ is a **non-blocking note** — document and decide intentionality before promoting.

---

*Runbook: next-migration preview smoke test. Created 2026-06-14.*
