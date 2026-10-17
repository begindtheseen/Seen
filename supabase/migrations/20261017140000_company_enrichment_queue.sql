-- company_enrichment_queue — self-filling company pages.
--
-- WHY: per-visitor scoring is LLM-free (cached company_scores or aggregated reports), so a company
-- with no reports showed "be the first to report" forever unless someone reported. Now, when a real
-- visitor's score lookup hits a company with ZERO first-party reports, api/reports.js enqueues it
-- here (lib/server/enrichmentQueue.js → enqueue_company_enrichment). A 15-minute Vercel cron
-- (api/enrich-companies.js → lib/server/companyEnrichmentWorker.js) claims a few at a time
-- (claim_enrichment_batch), finds public Reddit hiring threads about the company, extracts
-- first-hand experiences with the free LLM gateway, and writes them as attributed, down-weighted
-- (0.3) reports in the existing Reddit shape — so the page fills itself within minutes–hours.
--
-- KEY: company_key = api/_utils/companyReddit.js normalizeCompanyKey (lowercased, legal suffix
-- stripped, whitespace collapsed — the same key company_reddit_cache uses), so "Acme, Inc." and
-- "acme" share one row. company_name is the lowercase name the lookup used (what reports.company_name
-- and company_scores.company_name are matched by).
--
-- LIFECYCLE: queued → running → done (≥1 report written) | empty (nothing usable) | error (gave up
-- after 3 attempts). done/empty get next_eligible_at = +30 days (re-enrichment cooldown); a lookup
-- after that re-queues the row — but only ever for a company that STILL has zero first-party
-- reports, because only such lookups enqueue at all. request_count counts lookups while queued and
-- orders the claim, so companies real users keep looking up go first and one-off junk sinks.
--
-- ACCESS: server-only, exactly like company_reddit_cache (054): RLS ON with NO policy; every caller
-- uses the service key. The three functions are SECURITY INVOKER and EXECUTE is granted only to
-- service_role (revoked from public/anon/authenticated), so the anon key can neither read the queue
-- nor enqueue/claim.
--
-- BACKWARD COMPATIBLE: one new table + three new functions; no existing object changes. Code that
-- ships BEFORE this migration treats the missing RPCs as "queue unavailable" and changes nothing.
-- Idempotent.

create table if not exists public.company_enrichment_queue (
  company_key      text        primary key,
  company_name     text        not null,
  status           text        not null default 'queued',
  requested_at     timestamptz not null default now(),
  request_count    integer     not null default 1,
  claimed_at       timestamptz,
  attempts         integer     not null default 0,
  last_error       text,
  done_at          timestamptz,
  llm_called_at    timestamptz,          -- last time a run actually spent an LLM call on this company
  threads_seen     integer     not null default 0,
  reports_added    integer     not null default 0,
  next_eligible_at timestamptz not null default now(),

  constraint company_enrichment_queue_status_chk check (status in ('queued', 'running', 'done', 'empty', 'error')),
  constraint company_enrichment_queue_key_len_chk check (char_length(company_key) between 2 and 120),
  constraint company_enrichment_queue_name_len_chk check (char_length(company_name) between 2 and 200)
);

-- Claim order for queued rows (status filter is the partial predicate).
create index if not exists company_enrichment_queue_claim_idx
  on public.company_enrichment_queue (request_count desc, requested_at)
  where status = 'queued';
-- Stuck-run reclaim + daily-cap count.
create index if not exists company_enrichment_queue_running_idx
  on public.company_enrichment_queue (claimed_at)
  where status = 'running';
create index if not exists company_enrichment_queue_llm_idx
  on public.company_enrichment_queue (llm_called_at)
  where llm_called_at is not null;

alter table public.company_enrichment_queue enable row level security;
-- Explicit (Supabase's default privileges already give service_role these on new public tables).
revoke all on table public.company_enrichment_queue from anon, authenticated;
grant select, insert, update, delete on table public.company_enrichment_queue to service_role;

-- ── enqueue_company_enrichment ───────────────────────────────────────────────────────────────
-- One round trip from the score path. Inserts a new queued row, bumps request_count while queued,
-- or re-queues a done/empty/error row whose cooldown has passed; otherwise a no-op. A NEW row is
-- refused once p_max_queued rows are already waiting (flood guard — throughput is ~10/day on the
-- free LLM tier, so a deeper backlog would only be junk). Returns the row's status (zero rows when
-- refused/invalid) — the company page's tiny status read.
create or replace function public.enqueue_company_enrichment(p_key text, p_name text, p_max_queued integer default 2000)
returns table (status text, requested_at timestamptz, done_at timestamptz)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_key  text := lower(btrim(coalesce(p_key, '')));
  v_name text := lower(btrim(coalesce(p_name, '')));
  v_max  integer := least(greatest(coalesce(p_max_queued, 2000), 1), 20000);
  v_waiting integer;
