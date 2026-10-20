# Seen Job Ingestion Engine — build report

_Multi-source, employer-direct-first, self-growing. Built 2026-08-07._

## 1. How search worked before
`api/jobs.js` is DB-first: geocode the place → indexed bbox DB read → relevance-rank. If fewer than a `TARGET` (~25, admin-tunable) in-radius results, it **expanded** via `aggregateForQuery` (Adzuna pull → normalize → global upsert → id-stitch), guarded by a 3-hour per-(query,location) cooldown (`search_pull_log`), an in-flight coalescer, and a global aggregation budget; then geo-widen → national-widen → nearest-fallback so a board is never empty. Every discovery persisted to the shared corpus. **The engine was already sophisticated — its only real limit was the source.**

## 2. Existing Adzuna dependency
Adzuna was the sole source for arbitrary user queries. Five keyless secondary feeds (Remotive, Arbeitnow, Jobicy, RemoteOK, The Muse) ran cron-only and remote-focused. So a search for a local/company-specific role returned only Adzuna's thin, redirect-URL results.

## 3. New provider architecture
Modeled on **ever-jobs' `IScraper`** (MIT): one interface, each provider self-normalizes, `Promise.allSettled` fan-out, source-rank merge. `lib/jobs/`:
- **atsDetect.js** — URL → `{provider, tenant}` for 16 ATS; flags aggregator redirects.
- **atsProviders.js** — employer-direct providers (public JSON, no keys), reuse `buildJob()`.
- **sourceRegistry.js** — `company_sources` CRUD + snowball + circuit breaker.
- **expand.js** — `aggregateWithSources` (employer-direct first, Adzuna fallback, snowball, canonical dedup).
- **discovery.js** — Common Crawl CDX sweep → own source directory.
- **seedSources.js** — curated bootstrap.

## 4. Open-source used
- **ever-jobs (MIT):** provider-interface pattern, `allSettled` worker-pool, source-rank merge, per-job liveness/legitimacy idea — adapted.
- **kalil0321/ats-scrapers (MIT):** exact public ATS endpoints + field mappings — verified my providers against them; `{provider}:{ats_id}` dedup key — adopted.
- **Feashliaa/job-board-aggregator (code MIT / data CC BY-NC):** Common Crawl CDX discovery *method* — reused; its 95k-slug dataset — **rejected** (non-commercial).
- **Masterjx9/OpenPostings (no license):** first-seen/last-seen freshness *idea* — reimplemented; code — **rejected** (all-rights-reserved).
- **vesaias/JobNavigator (MIT):** canonical-URL dedup (strip tracking) idea; JobSpy/Indeed technique — **rejected** (ToS).

## 5. Providers implemented
Employer-direct, public JSON, no keys, no scraping: **Greenhouse, Lever, Ashby, Workable, Recruitee, SmartRecruiters.** Detected-but-not-yet-ingested (recorded for provenance/future official access): Workday, iCIMS, Jobvite, JazzHR, BambooHR, Personio, SuccessFactors, Taleo, Oracle, ADP, Paylocity.

## 6. Provider interface
`fetchCompanyJobs(tenant, {companyName, fetchImpl, timeoutMs}) → CanonicalJobRow[]` — `fetchImpl` injectable (tests), rows produced by the shared `buildJob()` + provenance stamp, `[]` on any error (isolation). `fetchSourceJobs()` is the central health-tracked entry.

**Title-as-company guard (2026-10-17).** `buildJob()` (and the Adzuna mapper) reject a row whose company is a job title, via `isTitleLikeCompany()` in `lib/server/jobSources.js`. Arbeitnow sends these upstream: `company_name` is its only employer field and its URL slug is built from it, so nothing better can be recovered. On 2026-10-17 prod had 23 such rows under 3 fake names. The rule needs a role noun plus a title shape (a leading seniority word, parentheses, ` - `, `/`), or a gender marker such as `(m/w/d)`. A legal suffix (GmbH, Ltd, …) or a leading "The" marks a real company. Checked against all 10,871 distinct `jobs.company` values: it matched only those 3.

