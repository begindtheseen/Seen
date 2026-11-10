# Admin server — the shapes every action answers (A1, 2026-11-10)

The UI codes to THIS file and to `components/admin2/contract.ts`. Everything here is produced by
`api/admin-stats.js` (a router) over `lib/server/admin/*`. Tests that hold the server to it:
`api/admin-stats.contract.test.mjs` (one validator, run over every action below).

## Transport

- `POST /api/admin-stats`, header `X-Admin-Token: <token>`, JSON body `{ "action": "<name>", ...args }`.
  Ids, filters and every list of ids travel in the BODY. Nothing destructive is reachable by GET.
- `GET /api/admin-stats` (no action) is the LEGACY dashboard read used by `/admin/legacy`, the exec
  dashboard and the brain sync. The new UI never calls it; it uses `overview` and the per-section lists.
- Success: HTTP 200 with `AdminOk` (writes, and reads that return one thing) or `AdminList` (lists).
- Failure: HTTP 4xx/5xx with `AdminErr` `{ ok:false, error, code, retryable, changed?, remaining? }`.

| HTTP | code | retryable | when |
|---|---|---|---|
| 400 | `bad_request` | false | a field is missing or invalid (the sentence names it) |
| 400 | `unknown_action` | false | the action is not one of ours — the answer carries `actions: string[]` |
| 401 | `unauthorized` | false | no token / expired / signed out. UI: "Session ended — sign in", replay after |
| 403 | `forbidden` | false | a moderator asked for an admin-only action (extra code, not in the contract comment) |
| 404 | `not_found` | false | the row is gone |
| 409 | `conflict` | false | it changed while you looked (e.g. already decided by someone else) |
| 429 | `rate_limited` | true | login attempts (extra code) |
| 502 | `upstream` | true | the database refused or failed; `changed` says what was written first |
| 504 | `timeout` | true | ran out of time; `changed`/`remaining` say where it stopped |

Every `AdminOk.message` is one plain sentence that says what happened, with counts. `touched` names the
cache keys to re-read (AdminCacheKey). `undo` is present only when the server can reverse it:
`{ action: "undo", args: { audit_id: "<id>" }, label: "Undo", expires_at: <now + 7 days> }`.
Undo is itself audited and conditional (it only reverts rows still holding the values the action wrote;
rows changed since are reported in `skipped` as `changed_since`).

A count the server could not read is `null`, never 0, and its name is in `failed`.

---

## Session

### `admin_login` (no token) `{ username, password }`
```json
{ "ok": true, "token": "4f…64 hex", "role": "super_admin", "username": "owner",
  "changed": 1, "skipped": [], "message": "Signed in as owner.", "touched": [] }
```
One session per submit. 5 attempts / 15 min / IP (429 `rate_limited`), 5 wrong passwords lock the account
15 min (429). Wrong credentials: 401 `{ ok:false, code:"unauthorized", error:"Invalid credentials", retryable:false }`.

### `admin_logout` `{}` → `{ ok:true, changed:1, skipped:[], message:"Signed out.", touched:[] }` (`changed` 0 when the session was already gone).

### `whoami` `{}` (new) → `{ ok:true, changed:0, skipped:[], message:"Signed in as owner.", touched:[], rows:[{ admin_id:"1", username:"owner", role:"super_admin", expires_at:"2026-11-10T20:00:00.000Z" }] }`

---

## Today

