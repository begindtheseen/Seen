-- job_enrichment — structured signals extracted ONCE per listing by an offline LLM batch
-- (scripts/credit/tag-jobs.mjs, claude-haiku-5-5 via the Message Batches API).
--
-- WHY: the listing scorer (lib/server/jobScore.js) can only see what a regex can see. The most
-- valuable fact for Seen's beachhead audience — "was this posted by a staffing agency (which one),
-- or by the employer itself?" — is usually stated in prose ("our client", "on behalf of a leading…",
-- "W2 contract through …"), not in a field. This table holds that classification plus work mode,
-- seniority, parsed pay, and a fixed-vocabulary list of ghost/red-flag signals, so the app can read
-- them as data instead of re-deriving them per request.
--
-- These are MODEL CLAIMS about the listing text, not facts about a company: every row carries
-- `model`, `confidence`, and `enriched_at`, and surfaces must label them as such (CLAUDE.md
-- anti-gaming: "never present weak data as fact"). Nothing here feeds a company's score.
--
-- KEY: job_id = jobs.id, which is uuid (migration 068 jobs_dedupe_refresh: `existing_id uuid`;
-- 20260929120000 sweep_stale_jobs compares jobs.id to a uuid[]). ON DELETE CASCADE: the stale-job
-- sweep and the dedupe trigger delete jobs rows; their enrichment must go with them. The cascade
-- adds one primary-key delete per swept row (small next to the ~1.5ms/row jobs delete the sweep's
-- batch sizing already budgets for).
--
-- ACCESS: jobs is read publicly behind its expires_at gate (migration 055's note) and every app
-- read goes through the service key. Enrichment is derived only from those public listings, so it
-- is publicly readable on exactly the same terms: the select policy below is an EXISTS against
-- public.jobs, which runs under the caller's own jobs RLS — anon/authenticated can see an
-- enrichment row only when they could see its listing. No insert/update/delete policy: writes are
-- service-role only (RLS bypassed), like jobs.
--
-- Backward compatible: a new table, its indexes, and one policy. No existing object changes.
-- Idempotent.

create table if not exists public.job_enrichment (
  job_id          uuid        primary key references public.jobs(id) on delete cascade,
  posted_by       text,                 -- direct | staffing_agency | recruiter_unclear | unknown
  agency_name     text,                 -- normalized to lib/agencies.ts display names when it is one of them
  client_employer text,                 -- the real employer, only when an agency listing names it
  is_remote       text,                 -- remote | hybrid | onsite | unknown
  seniority       text,                 -- entry | mid | senior | lead | unknown
  salary_min      numeric,
  salary_max      numeric,
  salary_period   text,                 -- hour | year | unknown
  salary_currency text,                 -- ISO 4217, e.g. USD
  ghost_signals   text[]      not null default '{}',
  red_flags       text[]      not null default '{}',
  summary         text,                 -- ≤200 chars, neutral description of the role
  model           text,                 -- the model that produced the row, e.g. claude-haiku-5-5
  enriched_at     timestamptz not null default now(),
  confidence      text,                 -- high | medium | low (mainly about posted_by)

  constraint job_enrichment_posted_by_chk     check (posted_by     in ('direct', 'staffing_agency', 'recruiter_unclear', 'unknown')),
  constraint job_enrichment_is_remote_chk     check (is_remote     in ('remote', 'hybrid', 'onsite', 'unknown')),
  constraint job_enrichment_seniority_chk     check (seniority     in ('entry', 'mid', 'senior', 'lead', 'unknown')),
  constraint job_enrichment_salary_period_chk check (salary_period in ('hour', 'year', 'unknown')),
  constraint job_enrichment_confidence_chk    check (confidence    in ('high', 'medium', 'low')),
  constraint job_enrichment_currency_chk      check (salary_currency ~ '^[A-Z]{3}$'),
  constraint job_enrichment_salary_order_chk  check (salary_min is null or salary_max is null or salary_min <= salary_max),
  constraint job_enrichment_summary_len_chk   check (char_length(summary) <= 200),
  -- The fixed vocabularies. Keep in lockstep with GHOST_SIGNALS / RED_FLAGS in scripts/credit/tag-jobs.mjs.
  constraint job_enrichment_ghost_vocab_chk   check (ghost_signals <@ array[
    'evergreen_pipeline', 'vague_duties', 'no_salary', 'reposted_language',
    'unrealistic_requirements', 'generic_boilerplate', 'hidden_employer'
  ]::text[]),
  constraint job_enrichment_red_flag_vocab_chk check (red_flags <@ array[
    'mlm_or_commission_only', 'pay_to_apply', 'requests_sensitive_info', 'off_platform_contact',
    'too_good_to_be_true_pay', 'unpaid_trial_work', 'misleading_title'
  ]::text[])
);
-- (A CHECK on a NULL column passes, so every enum column above may also be NULL: the writer stores
-- NULL — never a guessed value — when the model returned something outside the vocabulary.)

-- /agencies and job-card badges filter by who posted and which agency.
create index if not exists job_enrichment_posted_by_idx   on public.job_enrichment (posted_by);
create index if not exists job_enrichment_agency_name_idx on public.job_enrichment (agency_name)
  where agency_name is not null;

alter table public.job_enrichment enable row level security;

drop policy if exists job_enrichment_public_read on public.job_enrichment;
create policy job_enrichment_public_read on public.job_enrichment
  for select to anon, authenticated
  using (exists (select 1 from public.jobs j where j.id = job_enrichment.job_id));
