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
| 401 | `unauthorized` | false | the session row was read and is missing, expired or the account is disabled. UI: "Session ended — sign in", replay after |
| 503 | `upstream` | true | the session could not be READ (slow or failing database): "Couldn’t check your session — try again." — never a sign-out |
| 403 | `forbidden` | false | a moderator asked for an admin-only action (extra code, not in the contract comment) |
| 404 | `not_found` | false | the row is gone |
| 409 | `conflict` | false | it changed while you looked (e.g. already decided by someone else) |
| 429 | `rate_limited` | true | login attempts (extra code) |
| 502 | `upstream` | true | the database refused or failed; `changed` says what was written first |
| 504 | `timeout` | true | ran out of time; `changed`/`remaining` say where it stopped |
| 501 | `not_available` | false | this action cannot run in this function; `run` says where it can (extra code) |
| 409 | `in_progress` | true | the same `request_id` is still running from the first press — wait, then check (extra code) |

## One press = one execution (`request_id`, every write)
Every write action accepts `request_id` (8–64 of `A–Z a–z 0–9 _ -`; one per press, reused on Retry). The first call
records its answer in `admin_audit_log` (action `request_result`, target `request:<action>:<id>:<round>`, metadata
`{status, status_code, response}`); a replay answers that recorded answer with `replayed: true`, `changed: 0` and
`recorded_changed`, and writes nothing. A replay while the first is still running → 409 `in_progress`. A first call
that failed (not 2xx) is not replayed: Retry runs it. Job actions (`purge_stale_jobs`, `auto_merge`,
`job_dupes_remove`, `dedupe_jobs`, `recompute_queue_drain`) repeat one id across rounds, so they are only made
idempotent when the call names its round (`round: n`). `review_held` and `dedupe_reports` keep their own batch rule
(a retry finishes the rest). These records never appear in `activity_log`.

### Additive writes: an unknown outcome is not a failure (round 8)
Every write is classified in `lib/server/admin/idempotency.js WRITE_CLASS` as **additive** (repeating it changes
things again) or **set** (repeating it changes nothing more), each with its reason; the contract test fails on an
unclassified write. Additive today: `grant_credits` and `undo` (of a credit grant). For those:
- Before its write the handler records its INTENT `{kind, prior, next, …}` on the request record (record status
  `running`). If the record cannot take it, nothing is written → 503 `upstream`, retryable.
- When the database's answer to the write is lost (timeout, reset, 5xx) — or a follow-up write it needs (the ledger
  row) is not confirmed — the audit row is KEPT, the record becomes `unknown`, and the answer is
  504 `timeout`, `retryable:true`, "… press Retry to check whether it went through". A plain 4xx refusal is a failure
  (audit row dropped, record `failed`).
- Retry with the same `request_id` on an `unknown` record, or a `running` record older than 70 s, first reads the
  current state and compares it with the intent:
  - current == next → it was done: missing ledger/audit rows are completed (never a second one), the record is
    finished, and the answer is the normal `AdminOk` (with `undo`) plus `replayed:true`, `changed:0`,
    `recorded_changed:1`.
  - current == prior → nothing happened: the first try's kept audit row is removed and the write runs once.
  - anything else → 409 `conflict`, `retryable:false`: "The balance changed since your first press (it is now N) —
    check before granting again."
- No counter and no record found: an additive write refuses — 503 "Couldn’t check whether this was already done —
  nothing was changed." Set-style writes run.
`fulfill_employer_purchase` (set): when the purchase is already marked fulfilled it checks the perk exists and
re-grants it when it is missing.

