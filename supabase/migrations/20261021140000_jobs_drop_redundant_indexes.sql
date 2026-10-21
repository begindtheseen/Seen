-- Drop four jobs indexes that cost space and slow every insert but serve no query (2026-10-21).
-- Measured on prod (pg_stat_user_indexes, stats since the project started):
--   jobs_uniq                 10 MB  UNIQUE (title, company, location) — implied by
--                                    idx_jobs_title_company_location_dedup (lower(...), COALESCE → stricter);
--                                    no upsert names it as an on_conflict target
--   idx_jobs_search_expires  6.3 MB  0 scans
--   idx_jobs_search_query      4 MB  10 scans, last 2026-08-12 (idx_jobs_search_query_trgm serves the ilike reads)
--   idx_jobs_title           2.4 MB  0 scans (full-text; no code uses to_tsvector / fts on jobs)
-- Every jobs row is inserted or refreshed through these, so dropping them also lightens the ingest.
-- To undo: the definitions are in 004_performance_indexes.sql and the comment in 068.
drop index if exists public.jobs_uniq;
drop index if exists public.idx_jobs_search_expires;
drop index if exists public.idx_jobs_search_query;
drop index if exists public.idx_jobs_title;
