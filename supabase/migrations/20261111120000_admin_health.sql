-- Admin remake round 4 (2026-11-10): two read-only RPCs for System and Listings. Additive and idempotent; the code
-- works without them (lib/server/admin/system.js db_size falls back to jobs_storage_status; listings.js
-- source_health falls back to per-source exact counts).

-- Database size against the storage guard, with the jobs table's share.
create or replace function public.admin_db_size()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_max integer;
  v_enabled boolean;
begin
  if to_regclass('public.jobs_storage_guard') is not null then
    execute 'select max_mb, enabled from public.jobs_storage_guard limit 1' into v_max, v_enabled;
  end if;
  return jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'jobs_bytes', pg_total_relation_size('public.jobs'),
    'max_mb', v_max,
    'enabled', v_enabled
  );
end;
$$;

-- Per-source listing health in one pass. p_today = midnight California time.
create or replace function public.admin_source_health(p_today timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'source', s.source, 'live', s.live, 'added_24h', s.added_24h, 'added_today', s.added_today, 'last_seen', s.last_seen
  ) order by s.live desc), '[]'::jsonb)
  from (
    select coalesce(source, '(none)') as source,
           count(*) filter (where availability_status = 'active' and expires_at > now()) as live,
           count(*) filter (where created_at >= now() - interval '24 hours') as added_24h,
           count(*) filter (where created_at >= p_today) as added_today,
           max(last_seen_at) as last_seen
    from jobs
    group by coalesce(source, '(none)')
  ) s;
$$;

revoke all on function public.admin_db_size() from public, anon, authenticated;
revoke all on function public.admin_source_health(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_db_size() to service_role;
grant execute on function public.admin_source_health(timestamptz) to service_role;
