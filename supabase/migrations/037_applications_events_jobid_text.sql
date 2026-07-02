-- Migration 037: codify the 2026-07-02 hand-applied prod schema repairs (PR #124).
-- These two changes were applied directly to production via SQL during the full-app
-- audit session; this file records them so a fresh environment (or disaster-recovery
-- restore) gets the same schema. Both statements are idempotent.
--
-- 1) applications.events — the tracker's `load` selects this column; without it the
--    select 400s for every signed-in user (synced applications invisible, all
--    stage/outcome updates silently discarded).
ALTER TABLE applications ADD COLUMN IF NOT EXISTS events jsonb DEFAULT '[]'::jsonb;

-- 2) applications.job_id must be text — client job ids are strings like 'db-<uuid>'
--    or aggregator-assigned keys, not uuids. Prod originally had uuid + an
--    unsatisfiable FK, so job_id could never persist. Drop any FK on job_id and
--    convert the type (no-op when already text).
DO $$
DECLARE
  fk record;
BEGIN
  FOR fk IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY (con.conkey)
    WHERE rel.relname = 'applications'
      AND con.contype = 'f'
      AND att.attname = 'job_id'
  LOOP
    EXECUTE format('ALTER TABLE applications DROP CONSTRAINT %I', fk.conname);
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'applications' AND column_name = 'job_id' AND data_type = 'uuid'
  ) THEN
    ALTER TABLE applications ALTER COLUMN job_id TYPE text USING job_id::text;
  END IF;
END $$;