### `overview` `{}` → `AdminOverview`
```json
{ "ok": true, "as_of": "2026-11-10T18:02:11.120Z", "degraded": false, "failed": [],
  "source": "rpc",
  "stats": { "listings_live": 136865, "listings_stale": 20982, "reports_24h": 41, "signups_24h": 2, "revenue_7d_cents": 2998 },
  "queues": [
    { "key": "held_reports", "label": "Held reports", "count": 13, "section": "review", "filter": { "kind": "held" } },
    { "key": "listing_tickets", "label": "Listing tickets", "count": 4, "section": "review", "filter": { "kind": "tickets" } },
    { "key": "reddit_disputes", "label": "Reddit disputes", "count": 0, "section": "review", "filter": { "kind": "disputes" } },
    { "key": "employer_claims", "label": "Employer claims", "count": 1, "section": "review", "filter": { "kind": "claims" } },
    { "key": "employer_replies", "label": "Employer replies", "count": 1, "section": "review", "filter": { "kind": "replies" } },
    { "key": "purchases_to_fulfil", "label": "Purchases to fulfil", "count": 0, "section": "review", "filter": { "kind": "purchases" } },
    { "key": "data_issues", "label": "Data issues", "count": 3, "section": "review", "filter": { "kind": "issues" } },
    { "key": "account_clusters", "label": "Account clusters", "count": 2, "section": "people", "filter": { "view": "clusters" } }
  ],
  "system": { "ok": false, "line": "1 cron needs a look: refresh-jobs last ran 9 h ago.",
    "failing": [ { "name": "refresh-jobs", "last_run": "2026-11-10T09:00:03.000Z", "detail": "overdue — next run was 2026-11-10T14:00:00.000Z" } ] },
  "extra": { "reports_7d": 122, "signups_7d": 9, "signups_today": 1, "errors_24h": 6, "recompute_waiting": 0,
             "listings_total": 158082, "listings_added_today": 951, "listings_counts_source": "rpc",
             "revenue_source": "credit_transactions reason=purchase_<sku> × …; employer_purchases.amount_cents" } }
```
- `source`: `"rpc"` (one `admin_overview(p_today)` call) or `"fallback"` (bounded parallel counts; each has its own
  ~6 s cap). The California day (`pacificDayStart`) is `p_today`; "24h" stats are rolling 24 hours.
- `revenue_7d_cents` = one-time purchases only: consumer `credit_transactions.reason = purchase_<sku>` × the SKU
  price in `lib/server/creditRules.js ONE_TIME_SKUS`, plus `employer_purchases.amount_cents` (status paid/fulfilled)
  in the last 7 days. Seen sells no subscriptions: no MRR / trial / past-due field exists anywhere.
- `listings_stale` = clearable stale (what "Clear stale" removes, `staleSweep.STALE_CLEARABLE_FILTER`).
- The 30-day chart / top companies / outcome mix are `reports_stats` (kept off Today so it stays fast).
- Touched: none (read). Cache key: `overview`.

### `search` `{ q }` → `AdminSearch`
```json
{ "ok": true, "q": "walmart",
  "results": [
    { "kind": "company", "id": "walmart", "title": "Walmart", "sub": "Score 63 · 412 reports" },
    { "kind": "user", "id": "5f0c…-uuid", "title": "jo@walmart.com", "sub": "Joined Nov 2, 2026" },
    { "kind": "job", "id": "9a1b…-uuid", "title": "Cashier — Walmart", "sub": "Phoenix, AZ · active" },
    { "kind": "report", "id": "c3d4…-uuid", "title": "Walmart · ghosted", "sub": "Oct 30, 2026 · held" } ] }
```
`q`: an email (or part), a company name, a listing id or apply URL, a report id, a user id. ≤ 25 results.
Parallel exact / contains reads (every value through `lib/server/pgrest.js`); a uuid looks up users, listings and reports; an http(s) URL looks up listings by apply link.
For `kind:'company'` the `id` is the company name (open `?item=company:<name>`).

