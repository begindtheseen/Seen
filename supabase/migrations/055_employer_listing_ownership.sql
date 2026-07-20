-- Migration 055: employer-posted listing ownership.
--
-- WHY: employers with an APPROVED company claim (migration 053) can now post their own job
-- listings directly (api/employer-listings.js action:'create') with a click-through apply_url.
-- The jobs table pre-dates the migration series and is shared by the aggregation pipeline
-- (source Adzuna/Remotive/…) and the paste-a-link importer (source 'Imported'). These two
-- additive, nullable columns mark the subset a specific employer created so surfaces can badge
-- "Posted by you", attribute the row to the claiming employer, and let the employer dispute-manage
-- their own postings. Aggregated/imported rows keep employer_user_id = NULL and is_employer_posted
-- = false, so nothing about the neutral-aggregator corpus changes.
--
-- Idempotent. No RLS change — jobs is read publicly (expires_at gate) and written only via the
-- service key (RLS bypassed), same as today. employer_user_id is server-set from the verified JWT.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS employer_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS is_employer_posted boolean NOT NULL DEFAULT false;

-- "My postings" lookups and the ownership filter on the employer dashboard.
CREATE INDEX IF NOT EXISTS idx_jobs_employer_user_id
  ON public.jobs (employer_user_id) WHERE employer_user_id IS NOT NULL;
