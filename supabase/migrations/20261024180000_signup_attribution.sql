-- First-touch signup attribution: which landing pages and sources produce sign-ups, trials and paid users,
-- without a third-party tracker.
--
-- One row per NEW account (younger than 7 days when recorded), written once by api/user-sync.js
-- record_attribution with the service key (lib/server/signupAttribution.js): insert-only, the first record
-- wins (on_conflict=user_id + resolution=ignore-duplicates). Read by the admin report
-- (api/admin-stats.js action signup_attribution → lib/server/attributionReport.js).
--
-- What is stored is how the device first arrived: the landing PATH (no query string), the referring
-- site's HOSTNAME, the link's utm_* tags, the invite code (?ref=) and when that was. Never a full URL,
-- never an IP, never a search query. The last external touch before sign-up rides along as jsonb.
-- account_created_at is copied from auth.users by the server, never taken from the browser.
--
-- Server-only table (RLS on, no policies, grants revoked). Additive and backward-compatible: the code
-- ships FIRST and answers { reason: 'not_ready' } (PostgREST 404 / PGRST205) until this is applied.
-- delete_account deletes the row; it also cascades with the auth user.

create table if not exists public.signup_attribution (
  user_id uuid primary key references auth.users(id) on delete cascade,
  landing_path text not null check (char_length(landing_path) between 1 and 200 and left(landing_path, 1) = '/'),
  referrer_host text check (referrer_host is null or char_length(referrer_host) <= 200),
  utm_source text check (utm_source is null or char_length(utm_source) <= 200),
  utm_medium text check (utm_medium is null or char_length(utm_medium) <= 200),
  utm_campaign text check (utm_campaign is null or char_length(utm_campaign) <= 200),
  utm_content text check (utm_content is null or char_length(utm_content) <= 200),
  utm_term text check (utm_term is null or char_length(utm_term) <= 200),
  ref_code text check (ref_code is null or ref_code ~ '^[a-z2-9]{8}$'),
  first_seen_at timestamptz,
  last_touch jsonb check (last_touch is null or (jsonb_typeof(last_touch) = 'object' and pg_column_size(last_touch) <= 4096)),
  account_created_at timestamptz not null,
  recorded_at timestamptz not null default now()
);

-- The admin report reads one window of sign-ups at a time.
create index if not exists signup_attribution_created_idx on public.signup_attribution (account_created_at desc);

alter table public.signup_attribution enable row level security;
revoke all on public.signup_attribution from anon, authenticated;
