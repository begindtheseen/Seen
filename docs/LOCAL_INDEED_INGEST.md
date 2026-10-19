# Local Indeed ingestion

This is an **admin-only**, manually started pipeline. The public site has no listing-import
control. Indeed is accessed only from the Mac running OpenCLI and its connected Chrome browser;
Vercel never fetches Indeed.

## One-time setup

1. Install OpenCLI and connect its Browser Bridge to Chrome. Open Indeed in that Chrome profile
   and complete any human verification it presents.
2. In Vercel, create a strong `LOCAL_INDEED_INGEST_SECRET` environment variable. Keep it server-only.
3. On the Mac, set the same value as `SEEN_LOCAL_INGEST_TOKEN` and configure the searches:

```sh
export SEEN_LOCAL_INGEST_TOKEN='same-secret-from-vercel'
export INDEED_SEARCHES_JSON='[
  {"query":"software engineer","location":"Remote"},
  {"query":"data analyst","location":"New York, NY"}
]'
export INDEED_RESULTS_PER_SEARCH=25 # OpenCLI maximum per page
export INDEED_MAX_PAGES=3           # OpenCLI supports --start pagination in offsets of 10
# Optional: INDEED_MAX_SEARCHES=10  # default is every supplied search
```

## Run it

From the Seen repository on that Mac:

```sh
npm run ingest:indeed
```

The script searches Indeed through OpenCLI, opens each returned job by its job key to collect the
full description, then sends batches to `/api/ingest-local-indeed`. The endpoint accepts only
Indeed URLs and applies Seen's normal quality checks, scoring, deduplication, and Supabase upsert.

If OpenCLI reports an Indeed Cloudflare challenge, open Indeed in the connected Chrome profile,
complete it yourself, and run the command again. Do not run this as a Vercel cron.

The command prints structured diagnostics: requested/attempted/successful/failed searches,
raw and duplicate hits, detail failures, accepted/rejected rows, and database writes. `upserted`
means rows written or refreshed; it is **not** a count of brand-new inserts (Supabase does not
return a reliable insert-vs-update split for this merge path). The importer preserves each Indeed
`jk` as `external_id`, so repeated results dedupe while same title/company jobs in different
locations remain distinct.

OpenCLI's installed Indeed adapter supports `--start`, `--limit` (1–25) and one page per call.
The importer uses that documented pagination and stops on a short page. Detail commands remain
sequential (`INDEED_DETAIL_CONCURRENCY=1` only): parallel Browser Bridge detail calls have not
been verified safe and are deliberately rejected rather than risking Chrome sessions or rate limits.
