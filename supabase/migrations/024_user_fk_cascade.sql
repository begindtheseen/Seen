-- Migration 024: ON DELETE CASCADE foreign keys for user-linked tables that have NONE.
--
-- WHY: account deletion (api/user-sync.js `delete_account`) deletes rows table-by-table in
-- application code. If a delete is ever missed — or a user is removed directly via the Supabase
-- auth admin API — child rows are orphaned (a GDPR Art.17 right-to-erasure gap). These FKs make
-- Postgres erase the children automatically when the auth.users row goes away.
--
-- SCOPE: only the tables that key on user_id and currently have NO FK to auth.users. The tables
-- applications, saved_jobs, notifications, profiles, employer_profiles already have ON DELETE
-- CASCADE FKs and are skipped automatically.
--
-- SAFETY: NOT VALID adds the constraint without scanning/locking existing rows (the cascade
-- trigger is active immediately regardless of validation). A follow-up pass validates once the
-- table is known clean. Idempotent: skips tables/columns/constraints already present.

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
    'job_availability_reports',
    'search_events'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'user_id'
    ) THEN CONTINUE; END IF;
    -- Skip if any FK on user_id already references auth.users
    IF EXISTS (
      SELECT 1 FROM pg_constraint con
      JOIN pg_class rel  ON rel.oid  = con.conrelid
      JOIN pg_namespace nsp  ON nsp.oid  = rel.relnamespace
      JOIN pg_class frel ON frel.oid = con.confrelid
      JOIN pg_namespace fnsp ON fnsp.oid = frel.relnamespace
      WHERE con.contype = 'f' AND nsp.nspname = 'public' AND rel.relname = t
        AND fnsp.nspname = 'auth' AND frel.relname = 'users'
    ) THEN CONTINUE; END IF;

    cname := 'fk_' || t || '_user';
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = cname) THEN CONTINUE; END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID',
      t, cname
    );
    RAISE NOTICE 'Added ON DELETE CASCADE fk on %', t;
  END LOOP;
END $$;
