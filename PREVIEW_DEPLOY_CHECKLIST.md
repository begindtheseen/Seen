# Preview Deploy Checklist — Seen
**Branch:** `next-migration`  
**Last build:** ✅ 19 routes, 0 TypeScript errors (HEAD `4ee7ac4`)  
**Purpose:** Gate checklist before Brandon promotes to production.

Do not skip steps. Check each box before proceeding to the next section.

---

## 1. Pre-Deploy Build Verification

Run locally before triggering Vercel build:

```bash
git checkout next-migration
git pull origin next-migration
npm ci
npm run build
```

- [ ] `npm run build` exits 0 with no errors
- [ ] 19 routes listed (○ Static or ƒ Dynamic — no red ✗)
- [ ] Zero TypeScript errors in build output
- [ ] `/company/[slug]` listed as ƒ (Dynamic) — this is the one route that uses the Next.js runtime slot

**Serverless function cap:** 11 declared (`api/*.js`) + 1 Next.js runtime = 12 (at Vercel Pro limit). Do not add new `api/*.js` files.

---

## 2. Trigger Preview Deployment

Vercel does NOT auto-build commits authored by the `claude` bot. To trigger:

**Option A — Owner GitHub web edit (preferred):**
1. Go to `github.com/begindtheseen/Seen`
2. Open any file on `next-migration` (e.g. `package.json`)
3. Make a whitespace edit, commit directly to `next-migration`
4. Vercel will detect the owner-authored commit and build

**Option B — Deploy Hook:**
```bash
curl -X POST "https://api.vercel.com/v1/integrations/deploy/prj_P2SoPxsy9RpdoJfVUqqg6RslWXV5/6kpPtZBS1w"
```

**Option C — Vercel CLI from owner's Mac:**
```bash
vercel --prod --token=$VERCEL_TOKEN
```

- [ ] Deployment triggered
- [ ] Build starts in Vercel dashboard (not "no deployment" state)
- [ ] Build completes green (no vulnerability blocks, no compile errors)
- [ ] Preview URL is available

---

## 3. Environment Variables Verification

In Vercel dashboard → Project Settings → Environment Variables, verify ALL of the following are set for the `next-migration` branch (or all branches):

### Required — Core
- [ ] `SUPABASE_URL` — e.g. `https://xxxx.supabase.co`
- [ ] `SUPABASE_ANON_KEY` — public, safe in frontend
- [ ] `SUPABASE_SERVICE_KEY` — server-only, must NOT appear in client bundles
- [ ] `NEXT_PUBLIC_SUPABASE_URL` — same as `SUPABASE_URL`, prefixed for client
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` — same as `SUPABASE_ANON_KEY`, prefixed for client

### Required — AI
- [ ] `ANTHROPIC_API_KEY` — Claude API key for job insights, resume analysis, moderation

### Required — Admin
- [ ] `ADMIN_EMAIL` — controls `/api/admin-stats` access (used in email-based admin check if present)
- [ ] `ADMIN_USERNAME` — first admin account bootstrap username
- [ ] `ADMIN_PASSWORD` — first admin account bootstrap password

### Required — Jobs / Demand
- [ ] `ADZUNA_APP_ID` — job search external API
- [ ] `ADZUNA_APP_KEY` — job search external API

### Optional but expected
- [ ] `REDDIT_CLIENT_ID` — for reddit_import admin job
- [ ] `REDDIT_CLIENT_SECRET` — for reddit_import admin job

**Verification:** Open preview URL, open browser DevTools → Network tab, search for a job. Confirm no 401/403 errors on `/api/jobs`. Any 500 with `missing env var` in the response body means an env is not set.

---

## 4. Supabase Verification

From the Supabase dashboard for the production project:

### Schema checks
- [ ] `users` table exists with RLS enabled
- [ ] `applications` table exists
- [ ] `reports` table exists with `company_name`, `outcome`, `role`, `location`, `platform`, `created_at`, `needs_review`, `outcome_weight`, `trust_reason` columns
- [ ] `companies` table exists with `overall_score`, `ghost_rate`, `response_rate`, `avg_wait_days`, `report_count`, `risk_level`, `waste` columns
- [ ] `jobs` table exists with `id`, `title`, `company`, `location`, `score`, `waste_score`, `apply_url`, `description`, `availability_status`, `expires_at` columns
- [ ] `admin_sessions` table exists (required for admin auth)
- [ ] `feature_flags` table exists
- [ ] `duplicate_clusters` table exists
- [ ] `user_issues` table exists
- [ ] `ai_credits` table exists
- [ ] `admin_audit_log` table exists

### RLS check
- [ ] `reports` table allows anonymous INSERT (for anonymous report submission)
- [ ] `reports` table allows authenticated SELECT for feed
- [ ] `applications` table is user-scoped (users can only see their own)

### Supabase Auth
- [ ] Email/password provider enabled
- [ ] Email confirmation enabled (or disabled intentionally)
- [ ] Site URL set to `https://seenjobs.io` (for email links to redirect correctly)
- [ ] Redirect URLs include `https://seenjobs.io/**` and preview URL pattern

---

## 5. Admin Verification

Admin auth is **separate from Supabase** — it uses `admin_sessions` table with username/password.

