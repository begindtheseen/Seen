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
