-- Inbox Autopilot (2026-10-21, owner: "if it doesn't cost us any money that's genius").
-- A user gets a private address (track-<token>@seenjobs.io — Resend receiving is already enabled for the
-- whole domain), forwards job emails to it, and Seen keeps the tracker up to date from them.
--
-- Privacy decision: ONLY the facts Seen pulled out of an email are stored — never its text, subject or
-- attachments. The email itself stays in Resend (1-day retention on the free plan) and is never copied.
-- Both tables are server-only (RLS on, no policies, grants revoked): api/user-sync.js and
-- api/inbox-email.js read and write them with the service key.
--
-- Additive and backward-compatible: the code that uses these tables answers "not set up yet" until this
-- migration is applied, and nothing else reads them.

create table if not exists public.inbox_addresses (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token text not null unique check (token ~ '^[a-z2-9]{12}$'),
  paused boolean not null default false,
  created_at timestamptz not null default now(),
  last_received_at timestamptz,
  received_count integer not null default 0,
  -- Gmail sends a confirmation code to a new forwarding address; Seen shows it to the user so the
  -- forward can be switched on. {code, url, at} — cleared once a real job email arrives.
  forwarding_confirm jsonb
);

create table if not exists public.inbox_events (
  id uuid primary key default gen_random_uuid(),
  -- The provider's id for the received email: one row per email, so a webhook and the hourly catch-up
  -- can never process the same email twice.
  provider_email_id text not null unique,
  user_id uuid references auth.users(id) on delete cascade,
  received_at timestamptz not null default now(),
  -- processing | applied | unplaced | ignored | not_ours | paused | failed
  state text not null default 'processing',
  -- application_received | interview | assessment | rejection | offer | forwarding_confirm | other
  kind text,
  company text,
  role text,
  vendor text,
  sender_name text,
  sender_domain text,
  confidence text,
  application_id uuid references public.applications(id) on delete set null,
  -- ask | shared | declined | null — the one-tap "add this outcome to the company's grade?" prompt.
  share_state text,
  created_at timestamptz not null default now()
);

create index if not exists inbox_events_user_idx on public.inbox_events (user_id, received_at desc);

alter table public.inbox_addresses enable row level security;
alter table public.inbox_events enable row level security;
revoke all on public.inbox_addresses from anon, authenticated;
revoke all on public.inbox_events from anon, authenticated;
