-- Saved jobs: store the apply URL + a full listing snapshot captured at save time.
-- This makes a saved listing always reopen to the exact role the user saved,
-- independent of session cache or job-cache expiry — fixing the long-standing
-- "saved listings weren't clickable / couldn't return to them" problem.
--
-- The saved_jobs table predates the tracked migrations (created manually in prod),
-- so these are additive, idempotent ALTERs.

ALTER TABLE saved_jobs ADD COLUMN IF NOT EXISTS apply_url text;
ALTER TABLE saved_jobs ADD COLUMN IF NOT EXISTS snapshot  jsonb;