### `activity_log` `{ after?, filter_action?, target?, include_logins?, limit? }` → `AdminList<AdminActivityRow>`
(`action` in the body is the route name, so the contract's `action?` filter travels as `filter_action`.)
```json
{ "ok": true, "as_of": "…", "next": "MjAyNi0xMS0xMFQxNzo1OTowMC4wMDBafDIxMDI",
  "rows": [ { "id": "2103", "at": "2026-11-10T18:00:11.000Z", "admin": "owner", "action": "review_held",
              "target_kind": "bulk", "target_id": null,
              "summary": "Approved 288 held reports (12 skipped)", "undoable": true } ] }
```
Newest first, keyset (`next` → `after`). `filter_action` filters exactly; `target` = `"<kind>:<id>"` (e.g. `job:9a1b…`).
Logins are hidden unless `include_logins: true` (the hourly automated login is most of the table). A bulk decision
shows as its one batch row (`review_held`, whose Undo covers every report); the per-report rows appear with
`include_batch_rows: true`, or when filtering by action or target.
`undoable` is true for: `review_held` (bulk), `approve_held_report`/`reject_held_report`, `*_report` moderation
(approve/reject/hold/restore), `merge_companies` / `auto_merge_pair`, `delete_listing`, `dismiss_inactive_report`,
`set_pro_window`, `set_flag`, `update_reddit_dispute`, `resolve_issue`/`dismiss_issue`, `update_cluster`,
`grant_credits`, `job_update` — and the row is not already undone.

### `undo` `{ audit_id }` → `AdminOk`
```json
{ "ok": true, "changed": 288, "skipped": [ { "reason": "changed_since", "count": 0 } ],
  "message": "Undid it: 288 reports are back in the review queue.", "touched": ["held","reports","overview","activity"],
  "remaining": 0, "complete": true }
```
Large bulk undos run as a job: `complete:false` + `remaining` → call again with the same `audit_id`.
An already-undone row: 409 `conflict` "That was already undone." A row that cannot be undone: 400 `bad_request`.

### `cron_health` `{}` → `AdminList<AdminCron>`
```json
{ "ok": true, "as_of": "…", "rows": [
  { "name": "refresh-jobs", "path": "/api/refresh-jobs", "schedule": "0 2,6,10,14,18,22 * * *",
    "last_run": "2026-11-10T14:00:04.000Z", "last_result": "ok", "next_run": "2026-11-10T18:00:00.000Z",
    "overdue": false, "detail": "Next: Nov 10, 10:00 AM (California) · from cron_runs" },
  { "name": "outcome-followups", "path": "/api/outcome-followups", "schedule": "0 15 * * *",
    "last_run": "2026-11-10T15:00:41.000Z", "last_result": "ok", "next_run": "2026-11-11T15:00:00.000Z",
    "overdue": false, "detail": "Last email sent Nov 10, 7:00 AM · from outcome_email_log" },
  { "name": "company-signals", "path": "/api/company-signals", "schedule": "0 8 * * 1",
    "last_run": null, "last_result": "unknown", "next_run": "2026-11-16T08:00:00.000Z", "overdue": false,
    "detail": "Nothing records this cron's runs yet" } ] }
```
One row per distinct path in `vercel.json` crons (several schedules for one path are merged; `schedule` lists
them comma-joined in the hour field when they differ only by hour, else `;`-joined). `next_run` is computed from
the schedule in UTC (Vercel's clock); `detail` says it in California time. Sources, in order: `cron_runs` (new),
then what the cron already writes: `collector_runs` (cron-archive-reports), `outcome_email_log` (outcome-followups —
only proves a send), `search_daily.fetched_at` (cron-search-data), `demand_refresh_log` (demand). Nothing →
`"unknown"`, `last_run:null`, `overdue:false` (never guessed). `overdue` = a recorded last run older than the
scheduled interval + 1 h grace.

---

## Review

### `list_held_reports` `{ sort? }` → `AdminList<HeldRow>` (+ legacy fields)
`sort`: `needs_eyes` (default) | `newest` | `oldest` | `company` | `outcome`.
```json
{ "ok": true, "sort": "needs_eyes", "total": 300, "as_of": "…",
  "counts": { "total": 300, "needs_eyes": 120, "positive": 150, "employee_review": 30 },
  "rows": [ { "id": "b1b2…-uuid", "company_name": "Tesla", "outcome": "rejected", "role": "Engineer",
    "platform": "Indeed", "source": "external", "created_at": "2026-10-18T00:00:00Z",
    "report_text": "Engineer interview - no offer", "outcome_weight": 0.55, "trust_reason": "external_import",
    "needs_review": true,
    "review": { "kind": "hiring", "positive": false, "group": "needs_eyes", "sourceUrl": null,
                "flags": ["no_source_link"] } } ],
  "reports": "<same array, legacy name>", "truncated": false }
```
Every pending row is read (keyset pages internally, no 1,000 cap; `truncated` true only past 20,000).
`flags` may include `possible_duplicate`, `anti_gaming_hold`, `not_a_hiring_outcome`, `no_source_link`.

### `review_held` `{ decision: "approve"|"reject", ids: string[], request_id?: uuid, include_duplicates?: boolean }` → `AdminOk`  (THE bulk fix)
Send ONE `request_id` per press and reuse it on Retry / continuation: rows that press already decided are then
reported as `already_done_last_try` and one Undo covers every row of the press.
Any number of ids (1–5,000) in the body. Written in chunks of ≤100 ids per PostgREST call, or in one
`admin_review_reports(p_ids, p_decision, p_admin)` call when that RPC exists. Every write repeats the
"still pending" filter and counts the rows it changed. Rows flagged `possible_duplicate` are NOT approved by a
bulk approve unless `include_duplicates: true`.
```json
{ "ok": true, "changed": 288,
  "skipped": [ { "reason": "possible_duplicate", "count": 12, "ids": ["…"] },
               { "reason": "already_decided", "count": 0 }, { "reason": "not_held", "count": 0 } ],
  "message": "Approved 288 of 300 · 12 skipped as possible duplicates.",
  "undo": { "action": "undo", "args": { "audit_id": "2103" }, "label": "Undo", "expires_at": "…" },
  "touched": ["held","reports","overview","activity","company:tesla","company:spacex"],
  "rows": [ { "id": "…", "state": "live", "decision": "approve" } ],
  "recompute": { "queued": 41, "done": 41, "remaining": 0, "mode": "table" },
  "remaining": 0, "complete": true }
```
- `skipped` reasons: `possible_duplicate` (approve only), `already_decided` (held but already rejected/duplicate,
  or decided by someone else — **never** a row this same admin decided in the last 10 minutes: a retry after a
  timeout counts those as `changed` again via the audit trail, `message` says "already done by your last try"),
  `not_held` (live rows), `not_found` (no such id), `invalid_id`.
- `rows`: one per id actually changed (for in-place removal from the held list).
- Company recompute is decoupled: companies are queued (`company_recompute_queue` table, or — before the
  migration — carried in `recompute.cursor`); the request drains what fits in ~8 s and reports
  `recompute.remaining`. When `recompute.remaining > 0` the UI runs `recompute_queue_drain` as a job.
- Partial failure: 502 `{ ok:false, code:"upstream", retryable:true, changed:150, remaining:150, error:"…" }`.
  Audit rows for the 150 already exist; pressing again changes only the other 150.
- A second identical call: `changed:0`, message "Nothing to do — all 300 were already decided (288 by your last
  try)." (`skipped:[{reason:"already_decided",count:300}]`).

### `review_reports` (legacy alias, `/admin/legacy`) — same engine, legacy shape:
`{ ok, decision, requested, changed, skipped: <number>, companies, recomputed, message, touched, undo }` (≤500 ids, as before).

### `recompute_queue_drain` `{ cursor? }` → `AdminOk` (job)
```json
{ "ok": true, "changed": 25, "skipped": [], "remaining": 16, "complete": false, "cursor": "eyJjIjpb…",
  "message": "Recomputed 25 company scores · 16 waiting.", "touched": ["companies","overview"] }
```
Repeat while `complete:false`, passing `cursor` back (needed only when the queue table is absent).

### `reports_recent` `{ after?, state?: "live"|"held"|"rejected"|"duplicate", q?, limit? }` → `AdminList<ReportRow>`
```json
{ "ok": true, "next": "…", "rows": [ { "id": "…", "company_name": "Home Depot", "outcome": "interview",
  "role": "Cashier", "platform": "Reddit r/HomeDepot", "created_at": "…", "report_text": "…",
  "outcome_weight": 0.3, "trust_reason": "reddit_rule_match", "needs_review": false,
  "state": "live", "counted": true, "employeeReview": false, "rules": "passes" } ] }
```
Newest first, keyset. `q` = company name contains.

### `reports_stats` `{}` → `AdminOk` `rows:[{ total, by_day:[{date,count}]×30 (California days), top_companies:[{company,count}], outcome_mix:{ghosted,rejected,interview,offer,waiting}, source }]`
Every report of the last 30 California days (keyset read) — the old chart read the oldest 1,000.

### `report_detail` `{ id }` → `AdminOk` with `rows:[ReportRow & { history: AdminActivityRow[] }]`

### `moderate_report` `{ id, decision: "approve"|"reject"|"hold"|"restore" }` → `AdminOk`
```json
{ "ok": true, "changed": 1, "skipped": [], "message": "Rejected — hidden from the company page and out of its grade.",
  "undo": { "action": "undo", "args": { "audit_id": "2110" }, "label": "Undo" },
  "touched": ["reports","held","overview","activity","company:home depot"],
  "rows": [ { "id": "…", "state": "rejected", "counted": false, "employeeReview": false } ],
  "state": "rejected", "counted": false, "recomputed": true }
```
Nothing to do → `changed:0` and the reason as `message` (e.g. "Already live — nothing to approve.").
Aliases: `approve_report`→approve, `investigate_report`→hold, `deny_hiring_report`→reject.

### `scan_report_dupes` `{}` → `AdminList<{company, count}>` + `{ suspected, groups, total, by_company }`
### `dedupe_reports` `{}` → `AdminOk` job: `changed` = copies marked, `remaining`, `complete`. Touched `report_dupes, reports, overview`.

### `list_listing_tickets` `{ status?: "open"|"resolved"|"all" }` → `AdminList<Ticket>` + `counts {open, resolved}`
```json
{ "ok": true, "counts": { "open": 4, "resolved": 9 }, "rows": [ { "job_id": "9a1b…", "title": "Cashier",
  "company": "Walmart", "city": "Phoenix", "apply_url": "https://…", "availability_status": "active",
  "is_db_listing": true, "removed": null,
  "reports": { "count": 3, "expired": 3, "unknown": 0, "latest": "…", "snapshot": { "company": "Walmart", "title": "Cashier", "city": "Phoenix", "apply_url": "https://…" } },
  "dispute": { "id": 12, "kind": "still_active", "status": "open", "reason": "…", "detail": "…", "created_at": "…" },
  "status": "open", "latest_activity": "…" } ], "tickets": "<legacy name>" }
```
Job and suppression lookups are chunked (≤100 ids / ≤50 URLs per call) — no URL over ~6 KB.

### `resolve_listing_dispute` `{ id, decision: "approved"|"denied", note? }` → `AdminOk`
`changed` = 1 when the dispute status moved; `applied {takedown, edited, suppressed, reportsCleared}`; a takedown
answers `undo`. 409 when already resolved. Touched `tickets, listings, overview, activity, job:<id>`.

### `delete_listing` `{ job_id }` → `AdminOk` (take a listing down)
```json
{ "ok": true, "changed": 1, "skipped": [], "message": "Taken down: expired, apply link blocked, 3 reports cleared.",
  "undo": { "action": "undo", "args": { "audit_id": "2120" }, "label": "Undo" },
  "touched": ["tickets","listings","listing_counts","overview","activity","job:9a1b…"],
  "soft_deleted": true, "suppressed": true, "reports_cleared": 3 }
```
Undo restores the listing for 14 days (same as `job_restore`), un-blocks the apply link and re-inserts the
cleared reports from the audit snapshot.

### `dismiss_inactive_report` `{ job_id }` → `AdminOk`; the deleted report rows are snapshotted into the audit row
first (refuses if the audit cannot be written); `changed` = rows deleted; undoable.

### `list_reddit_disputes` `{ status? }` → `AdminList<Dispute>` + `counts`, `disputes` (legacy)
Row: `{ id, company_name, company_key, reason, detail, permalink, contact, status, created_at }`.
### `update_reddit_dispute` `{ id, status: "reviewed"|"actioned"|"dismissed" }` → `AdminOk` (checked, prior in audit, undoable). Touched `disputes, overview, activity`.

### `issues_list` `{ status?: "open"|"resolved"|"dismissed"|"all", after? }` → `AdminList<Issue>`
Row: `{ id, type, target_type, target_name, notes, status, created_at, resolved_at }`; `total` = exact count for the status.
### `resolve_issue` / `dismiss_issue` `{ id }` → `AdminOk` (checked; 404 when no open issue has that id; undoable). Touched `issues, overview, activity`.

### Employer claims — `POST /api/employer-claims` (same `X-Admin-Token`)
- `{ action:"list", status? }` → `{ ok:true, rows: Claim[], claims: Claim[], counts:{pending,approved,rejected} }`
  Claim: `{ id, user_id, company_name, company_display_name, status, created_at, reviewed_at, reviewed_by, note, email, email_verified, employer_name }`
- `{ action:"approve"|"reject", id, note? }` → `{ ok:true, changed:1, skipped:[], message:"Claim approved.", touched:["claims","overview"], rows:[Claim], claim }`; 409 `conflict` when another approved claim exists.

### `list_employer_replies` `{ status? }` → `AdminList<Reply>` + `counts`, `replies` (legacy)
Reply: `{ id, report_id, company_key, body, status, created_at, reviewed_at, reviewed_by, report: { role, outcome, report_text, company_name } | null }`
### `moderate_employer_reply` `{ reply_id, decision: "approve"|"reject" }` → `AdminOk` (`changed` counted; only a pending reply is changed, else `changed:0` "Already decided"). Touched `replies, overview, activity`.

### `list_employer_purchases` `{}` → `AdminList<Purchase>` + `perks`, `total_cents`, `purchases` (legacy)
Purchase: `{ id, company, email, employer_sku, amount_cents, status, created_at, fulfilled_at }`.
### `fulfill_employer_purchase` `{ purchase_id }` → `AdminOk` (`perk`, `until`; the purchase PATCH is checked and
conditional on `status=eq.paid` — a second press says "Already fulfilled"). Touched `purchases, overview, activity`.

