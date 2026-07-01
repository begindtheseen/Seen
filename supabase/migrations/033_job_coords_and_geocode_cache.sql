-- Real radius search: per-job coordinates + a geocode cache for search centers.
alter table public.jobs add column if not exists lat double precision;
alter table public.jobs add column if not exists lng double precision;
create index if not exists jobs_latlng_idx on public.jobs (lat, lng) where lat is not null and lng is not null;

create table if not exists public.geocode_cache (
  q text primary key,
  lat double precision not null,
  lng double precision not null,
  created_at timestamptz not null default now()
);