## Audit before write, always
A destructive write writes its audit row first, time-boxed (8 s); if that row cannot be written or does not answer,
nothing is written and the answer is a retryable AdminErr (502 `upstream` or 504 `timeout`) saying "nothing was
changed". A bulk decision writes its batch row first (the activity line and the Undo), then each chunk's per-report
rows before that chunk.

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
  "system": { "ok": false, "state": "failing", "recorded": 9, "unknown": 8,
    "line": "1 cron needs a look: refresh-jobs missed its last run (last ran Nov 10, 2026, 1:00 AM PT).",
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
- `listings_stale` = stale rows (`staleSweep.STALE_CLEARABLE_FILTER`), an exact count. "Clear stale" also deletes
  expired rows nobody saved, so its result can be larger than this number (its message says so).
- `system`: `ok` (true only when every cron that records its runs is on time), plus optional
  `state: 'ok' | 'failing' | 'unknown'`, `recorded` (crons with a recorded run) and `unknown` (crons with none;
  `recorded + unknown` = all crons). No recorded run anywhere → `ok:false, state:'unknown'` — never "all on time".
  When cron health itself cannot be read: `state:'unknown', recorded:null, unknown:null` and `cron_health` in `failed`.
- Every count here and in every list is an exact count (Content-Range) or `null` — never the length of a page.
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
Company names in a summary are display names (`lib/companyNames.js displayCompanyName`), never the stored lower-case
keys: "Merged Beacon Group into Beacon Holdings". The same holds for the merge / separate / undo-merge answers.
`undoable` is true for: `review_held` (bulk), `approve_held_report`/`reject_held_report`, `*_report` moderation
(approve/reject/hold/restore), `merge_companies` / `auto_merge_pair`, `delete_listing`, `dismiss_inactive_report`,
`set_pro_window`, `set_flag`, `update_reddit_dispute`, `resolve_issue`/`dismiss_issue`, `update_cluster`,
`grant_credits`, `job_update` — and the row is not already undone.

### `undo` `{ audit_id, request_id?, round? }` → `AdminOk`
```json
{ "ok": true, "changed": 288, "skipped": [ { "reason": "changed_since", "count": 0 } ],
  "message": "288 reports are back in the review queue.", "touched": ["held","reports","overview","activity"],
  "remaining": 0, "complete": true }
```
**Undo sentences say what is true now** (round 10) — never "Undid it: …"; the interface adds "Undone" itself. All of
them come from `words.js undoSentence`: "288 reports are back in the review queue." · "… back in the review queue, no
longer rejected." · "12 reports are no longer marked as copies." · "The report is back as it was." · "The outcome is
Ghosted again." · "Walmart Inc is separate again · 4 reports moved back." · "The listing is back on the site and its
reports are restored." · "The Pro window is back as it was." · "The flag X is Off again." · "Back to open." · "The
balance is back to 7." · "The listing is back as it was before the edit." A no-op stays a no-op sentence ("It changed
since, so it was left alone.").

**A bulk undo (`review_held`, `dedupe_reports`) is a JOB** — the same contract as the action it reverses:
- send `{ audit_id, request_id: <one per Undo press>, round: n }`, n = 1, 2, 3 … while `complete` is false. Each round
  works ≤ ~8 s on the rows (plus ≤10 s reading the batch and ≤4 s of score recompute), so a round answers well inside the
  client's normal timeout; give the first call the bulk timeout anyway.
- a round whose answer is lost is RE-SENT with the same `request_id` and the same `round`: it replays
  (`replayed: true, changed: 0, recorded_changed`) or answers 409 `in_progress` while it still runs — never run twice,
  never "failed". After a reload ask `job_status { kind: "undo", audit_id }`.
- a round re-sent after the last round finished answers `ok`, `complete: true, remaining: 0, already_undone: true` with
  the done sentence (not 409).
```json
{ "ok": true, "changed": 40, "skipped": [], "message": "Restoring 80 of 1,040 — keep going.", "touched": ["held","reports","overview","activity"],
  "remaining": 960, "complete": false, "cursor": "eyJhdWRpdF9pZCI6…", "restored": 80, "total": 1040 }
```
`changed` = rows restored by THIS round (sum them; count a replay's `recorded_changed` once); `restored` / `total` =
running totals. `recompute: { queued, remaining, mode, cursor? }` (round 11) = company scores this round QUEUED, not
recomputed inline — run the same `recompute_queue_drain` follow-up as after the bulk decision (pass `cursor` when the
queue table is absent). Shape of the work: rows sharing their prior values are restored by one conditional PATCH per
≤40 ids (no read before the write); 1,040 rows take ~41 calls in one round at 60 ms per call. The server re-reads the batch each round, so an interrupted or cancelled undo resumes from any later
press. The audit row records `undo_progress` and is marked undone only by the round that completes.
A single-row undo (`round` absent) is one call; `request_id` alone makes it idempotent. An already-undone row without
`round`: 409 `conflict` "That was already undone." A row that cannot be undone: 400 `bad_request`.

### `cron_health` `{}` → `AdminList<AdminCron>`
```json
{ "ok": true, "as_of": "…", "rows": [
  { "name": "refresh-jobs", "path": "/api/refresh-jobs", "schedule": "0 2,6,10,14,18,22 * * *",
    "last_run": "2026-11-10T14:00:04.000Z", "last_result": "ok", "next_run": "2026-11-10T18:00:00.000Z",
    "overdue": false, "duration_ms": 29876, "detail": "Next: Nov 10, 10:00 AM (California) · from cron_runs" },
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
`"unknown"`, `last_run:null`, `overdue:false` (never guessed). `schedule_label` = the schedule in words, in California time ("Every 15 minutes", "6 times a day (2:00 AM PT, …)",
"Last day of each month at 8:00 PM PT" for `0 4 1 * *` UTC) — show this, never `schedule`.
`duration_ms` (optional) = the last recorded run's length: "duration_ms N" in `cron_runs.detail`
(lib/server/cronRecord.js), else finished − started; absent when nothing recorded it. `overdue` = a recorded last run older than the
scheduled interval + 1 h grace.

---

## Review

### `list_held_reports` `{ sort? }` → `AdminList<HeldRow>` (+ legacy fields)
`sort`: `needs_eyes` (default) | `newest` | `oldest` | `company` | `outcome`.
```json
{ "ok": true, "sort": "needs_eyes", "total": 300, "as_of": "…",
  "counts": { "total": 300, "needs_eyes": 120, "positive": 150, "employee_review": 30,
              "clear_positives": 140, "possible_duplicates": 24, "unchecked": 0 },
  "checked": { "n": 300, "of": 300, "complete": true, "label": "all 300 checked for copies" },
  "duplicate_check": "done", "duplicate_check_pending": 0,
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
- `possible_duplicate` covers a copy of another HELD row AND a copy of a published report (same company + outcome +
  text); then `review.duplicate_of` = the original's id and `review.duplicate_of_live: true`. The flag survives the
  original's approval, so a fresh tab never offers the copy for bulk approval.
- **The duplicate-of-live check is remembered (round 10).** A result is kept per report id + a hash of its compare key
  (`admin_dup_checks`, migration 20261111130000; before it, per-instance memory) for 15 minutes, and cleared for a company
  whenever any of its reports changes state (approve / reject / restore / hold / outcome / merge / undo — every path that
  queues the company's score). A read applies remembered results with no live reads and checks only the rest, ≤4 reads
  in parallel, for at most 8 s from the session check (`LIVE_CHECK.listBudgetMs`); what it checks is remembered, so the
  next read continues. `counts.clear_positives` (= what "Approve all positive" publishes: positive, no anti-gaming hold,
  not a possible duplicate, checked) and `counts.possible_duplicates` come from the SAME results as the rows.
  `checked: { n, of, complete, label }` counts rows that have a compare key; while `complete` is false the two counts
  are lower bounds and the screen shows `checked.label` ("checked 82 of 343 for copies — checking 261 more") and
  re-reads — it never shows a moving number as final. `counts.unchecked` = rows still `pending`.
- Each row carries
  `review.duplicate_check: 'done'|'pending'`; the list carries `duplicate_check: 'done'|'pending'` and
  `duplicate_check_pending` (how many rows). **`pending` means "not checked yet", never "not a duplicate"** — show it as
  unchecked and re-read later. **One compare key** (`lib/server/reportReview.js duplicateKey`: company lower-cased with
  whitespace collapsed and trimmed, outcome, text) is used by the held-vs-held check, the list's live check, its
  remembered results and the bulk guard, and the list reads published reports with the same case-insensitive match as
  the guard — so "home  depot" is a copy of "Home Depot" in the list, from the cache and at approve time alike (a cached
  answer and a live answer are the same answer by construction). `review.duplicate_case_variant: true` marks a copy found
  under the name written differently; the bulk sentence says "(N under the company name written differently)". The bulk guard re-checks the rows it would approve, exactly, at decision time, and skips
  anything it cannot verify as `not_checked_for_duplicates` ("N not checked for duplicates — try again"); a row its
  own check could not reach in its budget uses the list's remembered result, so with a warm cache `not_checked` is 0.
  `review_held` answers carry `not_checked: n` (that count) beside `skipped`.
- Every row carries `rules: "passes"|"fails"|null` and `rules_detail: { verdict, comment: boolean|null, post: boolean|null }`
  — Seen's strict first-hand rules read as a comment and as the post itself (null = the rules do not apply: not an
  imported public account, or too short). `reports_recent` rows carry the same two fields.

### `review_held` `{ decision: "approve"|"reject", ids?: string[], scope?: "all", group?: "needs_eyes"|"positive"|"employee_review", include_ids?: string[], request_id?: uuid }` → `AdminOk`  (THE bulk fix)
- `ids` (1–5,000) OR `scope: "all"` ("all matching": the server takes every pending report, narrowed by `group`).
- **Bulk approve scope guard:** an approval of more than one report (several ids, or `scope:"all"`) SKIPS anti-gaming
  holds (`anti_gaming_hold`) and possible duplicates (`possible_duplicate`), each with its count and ids, unless that
  id is also listed in `include_ids` (the admin named it on purpose). A single-id approve is never filtered;
  rejections are never filtered. `include_duplicates` is gone. The legacy `review_reports` alias has the same guard.
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
- `skipped` reasons: `anti_gaming_hold` (message: "left for one-by-one review (approve them by ticking each)") and
  `possible_duplicate` (bulk approve only — see the guard above), `already_decided` (held but already rejected/duplicate,
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

### `correct_report_outcome` `{ id, outcome, reason? }` → `AdminOk` (full admins)
`outcome` ∈ ghosted, rejected, autoreject, hired, offer, interview, interviewing, human, waiting (the database's own
check). Conditional on the outcome read; audited with prior and next (`reason` in the audit row); the company's score
is recomputed (`recompute {queued, done, remaining, cursor?}`); undoable. Same outcome → `changed:0` "Already “x”.".

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
### `dedupe_reports` `{ request_id? }` → `AdminOk` job: `changed` = copies marked, `remaining`, `complete`, `undo`, `request_id`.
One Undo covers the whole press: send one `request_id` for every round of the job, and the last round's `undo`
reverts every copy marked under it (a resumable job like the review Undo). Touched `report_dupes, reports, held, overview, activity`.

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
- `{ action:"list", status? }` → `{ ok:true, rows: Claim[], claims: Claim[], counts:{pending,approved,rejected} }`;
  a failed read is 502 `{ ok:false, code:"upstream", retryable:true }`, never an empty list.
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
— each `number|null`; `failed: string[]`. `expired_kept` counts EVERY hidden expired row (kept or about to go) — the
UI reads `clear_plan` for Clear stale:
`clear_plan: { will_delete, stale_delete, expired_delete, aging_delete, kept_referenced, expired_kept_referenced, stale_total, expired_total, aging_total } | null`
— what "Clear stale" (sweep mode 'all') deletes: stale + expired + active-unseen-7-days rows that no saved_jobs /
applications row references; what it keeps: the referenced ones (`kept_referenced`; `expired_kept_referenced` = the
"expired, stored because someone saved/tracked it" tile). Each count from its own exact read. Also on `overview.extra.clear_plan`.

### `job_status` `{ kind: "clear_stale"|"auto_merge"|"recompute"|"report_dupes"|"job_dupes"|"undo", audit_id? }` → `AdminOk` `{ kind, remaining, complete, rows:[{kind, remaining}] }`
`kind: "undo"` needs `audit_id` (the action being undone): for a bulk decision it counts, from the reports themselves,
`remaining` (rows still holding what the action wrote), `restored`, `total`, `changed_since`, `not_found`, `undone`;
for a single action `remaining` is 0 once undone, else 1.
What a resumable job still has to do, read from the database (after a reload, show "Nothing left" / "N left" from
this, never the page's own counter). `job_dupes` answers `remaining: null` (known only after a scan).

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

### `source_health` `{}` → `AdminList<SourceRow>` + `{ as_of, source: "admin_source_health"|"exact", failing: number }`
SourceRow: `{ source, live, added_24h, added_today, last_seen, failing: boolean|null, why: string|null }`
- `live` = active and not expired; `added_24h` = rolling 24 h; `added_today` = since midnight California; exact counts
  (RPC `admin_source_health(p_today)` when deployed, else per-source exact counts). `failing` true when the source has no
  live listings or nothing seen in 48 h (`why` says which); null when a count could not be read.

### `get_job_target` `{}` → `AdminOk` + `target`; `set_job_target` `{ target: 5..60 }` → `AdminOk` (`changed:1`). Touched `sources`.
### `get_jobs_grouped` `{}` / `get_company_jobs` `{ company }` — unchanged reads (+ `rows`).

---

## Companies

### `companies_list` `{ q?, after?, limit? }` → `AdminList<CompanyRow>` + `total`, `total_label` (first page)
CompanyRow: `{ id, name, overall_score, report_count, ghost_rate, response_rate }`. Ordered by name; `q` = contains.
`total` = the exact number of `company_scores` rows matching `q` (a Content-Range count — never the page length;
`null` when the count could not be read); `total_label` = "companies with a score" (or "… matching the search").
Sent on the first page only (absent when `after` is given).
### `company_detail` `{ name }` → `AdminOk` `rows:[{ score: CompanyRow & {…all score columns}, reports_total, held, merges: MergeRow[], perks }]`
### `company_recompute` `{ name }` → `AdminOk` (`changed`: 1 when a score row was written). Touched `company:<name>, companies`.
### `find_duplicates` `{}` → `AdminList<{ key, auto, companies:[{id,name,report_count,overall_score}] }>` + `duplicates`, `total`
### `merge` `{ primary_id, secondary_id }` or `{ primary, secondary }` (exact names, case-insensitive, no wildcards)
→ `AdminOk` (`changed`=1, `moved_reports`, `merge_id`, undoable → reverses via `undo_merge`). Touched `companies, company_dupes, merges, company:<a>, company:<b>, activity`.
### `auto_merge` `{ request_id?, round? }` → `AdminOk` job, rounds of ~10 s (progress every round), ONE unit, groups: `changed` = groups merged this round, `remaining` = groups
left, `groups_total`, `complete`; `merged` = companies absorbed (detail only), `groups: [{canonical, absorbed[]}]`.
Sentence: "Merged 57 groups (60 companies) · 12 groups left." A summary over rounds sums `changed` (groups) and `merged`
(companies) and says both the same way.
### `list_merges` `{}` → `AdminList<MergeRow>` + `merges`. MergeRow: `{ id, created_at, primary_name, secondary_name, moved_reports, undone_at }`.
### `undo_merge` `{ merge_id }` / `resplit_company` `{ name }` → `AdminOk` (`restored {…}`).
### `export_company` `{ company }` → `AdminOk` + `bundle`, `display_name` (the company's own spelling; read; audited).
**Legal audit exports (binary, separate endpoints, for a core download helper):**
- `POST /api/admin-company-audit-pdf` and `POST /api/admin-company-audit-package`, header `X-Admin-Token`, JSON body
  `{ company: "<name>" }` (or `{ id: "<companies.id>" }`; GET `?company=` also works). Full admins only.
- Success: 200 binary. PDF: `Content-Type: application/pdf`, `Content-Disposition: attachment;
  filename="seen-legal-audit-<slug>-<YYYY-MM-DD>.pdf"`, `X-Source-Json-Sha256`. Package: `application/zip`,
  `filename="seen-legal-audit-package-<slug>-<YYYY-MM-DD>.zip"`, `X-Source-Json-Sha256`, `X-Pdf-Sha256`.
  Read the filename from Content-Disposition (same origin; no expose header needed).
- Failure: JSON `AdminErr` for auth (401 `unauthorized`, 503 `upstream` retryable when the session can't be read),
  JSON `{ error }` for 400 (company missing) / 403 (moderator) / 404 / 500 — treat any non-200 as an error with `error`.

---

## People

### `users_list` `{ q?, filter?: "all"|"pro"|"free"|"new_today"|"new_week", after?, limit? }` → `AdminList<UserRow>`
```json
{ "ok": true, "total": 23, "next": "…", "rows": [ { "id": "5f0c…", "email": "jo@example.com",
  "created_at": "…", "pro_until": "2026-11-24T00:00:00.000Z", "pro_active": true, "comped": false,
  "balance": 7 } ] }
```
Server-side search over every profile (email contains, or an exact user id). `pro` = an active `pro_until`.
`free` = no active Pro window (`pro` true or `pro_until` in the future) AND no purchase on the ledger
(`credit_transactions.reason` like `purchase_*`); welcome, earned and admin-granted credits do not make an account
paid. The answer carries `label` (that definition, in words) and `filter:"free"`; `total` is exact (every profile,
holder and purchaser read by keyset pages), on every page; same order and cursor as the other filters. A failed or
incomplete read is 502 `upstream`, never a short list.
### `user_detail` `{ user_id }` → `AdminOk` `rows:[UserRow & { ledger: [{ delta, reason, note, by, created_at }], credits_earned: number|null, credits_spent: number|null, signup_source: SignupSource|null, applications: number|null, reports: number|null }]`
SignupSource (from `signup_attribution`; null when the account has no row or before that migration):
`{ landing_path, referrer_host, utm_source, utm_medium, utm_campaign, ref_code, first_seen_at, landing_group, referrer_group }`.
`ledger` is the newest 50 entries; `credits_earned` / `credits_spent` are summed over every entry (keyset pages).
### `set_pro_window` `{ user_id, until: ISO-date | null }` → `AdminOk`
Writes `ai_credits.pro_until` ONLY on a grant (never `balance`, `pro` or `comped`, never a purchase row — so a grant can
never read as revenue). `null` ends it now; ending also clears an older grant's lifetime `pro` / `comped` flags (else the
account would stay Pro). Prior value in the audit row;
undoable. `rows:[UserRow]`. Touched `users, user:<id>, activity`.
`set_pro` (legacy) `{ user_id, pro }` → maps to `set_pro_window` (`pro:true` → now + 30 days, `pro:false` → null);
it never touches a balance.
### `grant_credits` `{ user_id, amount: 1..500, reason?: string (≤200) }` → `AdminOk` (`balance`; prior balance audited;
undoable while the balance is unchanged). `reason` is stored on the ledger row (`credit_transactions.metadata.note`, shown
as `note` in `user_detail.ledger`) and in the audit row's `metadata.reason`. ### `set_user_password` `{ user_id, new_password, reason? }` → `AdminOk` (not undoable).
### `delete_user` `{ user_id }` → `AdminOk` (`changed:1`; not undoable; the auth account is deleted FIRST now —
app rows go only after it succeeds).
### `clusters_list` `{ status? }` → `AdminList<Cluster>`; Cluster: `{ id, user_ids, users:[{id,email}], signals, risk_score, status, admin_note, created_at }`
### `cluster_detail` `{ cluster_id }` → `AdminOk` `rows:[{ id, user_ids, signals, risk_score, status, admin_note, created_at, updated_at, users: [UserRow & { found }] }]`
Cluster ids: production uses positive integers, the rig seeds uuids — every cluster action accepts either.
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
### `set_flag` `{ flag_name, status, percentage?, confirm? }` → `AdminOk` (undoable). Undo puts the prior status back; if the
flag had no row before, Undo deletes the row this created (only while it still holds the status set). A flag not in the registry → 400.
A `dangerous` flag needs `confirm` equal to the flag name (typed confirmation), else 400 "Type the flag name to confirm".
### `errors_list` `{ after?, endpoint? }` → `AdminList<{ id, endpoint, error_msg, created_at, ref }>` (+ `by_route` for 24 h).
### `revenue_summary` `{ days?: 7|30|90|365 }` → `AdminOk` `rows:[{ days, total_cents, consumer: [{sku, name, count, cents}], employer_cents, credits: { earned, spent, rows, source }, source }]`
Every total is an exact count × price or a sum over every row (keyset pages); a total that could not be read whole is null.
### `db_size` `{}` → `AdminOk` `rows:[DbSize|{db_size:null}]`, `db_size: DbSize|null`
DbSize: `{ total_mb, jobs_mb, jobs_pct, guard_max_mb, guard_enabled, used_pct, as_of, source }`. From RPC
`admin_db_size()` (with the jobs table's share), else `jobs_storage_status()` (what the legacy page reads: no jobs
split → `jobs_mb:null`), else `db_size:null` and message "could not be read".

### `refresh_demand` `{}` → `AdminOk` job (`complete:true`, `remaining:0`, `changed` = rows upserted, `result`)
Runs the existing api/demand.js refresh in this function (both 60 s). A refresh that does not finish → 504/502 AdminErr.

### `refresh_jobs` `{}` → 501 `AdminErr` `code:"not_available"`, `run: { method:"POST", path:"/api/refresh-jobs", auth:"X-Admin-Token", max_seconds:300 }`
Refreshing listings needs up to 270 s (api/refresh-jobs.js HANDLER_BUDGET_MS, maxDuration 300) and this function has
60 s; refresh-jobs exports only its handler. The UI runs it on its own endpoint (POST /api/refresh-jobs with the token;
it answers its own JSON: `{ ok, found, upserted, inserted, updated, failed_batches, stale_sweep, … }`).

### `revenue_funnel` `{ days? }` (POST alias of the GET). `search_opportunities` (unchanged).
### `recent_events` `{ since }` — unchanged (`events`, `server_time`).
### `top_searched` `{ limit? (1–50, default 10) }` → `AdminList<{ query, key, count }>` — most searched, last 7 days
Reads `search_logs` (the /jobs searches) for the last 7 days by keyset pages, newest first, and counts by the
trimmed, lower-cased query (`query` = its most common written form). `searches_read` = rows counted;
`searches_total` = the week's exact count (Content-Range; null if unreadable); `distinct`; `complete` = every row of
the week was read. Bounded at 100,000 rows / 15 s: then `complete:false` and `label` = "from the newest N searches of
the last 7 days" (else "searches in the last 7 days (all N)"). These are search queries (job titles or company names
as typed), not resolved companies. Table missing → `ok`, `ready:false`, no rows.
```json
{ "ok": true, "rows": [ { "query": "Cashier", "key": "cashier", "count": 1500 } ], "total": 1,
  "searches_read": 2500, "searches_total": 2500, "complete": true, "distinct": 2,
  "label": "searches in the last 7 days (all 2,500)", "message": "2,500 searches read · 2 different queries." }
```
### `enrichment_queue_stats` `{}` → `AdminOk` `rows:[EnrichmentQueueRow]`
`company_enrichment_queue` (statuses queued | running | done | empty | error). Every number is an exact
Content-Range count, `null` when that one count could not be read:
`{ ready:true, waiting (queued), running, done_today (done or empty, done_at since midnight PT), failed (now in error),
oldest_waiting_at, oldest_waiting_age_s, oldest_waiting_company (display name), labels:{waiting,running,done_today,failed} }`.
Message: "1,201 waiting · 2 running · 5 done today · 3 failed · oldest waiting 3 hours." Oldest row unreadable →
`skipped:[{reason:'oldest_unreadable'}]`. Table missing → `rows:[{ ready:false }]`.
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


## Failed reads are never empty
Every list action answers an error (502 `upstream`, retryable) when its main read fails; a secondary field that could
not be read is `null` (never `[]`): `user_detail.ledger`, `report_detail.rows[0].history`, `job_detail.history`,
`company_detail.rows[0].merges` / `perks`, `list_employer_purchases.perks`. `list_merges` answers `ready:false` with no
rows only when the table does not exist yet (404).


## Words the server writes
- Report rows carry `outcome_label` (the public site's words: Ghosted, Auto-rejected, Rejected, Got a response, Interview,
  Interviewing, Offer, Hired, Waiting) and `source_label` ("Imported · LinkedIn", "Sent to Seen · Seen", "From Reddit
  (passed the first-hand rules) · Reddit r/jobs", …). Employer replies' `report` carries `outcome_label` and
  `outcome_phrase` ("an Auto-rejected"). Never print `outcome` / `trust_reason` raw.
- Flag states read "Off", "On for admins only", "On for beta users", "On for N% of users", "On for everyone".
- Dates in sentences: "Nov 30, 2026"; times: "… PT".
- Account clusters are a People queue (`section: "people"` in `overview.queues`); Review's chips, sentence and badge
  do not count them.
