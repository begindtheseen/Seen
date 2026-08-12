-- The dedupe trigger must recognise a listing by EVERY identity the table enforces, or it waves
-- through a row that the storage layer then rejects — killing the whole batch it arrived in.
--
-- `jobs` carries three unique constraints:
--   jobs_external_id_idx                  UNIQUE (external_id) WHERE external_id IS NOT NULL
--   jobs_uniq                             UNIQUE (title, company, location)
--   idx_jobs_title_company_location_dedup UNIQUE (lower(title), lower(company), lower(location))
-- and until now the trigger only knew about the last two.
--
-- That gap was invisible while migration 067's predecessor keyed on the always-NULL `city` column,
-- because the key had degraded to (title, company) and suppressed almost every re-ingested row
-- before it could reach an index. Narrowing the key to the correct (title, company, location) in
-- 067 was right, but it let those rows through to the INSERT — where the same Adzuna posting,
-- re-ingested under a location string that had since changed ("Crestwood, Houston" one run,
-- "Houston, TX" the next), matched no existing row by name and collided on external_id instead.
--
-- PostgREST sends a batch as ONE multi-row INSERT and `resolution=merge-duplicates` can only infer
-- a single arbiter index, so the collision is not merged — it is a hard 409 that discards all 100
-- rows. Production, in the 10:00 run immediately after 067 deployed: 65 batches lost this way,
-- roughly 6,500 listings dropped in a single run.
--
-- external_id is the SOURCE's own identity for a posting and is therefore the strongest signal we
-- have: check it first, and fall back to the name key only when the row carries no external_id.

CREATE OR REPLACE FUNCTION public.jobs_dedupe_refresh()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE existing_id uuid;
DECLARE existing_employer boolean;
BEGIN
  -- 1. Source identity. Matches a re-ingested posting even when its title or location text drifted.
  IF NEW.external_id IS NOT NULL THEN
    SELECT id, COALESCE(is_employer_posted, false) INTO existing_id, existing_employer
      FROM public.jobs
     WHERE external_id = NEW.external_id
     LIMIT 1;
  END IF;

  -- 2. Name identity. Catches the same posting arriving from a different source, or with no id.
  IF existing_id IS NULL THEN
    SELECT id, COALESCE(is_employer_posted, false) INTO existing_id, existing_employer
      FROM public.jobs
     WHERE lower(title) = lower(NEW.title)
       AND lower(COALESCE(company,  '')) = lower(COALESCE(NEW.company,  ''))
       AND lower(COALESCE(location, '')) = lower(COALESCE(NEW.location, ''))
     LIMIT 1;
  END IF;

  IF existing_id IS NULL THEN
    RETURN NEW; -- genuinely new — insert normally
  END IF;

  -- First-party supersedes aggregation: an employer posting replaces the aggregated copy.
  IF COALESCE(NEW.is_employer_posted, false) AND NOT existing_employer THEN
    DELETE FROM public.jobs WHERE id = existing_id;
    RETURN NEW;
  END IF;

  -- Re-seen duplicate → refresh the existing listing instead of erroring the whole batch.
  -- Deliberately does NOT move title/company/location onto the matched row: that write could
  -- collide with a THIRD row already holding the new name key, turning a refresh back into the
  -- batch-killing 409 this migration exists to prevent. The listing stays discoverable under the
  -- name it was first seen with.
  UPDATE public.jobs SET
    last_seen_at    = now(),
    last_checked_at = now(),
    availability_status = CASE WHEN availability_status IN ('stale','expired') THEN 'active' ELSE availability_status END,
    expires_at      = GREATEST(COALESCE(expires_at, now()), now() + interval '14 days')
  WHERE id = existing_id;
  RETURN NULL; -- suppress the duplicate insert
END $function$;

-- Serve step 1 with an index rather than a scan of the whole table on every inserted row.
-- (jobs_external_id_idx already covers external_id; named here only to document the dependency.)
