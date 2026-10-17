# One-time API-credit data jobs

A one-time Claude API credit (~$200, expiring) is spent here on **offline batch jobs that leave
durable data**, never on live per-user traffic. Nothing in this folder is imported by the app.

Every job uses `lib/batch.mjs`: the Message Batches API (50% price), a shared spend ledger in
`.credit-runs/ledger.json`, a hard budget cap (`CREDIT_BUDGET_USD`, default 190), `--dry-run`,
and resumable state (a crashed run re-attaches to its batch; it never resubmits).

## Needs
- Env: `CREDIT_ANTHROPIC_API_KEY` (cloud sessions reserve `ANTHROPIC_API_KEY` for Claude Code; it still
  works for local runs), `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — never in files or chat. The client pins
  `https://api.anthropic.com` so a session's `ANTHROPIC_BASE_URL` can't redirect the credit jobs.
- Network: Anthropic, `*.supabase.co`, and for the Reddit job `arctic-shift.photon-reddit.com` (default
  `--source arctic`; `www.reddit.com` / `old.reddit.com` only for `--source reddit` — Reddit 403s cloud runners)
- Node ≥ 22.18 (scripts import `lib/*.ts` directly)
- Migrations applied (Supabase MCP or dashboard SQL editor — additive and idempotent):
  `supabase/migrations/20261017120000_job_enrichment.sql`, `20261017120100_company_summaries.sql`

Batches can take up to 24h. Start the big ones at least 2 days before the credit expires.

## Run order

Each step: dry run → small pilot → look at the output → full run. Stop and re-plan if a
pilot's quality is poor; unspent credit is better than bad public data.

| # | Step | Command (after `--dry-run`) | Est. |
|---|---|---|---|
| 0 | Preflight | `node scripts/credit/preflight.mjs` | ~$0 |
| 1 | Agencies via web search, pilot | `node scripts/credit/web-reports.mjs run --agencies "Robert Half,Insight Global,Aerotek"` → `write --label <label> --dry-run` → open every kept URL → `write --label <label>` | ~$0.40 |
| 2 | Agencies via Reddit (fetched from the Arctic Shift archive) | pilot `reddit-backfill.mjs fetch --companies 0 --only "insight global"` → check its log + `.credit-runs/reddit/threads/*.json` → `fetch --companies 0` → `extract --kind agency --label reddit-extract-agencies` → `sample --label …` → `qa-judge.mjs --input .credit-runs/reddit/qa-sample.json --label qa-reddit` → `write --label …` (refuses unless QA PASS) | ~$3–8 |
| 3 | All 26 agencies via web search | `web-reports.mjs run` → `write` | ~$3 |
| 4 | Job tagging | `tag-jobs.mjs run --limit 200 --no-write` → review `validation.json` / `review-sample.json` → `write --label …` → `tag-jobs.mjs run` | ~$8–12 |
| 5 | Top companies via Reddit | `reddit-backfill.mjs fetch --companies 400` (hours: rate-limited) → `extract --kind company --label reddit-extract-companies` → sample → QA → write | ~$20–100 |
| 6 | More companies via web search (as budget allows) | `web-reports.mjs run --companies 100 --no-agencies` | ~$11.50 / 100 |
| 7 | Company summaries — LAST, so they include the new reports | `company-summaries.mjs --companies 50 --label company-summaries-pilot` → review `validated.json` / `rejections.json` → `write` → full run | ~$31 / 3k |
| 8 | Duplicate companies | `company-dedupe.mjs --label dedupe` → owner reviews `.credit-runs/dedupe/proposals.json` → `apply --yes` | < $1 |

### "Max fill" day (breadth: real reviews + locations on as many company pages as possible)

**Deploy first:** web-search rows from Glassdoor / ConsumerAffairs / Blind / … are written as
`platform "Public review · <host>"`, `source 'web_public'`, weight 0.3, `trust_reason 'web_search_public_review'`.
The app must classify that label (low trust + public-discussion badge) in PRODUCTION before step 3's
`write` — `write` prints how this checkout scores it; it cannot see what is deployed.

| # | Step | Command | Est. |
|---|---|---|---|
| 1 | Agencies (web + Reddit) | steps 1–3 above | ~$7–12 |
| 2 | Target list (no spend) | `node scripts/credit/web-reports.mjs run --dry-run --no-agencies --targets-file scripts/credit/data/major-employers.json --companies 1000 --label web-max-1000` → read `.credit-runs/web-max-1000/targets.json` | $0 |
| 3 | Top companies via web search | same command without `--dry-run` → `write --label web-max-1000 --dry-run` → spot-check ~20 URLs → `write --label web-max-1000` | ~$100–115 |
| 4 | Top companies via Reddit (quick) | `reddit-backfill.mjs fetch --quick --companies 300 --targets-file scripts/credit/data/major-employers.json` (~3h, $0) → `extract --kind company --label reddit-extract-max` → `sample --label reddit-extract-max` → `qa-judge.mjs … --label qa-reddit-max` → `write --label reddit-extract-max --qa-label qa-reddit-max` | ~$15–40 |
| 5 | Job tagging | step 4 above | ~$8–12 |
| 6 | Company summaries — LAST | step 7 above | rest of budget |

