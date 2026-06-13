# Admin Parity Checklist

Feature-parity audit of the admin dashboard: old production SPA (`/tmp/old/index.html`, 13,354 lines) vs the Next.js port (`/home/user/Seen/app/admin/page.tsx`, 266 lines) and the live backend (`/home/user/Seen/api/admin-stats.js`, 506 lines).
Verified source ranges: admin HTML `index.html:2402–2716` (`div id="page-admin"`), admin CSS `index.html:795–833` (`.adm-*`, `.issue-*`), `AdminSession` helper `index.html:2835–2844`, login show/hide helpers `index.html:6392–6406`, admin JS `index.html:6408–7217`, nav hook `index.html:9729` (`if(page==='admin')renderAdminPage()`), deep-link `index.html:12921` (`#admin`).

## API actions supported by `api/admin-stats.js` (map UI → API)

All POST actions take JSON body `{ action, ... }`. Everything except `admin_login` requires header `X-Admin-Token` (verified against `admin_sessions` table; sessions last 8h). Mutations write to `admin_audit_log`. Role `moderator` is blocked from actions marked †.

| Action | Line | Params | Notes |
|---|---|---|---|
| `admin_login` | 57 | `username`, `password` | scrypt verify, IP rate-limit 5/15min, lockout after 5 fails, bootstraps first account from `ADMIN_USERNAME`/`ADMIN_PASSWORD` env. Returns `{token, role, username}` |
| *(GET, no action)* | 132 | — | Dashboard stats payload (see "GET payload gap" below) |
| `admin_logout` | 259 | — | Deletes the `admin_sessions` row |
| `find_duplicates` | 264 | — | Normalizes company names (strips Inc/LLC/Corp/…), returns `{ok, duplicates:[{key, companies:[{id,name,report_count,overall_score}]}]}` |
| `merge` | 277 | `primary_id`, `secondary_id` | ⚠️ Takes **IDs**. Old UI sends `{primary, secondary}` **names** and reads `d.merged_report_count` — see mismatch note in §5 |
| `auto_merge` | 296 | — | Returns `{ok, merged}` only. ⚠️ Old UI also reads `d.groups[].canonical/absorbed` which is NOT returned |
| `resolve_issue` / `dismiss_issue` | 317 | `id` | PATCHes `user_issues.status` |
| `set_pro` † | 325 | `user_id`, `pro` | Upserts `ai_credits` (pro→999 balance). **No UI anywhere in old app** — API-only |
| `set_flag` † | 335 | `flag_name`, `status`, `percentage` | Upserts `feature_flags`. Valid statuses: `off, admin_only, beta_users, percentage_rollout, fully_on` |
| `seed_flags` † | 354 | — | Creates 3 default flags (`ai_credit_system_enabled`, `reddit_import_enabled`, `job_refresh_enabled`); returns `{ok, created, total}` |
| `get_recent_jobs` | 374 | `period` (`today`/`week`/`month`) | Returns `{ok, jobs[], total, period}` (limit 200) |
| `update_cluster` | 392 | `cluster_id`, `status`, `admin_note?` | Valid: `suspected, safe, watching, limited, frozen, suspended` |
| `remove_listing` † | 405 | `job_id` | Sets job `availability_status:'removed'`, marks reports `confirmed_expired` |
| `deny_report` | 424 | `job_id` | Sets job back to `active`, marks reports `denied` |
| `approve_report` | 442 | `id` | reports: `needs_review:false, outcome_weight:1.0` |
| `investigate_report` | 450 | `id` | reports: `needs_review:true` |
| `deny_hiring_report` | 458 | `id` | reports: `outcome_weight:0, needs_review:false` |
| `detect_duplicates_by_signals` † | 466 | — | Groups `login_signals` by IP (2–10 users/IP, last 30d), upserts `duplicate_clusters`; returns `{ok, suspects, clusters_created}` |

