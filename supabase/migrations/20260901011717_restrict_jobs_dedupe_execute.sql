-- jobs_dedupe_refresh is a SECURITY DEFINER trigger function. It is invoked only by
-- trg_jobs_dedupe_refresh during INSERT; there is no API/RPC caller. Supabase grants function
-- EXECUTE to PUBLIC by default, which needlessly exposes the definer boundary to anon and
-- authenticated roles and is reported by the database security advisor.
--
-- Trigger execution does not require callers to hold EXECUTE on the trigger function. Keep an
-- explicit service-role grant for maintenance and revoke every public-facing role.
revoke all on function public.jobs_dedupe_refresh() from public;
revoke all on function public.jobs_dedupe_refresh() from anon;
revoke all on function public.jobs_dedupe_refresh() from authenticated;
grant execute on function public.jobs_dedupe_refresh() to service_role;

comment on function public.jobs_dedupe_refresh() is
  'SECURITY DEFINER trigger-only job dedupe function; direct execution is restricted to service_role.';
