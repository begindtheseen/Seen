-- Admin dashboard: the seven jobs-table counts in ONE pass.
--
-- Why (production, 2026-10-24): api/admin-stats.js answered every dashboard load and every Seen Command
-- Home-tab poll (30–60 s apart while open) with seven concurrent `Prefer: count=exact` requests over the
-- ~83k-row jobs table. pg_stat_statements had those seven count(*) shapes as the top statements by total
-- time (means 0.4–1.9 s, maxima at the 8 s statement_timeout), and every company-page read queued behind
-- them on the shared instance (max_connections 60). One scan on one connection replaces seven.
--
-- ADDITIVE and deploy-order safe: lib/server/adminJobsCounts.js calls this RPC first and, while it 404s,
-- falls back to the same seven exact counts as before. Exact numbers either way — never an estimate.
-- Filters mirror lib/server/staleSweep.js STALE_CLEARABLE_FILTER / STALE_KEPT_FILTER and the dashboard's
-- "Added today" (California day start, passed in by the caller).

create or replace function public.admin_jobs_counts(p_today timestamptz, p_overdue timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'total',            count(*),
    'active',           count(*) filter (where availability_status = 'active'),
    'added_today',      count(*) filter (where created_at >= p_today),
    'stale_or_expired', count(*) filter (where availability_status in ('stale', 'expired')),
    'stale_clearable',  count(*) filter (where availability_status = 'stale'   and is_employer_posted = false),
    'expired_kept',     count(*) filter (where availability_status = 'expired' and is_employer_posted = false),
    'stale_overdue',    count(*) filter (where availability_status = 'stale'   and is_employer_posted = false and last_seen_at < p_overdue)
  )
  from public.jobs;
$$;

revoke all on function public.admin_jobs_counts(timestamptz, timestamptz) from public;
revoke all on function public.admin_jobs_counts(timestamptz, timestamptz) from anon;
revoke all on function public.admin_jobs_counts(timestamptz, timestamptz) from authenticated;
grant execute on function public.admin_jobs_counts(timestamptz, timestamptz) to service_role;

comment on function public.admin_jobs_counts(timestamptz, timestamptz) is
  'Admin dashboard jobs counts (total/active/added today/stale+expired/clearable/kept/overdue) in one scan. Service role only.';