---

## Listings

### `listing_counts` `{}` → `AdminOk` + `counts`
`counts: { total, active, added_today, stale_or_expired, stale_clearable, expired_kept, stale_overdue, source:"rpc"|"exact" }`
— each `number|null`; `failed: string[]`.

### `listings_browse` `{ filters: { q?, company?, location?, source?, status?, visible?, employer?, since?, sort?, limit? }, after? }` → `AdminList<JobRow>`
`next` is a string; pass it back as `after`. (`jobs_browse` is the Seen Command form: same filters, `filters.cursor` = the
object `next` it returns — not contract-shaped, do not use it in the new UI.)
Rows: `id,title,company,location,source,availability_status,status,created_at,last_seen_at,expires_at,salary_min,salary_max,salary,apply_url,is_employer_posted,score,remote`
(`lib/server/jobAdmin.js LIST_SELECT`). `total` = exact count for the filters.

### `job_detail` `{ job_id }` → `AdminOk` with `rows:[{ job, holders, history, suppressed, on_site }]` (+ the same fields at top level, legacy)
### `job_edit` `{ job_id, patch }` (patch keys: lib/server/jobAdmin.js EDITABLE) → `AdminOk` (`fields: string[]`, `rows:[job]`, undoable). Legacy `job_update` keeps `changed: string[]`.
### `job_restore` `{ job_id }` → `AdminOk` (`changed:1`, `rows:[job]`).

