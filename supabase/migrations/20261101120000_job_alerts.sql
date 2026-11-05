-- Job alerts (owner request 2026-11-01): "an option in settings to only be notified for specific
-- jobs in specific areas." Two columns on the existing per-user email_prefs row:
--
--   job_match_mode — 'resume' (default: the job-match email follows the résumé, as before) or
--     'alerts' (only listings that match one of job_alerts). "Off" is the existing
--     job_match_opt_out, so the one-click unsubscribe and Settings agree.
--   job_alerts — up to 5 alerts, each { keywords, place, remote, miles, lat, lng }, validated and
--     geocoded by api/user-sync.js (job_alerts_save, lib/server/jobAlerts.js).
--
-- Additive only. email_prefs stays server-only (RLS on, no policy; written with the service key by
-- api/user-sync.js, api/unsubscribe.js and read by api/cron-job-matches.js). Code works before this
-- is applied: Settings hides the section and the cron keeps everyone on résumé matches.

ALTER TABLE public.email_prefs ADD COLUMN IF NOT EXISTS job_match_mode text NOT NULL DEFAULT 'resume';
ALTER TABLE public.email_prefs ADD COLUMN IF NOT EXISTS job_alerts jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$ BEGIN
  ALTER TABLE public.email_prefs ADD CONSTRAINT email_prefs_job_match_mode_check CHECK (job_match_mode IN ('resume', 'alerts'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.email_prefs ADD CONSTRAINT email_prefs_job_alerts_check
    CHECK (CASE WHEN jsonb_typeof(job_alerts) = 'array' THEN jsonb_array_length(job_alerts) <= 5 ELSE false END);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_email_prefs_job_alerts_mode ON public.email_prefs (job_match_mode) WHERE job_match_mode = 'alerts';

ALTER TABLE public.email_prefs ENABLE ROW LEVEL SECURITY;
