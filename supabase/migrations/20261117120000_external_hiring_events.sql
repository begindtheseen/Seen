-- External hiring events (2026-11-17): state workforce job fairs and union apprenticeship windows, read from official
-- public calendars by api/cron-hiring-events.js (lib/server/externalEvents.js) and served beside the events Seen's own
-- listings announce on every start guide's "Hiring events" strip. One row per event; `payload` is the row the API
-- serves (lib/jobs/externalEvents.js). Server-only: writes and reads go through the service role. The code works
-- before this table exists (it falls back to the checked-in snapshot in lib/jobs/data/).
create table if not exists public.external_hiring_events (
  id          text        primary key,
  kind        text        not null check (kind in ('fair', 'apprenticeship')),
  source      text        not null,
  starts_on   date,
  ends_on     date,
  state       text,
  payload     jsonb       not null,
  src         text        not null,
  fetched_at  timestamptz not null default now()
);
-- The request-path read: rows whose last day is today or later (or that print no last day), soonest first.
create index if not exists external_hiring_events_ends_on_idx on public.external_hiring_events (ends_on);
-- The cron's per-source replace: a source's rows the latest run did not see.
create index if not exists external_hiring_events_source_idx on public.external_hiring_events (source, fetched_at);
alter table public.external_hiring_events enable row level security;
revoke all on public.external_hiring_events from anon, authenticated;