### `purge_stale_jobs` `{}` → `AdminOk` job — "Clear stale"
```json
{ "ok": true, "changed": 4212, "skipped": [], "remaining": 16770, "complete": false,
  "message": "Cleared 4,212 stale listings · 16,770 left.", "touched": ["listing_counts","listings","overview"],
  "removed": 4212, "deleted": 4100, "retained": 112, "staled": 0, "kept": 1 }
```

### `job_dupes_scan` `{ cursor? }` → `AdminOk` job (resumable; never "did not finish")
Each round reads up to ~25 s of keyset pages (or one `admin_job_dupes_plan` page) and returns `cursor` +
`complete`. When complete: `rows` = up to 8 sample groups `{ keep, remove[], kept[] }` (brief rows
`{id,title,company,location,source,status}`), `suspected`, `groups`, `protected`, `total`.
```json
{ "ok": true, "changed": 0, "skipped": [], "complete": false, "cursor": "eyJhIjoi…", "remaining": null,
  "message": "Scanned 61,000 listings so far — keep going.", "touched": [], "scanned": 61000 }
```
### `job_dupes_remove` `{ cursor? }` → `AdminOk` job: `changed` = rows deleted, `remaining`, `complete`, `cursor`
(scans first if needed, then deletes ≤100 ids per call). Touched `job_dupes, listings, listing_counts, overview`.
Legacy `scan_job_dupes` / `dedupe_jobs` map here and keep their old fields (`suspected`, `deleted`).

