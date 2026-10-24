-- Living search data (2026-10-24): what people actually search before they land on Seen, pulled daily by
-- api/cron-search-data.js from Google Search Console (Search Analytics) and Bing Webmaster Tools, plus a log of
-- the URLs Seen offered to IndexNow. Read by lib/server/searchOpportunities.js (admin opportunities, the report
-- collectors' search_demand order, and the intents a company page answers first).
--
-- Additive only. The code reads and writes these tables best-effort: before this migration is applied every
-- path no-ops (deploy code before schema). Server-only: RLS on, no policies, no anon/authenticated grants. Raw
-- search strings never leave the server; public pages only ever see an intent label.

create table if not exists public.search_daily (
  id bigint generated always as identity primary key,
  date date not null,                          -- the provider's day (Search Console reports Pacific dates)
  source text not null check (source in ('google', 'bing')),
  query text not null,
  page text not null default '',               -- '' = a site-level row (Bing GetQueryStats has no page)
  clicks integer not null default 0 check (clicks >= 0),
  impressions integer not null default 0 check (impressions >= 0),
  ctr double precision not null default 0 check (ctr >= 0 and ctr <= 1),
  position double precision,                   -- average position; null when the provider gave none
  fetched_at timestamptz not null default now(),
  constraint search_daily_key unique (date, source, query, page)
);
-- (date, …) leads the unique index, which serves the 28-day window reads and the retention delete.
create index if not exists search_daily_page_date_idx on public.search_daily (page, date desc);
create index if not exists search_daily_query_date_idx on public.search_daily (query, date desc);
alter table public.search_daily enable row level security;
revoke all on public.search_daily from anon, authenticated;

create table if not exists public.search_indexnow_log (
  url text primary key,
  last_submitted_at timestamptz not null default now(),
  last_status integer
);
alter table public.search_indexnow_log enable row level security;
revoke all on public.search_indexnow_log from anon, authenticated;
