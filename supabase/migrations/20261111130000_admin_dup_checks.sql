-- Admin remake round 10 (2026-11-10): the held queue's duplicate-of-live check, remembered between reads so the
-- "Approve all positive (N)" count is the same on every load. Additive; server-only (RLS on, no policies). The code
-- works without it (lib/server/admin/dupCache.js falls back to per-instance memory).

create table if not exists public.admin_dup_checks (
  report_id    uuid        primary key,
  key_hash     text        not null,
  company      text        not null default '',
  duplicate_of uuid,
  checked_at   timestamptz not null default now()
);

create index if not exists admin_dup_checks_company_idx on public.admin_dup_checks (company);
create index if not exists admin_dup_checks_checked_at_idx on public.admin_dup_checks (checked_at);

alter table public.admin_dup_checks enable row level security;
revoke all on public.admin_dup_checks from anon, authenticated;
