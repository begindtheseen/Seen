-- Per-source Chronos credentials. The source name is resolved from this table; a caller-supplied
-- `by` value is only a consistency check. Secrets are never stored: an indexed digest selects one
-- row, then its salted scrypt verifier authenticates the random high-entropy credential.
create table if not exists public.brain_clients (
  id text primary key,
  name text not null,
  scopes text[] not null default array['read']::text[],
  lookup text not null unique,
  salt text not null,
  verifier text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  constraint brain_clients_name_len check (char_length(name) between 1 and 80),
  constraint brain_clients_lookup_shape check (lookup ~ '^[0-9a-f]{64}$'),
  constraint brain_clients_salt_shape check (salt ~ '^[0-9a-f]{32}$'),
  constraint brain_clients_verifier_shape check (verifier ~ '^[0-9a-f]{64}$'),
  constraint brain_clients_scopes check (scopes <@ array['read','write','admin','artifact:read','artifact:write','github:write']::text[])
);

create unique index if not exists brain_clients_one_active_name
  on public.brain_clients (lower(name)) where revoked_at is null;

alter table public.brain_clients enable row level security;
revoke all on table public.brain_clients from anon, authenticated;

comment on table public.brain_clients is
  'Chronos client identity registry; service-role only, with indexed digests, salted verifiers, and independently revocable scopes.';
