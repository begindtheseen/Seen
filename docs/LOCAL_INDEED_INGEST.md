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
