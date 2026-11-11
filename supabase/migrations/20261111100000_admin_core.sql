-- Admin remake (2026-11-10): the tables and indexes the new admin server reads. Additive and idempotent;
-- safe before or after the code (every reader falls back when these are absent).
--
--   cron_runs                 one row per cron run, written best-effort by lib/server/cronRun.js; read by
--                             Admin → System → cron health (lib/server/admin/system.js cronHealthRows).
--   company_recompute_queue   companies whose stored score must be recomputed after a bulk decision or a
--                             merge; drained by the `recompute_queue_drain` action (lib/server/admin/recompute.js).
--   admin_audit_log indexes   the activity log (keyset by created_at), a target's history, and a bulk
--                             decision's rows by batch id (undo).

create table if not exists public.cron_runs (
  id bigint generated always as identity primary key,
  name text not null,
  status text not null default 'ok' check (status in ('ok', 'partial', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  detail text
);
create index if not exists cron_runs_name_started_idx on public.cron_runs (name, started_at desc);
create index if not exists cron_runs_started_idx on public.cron_runs (started_at desc);
alter table public.cron_runs enable row level security;
revoke all on public.cron_runs from anon, authenticated;

create table if not exists public.company_recompute_queue (
  company_key text primary key,
  enqueued_at timestamptz not null default now(),
  attempts integer not null default 0
);
create index if not exists company_recompute_queue_enqueued_idx on public.company_recompute_queue (enqueued_at);
alter table public.company_recompute_queue enable row level security;
revoke all on public.company_recompute_queue from anon, authenticated;

create index if not exists admin_audit_log_created_id_idx on public.admin_audit_log (created_at desc, id desc);
create index if not exists admin_audit_log_target_idx on public.admin_audit_log (target_type, target_id, created_at desc);
create index if not exists admin_audit_log_batch_idx on public.admin_audit_log ((metadata->>'batch_id')) where metadata ? 'batch_id';