### `get_job_target` `{}` → `AdminOk` + `target`; `set_job_target` `{ target: 5..60 }` → `AdminOk` (`changed:1`). Touched `sources`.
### `get_jobs_grouped` `{}` / `get_company_jobs` `{ company }` — unchanged reads (+ `rows`).

---

## Companies

### `companies_list` `{ q?, after?, limit? }` → `AdminList<CompanyRow>`
CompanyRow: `{ id, name, overall_score, report_count, ghost_rate, response_rate }`. Ordered by name; `q` = contains.
### `company_detail` `{ name }` → `AdminOk` `rows:[{ score: CompanyRow & {…all score columns}, reports_total, held, merges: MergeRow[], perks }]`
### `company_recompute` `{ name }` → `AdminOk` (`changed`: 1 when a score row was written). Touched `company:<name>, companies`.
### `find_duplicates` `{}` → `AdminList<{ key, auto, companies:[{id,name,report_count,overall_score}] }>` + `duplicates`, `total`
### `merge` `{ primary_id, secondary_id }` or `{ primary, secondary }` (exact names, case-insensitive, no wildcards)
→ `AdminOk` (`changed`=1, `moved_reports`, `merge_id`, undoable → reverses via `undo_merge`). Touched `companies, company_dupes, merges, company:<a>, company:<b>, activity`.
### `auto_merge` `{}` → `AdminOk` job (`changed` = pairs merged, `remaining` groups, `complete`, `groups`).
### `list_merges` `{}` → `AdminList<MergeRow>` + `merges`. MergeRow: `{ id, created_at, primary_name, secondary_name, moved_reports, undone_at }`.
### `undo_merge` `{ merge_id }` / `resplit_company` `{ name }` → `AdminOk` (`restored {…}`).
### `export_company` `{ company }` → `AdminOk` + `bundle` (read; audited).
Legal audit PDF / package: `POST /api/admin-company-audit-pdf|package` `{ company }` with the same token (unchanged bodies).