begin
  if char_length(v_key) not between 2 and 120 or char_length(v_name) not between 2 and 200 then
    return;
  end if;

  update public.company_enrichment_queue q
     set request_count = q.request_count + 1,
         status       = case when q.status = 'queued' then q.status else 'queued' end,
         requested_at = case when q.status = 'queued' then q.requested_at else now() end,
         attempts     = case when q.status = 'queued' then q.attempts else 0 end,
         last_error   = case when q.status = 'queued' then q.last_error else null end,
         claimed_at   = case when q.status = 'queued' then q.claimed_at else null end,
         done_at      = case when q.status = 'queued' then q.done_at else null end
   where q.company_key = v_key
     and (q.status = 'queued'
          or (q.status in ('done', 'empty', 'error') and q.next_eligible_at <= now()));

  if not found and not exists (select 1 from public.company_enrichment_queue q where q.company_key = v_key) then
    select count(*) into v_waiting
      from (select 1 from public.company_enrichment_queue q where q.status = 'queued' limit v_max) s;
    if v_waiting < v_max then
      insert into public.company_enrichment_queue (company_key, company_name, status, requested_at, request_count, next_eligible_at)
      values (v_key, v_name, 'queued', now(), 1, now())
      on conflict (company_key) do nothing;
    end if;
  end if;

  return query
    select q.status, q.requested_at, q.done_at
      from public.company_enrichment_queue q
     where q.company_key = v_key;
end $$;

-- ── claim_enrichment_batch ───────────────────────────────────────────────────────────────────
-- Atomic claim for the cron worker. FOR UPDATE SKIP LOCKED so two overlapping runs never take the
-- same company. Also reclaims 'running' rows stuck > 30 minutes (a run that died mid-company), and
-- retires stuck rows that already used 3 attempts to 'error'. p_daily_max caps how many companies
-- may reach the LLM per rolling 24h (rows with llm_called_at in the window + rows running now) —
-- the free-tier token budget, enforced here so concurrent runs cannot overspend it.
create or replace function public.claim_enrichment_batch(p_limit integer default 3, p_daily_max integer default 10)
returns table (company_key text, company_name text, attempts integer)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_limit integer := least(greatest(coalesce(p_limit, 3), 0), 10);
  v_used  integer;
begin
  update public.company_enrichment_queue q
     set status = 'error', claimed_at = null, done_at = now(),
         last_error = coalesce(q.last_error, 'stuck_running'),
         next_eligible_at = now() + interval '1 day'
   where q.status = 'running'
     and q.claimed_at < now() - interval '30 minutes'
     and q.attempts >= 3;

  if p_daily_max is not null then
    select count(*) into v_used
      from public.company_enrichment_queue q
     where q.llm_called_at >= now() - interval '24 hours'
        or (q.status = 'running' and q.claimed_at >= now() - interval '30 minutes');
    v_limit := least(v_limit, greatest(p_daily_max - v_used, 0));
  end if;
  if v_limit <= 0 then
    return;
  end if;

  return query
    with c as (
      select q.company_key
        from public.company_enrichment_queue q
       where (q.status = 'queued' and q.next_eligible_at <= now())
          or (q.status = 'running' and q.claimed_at < now() - interval '30 minutes')
       order by (q.status = 'running') desc, q.request_count desc, q.requested_at asc
       limit v_limit
       for update skip locked
    )
    update public.company_enrichment_queue q
       set status = 'running', claimed_at = now(), attempts = q.attempts + 1
      from c
     where q.company_key = c.company_key
    returning q.company_key, q.company_name, q.attempts;
end $$;

-- ── enrichment_queue_stats ───────────────────────────────────────────────────────────────────
-- Admin overview counts in one small read (the queue is bounded by real lookups; full scan is fine).
create or replace function public.enrichment_queue_stats()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'queued',  count(*) filter (where status = 'queued'),
    'running', count(*) filter (where status = 'running'),
    'done',    count(*) filter (where status = 'done'),
    'empty',   count(*) filter (where status = 'empty'),
    'error',   count(*) filter (where status = 'error'),
    'reports_added_24h', coalesce(sum(reports_added) filter (where done_at >= now() - interval '24 hours'), 0),
    'llm_calls_24h', count(*) filter (where llm_called_at >= now() - interval '24 hours')
  )
  from public.company_enrichment_queue;
$$;

revoke all on function public.enqueue_company_enrichment(text, text, integer) from public, anon, authenticated;
revoke all on function public.claim_enrichment_batch(integer, integer) from public, anon, authenticated;
revoke all on function public.enrichment_queue_stats() from public, anon, authenticated;
grant execute on function public.enqueue_company_enrichment(text, text, integer) to service_role;
grant execute on function public.claim_enrichment_batch(integer, integer) to service_role;
grant execute on function public.enrichment_queue_stats() to service_role;
