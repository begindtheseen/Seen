-- Migration 052: persist employer signup intent (the metadata-key bug fix).
--
-- THE BUG (verified in prod 2026-07-19: 6 profiles, 0 employers on BOTH columns):
--   The signup trigger handle_new_user() read employer intent from
--   raw_user_meta_data->>'type', but the login form (app/login/page.tsx) wrote the choice
--   to raw_user_meta_data->>'role_type'. Those keys never met, so EVERY account fell to the
--   'seeker' default and profiles.account_type (migration 050) was never set by the trigger
--   at all — it silently rode its column DEFAULT 'seeker'. Employer intent was dropped 100%
--   of the time.
--
-- THE FIX:
--   Read the intent from ANY key the form has ever used — account_type (the stable key the
--   updated form now writes), role_type (the key the old form wrote), type (what the original
--   trigger read) — whitelist it to the allowed set, and persist it to BOTH profiles.type AND
--   profiles.account_type so the two columns can never disagree again.
--
-- This is a CREATE OR REPLACE of the LIVE function (fetched via pg_get_functiondef on
-- 2026-07-19). It is byte-for-byte the same shape as production except for the intent
-- resolution + the added account_type write. The security attributes are re-declared
-- verbatim because CREATE OR REPLACE FUNCTION resets configuration attributes: SECURITY
-- DEFINER and the pinned search_path (locked in migration 021) MUST be restated or the
-- security hardening would be lost. Idempotent.
--
-- NOT INCLUDED ON PURPOSE: this migration does NOT backfill or modify any existing profile
-- row. Whether the 6 existing seeker rows should change is a data decision for the owner, not
-- a schema migration. New signups from this point forward are labeled correctly.

CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  resolved_type text;
begin
  -- Resolve signup intent from any key the form has written over time. coalesce() takes the
  -- first non-null, newest key first: account_type (updated form) → role_type (old form) →
  -- type (original trigger) → 'seeker' default. This makes the trigger work for BOTH the new
  -- and old client at once, so it is safe to ship the migration and the form change in any order.
  resolved_type := coalesce(
    NEW.raw_user_meta_data->>'account_type',
    NEW.raw_user_meta_data->>'role_type',
    NEW.raw_user_meta_data->>'type',
    'seeker'
  );

  -- Whitelist: only 'seeker' and 'employer' are valid account types. Anything else (tampered
  -- or unexpected metadata) collapses to 'seeker'. This guarantees the profiles_account_type_chk
  -- CHECK constraint (migration 050) can never fail a signup and no junk value reaches
  -- profiles.type.
  if resolved_type not in ('seeker', 'employer') then
    resolved_type := 'seeker';
  end if;

  -- Persist the SAME resolved value to both columns. `type` is the legacy label auth.tsx has
  -- historically read; `account_type` is the NOT-NULL hard-separation label from migration 050.
  -- Writing both keeps them consistent from the first row.
  insert into public.profiles (id, email, name, type, account_type)
  values (
    NEW.id,
    NEW.email,
    coalesce(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    resolved_type,
    resolved_type
  );
  return NEW;
end;
$function$;

-- Defense in depth (no behavior change): re-assert the EXECUTE revocation from migration 021.
-- CREATE OR REPLACE does not drop existing grants, but restating this keeps the migration
-- self-documenting about the security posture of this SECURITY DEFINER auth trigger.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
