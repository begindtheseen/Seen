-- One row per cloud collector run (2026-10-21): api/cron-archive-reports.js writes it, Seen Command reads the
-- last 50 through GET /api/cron-archive-reports?runs=1 (notifications + Home), and the cron uses it to rotate
-- through companies instead of retrying the same ones hourly. Server-only (RLS on, no policies).
create table if not exists public.collector_runs (
  id bigint generated always as identity primary key,
  pipeline text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'complete', 'partial', 'failed')),
  companies text[] not null default '{}',
  new_reports integer not null default 0,
  summary jsonb,
  error text
);
create index if not exists collector_runs_pipeline_started_idx on public.collector_runs (pipeline, started_at desc);
alter table public.collector_runs enable row level security;
revoke all on public.collector_runs from anon, authenticated;
