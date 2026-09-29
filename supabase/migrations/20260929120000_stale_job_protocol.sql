-- Stale-job protocol: ONE set-based, batched, server-side sweep replaces three paths that could not
-- finish against prod (verified 2026-09-29: 95,505 stale/expired rows = 67% of `jobs`, 605 MB):
--   • api/refresh-jobs.js › deleteExpired()  — one unbounded DELETE; cancelled by the 8s
--     statement_timeout service_role inherits from `authenticator`, silently (response unchecked).
--   • api/refresh-jobs.js › markStaleJobs()  — correct but slow: 2 REST round trips per 200 rows.
--   • api/admin-stats.js  › purge_stale_jobs — one unbounded PATCH over every stale row (rewrites all
--     18 indexes per row); cancelled by the same 8s timeout, so the admin button never cleared anything.
--
-- LIFECYCLE (thresholds unchanged — lib/server/employerNotifications.js mirrors 7d / 14d):
--   active, aggregated, unseen 7d+   → 'stale' + expires_at=now (hidden; the liveness re-check in
--                                      lib/server/staleRefresh.js or a re-ingest can still revive it)
--   stale unseen 14d+, or 'expired'  → DELETED
--     …unless a saved_jobs / applications row references it → kept as 'expired' (hidden) so the
--     /jobs/[id] permalink a user holds still resolves.
--   p_mode='all' (admin "clear stale now") deletes every unreferenced stale/expired row regardless of age.
-- Employer-posted rows are never touched (they live until their own expires_at / employer delete).
-- A row with expires_at > now() is never deleted — the guard that keeps a serving listing safe.
--
-- PERFORMANCE: every candidate query is a bounded index range scan (partial indexes below). The first
-- cut used OR-predicates and per-row reference probes; on prod the planner seq-scanned the table
-- (8.4s for one page — over the 8s budget before writing a row). Each call handles at most p_batch rows
-- per step; callers loop while `more` is true (lib/server/staleSweep.js).
-- Backward compatible: adds indexes + a function only; the pre-existing code keeps working against it.

-- The admin dashboard's "jobs added today" count had no index: a 6.9s sequential scan (EXPLAIN
-- ANALYZE on prod, 2026-09-29) on every admin load, the single slowest query behind that page.
create index if not exists jobs_created_at_idx on public.jobs (created_at);
-- Step 1's candidates: active aggregated rows by age (7ms for a page on prod, was 8.4s).
create index if not exists jobs_active_aggregated_last_seen_idx on public.jobs (last_seen_at)
  where availability_status = 'active' and is_employer_posted = false;
-- Step 2/3's candidates: stale aggregated rows by age, so a scheduled run skips the 7–14d window
-- without walking it. ('expired' rows use the existing availability_status index — a small set.)
create index if not exists jobs_stale_aggregated_last_seen_idx on public.jobs (last_seen_at)
  where availability_status = 'stale' and is_employer_posted = false;

create or replace function public.sweep_stale_jobs(p_mode text default 'scheduled', p_batch integer default 1000)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch    integer := least(greatest(coalesce(p_batch, 1000), 1), 5000);
  -- Marking stale rewrites every index on the row (status + expires_at are indexed, so no HOT update;
  -- 4 trigram GINs + a tsvector GIN): ~7ms/row on prod vs ~1.5ms/row to delete. Cap it separately so
  -- one call stays well inside the 8s budget (500 × 7ms + 1000 × 1.5ms ≈ 5s worst case).
  v_stale_batch integer := least(greatest(coalesce(p_batch, 1000), 1), 500);
  v_now      timestamptz := now();
  v_stale_at timestamptz := now() - interval '7 days';
  -- 'all' = every stale row is deletable now; 'scheduled' = only rows unseen 14d+.
  v_dead_at  timestamptz;
  v_staled   integer := 0;
  v_deleted  integer := 0;
  v_retained integer := 0;
  v_refs     uuid[];
begin
  if p_mode is null or p_mode not in ('scheduled', 'all') then
    raise exception 'sweep_stale_jobs: unknown mode %', p_mode using errcode = '22023';
  end if;
  v_dead_at := case when p_mode = 'all' then 'infinity'::timestamptz else v_now - interval '14 days' end;

  -- Every job id a user still holds. saved_jobs / applications are tiny and job_id is free text
  -- (no FK), so collect the uuid-shaped ones ONCE and probe jobs' primary key with them.
  select coalesce(array_agg(distinct r.job_id::uuid), '{}') into v_refs
    from (select job_id from public.saved_jobs
          union all
          select job_id from public.applications) r
   where r.job_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  -- 1. Active aggregated rows unseen 7d+ → stale AND hidden (user search gates on expires_at > now()).
  with c as (
    select id from public.jobs
     where availability_status = 'active' and is_employer_posted = false and last_seen_at < v_stale_at
     limit v_stale_batch
  )
  update public.jobs j
     set availability_status = 'stale', expires_at = v_now, last_checked_at = v_now
    from c where j.id = c.id;
  get diagnostics v_staled = row_count;

  -- 2. Delete dead, hidden, unreferenced aggregated rows. Two branches so each is an index scan.
  with c as (
    (select id from public.jobs
      where availability_status = 'expired' and is_employer_posted = false
        and expires_at <= v_now and id <> all (v_refs)
      limit v_batch)
    union all
    (select id from public.jobs
      where availability_status = 'stale' and is_employer_posted = false
        and last_seen_at < v_dead_at and expires_at <= v_now and id <> all (v_refs)
      limit v_batch)
    limit v_batch
  )
  delete from public.jobs j using c where j.id = c.id;
  get diagnostics v_deleted = row_count;

  -- 3. Referenced rows that would have been deleted → terminal 'expired', kept for their permalink.
  update public.jobs j set availability_status = 'expired', last_checked_at = v_now
   where j.id = any (v_refs)
     and j.availability_status = 'stale' and j.is_employer_posted = false
     and j.last_seen_at < v_dead_at and j.expires_at <= v_now;
  get diagnostics v_retained = row_count;

  return jsonb_build_object(
    'mode', p_mode, 'batch', v_batch,
    'staled', v_staled, 'deleted', v_deleted, 'retained', v_retained,
    'more', (v_staled >= v_stale_batch or v_deleted >= v_batch)
  );
end $$;

revoke all on function public.sweep_stale_jobs(text, integer) from public, anon, authenticated;
grant execute on function public.sweep_stale_jobs(text, integer) to service_role;