---

## People

### `users_list` `{ q?, filter?: "all"|"pro"|"new_today"|"new_week", after?, limit? }` → `AdminList<UserRow>`
```json
{ "ok": true, "total": 23, "next": "…", "rows": [ { "id": "5f0c…", "email": "jo@example.com",
  "created_at": "…", "pro_until": "2026-11-24T00:00:00.000Z", "pro_active": true, "comped": false,
  "balance": 7 } ] }
```
Server-side search over every profile (email contains, or an exact user id). `pro` = an active `pro_until`.
### `user_detail` `{ user_id }` → `AdminOk` `rows:[UserRow & { ledger: [{ delta, reason, created_at }], applications: number|null, reports: number|null }]`
### `set_pro_window` `{ user_id, until: ISO-date | null }` → `AdminOk`
Writes `ai_credits.pro_until` ONLY on a grant (never `balance`, `pro` or `comped`, never a purchase row — so a grant can
never read as revenue). `null` ends it now; ending also clears an older grant's lifetime `pro` / `comped` flags (else the
account would stay Pro). Prior value in the audit row;
undoable. `rows:[UserRow]`. Touched `users, user:<id>, activity`.
`set_pro` (legacy) `{ user_id, pro }` → maps to `set_pro_window` (`pro:true` → now + 30 days, `pro:false` → null);
it never touches a balance.
### `grant_credits` `{ user_id, amount: 1..500 }` → `AdminOk` (`balance`; prior balance audited; undoable while the
balance is unchanged). ### `set_user_password` `{ user_id, new_password, reason? }` → `AdminOk` (not undoable).
### `delete_user` `{ user_id }` → `AdminOk` (`changed:1`; not undoable; the auth account is deleted FIRST now —
app rows go only after it succeeds).
### `clusters_list` `{ status? }` → `AdminList<Cluster>`; Cluster: `{ id, user_ids, users:[{id,email}], signals, risk_score, status, admin_note, created_at }`
### `update_cluster` `{ cluster_id, status, admin_note? }` → `AdminOk` (checked; undoable). `detect_duplicates_by_signals` → `AdminOk` (`changed` = clusters created).
### `signup_attribution` `{ days? }` (POST alias of the GET) → the report from `lib/server/attributionReport.js` + `ok`, `touched:[]`.

