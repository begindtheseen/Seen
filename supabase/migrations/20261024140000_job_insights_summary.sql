-- job_insights: the shared 7-day insight cache read and written by api/job-insights.js.
--
-- The table was created by hand in prod and never had the description_summary column the handler
-- writes, so every upsert was rejected (400) and the table held 0 rows (verified 2026-10-24, read-only):
-- a cached insight was never served to anyone. The handler now retries without the column, so this
-- migration is additive and can be applied in any order relative to the deploy.
create table if not exists public.job_insights (
  job_id text primary key,
  what_they_want jsonb not null default '[]'::jsonb,
  hidden_requirements jsonb not null default '[]'::jsonb,
  insider_tip text not null default '',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);
alter table public.job_insights enable row level security;
alter table public.job_insights add column if not exists description_summary text not null default '';
