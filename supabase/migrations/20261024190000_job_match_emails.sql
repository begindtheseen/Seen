-- Job-match emails (owner request 2026-10-24): when a live listing matches someone's résumé, email
-- them an invitation to apply, linking to the listing's Seen page. At most 2 a California day, only
-- the best match each time, never the same job twice (api/cron-job-matches.js).
--
--   job_match_email_log — one row per (user, job_key). job_key is the listing's identity in
--     lower(title)|lower(company) form, so the same job stored twice by two sources is still one
--     email. The UNIQUE constraint makes a claim race-safe: the cron inserts the row BEFORE it sends
--     (a duplicate insert 409s instead of double-sending) and deletes it if the send fails.
--   email_prefs.job_match_opt_out — the one-click unsubscribe in every job-match email
--     (api/unsubscribe.js?list=job_matches). Separate from outcome_opt_out: stopping job matches
--     never stops the Day 7/14/30 check-ins, and the reverse.
--
-- Additive only. Written by the service key; RLS on with no policy (server-only table pattern).

CREATE TABLE IF NOT EXISTS public.job_match_email_log (
  id        bigserial   PRIMARY KEY,
  user_id   uuid        NOT NULL,
  job_id    text        NOT NULL,
  job_key   text        NOT NULL,
  company   text,
  sent_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, job_key)
);

CREATE INDEX IF NOT EXISTS idx_job_match_email_log_user_sent ON public.job_match_email_log (user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_match_email_log_sent ON public.job_match_email_log (sent_at DESC);

ALTER TABLE public.job_match_email_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.email_prefs ADD COLUMN IF NOT EXISTS job_match_opt_out boolean NOT NULL DEFAULT false;
