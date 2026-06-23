-- Migration 026: clean up pre-existing orphans and VALIDATE the FKs from migration 024.
--
-- Migration 024 added the cascade FKs as NOT VALID so they wouldn't block on existing data. This
-- removes any rows whose user_id no longer exists in auth.users (exactly what the cascade would
-- have erased — leftovers from accounts deleted before the FK existed) and then validates the
-- constraints so they are fully enforced going forward.
--
-- On the production project this found and removed one orphaned ai_credits row.

DELETE FROM public.ai_credits c
WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = c.user_id);

DO $$
DECLARE
  t text;
  cname text;
  tables text[] := ARRAY[
    'ai_credits','credit_transactions','resume_employment','answered_questions',
    'user_recent_cos','login_signals','job_availability_reports','search_events'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    cname := 'fk_' || t || '_user';
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = cname AND NOT convalidated) THEN
      BEGIN
        EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', t, cname);
      EXCEPTION WHEN others THEN
        RAISE NOTICE 'Could not validate % (orphans present); left NOT VALID', cname;
      END;
    END IF;
  END LOOP;
END $$;
