-- Admin remake (2026-11-10): three RPCs that move admin work into SQL. Additive and idempotent; run AFTER
-- 20261111100000_admin_core.sql (admin_overview counts company_recompute_queue; admin_review_reports writes it).
-- The code works without them: each caller treats a 404 as "not deployed" and runs the REST fallback, which
-- gives the same answer (tests: api/admin-stats.fallbacks.test.mjs).

-- Today's queue counts in one call (lib/server/admin/overview.js). p_today = midnight California time.
create or replace function public.admin_overview(p_today timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'held_reports', (select count(*) from reports where needs_review is true and (trust_reason is null or trust_reason not in ('admin_rejected', 'duplicate_import'))),
    'reddit_disputes', (select count(*) from company_reddit_disputes where status = 'open'),
    'employer_claims', (select count(*) from employer_company_claims where status = 'pending'),
    'employer_replies', (select count(*) from employer_report_replies where status = 'pending'),
    'purchases_to_fulfil', (select count(*) from employer_purchases where status = 'paid'),
    'data_issues', (select count(*) from user_issues where status = 'open'),
    'account_clusters', (select count(*) from duplicate_clusters where status = 'suspected'),
    'reports_24h', (select count(*) from reports where created_at >= now() - interval '24 hours'),
    'signups_24h', (select count(*) from profiles where created_at >= now() - interval '24 hours'),
    'reports_7d', (select count(*) from reports where created_at >= now() - interval '7 days'),
    'signups_7d', (select count(*) from profiles where created_at >= now() - interval '7 days'),
    'signups_today', (select count(*) from profiles where created_at >= p_today),
    'errors_24h', (select count(*) from api_errors where created_at >= now() - interval '24 hours'),
    'recompute_waiting', (select count(*) from company_recompute_queue)
  );
$$;

