-- The matched-jobs rail, answered instantly (lib/server/railCache.js): each person's last computed rail, kept so
-- /api/jobs action:'recommended' answers in one round trip. Server-only (service role); the code works without it.
create table if not exists public.matched_jobs_cache (
  user_id   uuid        primary key,
  sig       text        not null,
  built_at  timestamptz not null default now(),
  payload   jsonb       not null
);
alter table public.matched_jobs_cache enable row level security;
revoke all on public.matched_jobs_cache from anon, authenticated;