### ⚠️ GET payload gap (affects BOTH old and new frontends)
The current GET handler (lines 132–254) returns `reports: {total, today, this_week, recent}` and `company_lookups: {ready, today}`. It does **NOT** return `reports.chart`, `reports.top_companies`, `reports.outcome_breakdown`, or `company_lookups.top` — yet the old UI (index.html:6555–6614) and the new `page.tsx` (lines 157–262) both render those fields. Those panels currently render empty against this API version. Decide: re-add the aggregation server-side, or drop/compute client-side from `reports.recent`. Any new `api/*.js` change must respect the 11-function serverless cap (modify `admin-stats.js` in place; do not add files).

## Auth

- **Old flow** (`adminLogin` 6408–6433, `adminLogout` 6498–6505, `AdminSession` 2835–2844, `_admShowLogin`/`_admHideLogin` 6392–6406, login form HTML 2704–2714): username/password POST `admin_login` → token stored in `sessionStorage['seen_admin_tok']`; all requests send `X-Admin-Token` via `AdminSession.headers()`; 401 **and 403** clear token and re-show login ("Session expired" / "Access denied"); logout POSTs `admin_logout` (server-side session delete) then clears token; Enter-key submits.
- **New flow** (`page.tsx` 44–115, 117–138): same `admin_login` POST, token in `sessionStorage['admin_token']` (different key — harmless, but old sessions won't carry over); 401 handled; **403 not handled**; `logout()` only clears sessionStorage — **never calls `admin_logout`, so the server session stays alive for 8h**.
- **Status: 🟡 partial** — add `admin_logout` POST on sign-out and 403 handling.
- **Files to change**: `/home/user/Seen/app/admin/page.tsx`

## Section-by-section inventory

### 1. Header (title, last-updated, Refresh, Sign out)
- **Old source**: HTML 2405–2418; refresh button calls `renderAdminPage()` (6507–6774), sign-out calls `adminLogout()` (6498).
- **API calls**: GET `/api/admin-stats` (X-Admin-Token); POST `admin_logout`.
- **UI elements**: "↻ Refresh" button, "Sign out" button, `#admLastUpdated` text ("Updated 3:42:10 PM" / "Failed to load — …").
- **Status in Next.js**: 🟡 partial — refresh/sign-out/timestamp exist (page.tsx 164–184) but sign-out skips the `admin_logout` API call.
- **Files to change**: `app/admin/page.tsx`

### 2. KPI stat boxes (Users / Community data / Application tracking)
- **Old source**: HTML 2420–2491; populated by `renderAdminPage()` 6528–6552 (`admTotalUsers`, `admNewToday`, `admNewWeek`, `admCoScored`, `admTotalReports`, `admReportsToday`, `admReportsWeek`, `admGhostRate`, `admTotalApps`, `admGhostedApps`, `admHiredApps`, `admCoLookupToday`).
- **API calls**: GET `/api/admin-stats` → `users.*`, `companies.with_scores`, `reports.total/today/this_week`, `applications.*`, `company_lookups.today/ready`.
- **UI elements**: 3 rows × 4 KPI cards each (`.adm-kpi`), with sub-labels ("all time", "last 24h", etc.). When `company_lookups.ready === false`, shows "N/A" and unhides the setup note (§4).
- **Status in Next.js**: ✅ complete — all 12 boxes present (page.tsx 186–211); only the `ready:false → N/A` fallback is missing (shows 0 instead).
- **Files to change**: `app/admin/page.tsx` (minor)

### 3. Jobs KPI row (Active listings / New today)
- **Old source**: HTML 2493–2505; populated at 6664–6666 (`admTotalJobs`, `admJobsAddedToday`).
- **API calls**: GET → `jobs.active`, `jobs.new_today` (API also returns unused-in-UI `jobs.stale_or_expired`, `jobs.zero_result_searches_7d`, `jobs.top_zero_queries`, `jobs.reports_by_status`).
- **UI elements**: 2 KPI cards with blue/green left borders.
- **Status in Next.js**: ❌ missing — no Jobs KPI row at all.
- **Files to change**: `app/admin/page.tsx` (extend `AdminStats` interface with `jobs`)

### 4. Company-lookup setup note (search_logs SQL)
- **Old source**: HTML 2537–2561 (`#admSetupNote`), toggled at 6547–6549.
- **API calls**: driven by GET `company_lookups.ready`.
- **UI elements**: amber callout with a `CREATE TABLE search_logs …` SQL block + Supabase link, shown only when tracking isn't enabled.
- **Status in Next.js**: ❌ missing.
- **Files to change**: `app/admin/page.tsx` (low priority — one-time setup aid)

### 5. Reports chart (30d), top reported, most researched, outcome breakdown
- **Old source**: HTML 2507–2535 (`#admChart`, `#admChartLabels`, `#admTopReported`, `#admTopSearched`, `#admOutcomes`); JS 6554–6614.
- **API calls**: GET → `reports.chart`, `reports.top_companies`, `company_lookups.top`, `reports.outcome_breakdown` — **none of which the current API returns** (see GET payload gap above).
- **UI elements**: bar-per-day chart with ~6 spaced date labels + hover tooltips; two ranked-bar lists (blue bars = reported, green bars = researched, count on right); outcome chips (ghosted/rejected/interview/offer/waiting) colored and sorted desc, zero-values hidden.
- **Status in Next.js**: 🟡 partial — chart, both bar lists, and outcome bars are rendered (page.tsx 213–262) but read fields the API never sends, so they render empty; chart date labels missing; outcome "waiting" bucket missing.
- **Files to change**: `api/admin-stats.js` (re-add aggregations to GET), `app/admin/page.tsx`

### 6. Recent hiring reports feed + report moderation
- **Old source**: HTML 2563–2567 (`#admRecentReports`, `#admNeedsReviewBadge`); render JS 6617–6652; `adminActReport(id, action, btn)` 7192–7217.
- **API calls**: GET → `reports.recent` (last 25, incl. `outcome_weight`, `trust_reason`, `needs_review`); POST `approve_report` / `investigate_report` / `deny_hiring_report` with `{id}`.
- **UI elements**: per-row outcome label (color-coded: ghosted red, rejected/autoreject amber, hired/offer green, interview/human blue), company · role, truncated report text (90 chars), relative age, trust line (`community · {trust_reason|platform}`), status badges ("● Review" amber / "✗ Denied" red, denied rows at 45% opacity), header badge "N need review", and three moderation buttons per row: **✓** (approve), **?** (investigate), **✗** (deny).
- **Status in Next.js**: ❌ missing — no recent-reports feed, no moderation actions.
- **Files to change**: `app/admin/page.tsx` (or new component, e.g. `app/admin/components/RecentReports.tsx`)

### 7. Recent tracker applications feed
- **Old source**: HTML 2569–2573 (`#admRecentApps`); render JS 6654–6662.
- **API calls**: GET → `applications.recent` (last 25).
- **UI elements**: read-only rows: stage label (color per stage: Applied/Screening blue, Interview amber, Offer/Hired green, Rejected red, Ghosted dim), company · role, relative age.
- **Status in Next.js**: ❌ missing.
- **Files to change**: `app/admin/page.tsx`

### 8. New job listings browser (Today / This Week / This Month tabs)
- **Old source**: HTML 2575–2588 (`#admJobsList`, `#admJobsListCount`, `.adm-period-btn`); `adminLoadRecentJobs(period, clickedBtn)` 6931–6983.
- **API calls**: POST `get_recent_jobs` `{period: 'today'|'week'|'month'}`.
- **UI elements**: 3 tab buttons (active tab styled blue), count label "— N today", rows of title · company / city · source · availability status (colored: active green, stale amber, expired red, removed dim), relative age, "↗" external link to `apply_url || url`. Handles 401 by forcing re-login. Lazy: nothing loads until a tab is clicked.
- **Status in Next.js**: ❌ missing.
- **Files to change**: `app/admin/page.tsx`

### 9. Reported inactive listings (remove listing / keep active)
- **Old source**: HTML 2590–2599 (`#admInactiveList`, `#admInactiveCount`); render JS 6668–6698; `adminRemoveListing` 6985–7004; `adminDenyReport` 7006–7023.
- **API calls**: GET → `jobs.inactive_reports` (grouped per job with `report_count`, `latest_reported_at`, embedded `job`); POST `remove_listing` `{job_id}` (confirm() first), POST `deny_report` `{job_id}`.
- **UI elements**: amber count badge in header; per-row job title · company, city · "N reports · latest Xh ago", "↗ Verify listing →" link; buttons **"Remove listing"** (red, confirm dialog, row → "✓ Listing removed") and **"Keep active"** (row → "✓ Marked as still active").
- **Status in Next.js**: ✅ **ported** (recovery branch). `InactiveRow` component: amber count badge, job title · company, city · "N reports · latest Xh ago", "↗ Verify listing →" link, Remove listing (red, `confirm()` dialog → "✓ Listing removed") + Keep active (→ "✓ Marked as still active"). Reads `stats.jobs.inactive_reports`; POSTs `remove_listing`/`deny_report` `{job_id}`. Verifies `d.ok`.
- **Files to change**: `app/admin/page.tsx` ✅ done

### 10. Data quality issues queue (user-reported issues)
- **Old source**: HTML 2601–2610 (`#admIssuesList`, `#admIssueCount`, `#admIssuesRefreshBtn`); `adminLoadIssues(issueData)` 7108–7166; `adminActIssue(id, action, btn)` 7168–7190. (User-side submission modal `reportIssue`/`submitIssue` 7044–7105 posts to `/api/reports` — out of admin scope but feeds this queue.)
- **API calls**: GET → `issues.items` (open `user_issues`, limit 20); refresh button re-fetches full GET; POST `resolve_issue` / `dismiss_issue` `{id}`.
- **UI elements**: red count badge; per-issue type badge (`wrong_data`/`duplicate`/`broken_listing`/`spam`/`other`, CSS 828–833), target name, notes, relative age; **Resolve** (green) / **Dismiss** buttons (row fades and is removed, badge decremented); duplicate-type issues get an extra **"Open in merge tool ↓"** button that prefills the merge form via `adminSetMerge(target, '')`.
- **Status in Next.js**: ✅ **ported** (recovery branch). `IssueRow` component: type badge with parity colors, target name, notes, relative age, red count badge in header, Refresh button, Resolve/Dismiss actions (row → "✓ Resolved"/"✓ Dismissed" then refetch). Verifies `d.ok`. ⏳ The duplicate-type "Open in merge tool ↓" button is deferred to §11 (merge tool not built yet) — code comment marks the wire point.
- **Files to change**: `app/admin/page.tsx` ✅ done

### 11. Company deduplication (scan, auto-merge, manual merge)
- **Old source**: HTML 2612–2642 (`#admMergePanel`, `#admScanBtn`, `#admAutoMergeBtn`, `#admMergePrimary`, `#admMergeSecondary`, `#admMergeStatus`, `#admDupesList`); `adminScanDupes` 6776–6809; `adminSetMerge` 6811–6817; `adminManualMerge` 6819–6841; `adminAutoMerge` 6843–6870.
- **API calls**: POST `find_duplicates`; POST `merge` — ⚠️ old UI sends `{primary, secondary}` **names** but the current API (admin-stats.js:277–279) requires `{primary_id, secondary_id}` and doesn't return `merged_report_count`; POST `auto_merge` — old UI reads `d.groups` which API doesn't return. **The Next.js port must target the current API contract (IDs), not the old UI's payload — resolve this drift when porting (either fix the API to accept names or have the UI pass the IDs from `find_duplicates` results).**
- **UI elements**: "Scan for dupes" / "Auto-merge" (green) header buttons; manual-merge form: "Keep (primary)" + "Absorb (secondary)" inputs, "Merge →" red button, status line (validates both fields, blocks self-merge); dupes list groups: "N entries match \"key\"", primary chip green with report count, others red, "Set to merge" button prefills the form; rescans after every merge.
- **Status in Next.js**: ❌ missing.
- **Files to change**: `app/admin/page.tsx`; possibly `api/admin-stats.js` (merge contract + missing response fields)

### 12. Feature flags (set flag, seed defaults)
- **Old source**: HTML 2644–2651 (`#admFlagsPanel`); render JS 6702–6716; `adminSetFlag(flagName, status, selectEl)` 6873–6898; `adminSeedFlags(btnEl)` 6913–6929. Runtime consumer: `FeatureFlags` object 2750+.
- **API calls**: GET → `feature_flags[]`; POST `set_flag` `{flag_name, status}`; POST `seed_flags`.
- **UI elements**: "+ Seed defaults" header button; per-flag row: name + description, colored status label (Off/Admin only/Beta (20%)/% rollout/Live), `<select>` with the 5 statuses (optimistic "Saving…" label, toast on success/failure, also updates in-memory `FeatureFlags._flags`); empty state shows "Initialize default flags →" button.
- **Status in Next.js**: ❌ missing.
- **Files to change**: `app/admin/page.tsx`

### 13. Duplicate account clusters / login signals
- **Old source**: HTML 2653–2660 (`#admClustersPanel`); render JS 6718–6736; `adminUpdateCluster(clusterId, status)` 6901–6911; `adminDetectDuplicates()` 7025–7041.
- **API calls**: GET → `duplicate_clusters.{suspected, items}`; POST `update_cluster` `{cluster_id, status}`; POST `detect_duplicates_by_signals` (then re-renders dashboard after 1.2s).
- **UI elements**: "Scan signals" header button → "✓ Found N suspect groups — created M new clusters"; "N suspected clusters" amber header line; per-cluster: "Risk {risk_score}/100" (color by status), "{n} accounts · {signals joined}", status `<select>` (suspected/safe/watching/limited/frozen/suspended).
- **Status in Next.js**: ❌ missing.
- **Files to change**: `app/admin/page.tsx`

### 14. API Health (errors + DAU)
- **Old source**: HTML 2662–2666 (`#admHealthPanel`); render JS 6738–6762.
- **API calls**: GET → `errors.{today, this_week, by_route, recent}`, `users.dau`.
- **UI elements**: 3 mini-stat tiles (Errors today — red if >10, This week, DAU); "Errors by route" ranked list; "Recent" list (time, endpoint, first 60 chars of error_msg).
- **Status in Next.js**: ❌ missing.
- **Files to change**: `app/admin/page.tsx`

### 15. Background job runner (refresh_jobs / refresh_demand / reddit_import)
- **Old source**: HTML 2668–2699 (`#jobBtnRefreshJobs`, `#jobBtnRefreshDemand`, `#jobBtnRedditImport`, `#admJobResult`); `adminRunJob(job, btn)` 6435–6496.
- **API calls**: NOT admin-stats — hits the job endpoints directly with `AdminSession.headers()` (X-Admin-Token):
  - `refresh_jobs` → POST `/api/refresh-jobs` `{}` → reads `{inserted, updated}`
  - `refresh_demand` → POST `/api/demand` `{}` → reads `{rows_upserted}`
  - `reddit_import` → POST `/api/reports` `{action:'reddit_import', subreddit}` once per subreddit (`recruitinghell`, `jobs`, `cscareerquestions`, `careerguidance`) sequentially to dodge rate limits; sums `results[].imported`, shows per-sub progress `sub:posts(+imported)`.
- **UI elements**: 3 job cards (name + description + cadence note), "▶ Run" buttons (→ "⏳ Running…" → "✓ Done"/"✗ Error", restored after 5s), shared result line `#admJobResult`.
- **Status in Next.js**: ❌ missing.
- **Files to change**: `app/admin/page.tsx`

### 16. Credit/pro coverage & admin audit (API-only, no UI in old app)
- **Old source**: none — GET returns `credits: {total_users, pro_users}` (admin-stats.js:234) which the old dashboard never displays; `set_pro` (line 325) has no caller anywhere in index.html (verified by grep); every admin mutation writes `admin_audit_log` (lines 117, 292, 321, 330, 349, 401, 420, 438, 446, 454, 462) but there is no audit-viewer UI or read endpoint.
- **Status in Next.js**: ❌ missing (also missing in old — NOT a parity blocker). Optional enhancements: credits KPI card, a `set_pro` user-lookup tool, an audit-log viewer (would need a new GET branch in `api/admin-stats.js`).
- **Files to change**: `app/admin/page.tsx` + `api/admin-stats.js` (only if you choose to build them)

## Summary table

| # | Section | Status | Effort |
|---|---------|--------|--------|
| — | Auth (login/logout/401/403) | 🟡 logout API call + 403 handling missing | S |
| 1 | Header (refresh/sign out/updated-at) | 🟡 | S |
| 2 | KPI boxes (users/community/apps) | ✅ (minus `ready:false` N/A state) | S |
| 3 | Jobs KPI row | ❌ | S |
| 4 | search_logs setup note | ❌ | S |
| 5 | Chart / top reported / researched / outcomes | 🟡 UI exists, API fields missing | M (API + UI) |
| 6 | Recent hiring reports + moderation (✓/?/✗) | ❌ | M |
| 7 | Recent tracker applications | ❌ | S |
| 8 | Recent jobs browser (period tabs) | ❌ | M |
| 9 | Reported inactive listings (remove/keep) | ✅ | M |
| 10 | Data quality issues queue | ✅ (merge-tool prefill deferred to §11) | M |
| 11 | Company dedup (scan/auto/manual merge) | ❌ (+ API contract drift) | L |
| 12 | Feature flags | ❌ | M |
| 13 | Duplicate account clusters | ❌ | M |
| 14 | API Health | ❌ | S |
| 15 | Background job runner | ❌ | M |
| 16 | Credits/set_pro/audit viewer (API-only) | ❌ in both — optional | M (optional) |

## Porting order recommendation

1. **Auth completion** (§Auth, §1) — add `admin_logout` POST on sign-out and 403 handling; consider extracting a shared `adminFetch(token, body?)` helper + `AdminStats` types into `app/admin/lib.ts` so every later section reuses it. Everything else depends on this.
2. **Fix the GET payload gap** in `api/admin-stats.js` (§5) — restore `reports.chart`, `reports.top_companies`, `reports.outcome_breakdown`, `company_lookups.top`; this instantly fixes the already-ported chart/bars panels in `page.tsx` and unblocks the old-parity panels. Edit the existing file only (serverless cap: 11 declared + 1 runtime = 12, at limit).
3. **Read-only GET panels** (§3 Jobs KPIs, §7 Recent apps, §14 API Health, §4 setup note) — zero new API surface, pure rendering of fields GET already returns.
4. **Recent hiring reports + moderation** (§6) — first interactive section; introduces the POST-action pattern (`approve_report`/`investigate_report`/`deny_hiring_report`) reused by everything below.
5. **Issues queue** (§10) — `resolve_issue`/`dismiss_issue`; small, same pattern. Stub `adminSetMerge` prefill until §8.
6. **Reported inactive listings** (§9) — `remove_listing`/`deny_report` with confirm dialog.
7. **Recent jobs browser** (§8) — first POST-driven *data fetch* (`get_recent_jobs`), tab state.
8. **Company deduplication** (§11) — largest piece; resolve the `merge` name-vs-ID contract drift first (recommend: UI keeps the `find_duplicates` result IDs and POSTs `primary_id`/`secondary_id`; manual-merge text form needs a name→id lookup or an API change), and decide whether `auto_merge` should return `groups` again. Wire issues-queue "Open in merge tool" prefill from §5.
9. **Feature flags** (§12) — `set_flag`/`seed_flags` selects; coordinate with however the Next.js app consumes `FeatureFlags` at runtime.
10. **Duplicate account clusters** (§13) — `update_cluster`/`detect_duplicates_by_signals`.
11. **Background job runner** (§15) — depends on `/api/refresh-jobs`, `/api/demand`, `/api/reports` accepting `X-Admin-Token`; verify those endpoints on next-migration before wiring.
12. **Optional**: credits KPI, `set_pro` tool, audit-log viewer (§16) — net-new features, not parity; audit viewer needs an API addition.
