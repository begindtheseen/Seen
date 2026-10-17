# One-time API-credit data jobs

A one-time Claude API credit (~$200, expiring) is spent here on **offline batch jobs that leave
durable data**, never on live per-user traffic. Nothing in this folder is imported by the app.

Every job uses `lib/batch.mjs`: the Message Batches API (50% price), a shared spend ledger in
`.credit-runs/ledger.json`, a hard budget cap (`CREDIT_BUDGET_USD`, default 190), `--dry-run`,
and resumable state (a crashed run re-attaches to its batch; it never resubmits).

## Needs
- Env: `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (never in files or chat)
- Network: Anthropic, `*.supabase.co`, and for the Reddit job `www.reddit.com` / `old.reddit.com`
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
| 2 | Agencies via Reddit | `reddit-backfill.mjs fetch --companies 0` → `extract --kind agency --label reddit-extract-agencies` → `sample --label …` → `qa-judge.mjs --input .credit-runs/reddit/qa-sample.json --label qa-reddit` → `write --label …` (refuses unless QA PASS) | ~$3–8 |
| 3 | All 26 agencies via web search | `web-reports.mjs run` → `write` | ~$3 |
| 4 | Job tagging | `tag-jobs.mjs run --limit 200 --no-write` → review `validation.json` / `review-sample.json` → `write --label …` → `tag-jobs.mjs run` | ~$8–12 |
| 5 | Top companies via Reddit | `reddit-backfill.mjs fetch --companies 400` (hours: rate-limited) → `extract --kind company --label reddit-extract-companies` → sample → QA → write | ~$20–100 |
| 6 | More companies via web search (as budget allows) | `web-reports.mjs run --companies 100 --no-agencies` | ~$12.50 / 100 |
| 7 | Company summaries — LAST, so they include the new reports | `company-summaries.mjs --companies 50 --label company-summaries-pilot` → review `validated.json` / `rejections.json` → `write` → full run | ~$31 / 3k |
| 8 | Duplicate companies | `company-dedupe.mjs --label dedupe` → owner reviews `.credit-runs/dedupe/proposals.json` → `apply --yes` | < $1 |

`node scripts/credit/web-reports.mjs`, etc. Use `node --test 'scripts/credit/*.test.mjs'` for tests
(Node 22 won't take the bare directory).

## Rules the jobs enforce
- Public-discussion data is written as attributed, down-weighted (0.3) rows the UI labels
  "Sourced from public discussion" — never as first-hand Seen reports.
- No personal names, usernames, or contact details in any stored summary.
- Web-search accounts are kept only if their exact URL came back from search in that response.
- Company summaries may only cite numbers present in Seen's own stats.
- Every write is revertible: Reddit writes keep a ledger (`.credit-runs/reddit/written.json`),
  web-search rows carry `trust_reason = 'web_search_public_discussion'`, aliases carry
  `source = 'credit-dedupe'`.

## Supabase egress
The project is in an egress grace period (until 2026-10-28). These jobs read from the DB too —
tag-jobs reads ~49k job descriptions (~0.25 GB). Run each read once; the runs cache locally.
