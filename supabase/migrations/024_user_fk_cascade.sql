-- Migration 024: ON DELETE CASCADE foreign keys for user-linked tables.
--
-- WHY: account deletion (api/user-sync.js `delete_account`) was deleting rows table by
-- table in application code. If a delete is ever missed, or a user is removed directly via
-- the Supabase auth admin API, child rows are orphaned — a GDPR Art.17 (right-to-erasure)
-- gap and a data-integrity problem. These FKs make Postgres erase the children automatically
-- whenever the auth.users row goes away, so deletion can never be partial.
--
-- SAFETY:
--   * `NOT VALID` adds the constraint for all FUTURE writes/deletes WITHOUT scanning or
--     locking the existing table, so applying this is fast and non-blocking even on large
--     tables. (Pre-existing orphan rows, if any, are left untouched; see the optional
--     VALIDATE step at the bottom to enforce retroactively after cleaning them up.)
--   * Idempotent: skips tables/columns that don't exist and constraints already present.
--   * Only touches tables that key on `user_id` referencing auth.users.
--
-- REVIEW BEFORE APPLYING: authored without a live DB connection. Run in the Supabase SQL
-- editor on a branch/staging project first if you have one.

DO $$
DECLARE
  t      text;
  cname  text;
  tables text[] := ARRAY[
    'ai_credits',
    'credit_transactions',
    'resume_employment',
    'answered_questions',
    'user_recent_cos',
    'login_signals',
    'application_events',
    'saved_jobs',
    'job_availability_reports'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Table must exist
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    -- Column must exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'user_id'
    ) THEN CONTINUE; END IF;
    -- Constraint must not already exist
    cname := 'fk_' || t || '_user';
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = cname) THEN CONTINUE; END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID',
      t, cname
    );
    RAISE NOTICE 'Added ON DELETE CASCADE fk on %', t;
  END LOOP;
END $$;

-- OPTIONAL (run later, off-peak): retroactively validate the constraints. This scans each
-- table once and will ERROR if orphan rows exist (user_id not present in auth.users) — clean
-- those up first, then uncomment and run.
--
-- DO $$
-- DECLARE t text; cname text;
--   tables text[] := ARRAY['ai_credits','credit_transactions','resume_employment',
--     'answered_questions','user_recent_cos','login_signals','application_events',
--     'saved_jobs','job_availability_reports'];
-- BEGIN
--   FOREACH t IN ARRAY tables LOOP
--     cname := 'fk_' || t || '_user';
--     IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = cname AND NOT convalidated) THEN
--       EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', t, cname);
--     END IF;
--   END LOOP;
-- END $$;
