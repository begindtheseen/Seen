-- Growth rewards (owner-approved 2026-10-24): Seen Pro days for reporting outcomes and inviting friends.
--
--   1. Report and get Pro: every outcome reported from a tracked application earns 3 days of Pro, once per
--      application, only when the application was tracked 7+ days before the report, at most 15 days per
--      California calendar month. Same reward for every outcome.
--   2. Invite a friend: a personal link (seenjobs.io/?ref=<code>). When the invitee tracks their first
--      application, both get 7 days. A referrer is rewarded for at most 10 invitees.
--
-- The numbers live in lib/server/creditRules.js; the two caps are repeated in the trigger below so they
-- hold under concurrency, and lib/server/growthRewards.test.mjs fails if the two ever disagree.
-- Pro time itself is ai_credits.pro_until (migration 044), written by lib/server/grantProDays.js.
--
-- Server-only tables (RLS on, no policies, grants revoked): api/user-sync.js and api/reports.js read and
-- write them with the service key. A reward never touches reports, company_scores or any weight.
--
-- Additive and backward-compatible. The code ships FIRST: until this is applied every reward path answers
-- "not ready" (PostgREST 404 / PGRST205) and the report or application it rides on still succeeds.

-- One invite code per user. The code is random (not the user id) and is safe to put in a link.
create table if not exists public.referral_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique check (code ~ '^[a-z2-9]{8}$'),
  created_at timestamptz not null default now()
);

-- One referrer per invitee, ever (the primary key). rewarded_at is set once the invitee tracked their
-- first application and the rewards were handed out; referrer_rewarded says whether the referrer's
-- share was paid (false once they reached their cap).
create table if not exists public.referrals (
  invitee_id uuid primary key references auth.users(id) on delete cascade,
  referrer_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  claimed_at timestamptz not null default now(),
  rewarded_at timestamptz,
  referrer_rewarded boolean,
  check (invitee_id <> referrer_id)
);
create index if not exists referrals_referrer_idx on public.referrals (referrer_id, claimed_at desc);

-- The ledger: one row per grant, so a reward is idempotent under retries and races (the unique key), and
-- an admin can see (and undo by hand) every day that was handed out.
--   kind 'report'            ref_id = the application id   (one reward per application, ever)
--   kind 'referral_invitee'  ref_id = the invitee's user id (one per invitee)
--   kind 'referral_referrer' ref_id = the invitee's user id (one per invitee; user_id = the referrer)
create table if not exists public.growth_rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('report', 'referral_invitee', 'referral_referrer')),
  ref_id text not null,
  days integer not null check (days > 0 and days <= 31),
  -- The California month the reward was granted in ('2026-10'); set by the trigger, never by a client.
  pacific_month text not null default to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM'),
  -- What pro_until became after this grant (null = the grant step did not finish).
  pro_until_after timestamptz,
  created_at timestamptz not null default now(),
  unique (kind, ref_id)
);
create index if not exists growth_rewards_user_idx on public.growth_rewards (user_id, kind, pacific_month);
create index if not exists growth_rewards_recent_idx on public.growth_rewards (created_at desc);

-- The caps, enforced in the database so two requests at the same moment cannot both squeeze past them.
-- A per-user advisory lock serializes that user's grants; the count is read after the lock is held.
-- Note: a BEFORE INSERT trigger runs before ON CONFLICT is checked, so a duplicate insert at the cap gets
-- the cap error instead of being ignored. The code checks "already rewarded" first; either way nothing
-- is granted twice.
create or replace function public.growth_rewards_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_days integer;
  v_count integer;
begin
  new.pacific_month := to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM');
  perform pg_advisory_xact_lock(hashtextextended('growth_rewards:' || new.user_id::text, 0));
  if new.kind = 'report' then
    -- REPORT_REWARD_MONTHLY_CAP_DAYS
    select coalesce(sum(days), 0) into v_days
      from public.growth_rewards
     where user_id = new.user_id and kind = 'report' and pacific_month = new.pacific_month;
    if v_days + new.days > 15 then
      raise exception 'growth_reward_cap: monthly report reward cap reached' using errcode = 'P0001';
    end if;
  elsif new.kind = 'referral_referrer' then
    -- REFERRAL_MAX_REWARDED
    select count(*) into v_count
      from public.growth_rewards
     where user_id = new.user_id and kind = 'referral_referrer';
    if v_count >= 10 then
      raise exception 'growth_reward_cap: referral reward cap reached' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists growth_rewards_guard on public.growth_rewards;
create trigger growth_rewards_guard
  before insert on public.growth_rewards
  for each row execute function public.growth_rewards_guard();

revoke all on function public.growth_rewards_guard() from public, anon, authenticated;

alter table public.referral_codes enable row level security;
alter table public.referrals enable row level security;
alter table public.growth_rewards enable row level security;
revoke all on public.referral_codes from anon, authenticated;
revoke all on public.referrals from anon, authenticated;
revoke all on public.growth_rewards from anon, authenticated;
