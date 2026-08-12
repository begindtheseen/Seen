-- Fix the job dedupe key: it has been (title, company, city) since 2026-07-20, and `city` is NULL
-- on every single row.
--
-- Nothing in the ingestion path writes jobs.city. buildJob() and fetchAdzuna()
-- (lib/server/jobSources.js) and every ATS provider (lib/jobs/atsProviders.js) write `location`.
-- Migration 014 named "(title, company, city) case-insensitive" as the true duplicate key; the
-- column that actually holds that value is `location`.
--
-- The consequence is silent and total. trg_jobs_dedupe_refresh matches an incoming row with
--     lower(city) IS NOT DISTINCT FROM lower(NEW.city)
-- and NULL IS NOT DISTINCT FROM NULL is TRUE, so the city term is a no-op and the key collapses to
-- (title, company): the same role at the same employer can exist exactly ONCE nationwide. It hides
-- itself, too — the suppressed insert still bumps the surviving row's last_seen_at, so the cron
-- reports a healthy run while dropping every other city's copy.
--
-- Measured on production 2026-08-12, before this migration:
--   * jobs.city IS NULL on all 35,126 rows
--   * 35,000 of 35,062 distinct (title, company) pairs held exactly ONE location
--   * 2,783 companies did span multiple locations — but only ever with different titles
--
-- This migration is also the first record of the trigger in this repo at all: it was applied
-- straight to production as 061_jobs_dedupe_refresh_trigger / 061b_jobs_dedupe_refresh_trigger_real
-- and never committed, so `supabase/migrations/` has described a database that does not exist for
-- three weeks. Recreated in full below.
--
-- Verified before writing this, against production:
--   * no row has a NULL company, or a NULL or empty location
--   * (lower(title), lower(company), lower(location)) is unique across all 35,126 rows
-- so the unique index creates cleanly with no dedup pass first. It cannot start colliding between
-- now and apply time either: the key in force until then is strictly stricter than this one.

-- New key. coalesce() matches the trigger predicate below expression-for-expression so the
-- per-insert duplicate lookup is an index scan rather than a scan of the whole table.
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_title_company_location_dedup
  ON jobs (lower(title), lower(coalesce(company, '')), lower(coalesce(location, '')));

-- The old key indexed lower(city), which is NULL on every row. Btree treats NULLs as distinct, so
-- this index never enforced anything — it only encoded the wrong key and cost a write on every
-- insert into a table that already carries 18 indexes.
DROP INDEX IF EXISTS idx_jobs_title_company_city_dedup;

CREATE OR REPLACE FUNCTION public.jobs_dedupe_refresh()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE existing_id uuid;
DECLARE existing_employer boolean;
BEGIN
  SELECT id, COALESCE(is_employer_posted, false) INTO existing_id, existing_employer
    FROM public.jobs
   WHERE lower(title) = lower(NEW.title)
     AND lower(COALESCE(company,  '')) = lower(COALESCE(NEW.company,  ''))
     AND lower(COALESCE(location, '')) = lower(COALESCE(NEW.location, ''))
   LIMIT 1;

  IF existing_id IS NULL THEN
    RETURN NEW; -- no duplicate — insert normally
  END IF;

  -- First-party supersedes aggregation: an employer posting replaces the aggregated copy.
  IF COALESCE(NEW.is_employer_posted, false) AND NOT existing_employer THEN
    DELETE FROM public.jobs WHERE id = existing_id;
    RETURN NEW;
  END IF;

  -- Re-seen duplicate → refresh the existing listing instead of erroring the whole batch.
  UPDATE public.jobs SET
    last_seen_at    = now(),
    last_checked_at = now(),
    availability_status = CASE WHEN availability_status IN ('stale','expired') THEN 'active' ELSE availability_status END,
    expires_at      = GREATEST(COALESCE(expires_at, now()), now() + interval '14 days')
  WHERE id = existing_id;
  RETURN NULL; -- suppress the duplicate insert
END $function$;

DROP TRIGGER IF EXISTS trg_jobs_dedupe_refresh ON public.jobs;
CREATE TRIGGER trg_jobs_dedupe_refresh
  BEFORE INSERT ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.jobs_dedupe_refresh();
