-- Security: company_aliases (006) and geocode_cache (033) were created without RLS, so the
-- public anon key could read AND write them via PostgREST (Supabase lint 0013
-- rls_disabled_in_public). Every caller is server-side with the service_role key
-- (api/admin-stats.js, api/reports.js, api/_utils/companyAuditBundle.js, lib/server/geo.js),
-- which bypasses RLS — so enabling RLS with no policies makes them server-only, matching
-- the project's other server-only tables. Idempotent.
alter table if exists public.company_aliases enable row level security;
alter table if exists public.geocode_cache   enable row level security;
