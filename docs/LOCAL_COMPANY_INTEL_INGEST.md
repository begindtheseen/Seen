# Local company-intelligence ingestion

This is a Mac-only, admin-only raw-evidence pipeline. It does not use an LLM, generate summaries,
or invent applicant outcomes. Every item needs a company name, original source URL, and a short
excerpt. Profanity, phone numbers, and email addresses are redacted automatically.

Set `LOCAL_COMPANY_INTEL_INGEST_SECRET` in Vercel (Production) and use the same value locally:

```sh
export SEEN_COMPANY_INTEL_INGEST_TOKEN='same-secret-from-vercel'
export COMPANY_INTEL_ITEMS_JSON='[
  {"company":"Acme","source":"Reddit r/jobs","source_url":"https://www.reddit.com/r/jobs/comments/example/","excerpt":"I completed a final interview and never heard back.","kind":"applicant_outcome","outcome":"ghosted","sentiment":"negative","year":"2026"},
  {"company":"Acme","source":"Indeed","source_url":"https://www.indeed.com/cmp/Acme/reviews","excerpt":"Great benefits and supportive teammates.","kind":"employee_review","sentiment":"positive","year":"2026"}
]'
npm run ingest:company-intel
```

`applicant_outcome` needs a supported `outcome` and becomes a low-trust, source-labeled imported
report. `employee_review` and `public_commentary` appear under “What people are saying online” but
never affect applicant-report counts, ghost rates, response rates, or grades. A source URL plus
normalized excerpt hash is registered in `company_intel_imports`, so re-runs and overlapping searches
skip duplicates safely.

## Automatic Reddit collection for companies already on Seen

After the Vercel deployment is live, this Mac-only command asks Seen for its most active existing
companies, searches Reddit through your connected OpenCLI browser, and imports raw source-attributed
excerpts. It never creates a company from a Reddit search. Direct first-person hiring outcomes become
low-trust reports; employee comments and everything else stay under “What people are saying online.”
No text is AI-summarized.

```sh
export SEEN_COMPANY_INTEL_INGEST_TOKEN='same-secret-from-vercel'
export COMPANY_INTEL_COMPANY_LIMIT=10
export COMPANY_INTEL_POSTS_PER_COMPANY=3
npm run ingest:reddit-intel
```

Start cautiously with `COMPANY_INTEL_COMPANY_LIMIT=5`. To inspect what it would collect without
writing anything, run `npm run ingest:reddit-intel -- --dry-run`.
