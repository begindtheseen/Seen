-- 020_rate_limits_rls.sql
-- Security hardening for the rate-limit infrastructure.
--
-- Supabase advisor (CRITICAL): `public.rate_limits` had Row Level Security DISABLED,
-- so the table was exposed to the `anon` / `authenticated` roles used by client SDKs.
-- The original 001_rate_limits.sql intentionally DISABLEd RLS and relied on REVOKE
-- alone, but RLS-disabled is flagged critical because default privileges can be
-- re-granted and it offers no row-level defense-in-depth.
--
-- This table is touched ONLY by server-side code:
--   * lib/server/ratelimit.js calls the increment_rate_limit() RPC with the SERVICE
--     key (service_role BYPASSES RLS), and
--   * increment_rate_limit()/cleanup_rate_limits() are SECURITY DEFINER (also bypass RLS).
-- So enabling RLS with no policies locks out anon/authenticated WITHOUT affecting the app.
-- Idempotent.

-- 1) Lock down the table: enable RLS (deny-all to non-service roles) + drop direct grants.
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rate_limits FROM anon, authenticated;

-- 2) Harden the SECURITY DEFINER rate-limit functions:
--    - pin search_path (advisor 0011: mutable search_path → injection surface)
--    - stop anon/authenticated from invoking them directly via /rest/v1/rpc
--      (only the service key path needs them).
ALTER FUNCTION public.increment_rate_limit(text, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.cleanup_rate_limits() SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.increment_rate_limit(text, integer) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limits() FROM anon, authenticated, public;

GRANT EXECUTE ON FUNCTION public.increment_rate_limit(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_rate_limits() TO service_role;
