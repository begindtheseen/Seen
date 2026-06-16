-- 021_security_policy_hardening.sql
-- Addresses the remaining Supabase security advisors (after 020 handled rate_limits).
-- Each change is verified against the codebase: every affected write path uses the
-- SERVICE key (service_role bypasses RLS), and none of the affected functions are
-- called via /rest/v1/rpc by the app. Idempotent.
--
-- ── 1. Close direct-INSERT data-poisoning holes (advisor 0024_permissive_rls_policy) ──
-- These tables each had a legacy `WITH CHECK (true)` INSERT policy that, because
-- permissive policies are OR'd, NEUTRALIZED the newer service-role-only policy — letting
-- anyone with the public anon key write directly to tables that feed company scores and
-- the jobs corpus (an anti-gaming / data-integrity hole). All real writes go through the
-- serverless API with the service key, so dropping the permissive policy enforces the
-- intended service-role-only writes. Employers keep their own scoped jobs-insert policy.
DROP POLICY IF EXISTS "Anyone can submit reports" ON public.reports;      -- service-role-only remains (reports_no_direct_write)
DROP POLICY IF EXISTS "Service can insert jobs"    ON public.jobs;        -- employers' scoped policy remains; service uses service_role
DROP POLICY IF EXISTS "insert only"                ON public.search_logs; -- service_role-only remains (search_logs_service_only)
DROP POLICY IF EXISTS "anon_insert"                ON public.user_issues; -- written via service key in api/reports.js; service_role bypasses RLS

-- ── 2. Stop anon/authenticated from invoking internal SECURITY DEFINER functions ──
-- (advisors 0028 / 0029). None are called via RPC by the app (only increment_rate_limit
-- is, handled in 020). handle_new_user is an auth trigger — triggers fire regardless of
-- the caller's EXECUTE grant, so revoking does not affect signup.
REVOKE EXECUTE ON FUNCTION public.handle_new_user()            FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.recalculate_location_score() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()            FROM anon, authenticated, public;

-- ── 3. Pin search_path on the remaining flagged functions (advisor 0011) ──
-- Prevents search_path injection against SECURITY DEFINER functions. No behavior change.
ALTER FUNCTION public.handle_new_user()            SET search_path = public, pg_temp;
ALTER FUNCTION public.recalculate_location_score() SET search_path = public, pg_temp;
ALTER FUNCTION public.purge_old_signals()          SET search_path = public, pg_temp;
