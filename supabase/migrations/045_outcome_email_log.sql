-- Migration 045: outcome follow-up email loop (Operation 50%, Engine E2 data + retention).
--
-- The Day-7/14/30 outcome loop is the app's core data-acquisition mechanism AND a retention
-- channel. It emails an applicant to ask what happened with an application, turning silent
-- ghostings into reported data. Two server-only tables back it:
--
--   outcome_email_log — idempotency ledger. One row per (application, milestone_day); the
--     UNIQUE constraint makes the cron safe to re-run and race-safe (a duplicate insert 409s
--     instead of double-sending).
--   email_prefs — per-user opt-out, honored before every send. Set by the one-click HMAC
--     unsubscribe link in each email (api/unsubscribe.js).
--
-- Both are written only by the service key (server), so RLS is enabled with no policy — the
-- intentional "server-only table" pattern used elsewhere in this schema.

CREATE TABLE IF NOT EXISTS outcome_email_log (
  id             bigserial   PRIMARY KEY,
  application_id uuid        NOT NULL,
  user_id        uuid        NOT NULL,
  milestone_day  int         NOT NULL,
  sent_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, milestone_day)
);

CREATE INDEX IF NOT EXISTS idx_outcome_email_log_app  ON outcome_email_log (application_id);
CREATE INDEX IF NOT EXISTS idx_outcome_email_log_user ON outcome_email_log (user_id);

ALTER TABLE outcome_email_log ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS email_prefs (
  user_id         uuid        PRIMARY KEY,
  outcome_opt_out boolean     NOT NULL DEFAULT false,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE email_prefs ENABLE ROW LEVEL SECURITY;