---

## System

### `flags_list` `{}` → `AdminList<FlagRow>`
Only flags code reads (registry in `lib/server/admin/system.js FLAG_READERS`, held true by a test that greps for each):
| flag | read at |
|---|---|
| `ai_credit_system_enabled` (dangerous: off = unlimited paid features for everyone) | `lib/server/credits.js:128` |
| `seenfit_engine_enabled` | `api/optimizer.js:75` |
| `humanproof_enabled`, `humanproof_paid_only`, `local_humanizer_model_enabled` | `api/optimizer.js:109-115` |
(`job_search_target` is the aggregation target — `get_job_target`, read at `api/jobs.js:550`.)
```json
{ "ok": true, "rows": [ { "flag_name": "ai_credit_system_enabled", "status": "fully_on", "percentage": 0,
  "description": "…", "updated_by": "owner", "updated_at": "…", "readers": ["lib/server/credits.js:128"],
  "dangerous": true, "exists": true } ], "unread": ["job_refresh_enabled", "admin_panel_enabled"] }
```
### `set_flag` `{ flag_name, status, percentage?, confirm? }` → `AdminOk` (undoable). A flag not in the registry → 400.
A `dangerous` flag needs `confirm` equal to the flag name (typed confirmation), else 400 "Type the flag name to confirm".
### `errors_list` `{ after?, endpoint? }` → `AdminList<{ id, endpoint, error_msg, created_at, ref }>` (+ `by_route` for 24 h).
### `revenue_summary` `{ days?: 7|30|90|365 }` → `AdminOk` `rows:[{ days, total_cents, consumer: [{sku, count, cents}], employer_cents, source: "credit_transactions purchase_<sku> × creditRules price; employer_purchases.amount_cents" }]`
### `revenue_funnel` `{ days? }` (POST alias of the GET). `search_opportunities` (unchanged).
### `recent_events` `{ since }` — unchanged (`events`, `server_time`).
### `export_csv` `{}` → `AdminOk` + `{ csv, filename }` (no subscription lines; counts are exact counts).
### `get_kpi_detail` `{ metric }` — legacy (rows ≤100), kept for `/admin/legacy`.

---

## Legacy names kept (for `/admin/legacy` and Seen Command)

| Old | Now |
|---|---|
| `review_reports` | `review_held` engine, legacy response |
| `scan_job_dupes`, `dedupe_jobs` | `job_dupes_scan` / `job_dupes_remove` engine (resumable), legacy fields kept |
| `set_pro` | `set_pro_window` (never touches a balance) |
| `job_update` | `job_edit` engine, `changed` stays the list of fields (Seen Command) |
| `approve_report`, `investigate_report`, `deny_hiring_report` | `moderate_report` |
| `jobs_browse`, `job_detail`, `job_restore` (Seen Command) | unchanged + contract fields |
| `seed_flags`, `get_recent_jobs`, `list_listing_disputes`, `remove_listing`, `deny_report`, `emergency_job_refresh`, `list_subscriptions`, `list_growth_rewards` | kept working for the legacy page; checked writes; not used by the new UI |