-- Approve or reject held reports in ONE transaction (lib/server/admin/review.js decideHeld): only rows still
-- pending are changed; one audit row per changed report with its prior values and the batch id; touched
-- companies are queued for a score recompute. A retry with the same p_batch reports the rows the batch already
-- decided as done_last_try, never as already decided. Ids arrive in the POST body, never in a URL.
create or replace function public.admin_review_reports(
  p_ids uuid[], p_decision text, p_admin text,
  p_admin_id bigint default null, p_batch text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch text := coalesce(p_batch, gen_random_uuid()::text);
  v_result jsonb;
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'decision must be approve or reject';
  end if;
  if coalesce(array_length(p_ids, 1), 0) > 5000 then
    raise exception 'at most 5000 ids per call';
  end if;

  with cur as (
    select r.id, r.company_name, r.outcome, r.needs_review, r.trust_reason, r.outcome_weight,
           (r.trust_reason = 'external_employee_review' or coalesce(r.report_text, '') ~* '\memployee (review|discussion)\M') as employee
    from reports r
    where r.id = any(p_ids)
      and r.needs_review is true
      and (r.trust_reason is null or r.trust_reason not in ('admin_rejected', 'duplicate_import'))
    for update
  ),
  upd as (
    update reports r set
      needs_review = (p_decision = 'reject'),
      trust_reason = case when p_decision = 'reject' then 'admin_rejected'
                          when c.employee then 'external_employee_review'
                          else r.trust_reason end,
      outcome_weight = case when p_decision = 'reject' then 0 else r.outcome_weight end
    from cur c
    where r.id = c.id
    returning r.id, c.company_name, c.outcome, c.needs_review, c.trust_reason, c.outcome_weight, c.employee
  ),
  aud as (
    insert into admin_audit_log (admin_id, username, action, target_type, target_id, metadata)
    select p_admin_id, coalesce(p_admin, 'admin'), p_decision || '_held_report', 'report', u.id::text,
           jsonb_build_object(
             'batch_id', v_batch, 'company', u.company_name, 'outcome', u.outcome,
             'prior', jsonb_build_object('needs_review', u.needs_review, 'trust_reason', u.trust_reason, 'outcome_weight', u.outcome_weight),
             'next', case when p_decision = 'reject' then jsonb_build_object('needs_review', true, 'trust_reason', 'admin_rejected', 'outcome_weight', 0)
                          when u.employee then jsonb_build_object('needs_review', false, 'trust_reason', 'external_employee_review')
                          else jsonb_build_object('needs_review', false) end)
    from upd u
    returning target_id
  ),
  q as (
    insert into company_recompute_queue (company_key)
    select distinct lower(trim(u.company_name)) from upd u where coalesce(trim(u.company_name), '') <> ''
    on conflict (company_key) do nothing
    returning company_key
  )
  select jsonb_build_object(
    'changed', coalesce((select jsonb_agg(u.id) from upd u), '[]'::jsonb),
    'companies', coalesce((select jsonb_agg(distinct lower(trim(u.company_name))) from upd u where coalesce(trim(u.company_name), '') <> ''), '[]'::jsonb),
    'audited', (select count(*) from aud),
    'queued', (select count(*) from q),
    'batch_id', v_batch
  ) into v_result;

  with ch as (
    select (jsonb_array_elements_text(v_result->'changed'))::uuid as id
  ),
  req as (
    select distinct x as id from unnest(p_ids) as x
  ),
  rest as (
    select req.id from req where not exists (select 1 from ch where ch.id = req.id)
  ),
  mine as (
    select distinct rest.id
    from rest
    join admin_audit_log a on a.target_type = 'report' and a.target_id = rest.id::text
    where a.action in ('approve_held_report', 'reject_held_report')
      and a.metadata->>'batch_id' = v_batch
  ),
  st as (
    select rest.id, (r.id is not null) as found, r.needs_review
    from rest
    left join reports r on r.id = rest.id
    where not exists (select 1 from mine where mine.id = rest.id)
  )
  select v_result || jsonb_build_object(
    'done_last_try', coalesce((select jsonb_agg(mine.id) from mine), '[]'::jsonb),
    'missing', coalesce((select jsonb_agg(st.id) from st where not st.found), '[]'::jsonb),
    'not_held', coalesce((select jsonb_agg(st.id) from st where st.found and st.needs_review is not true), '[]'::jsonb),
    'already_decided', coalesce((select jsonb_agg(st.id) from st where st.found and st.needs_review is true), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- Duplicate-listing groups found in SQL (lib/server/admin/listings.js job dupes): the database's own identity
-- (lower title + lower company + location with every non [a-z0-9] removed — jobDedupe.js locationKey) and the
-- same source + external id. Paged by group key; the code picks keepers and never deletes a protected row.
create or replace function public.admin_job_dupes_plan(p_after text default null, p_limit integer default 500)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with keyed as (
    select id, 'loc:' || lower(title) || '|' || lower(coalesce(company, '')) || '|' || regexp_replace(lower(coalesce(location, '')), '[^a-z0-9]+', '', 'g') as k
    from jobs
    where coalesce(trim(title), '') <> ''
    union all
    select id, 'ext:' || lower(coalesce(source, '')) || '|' || external_id as k
    from jobs
    where external_id is not null
  ),
  groups as (
    select k, array_agg(id order by id) as ids
    from keyed
    group by k
    having count(*) > 1
  ),
  page as (
    select k, ids from groups
    where p_after is null or k > p_after
    order by k
    limit greatest(1, least(coalesce(p_limit, 500), 2000))
  )
  select coalesce(jsonb_agg(jsonb_build_object('k', k, 'ids', ids) order by k), '[]'::jsonb) from page;
$$;

revoke all on function public.admin_overview(timestamptz) from public, anon, authenticated;
revoke all on function public.admin_review_reports(uuid[], text, text, bigint, text) from public, anon, authenticated;
revoke all on function public.admin_job_dupes_plan(text, integer) from public, anon, authenticated;
grant execute on function public.admin_overview(timestamptz) to service_role;
grant execute on function public.admin_review_reports(uuid[], text, text, bigint, text) to service_role;
grant execute on function public.admin_job_dupes_plan(text, integer) to service_role;
