-- Migration 050: hard employer/seeker separation label.
--
-- Every account carries an explicit account_type so employer accounts can NEVER be mixed into the
-- job-seeker experience or seeker-side dashboards (and vice versa). Today the employer portal
-- creates no accounts at all — reputation is a read-only lookup and employer checkout writes only
-- to the employer-namespaced tables (employer_purchases / employer_perks) — so nothing seeker is
-- ever touched. This column is the forward-safe guarantee for when employer accounts exist: they
-- are labeled 'employer' and seeker-facing queries filter to 'seeker'.
--
-- DEFAULT 'seeker' means every existing row is already correctly labeled a job seeker, so this is a
-- zero-behavior-change, no-bug migration.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'seeker';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.constraint_column_usage WHERE table_name = 'profiles' AND constraint_name = 'profiles_account_type_chk') THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_account_type_chk CHECK (account_type IN ('seeker', 'employer'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_account_type ON profiles (account_type);
