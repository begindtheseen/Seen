-- job_search: a slim copy of the columns job search reads, kept in step with public.jobs by triggers.
--
-- WHY (2026-11-26): the database is ~1.0 GB and public.jobs ~927 MB (postings, history, 21 indexes) on a server
-- with ~1 GB of memory, so a text search on jobs reads from disk: `title ilike %engineer%` ordered by score ran past
-- the 8 s statement timeout on every try, and a few phones searching at once queued the whole site behind those
-- reads. Search needs ~20 short columns (never the posting): this table is ~50 MB with its indexes, stays in memory,
-- and answers the same reads with the same rows (api/jobs.js routes every light read of jobs here once it exists).
--
-- It holds every jobs row (open or not), so any read answers exactly as the same read on jobs would. Triggers keep it
-- exact: insert, update of a copied column, delete. Rows a re-seen listing refreshes (last_seen_at / expires_at) are
-- updated in place; neither column is indexed, so those updates stay HOT (no index churn).
--
-- Idempotent. Server-only (RLS on, no policies; service_role bypasses RLS).

create table if not exists public.job_search (
  id uuid primary key,
  title text,
  company text,
  location text,
  salary text,
  salary_min integer,
  apply_url text,
  type text,
  source text,
  score integer,
  waste_score integer,
  search_query text,
  lat double precision,
  lng double precision,
  created_at timestamptz,
  is_employer_posted boolean,
  ats_tenant text,
  level text,
  expires_at timestamptz,
  last_seen_at timestamptz,
  apply_mode text
) with (fillfactor = 85, autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05);

alter table public.job_search enable row level security;
revoke all on table public.job_search from anon, authenticated;
grant select, insert, update, delete on table public.job_search to service_role;

create or replace function public.job_search_sync()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'DELETE' then
    delete from public.job_search where id = old.id;
    return old;
  end if;
  insert into public.job_search as s (
    id, title, company, location, salary, salary_min, apply_url, type, source, score, waste_score, search_query,
    lat, lng, created_at, is_employer_posted, ats_tenant, level, expires_at, last_seen_at, apply_mode
  ) values (
    new.id, new.title, new.company, new.location, new.salary, new.salary_min, new.apply_url, new.type, new.source,
    new.score, new.waste_score, new.search_query, new.lat, new.lng, new.created_at, new.is_employer_posted,
    new.ats_tenant, new.level, new.expires_at, new.last_seen_at, new.apply_mode
  )
  on conflict (id) do update set
    title = excluded.title, company = excluded.company, location = excluded.location, salary = excluded.salary,
    salary_min = excluded.salary_min, apply_url = excluded.apply_url, type = excluded.type, source = excluded.source,
    score = excluded.score, waste_score = excluded.waste_score, search_query = excluded.search_query,
    lat = excluded.lat, lng = excluded.lng, created_at = excluded.created_at,
    is_employer_posted = excluded.is_employer_posted, ats_tenant = excluded.ats_tenant, level = excluded.level,
    expires_at = excluded.expires_at, last_seen_at = excluded.last_seen_at, apply_mode = excluded.apply_mode
  where (s.title, s.company, s.location, s.salary, s.salary_min, s.apply_url, s.type, s.source, s.score,
         s.waste_score, s.search_query, s.lat, s.lng, s.created_at, s.is_employer_posted, s.ats_tenant, s.level,
         s.expires_at, s.last_seen_at, s.apply_mode)
     is distinct from
        (excluded.title, excluded.company, excluded.location, excluded.salary, excluded.salary_min,
         excluded.apply_url, excluded.type, excluded.source, excluded.score, excluded.waste_score,
         excluded.search_query, excluded.lat, excluded.lng, excluded.created_at, excluded.is_employer_posted,
         excluded.ats_tenant, excluded.level, excluded.expires_at, excluded.last_seen_at, excluded.apply_mode);
  return new;
end
$function$;

revoke all on function public.job_search_sync() from public, anon, authenticated;
grant execute on function public.job_search_sync() to service_role;

-- AFTER triggers: they see the row as stored (after the dedupe trigger and the storage guard). An update that touches
-- none of the copied columns (a posting text edit, last_checked_at) does not fire.
drop trigger if exists trg_jobs_search_sync_ins on public.jobs;
create trigger trg_jobs_search_sync_ins after insert on public.jobs
  for each row execute function public.job_search_sync();
drop trigger if exists trg_jobs_search_sync_upd on public.jobs;
create trigger trg_jobs_search_sync_upd after update of
  title, company, location, salary, salary_min, apply_url, type, source, score, waste_score, search_query,
  lat, lng, created_at, is_employer_posted, ats_tenant, level, expires_at, last_seen_at, apply_mode
  on public.jobs for each row execute function public.job_search_sync();
drop trigger if exists trg_jobs_search_sync_del on public.jobs;
create trigger trg_jobs_search_sync_del after delete on public.jobs
  for each row execute function public.job_search_sync();

-- Fill it from what jobs holds now (rows written meanwhile are added by the triggers above; a re-run copies again).
insert into public.job_search (
  id, title, company, location, salary, salary_min, apply_url, type, source, score, waste_score, search_query,
  lat, lng, created_at, is_employer_posted, ats_tenant, level, expires_at, last_seen_at, apply_mode
)
select id, title, company, location, salary, salary_min, apply_url, type, source, score, waste_score, search_query,
       lat, lng, created_at, is_employer_posted, ats_tenant, level, expires_at, last_seen_at, apply_mode
  from public.jobs
on conflict (id) do update set
  title = excluded.title, company = excluded.company, location = excluded.location, salary = excluded.salary,
  salary_min = excluded.salary_min, apply_url = excluded.apply_url, type = excluded.type, source = excluded.source,
  score = excluded.score, waste_score = excluded.waste_score, search_query = excluded.search_query,
  lat = excluded.lat, lng = excluded.lng, created_at = excluded.created_at,
  is_employer_posted = excluded.is_employer_posted, ats_tenant = excluded.ats_tenant, level = excluded.level,
  expires_at = excluded.expires_at, last_seen_at = excluded.last_seen_at, apply_mode = excluded.apply_mode;
delete from public.job_search s where not exists (select 1 from public.jobs j where j.id = s.id);

-- The reads search makes: substring matches on the text columns (trigram), the ranked order, the area box, the
-- newest rows (the index's minute read, the matched-jobs rail).
create index if not exists job_search_title_trgm on public.job_search using gin (title extensions.gin_trgm_ops);
create index if not exists job_search_company_trgm on public.job_search using gin (company extensions.gin_trgm_ops);
create index if not exists job_search_query_trgm on public.job_search using gin (search_query extensions.gin_trgm_ops);
create index if not exists job_search_location_trgm on public.job_search using gin (location extensions.gin_trgm_ops);
create index if not exists job_search_rank_idx on public.job_search (score desc nulls last, id);
create index if not exists job_search_latlng_idx on public.job_search (lat, lng) where lat is not null and lng is not null;
create index if not exists job_search_created_idx on public.job_search (created_at);

analyze public.job_search;

comment on table public.job_search is
  'Slim copy of the jobs columns search reads, kept exact by trg_jobs_search_sync_* (migration 20261126120000). Server-only.';
