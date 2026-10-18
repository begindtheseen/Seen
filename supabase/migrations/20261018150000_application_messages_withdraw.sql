-- Apply on Seen: employer messages + applicant withdrawal (owner request 2026-10-18).
--
--   seen_applications.thread   the whole conversation for one application, stored ON the existing row
--                              as a compact JSON array of tuples — [from, unix_seconds, text] or
--                              [from, unix_seconds, text, kind] — from 'e' (employer) / 'a' (applicant),
--                              kind 'w' = the applicant's withdrawal note. NULL until the first message,
--                              so applications nobody writes on cost nothing. Capped in code
--                              (lib/server/applicationThread.js: 40 entries × 600 chars). No messages
--                              table: one row per application already exists and both sides read it.
--   status 'withdrawn'         on seen_applications (the employer's copy) and applications (the tracker).
--
-- Additive and backward-compatible: the running code ignores the column until it exists
-- (lib/server/seenApplyStore.js threadAvailable) and never writes 'withdrawn' before then.
-- Idempotent.

ALTER TABLE public.seen_applications ADD COLUMN IF NOT EXISTS thread jsonb;

ALTER TABLE public.seen_applications DROP CONSTRAINT IF EXISTS seen_applications_status_check;
ALTER TABLE public.seen_applications ADD CONSTRAINT seen_applications_status_check
  CHECK (status IN ('new', 'reviewed', 'interviewing', 'rejected', 'hired', 'withdrawn'));

ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_status_check;
ALTER TABLE public.applications ADD CONSTRAINT applications_status_check
  CHECK (status IN ('active', 'ghosted', 'hired', 'rejected', 'withdrawn'));