Run `web-reports run` (step 3) first — its batch takes hours — and do the Reddit fetch while it runs.
Check `.credit-runs/ledger.json` between steps; every submit refuses when ledger + estimate > `CREDIT_BUDGET_USD`.

**Company targets** (`--companies N`, `--targets-file F`, both scripts — `scripts/credit/lib/targets.mjs`):
1. `--targets-file` entries in file order. `data/major-employers.json` = 1,622 large US employers (names +
   aliases only, no data): the ~300 biggest everyday employers first, then the rest by sector.
2. Companies with the most **current** listings in `jobs` (`availability_status=active`, `expires_at>now`),
   counted from one paged read of only the `company` column (~0.7 MB; cached in
   `.credit-runs/demand-cache.json` for 24h — `--refresh-demand` re-reads). ATS-slug names
   (`ivcevidensia`, `gongio`) rank after real display names.
3. `company_scores` rows by `report_count`.

Deduped by normalized name; agencies (their own pass) and companies already holding
≥ `--skip-if-reports K` (default 15) first-party reports are skipped. `N` caps the merged list; a
`--targets-file` without `--companies` runs the whole file and skips the demand read. Rows go under an
existing exact `company_scores` spelling when there is one (no split pages), else the lowercase name.
`reddit-backfill fetch --rank reports` keeps the old company_scores-only order.

**Web-search cost** (Sonnet 5.5, Batches): per target ≈ 0.5 × (input_tokens × $2 + output_tokens × $10) / 1M
+ searches_used × $0.01. With ~40k in / 5k out / `--max-uses 5` (default) that is ≈ $0.115 → **~$115 per 1,000
targets** (upper estimate; the pilot measured $0.31 / 3 targets ≈ $0.10 at `--max-uses 6` → ~$100). `run`
prints the target count and this estimate before it submits.

**Locations:** both extractors return an optional `city` ("Austin, TX"; null unless the account itself
states it — never the HQ). `reports` has no city column on prod; the city is written as
`reports.location_id` → `company_locations` via the app's `resolveOrCreateLocation`, which is what company
pages read. Full state names fold to postal codes; "Remote" / "multiple locations" are dropped.

`node scripts/credit/web-reports.mjs`, etc. Use `node --test 'scripts/credit/*.test.mjs'` for tests
(Node 22 won't take the bare directory). In a cloud session Node's `fetch` needs
`NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt` to reach Supabase / Anthropic.

## Reddit data source (Arctic Shift)
`fetch` reads Reddit through the public Arctic Shift archive (`/api/posts/search` + `/api/comments/tree`),
because Reddit returns 403 to our cloud runner. Per target: one all-time search per quieter job
subreddit, and `--windows` (default 1; 3 for depth) one-year windows per very active one
(r/recruitinghell, jobs, antiwork, cscareerquestions, WorkReform, ExperiencedDevs — full-text search
times out there unbounded) = 16 searches per target. `--quick` (breadth runs) searches only
r/recruitinghell, r/jobs, r/cscareerquestions and r/antiwork, one 1-year window each, and no quieter
subreddits = 4 searches per target (+ ≤ `--threads` comment trees). The live API rejects a search
without a subreddit, so the global search is off (`includeGlobal` in `lib/arcticShift.mjs`). Each search
tries `query` (title + body), then `title`; a timeout is retried once, then the search is skipped and
counted. Kept threads (same relevance gate as the live company page) get one comment-tree request each.
Requests are spaced ≥1s and honor `X-RateLimit-Reset` on 429. The cache format is the same as the
`--source reddit` (RSS) path, so extract/sample/write don't care which source fetched it.

## Rules the jobs enforce
- Public-discussion data is written as attributed, down-weighted (0.3) rows the UI labels
  "Sourced from public discussion" — never as first-hand Seen reports. Reddit sources keep the
  `Reddit r/<sub>` shape; every other site uses `Public review · <host>` / `source 'web_public'`.
- No personal names, usernames, or contact details in any stored summary.
- Web-search accounts are kept only if their exact URL came back from search in that response.
- Company summaries may only cite numbers present in Seen's own stats.
- Every write is revertible: Reddit writes keep a ledger (`.credit-runs/reddit/written.json`),
  web-search rows carry `trust_reason = 'web_search_public_discussion'` (Reddit URL) or
  `'web_search_public_review'` (any other site), aliases carry
  `source = 'credit-dedupe'`.

## Supabase egress
The project is in an egress grace period (until 2026-10-28). These jobs read from the DB too —
tag-jobs reads ~49k job descriptions (~0.25 GB). Run each read once; the runs cache locally.
