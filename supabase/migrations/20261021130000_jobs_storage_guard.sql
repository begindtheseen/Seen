-- Storage guard (2026-10-21). Prod is 421 MB and adds ~1–2k board listings an hour; on Supabase's Free plan
-- a database over 500 MB goes read-only, which would stop sign-ups, applications and reports — the whole
-- site — not just job imports. Until the plan is confirmed/upgraded, NEW aggregated listings are skipped
-- once the database passes jobs_storage_guard.max_mb. Nothing is deleted:
--   • a listing Seen already has keeps refreshing (trg_jobs_dedupe_refresh runs first and handles it),
--   • employer-posted listings are never blocked,
--   • lifting it is one statement: update public.jobs_storage_guard set enabled = false;  (or raise max_mb)
-- Triggers fire in name order: trg_jobs_dedupe_refresh < trg_jobs_zz_storage_guard.

create table if not exists public.jobs_storage_guard (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,
  max_mb integer not null default 470,
  note text,
  updated_at timestamptz not null default now()
);
insert into public.jobs_storage_guard (id, enabled, max_mb, note)
  values (1, true, 470, 'Free plan cap is 500 MB; raise or disable after upgrading to Pro (8 GB).')
  on conflict (id) do nothing;
alter table public.jobs_storage_guard enable row level security;
revoke all on public.jobs_storage_guard from anon, authenticated;

-- pg_database_size costs ~2.5 ms (measured on prod), so it is read once per transaction (one PostgREST
-- request = one transaction = one insert batch) and cached in a transaction-local setting.
create or replace function public.jobs_storage_guard() returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare v text := current_setting('seen.jobs_storage_blocking', true);
        g public.jobs_storage_guard%rowtype;
begin
  if coalesce(new.is_employer_posted, false) then return new; end if;
  if v is null or v = '' then
    select * into g from public.jobs_storage_guard where id = 1;
    v := case when g.enabled is true and pg_database_size(current_database()) > g.max_mb::bigint * 1024 * 1024 then 'y' else 'n' end;
    perform set_config('seen.jobs_storage_blocking', v, true);
  end if;
  if v = 'y' then return null; end if; -- a brand-new board listing while storage is near the cap: skipped
  return new;
end $$;

drop trigger if exists trg_jobs_zz_storage_guard on public.jobs;
create trigger trg_jobs_zz_storage_guard before insert on public.jobs
  for each row execute function public.jobs_storage_guard();

-- What the admin reads: the database size against the guard.
create or replace function public.jobs_storage_status() returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('db_bytes', pg_database_size(current_database()), 'enabled', g.enabled, 'max_mb', g.max_mb,
    'blocking', g.enabled and pg_database_size(current_database()) > g.max_mb::bigint * 1024 * 1024)
  from public.jobs_storage_guard g where g.id = 1;
$$;
revoke all on function public.jobs_storage_status() from public, anon, authenticated;
grant execute on function public.jobs_storage_status() to service_role;
