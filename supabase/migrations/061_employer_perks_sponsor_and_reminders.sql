-- Migration 061: Wave 3 employer perks — sponsor slot + renewal reminders.
--
-- sponsor_until: the Ghost Index sponsor slot (SKU sponsor30, owner-granted in admin like Verified —
--   a single, exclusive, LABELED slot above /agencies; reach/branding only, never a score or ranking).
-- renewal_reminded_until: idempotency marker for the renewal-reminder cron (api/employer-renewals) —
--   stores the ISO `until` value we last emailed about, so each period is reminded exactly once and a
--   renewal (a new, later `until`) re-arms the next reminder.
--
-- Idempotent; both columns nullable so existing rows are untouched. Server-only table (RLS on, no
-- policy) — read/written via the service key.

ALTER TABLE employer_perks
  ADD COLUMN IF NOT EXISTS sponsor_until          timestamptz,
  ADD COLUMN IF NOT EXISTS renewal_reminded_until text;
