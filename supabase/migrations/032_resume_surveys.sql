-- Migration 032: resume_surveys — anti-farming ledger for the résumé intel survey.
--
-- The résumé survey (api/user-sync.js action `resume_survey` / `submit_resume_survey`)
-- reads the signed-in user's stored résumé, parses their employment history with the
-- deterministic extractEmployment() parser, and asks generic hiring-experience questions
-- about ONE random past (company, role). On completion it awards AI credits AND writes a
-- trust-weighted first-party report that feeds that company's score.
--
-- This table records which (user, company, role) positions have already been surveyed so
-- the same job cannot be farmed for credits repeatedly. One completed survey per position.
--
-- SECURITY: RLS enabled with NO policies → deny-all to anon/authenticated, matching the
-- pattern in migrations 020/028/029/030. The server (api/user-sync.js) reads/writes this
-- table with the SERVICE key (service_role BYPASSES RLS). Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS public.resume_surveys (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL,
  company_norm  text        NOT NULL,           -- normalized company name (dedup key)
  company_name  text        NOT NULL,           -- display name as parsed from résumé
  role          text        NULL,               -- title as parsed from résumé
  company_id    uuid        NULL,               -- resolved companies.id (the report target)
  outcome       text        NULL,               -- mapped reports.outcome value
  answers       jsonb       NULL,               -- raw {questionKey: answer} captured
  credits_awarded integer   DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);

-- One survey per (user, company) — the anti-farming guarantee. company_norm is the
-- normalized name so "Acme Inc" and "Acme" collapse to the same position.
CREATE UNIQUE INDEX IF NOT EXISTS uq_resume_surveys_user_co
  ON public.resume_surveys (user_id, company_norm);

CREATE INDEX IF NOT EXISTS idx_resume_surveys_user
  ON public.resume_surveys (user_id, created_at DESC);

ALTER TABLE public.resume_surveys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.resume_surveys FROM anon, authenticated;

COMMENT ON TABLE public.resume_surveys IS
  'Anti-farming ledger: one completed résumé intel survey per (user, company). Service-key only (deny-all RLS).';