- [ ] Navigate to preview URL `/admin`
- [ ] Login form renders (not blank page, not redirect loop)
- [ ] Log in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`
- [ ] Dashboard loads — KPI boxes populate (users, reports, applications)
- [ ] "↻ Refresh" button works — timestamp updates
- [ ] Reports chart renders (may be empty if no data yet — bars should appear, not error)
- [ ] Recent Jobs browser: click "Today" tab → job rows appear (or "0 today" if none)
- [ ] Feature flags panel renders — "Seed defaults" button present
- [ ] Background job runner: "▶ Run" on Refresh Jobs → "⏳ Running…" → result line
- [ ] Sign out: clears session, returns to login form (verify: browser → Application → sessionStorage → `admin_token` should be gone)

---

## 6. AI Credit Verification

AI credits gate resume analysis and job insights. Test with a seeker account that has credits.

- [ ] Sign in as a seeker account
- [ ] Navigate to `/resume`
- [ ] Upload a small PDF (< 1MB)
- [ ] Parse button shows `· 1 credit` label
- [ ] Parse fires: spinner → score + strengths/gaps/tips appear
- [ ] No 401 error in network tab (Bearer token attached)
- [ ] No `credits_required: true` response if account has credits
- [ ] Navigate to `/jobs`, search for a role, open a job
- [ ] AI insights panel loads (not "unavailable") if account has credits
- [ ] If credits are 0: insight panel shows "You're out of AI credits" message (not a blank crash)

**If credits are 0 on the test account:**
- Run `POST /api/admin-stats { action: 'set_pro', user_id: '...' }` with admin token from `/admin`
- Or manually set `ai_credits.balance = 10` in Supabase for the test user

---

## 7. Job Search Verification

- [ ] Navigate to `/jobs`
- [ ] Enter a job title (e.g. "Software Engineer") and city (e.g. "Austin, TX")
- [ ] Click Search → spinner → job cards appear
- [ ] Each card shows: title, company, city, score ring, waste badge
- [ ] Click a job card → routes to `/jobs/[id]`
- [ ] Job detail renders: title, company, score, stat grid (`jd-grid`), AI insights loading
- [ ] Hard-refresh the job detail page (`/jobs/[id]`) → should re-fetch from DB and render (not show fallback screen)
- [ ] "Apply & Optimize →" button opens modal
- [ ] "← Back to jobs" works
- [ ] Save button (♡) persists across navigation
- [ ] "Check [company] →" in sticky footer links to `/company/[slug]`

---

## 8. Company Score Verification

- [ ] Navigate to `/companies`
- [ ] Scoreboard renders with grade letters, company names, bars
- [ ] Sort by "Ghost rate" and "Wait time" work
- [ ] Search input filters list
- [ ] Click a company card → routes to `/company/[slug]`
- [ ] Company detail renders: score ring, 7 tabs
- [ ] "Reports" tab shows hiring report cards with outcome color-coding
- [ ] "Process Score" tab shows hiring funnel
- [ ] Ghost surge banner appears if surge data exists (conditional — may not show)
- [ ] "Track this company" CTA appears
- [ ] Share buttons visible

---

## 9. Resume Analysis Verification

- [ ] Navigate to `/resume` (logged in with credits)
- [ ] Drag-and-drop a PDF → file name appears in UI
- [ ] Click "Parse resume · 1 credit" → loading → structured output (experience, skills)
- [ ] Click "Analyze against job · 1 credit" → score + strengths/gaps/tips
- [ ] Error state: attempt with 0 credits → see "credits required" message, not crash
- [ ] Navigate to `/jobs/[id]` then "✨ Optimize resume first →" → routes to `/resume?company=...&role=...`

---

## 10. Tracker Verification

- [ ] Navigate to `/tracker` (logged in)
- [ ] "+ Track manually" opens add form
- [ ] Add an application: company, role, city, platform → card appears
- [ ] Stage pill shows "Applied"
- [ ] After 7+ days (or test with a seeded app): follow-up card shows "Did they respond?"
- [ ] Answer "No" → app moves to Ghosted, outcome card appears
- [ ] Answer "Yes" → app moves to Interviewing
- [ ] "Clear dupes" button visible (not behind a condition)
- [ ] "Clear all" button visible
- [ ] Applications persist on hard refresh (localStorage-backed)

---

## 11. Report Submission Verification

- [ ] Navigate to `/report`
- [ ] Form renders immediately (no auth gate — anonymous allowed)
- [ ] Fill: company, role, city → select outcome "Ghosted" → stage appears
- [ ] Click "Submit anonymously →"
- [ ] Moderation fires (spinner) → success state: ✅ card with company name + "View feed →" link
- [ ] Navigate to `/feed` → submitted report appears at top
- [ ] Navigate to `/company/[slug]` for the company → report count incremented

---

## 12. Mobile Verification

Test at 375px width (iPhone SE) and 390px (iPhone 14):

- [ ] Landing page: hero legible, ticker visible, search inputs usable
- [ ] Nav: hamburger menu appears, side menu opens on tap, all links work
- [ ] Jobs: cards stack full-width, apply button reachable
- [ ] Job detail: sticky footer visible, not obscured by keyboard
- [ ] Tracker: app cards not overflowing, follow-up cards readable
- [ ] Feed: report cards not overflowing
- [ ] Report form: all inputs accessible, no layout break on keyboard open
- [ ] Footer links: tappable (not too small)

---

## Sign-off

Before handing preview URL to users or promoting to production:

- [ ] All 12 sections above checked
- [ ] No red 500 errors in Vercel function logs
- [ ] No broken layouts on mobile
- [ ] Admin sign-out confirmed clean (no lingering session)
- [ ] Brandon has reviewed preview URL personally

**Production promotion:** Brandon promotes preview → production in Vercel dashboard. Claude does not push to production directly.