## 7. Direct ATS coverage
Six ingestable providers cover the majority of tech/startup employers and a large share of mid-market. 27 well-known boards seeded live; the registry grows automatically via snowball + Common Crawl.

## 8. Indeed status
**Deliberately NOT implemented as core.** Both reference projects reach Indeed via a hidden `apis.indeed.com/graphql` endpoint with a static app key harvested from Indeed's mobile app — an undocumented private API whose automated use violates Indeed's ToS. For a monetized product that's real legal risk. It stays behind the provider interface, disabled, until official/licensed access (Indeed Publisher/Apply or a licensed aggregator) is added. No CAPTCHA/auth bypass anywhere.

## 9. Supplemental board status
The five keyless feeds remain (cron). LinkedIn/Glassdoor/ZipRecruiter/Google-Jobs = same ToS/reliability caveat as Indeed → not core; the interface supports adding official routes later.

## 10-11. Search Expansion behavior + exact threshold
Unchanged trigger, upgraded source order. DB-first; if in-radius results `< TARGET` (default 25, `feature_flags.job_search_target`), and not within the 3h cooldown, and the global budget allows → `aggregateWithSources`: (1) **employer-direct ATS** for registered boards matching the query's company, (2) **Adzuna** fallback, (3) snowball, (4) canonical dedup. Then geo-widen → national → nearest. Coalesced + budgeted exactly as before.

## 12. Global persistence
Every valid discovery upserts to the shared `jobs` corpus (merge-duplicates), so the next user's DB-first read serves them with no live fetch. User-private state (saved/applied/hidden) is separate, untouched.

## 13. Source/company registry
`company_sources` (migration 066): `{company_name, provider, tenant, careers_url, source_type, ingestable, status, confidence, job_count, consecutive_failures, first_discovered_at, last_successful_sync, discovered_via}`, unique `(provider, tenant)`. Grown by snowball (search results), seed, and Common Crawl. The scheduled refresh ingests due sources directly.

## 14. Deduplication
Canonical dedup (`expand.dedupJobs`): group by `title|company|location` fingerprint; within a fingerprint, distinct `external_id` (requisition) rows are kept separate, and an aggregator's no-requisition row collapses into the employer-direct one. Result: same vacancy across sources → **one** (employer-direct wins); same title / different requisition → **two**; two aggregator dups → one.

## 15. Canonical-source selection
Employer-direct is merged first (source authority) and, via upsert order (ATS upserted after Adzuna), overwrites the aggregator row for the same vacancy — so the stored apply URL and source become the employer's real ones.

