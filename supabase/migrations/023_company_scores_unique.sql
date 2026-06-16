-- 023_company_scores_unique.sql
-- Root-cause fix for company_scores duplicates.
--
-- The company_scores upserts used `resolution=merge-duplicates` but never specified an
-- on_conflict target, and there was NO unique constraint on company_name — so every
-- populate / company_score(force_refresh) INSERTED a new row instead of updating, and
-- manual dedupes kept reappearing. The reports.js change in this PR adds
-- `?on_conflict=company_name` to the upserts; this migration adds the matching UNIQUE
-- constraint so the upsert resolves to an UPDATE.
--
-- IMPORTANT: apply this AFTER the reports.js change in this PR is deployed. With the
-- constraint present but the OLD code (no on_conflict) live, the admin force_refresh /
-- populate upserts would error on company_name conflicts.
--
-- Idempotent: safe to re-run.

-- 1) Collapse any existing duplicates, keeping the best row per normalized name
--    (has a score, has reviews, then most recent).
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY lower(trim(company_name))
    ORDER BY (overall_score IS NOT NULL) DESC,
             (CASE WHEN web_reviews IS NULL OR web_reviews::text IN ('[]','null','') THEN 0 ELSE 1 END) DESC,
             created_at DESC NULLS LAST
  ) AS rn
  FROM company_scores
)
DELETE FROM company_scores WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2) Normalize names to the canonical form the app writes (lower+trim), so the unique
--    constraint matches how rows are inserted.
UPDATE company_scores
SET company_name = lower(trim(company_name))
WHERE company_name IS DISTINCT FROM lower(trim(company_name));

-- 3) Enforce one row per company.
DO $$ BEGIN
  ALTER TABLE company_scores ADD CONSTRAINT company_scores_company_name_key UNIQUE (company_name);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$;
