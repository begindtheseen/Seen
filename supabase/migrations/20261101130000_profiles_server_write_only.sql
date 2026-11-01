-- Profiles and employer claims are written by the server only (security audit 2026-11-01).
--
-- profiles had one policy, "own_profile" (migration 017), with no FOR clause = FOR ALL. With the
-- default Supabase grants, any signed-in account could PATCH its own row straight through
-- /rest/v1/profiles with the public anon key and its own JWT, skipping every server check:
--   • account_type / type → 'employer' (the gate for employer features: api/employer-claims.js),
--   • email (an editable copy of the sign-in email),
--   • resume_text (skipping the readability gate in api/user-sync.js save_resume), uncapped fields.
-- employer_company_claims let an account INSERT a pending claim directly (migration 053), skipping
-- the endpoint's employer-account and one-company checks.
--
-- Nothing in the app reads or writes either table with a user token: every path is a Vercel function
-- with the service key (service_role bypasses RLS and these grants), and the sign-up trigger
-- handle_new_user is SECURITY DEFINER. So this changes no app behaviour. Idempotent; safe to apply
-- before or after the code.

-- profiles: a person may read their own row; writes are server-only.
DROP POLICY IF EXISTS "own_profile" ON public.profiles;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'own_profile_read') THEN
    CREATE POLICY own_profile_read ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
  END IF;
END $$;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.profiles FROM anon, authenticated;

-- employer_company_claims: claims are requested through api/employer-claims.js only.
DROP POLICY IF EXISTS claims_insert_own_pending ON public.employer_company_claims;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.employer_company_claims FROM anon, authenticated;
