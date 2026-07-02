-- Migration 038: contributed intel survives account deletion (anonymized, not destroyed).
--
-- When a user is deleted (admin delete_user OR self-service delete_account) their
-- contributed company intel — public `reports` and `resume_surveys` answers — is
-- ANONYMIZED by setting user_id → null, never deleted. For that PATCH to succeed the
-- user_id columns must be nullable. `reports.user_id` is already nullable in prod
-- (the self-service path has been anonymizing it), but `resume_surveys.user_id` was
-- created NOT NULL by migration 032, which would reject the anonymizing PATCH.
--
-- Both statements are idempotent: DROP NOT NULL is a no-op when the column is already
-- nullable, and each is guarded so it only runs when the column actually exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'reports' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.reports ALTER COLUMN user_id DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'resume_surveys' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.resume_surveys ALTER COLUMN user_id DROP NOT NULL;
  END IF;
END $$;