## 16-17. Freshness / first-seen vs last-seen
`created_at` = immutable first-seen (merge-duplicates never resets it); `last_seen_at` bumped every sighting; `expires_at` + the stale/expire cron key off **last-seen** staleness (the correct convention — OpenPostings' first-seen-keyed expiry is a "new-in-24h" bug we avoided). Re-seeing a job never makes it look newer than its post date.

## 18. Provider health
Each source tracks `consecutive_failures`, `last_successful_sync`, `job_count`, `status`. A sync that returns jobs = success (resets); an error or empty return = soft failure.

## 19. Circuit breakers
`consecutive_failures ≥ 3` → `degraded` (deprioritized); `≥ 8` → `disabled` (skipped). A wrong/dead tenant self-removes; `dueSources`/`matchSourcesForQuery` skip disabled sources. So a broken board never breaks search or wastes budget.

## 20. Concurrency / locking
Distributed (not in-memory): the 3h cooldown + coalescer + global budget already coalesce a search stampede across instances. ATS fan-out is bounded (`mapLimit`, 8) with `allSettled` isolation.

## 21. Database migrations
`066_job_sources_ats.sql` (applied): nullable jobs provenance columns + the `company_sources` table + indexes. Additive/zero-risk (no existing query references them).

## 22-24. Files
**Added:** `lib/jobs/{atsDetect,atsProviders,sourceRegistry,expand,discovery,seedSources}.js`, `lib/jobs/jobs.test.mjs`, `supabase/migrations/066_job_sources_ats.sql`, this report. **Changed:** `api/jobs.js` (main search + company page → `aggregateWithSources`), `api/refresh-jobs.js` (seed + ingest registered sources + daily Common Crawl sweep). **Removed:** none (Adzuna demoted, not deleted).

## 25-26. Tests + results
`node --test lib/jobs/jobs.test.mjs` — **9/9**: ATS detection + tenant extraction; Greenhouse/Lever/Ashby normalization + provenance; malicious-payload sanitization; multi-source dedup (same vacancy → one, same title/diff req → two, aggregator dups → one); provider failure isolation; CDX tenant parsing. Full suite **738/738**, `tsc --noEmit` clean.

## 27. Active-job count before vs after
Not measured live from the sandbox — its egress allowlist blocks the ATS hosts (`boards-api.greenhouse.io` → 403 "Host not in allowlist"), so a live ingest run can't execute here. The endpoints are verbatim-confirmed by two production MIT projects; providers are validated against real API shapes via fixtures. In prod (open Vercel egress) the next cron ingests the 27 seeded boards + snowball/Common Crawl growth.

## 28. Performance
ATS fan-out is bounded (8 concurrent, 9s timeout each, `allSettled`) and additive to the existing search; the DB-first path is unchanged. Cron ATS ingest is capped (24 sources/run, 40 in full-mode) to stay within the 60s function budget.

## 29-30. Vercel / Supabase
Fits the existing Vercel serverless + Supabase model: bounded per-request expansion, heavy discovery on cron, idempotent upserts. No new runtime dependency, no queue added. New env vars: none.

## 31. Licensing
Code adapted only from MIT projects (ever-jobs, ats-scrapers, JobNavigator) with attribution. Common Crawl (ToU, commercial-OK) is the data source for discovery. **Rejected:** job-board-aggregator's CC BY-NC dataset, OpenPostings (unlicensed), and all hidden-mobile-API/scraping techniques (ToS).

## 32. Remaining weaknesses
- Live ingest unproven from this sandbox (egress-blocked); prod-only.
- Only 6 ATS ingestable; Workday/iCIMS/etc. detected but need providers (Workday/iCIMS often block plain fetches → need the browser-impersonation transport ats-scrapers uses).
- Common Crawl discovery uses the CDX HTTP API (fine at this scale; the columnar/Athena index is the path for millions).
- No admin source-distribution panel yet (data is in `company_sources` + `jobs.source_type`).

## 33. For million-scale indexing
Columnar Common Crawl index (Athena/DuckDB) for the host sweep; a real job queue (or Supabase cron + a worker) for continuous ATS ingest beyond the 60s function; the browser-impersonation transport for blocking ATS; a `job_observations` table to fully separate canonical job from per-source observations.

## 34. Deploy steps
1. Migration 066 — **applied**. 2. Registry — **seeded** (27 sources). 3. Merge the PR → Vercel deploys. 4. Trigger `/api/refresh-jobs?all=1` (admin) once to ingest the seeded boards immediately, or wait for the next scheduled run. 5. Watch `company_sources` grow via snowball as users search.

---

## OPEN-SOURCE COMPONENT DECISION TABLE

| Project / source | Component examined | Decision | Why | Code license | Data license | Seen files |
|---|---|---|---|---|---|---|
| **ever-jobs** | `IScraper` interface, `allSettled` worker-pool, source-rank merge, liveness/legitimacy states | **ADAPTED** | The cleanest TS provider pattern; modeled Seen's provider interface + fan-out + merge on it | MIT | none | `atsProviders.js`, `expand.js` |
| **kalil0321/ats-scrapers** | Greenhouse/Lever/Ashby/Workable/Recruitee/SmartRecruiters endpoints + field maps; `{provider}:{ats_id}` dedup key; `ats-companies/*.csv` | **PORTED (methods) / directory USABLE** | MIT + commercial-OK; endpoints confirmed verbatim; CSV directory is MIT + non-copyrightable facts (documented seed-expansion path) | MIT | MIT (repo-wide) | `atsProviders.js`, `atsDetect.js`, `expand.js` |
| **Feashliaa/job-board-aggregator** | Common Crawl CDX discovery method; ATS URL patterns; Z-score anomaly detection | **METHOD REUSED / DATA REJECTED** | Code MIT (method reusable); the 95k-slug **dataset is CC BY-NC — non-commercial**, so Seen regenerates its own from Common Crawl (ToU commercial-OK) | MIT | **CC BY-NC (rejected)** | `discovery.js` |
| **Masterjx9/OpenPostings** | first-seen/last-seen freshness + UPSERT; ATS extraction methods; source-directory schema | **METHOD REIMPLEMENTED / CODE REJECTED** | **No license file = all-rights-reserved**; may reimplement the (uncopyrightable) freshness *method* but not copy code. Seen keeps first-seen immutable + expires on last-seen (fixing OpenPostings' first-seen-keyed expiry bug) | **none (rejected)** | none (rejected) | `sourceRegistry.js`, freshness in `refresh-jobs.js` |
| **vesaias/JobNavigator** | JobSpy/Indeed technique; Playwright ATS-first; canonical-URL dedup | **DEDUP IDEA / INDEED REJECTED** | MIT code, but its Indeed/LinkedIn/ZipRecruiter paths hit hidden mobile APIs (ToS-violating for a monetized product) — rejected; canonical-URL-with-tracking-stripped dedup idea adopted | MIT | none | `expand.js` (dedup) |
| **Common Crawl** | CDX URL index (`index.commoncrawl.org`) | **USED (data source)** | ToU permits commercial reuse; the free, legitimate way to discover ATS tenants at scale and build Seen's OWN directory | Common Crawl ToU | Common Crawl ToU | `discovery.js` |
| **Indeed / LinkedIn / ZipRecruiter / Glassdoor / Google Jobs** | hidden mobile/guest APIs, SERP scraping | **REJECTED** | ToS-violating and brittle for a monetized product; would collapse if the site changes. Behind the provider interface, disabled, until official/licensed access | — | — | none |

### Attribution
Provider architecture adapted from **ever-jobs** (MIT); ATS endpoints/methods from **kalil0321/ats-scrapers** (MIT); Common Crawl discovery method from **Feashliaa/job-board-aggregator** (MIT code) run against **Common Crawl** (ToU); dedup idea from **JobNavigator** (MIT). No CC BY-NC data, no unlicensed code, and no ToS-violating scraping was incorporated.

## 28. 2026-10-20 — employer boards on their own clock; USAJOBS
- **Board sync moved to `api/refresh-employer-boards.js`** (hourly cron at :15, 300 s). Before, it ran at the
  tail of `refresh-jobs` on leftover budget, 24 boards at a time: prod had 4,173 active boards (registry
  `job_count` sum ~153k) but only 41 synced in two days, some last synced 2026-08-28. Now up to
  `EMPLOYER_BOARDS_PER_RUN` (default 200) of the stalest boards per run → the registry refreshes about daily.
  Dry run on prod (writes stubbed): 60 stalest boards in 3.4 s; the stalest are mostly empty/404 boards the
  circuit breaker will now finally degrade (3 fails) and disable (8).
- **Market filter** `lib/jobs/usLocation.js`: board rows are kept only when US, remote, or location-less.
  Sample of 25 boards: 57% US/remote; the rest London, Bengaluru, CDMX, "Remote (EMEA)"… A state code alone
  never beats a named foreign place ("Bengaluru, IN", "Vancouver, BC, CA"). Sync health uses the full board
  size, so a board whose openings are all abroad is healthy, not dead.
- **Seen Command** can trigger it: `POST /api/refresh-employer-boards` with `Bearer LOCAL_INDEED_INGEST_SECRET`
  and `{companies:[…≤50]}` or `{limit:1..400}`.
- **USAJOBS** (`lib/server/usajobs.js`): official federal board, free key at developer.usajobs.gov
  (`USAJOBS_API_KEY` + `USAJOBS_EMAIL`, the email the key was issued to). Runs with each cron batch search and
  in the on-site live top-up (`usajobsTopUp` in expand.js). No-op without the key. Headers verified against
  the live endpoint (401 on a fake key). No request-rate limit is published; 500 rows/page, 10k/query.
- **Jooble not built**: its request/response format is only shown after key signup, so it was not coded
  against a guess. Build it once a key exists and a real response can be recorded as a fixture.

## 29. 2026-10-20 — company-first job pull ("search Tesla")
One call, `POST /api/local-company-jobs` (Bearer `LOCAL_INDEED_INGEST_SECRET`, ≤10 companies), runs every
server-side source for a company and reports each separately (`lib/jobs/companyJobs.js`):
1. **Job boards**: its registered `company_sources` rows; if none, `lib/jobs/boardFinder.js` asks
   Greenhouse/Lever/Ashby/Workable/Recruitee/SmartRecruiters under name slugs (`tesla`, `home-depot`,
   `thehomedepot`…). A 200 is not proof (Workable 200 "Tesla" with 0 jobs; SmartRecruiters 200 for any slug):
   a hit needs ≥1 job and, when the board names itself, the same company name. Verified hits are
   registered (`discovered_via: company_search`) so the hourly sync keeps them.
2. **Career site** (`lib/jobs/careerSite.js`): robots.txt (honoured; longest-match, `*`/`$`) → job sitemaps
   (index walk, job sitemaps first) → schema.org JobPosting on each page; employer must match, US/remote only,
   expired skipped; rows `source: 'Company site'`, `source_type: 'EMPLOYER_SITE'`,
   `external_id: site:<host>:<identifier>`. Live 2026-10-20: Home Depot 15/15 pages, Target 8/8 (with
   salaries); Walmart pages carry no JobPosting server-side (JS-rendered) → `needs_browser`; Tesla 403s
   robots.txt itself → `blocked` → `needs_browser`.
3. **Adzuna** for the name, keeping only listings whose employer IS that company (no unverified
   `company` API parameter is used).
Indeed runs on the Mac (Seen Command). `needs_browser` sites go to `scripts/collect-career-site.mjs`
(OpenCLI `browser open/eval/close`, session `seen-careers`; EXPERIMENTAL until run once on the Mac), which
sends raw JobPosting objects to `POST /api/ingest-local-career-jobs`; Seen applies the same checks.

### 29.1 The in-page harvest (2026-10-20): every job on a site that refuses servers
Owner test pages: `https://www.tesla.com/careers/search/?site=US` and `https://www.spacex.com/careers/jobs`.
- **SpaceX** needs no browser: its careers page is an Angular app that reads
  `content.spacex.com/cms-assets/job_posts_new.json` (3,110 rows on 2026-10-20), and every row links to a
  Greenhouse board: `spacex` (2,772), `spacexglobal` (32, international) and `xai` (306, xAI's own jobs).
  Seen syncs `spacex` + `spacexglobal` hourly, so the company pull saves 2,760 US/remote SpaceX jobs.
- **Tesla** refuses every server (Akamai: 403 on the page, robots.txt and the careers feed, including
  from a headless Chrome in a datacenter), so it is read in the owner's Chrome. `harvestInPage`
  (lib/server/careerBrowser.js) runs INSIDE the open page: the list comes from Tesla's own careers feed
  (`/cua-api/apps/careers/state`, parsed tolerantly: the biggest array of objects with an id and a
  title, ids resolved through the feed's lookup tables), else from scrolling the search page until no
  new job links appear; each job's data comes from its page's JobPosting JSON-LD (in-page fetch, no tab
  per job), else Tesla's per-job feed (`/cua-api/careers/job/<id>`, description = its longest text). A
  job with neither is counted as `no_data`, never invented. Two requests at a time, 300 ms apart.
- The exact Tesla feed shape is NOT verified (nothing outside a real visitor's browser can read it);
  the scroll fallback does not depend on it. Each run reports `method` (tesla_feed | page_scroll |
  pages) and `notes` for a strategy that did not apply.
- Verified with a real headless Chrome on a stand-in www.tesla.com (host-resolver mapped) through the
  real collector, Seen Command and Seen's rowFromPosting: feed mode 120/120 listed (90 US saved), scroll
  mode 120/120, per-job-feed mode 40/40, 2,000 jobs in 5 min 18 s streamed in 40 batches of 50.
