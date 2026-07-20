-- Migration 058: apply-click events — the observable "someone applied" signal.
--
-- WHY: an application on Seen is a CLICK-THROUGH REDIRECT to the employer's external apply_url — the
-- actual submission happens off-site, so Seen can never observe it. The one thing we CAN observe on
-- "their listing page" is the apply click itself. api/apply.js records one row here per click (best-
-- effort — it never blocks the apply email path) so an employer gets real per-listing application
-- counts and an "apply_activity" notification. This is folded together with the seeker-self-reported
-- `applications` corpus (deduped) so the employer's count reflects both signals.
--
-- PRIVACY: user_id is recorded server-side ONLY for dedupe/rate context and is NEVER returned to an
-- employer — the employer surfaces expose apply activity only as aggregate counts + role/city/date,
-- never an applicant identity. Server-only table: RLS ON with NO policy, service-key access only.
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.apply_events (
  id            bigserial   PRIMARY KEY,
  job_id        text,                                   -- the listing applied to (jobs.id or ephemeral id), when known
  company_name  text,                                   -- display name at click time
  company_key   text        NOT NULL,                   -- normalized company name (scope/group key)
  role          text,                                   -- non-identifying: the role title clicked
  city          text,                                   -- non-identifying: listing city
  apply_url     text,                                   -- the external redirect target
  user_id       uuid,                                   -- server-only: applicant if signed in (never surfaced)
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Per-company activity reads (counts, recent), newest-first.
CREATE INDEX IF NOT EXISTS idx_apply_events_company ON public.apply_events (company_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_apply_events_job     ON public.apply_events (job_id);

ALTER TABLE public.apply_events ENABLE ROW LEVEL SECURITY;
