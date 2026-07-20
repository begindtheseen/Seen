-- Migration 059: trigram indexes for job search at scale.
--
-- WHY: every job-search DB read filters with substring ilike — title.ilike.*term*,
-- company.ilike.*q*, search_query.ilike.*term*, location.ilike.*place* (api/jobs.js).
-- The existing btree indexes (migration 004) cannot serve a leading-wildcard ilike, so
-- each of those filters is a sequential scan. Fine at 5k rows and light traffic; not fine
-- with thousands of concurrent searches multiplied by per-search OR-groups as the corpus
-- compounds. pg_trgm GIN indexes make every one of those ilike filters index-backed.
--
-- Idempotent; pg_trgm ships with Supabase Postgres.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_jobs_title_trgm
  ON public.jobs USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_jobs_company_trgm
  ON public.jobs USING gin (company gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_jobs_search_query_trgm
  ON public.jobs USING gin (search_query gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_jobs_location_trgm
  ON public.jobs USING gin (location gin_trgm_ops);
