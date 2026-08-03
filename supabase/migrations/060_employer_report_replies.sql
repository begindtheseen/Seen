-- Migration 060: employer replies to community outcome reports (Wave 2 — the employer "voice").
--
-- WHAT: an approved employer can post a public REPLY to a specific outcome report candidates filed
-- about their company (e.g. add context to a "ghosted" report). It is the employer's side of the
-- record — shown next to the report on the company page once an admin approves it.
--
-- INTEGRITY (load-bearing, mirrors employer_perks 049 / claims 053): a reply is a CLAIM, never a
-- fact and NEVER a score input. It is display-only — nothing here is read by the scoring path
-- (api/reports.js recompute / api/_utils/companyIntel.js). Money/replies never move ghost_rate or
-- response_rate. Because an employer-authored row would otherwise default to full 1.0 source trust,
-- replies are deliberately kept in their OWN table, out of `reports` entirely.
--
-- MODERATION: replies land 'pending' and are invisible to seekers until an admin approves them
-- (owner decision 2026-08-03 — held for review before public). Admin moderates via
-- api/admin-stats.js (list_employer_replies / moderate_employer_reply).
--
-- SCOPING: company_key (normalized company name — the same key claims + the surfaces use). report_id
-- is stored as TEXT (loose coupling, like apply_events.job_id → jobs.id): the legacy `reports` table
-- predates these migrations and its id type must not constrain this one. No FK to reports.
--
-- PRIVACY: the reply is authored BY the employer; it carries no seeker identity. employer_user_id is
-- the author (server-only, never surfaced publicly). Server-only table: RLS ON with NO policy,
-- service-key access only. Idempotent.

CREATE TABLE IF NOT EXISTS public.employer_report_replies (
  id                bigserial   PRIMARY KEY,
  report_id         text        NOT NULL,                    -- reports.id as text (loose coupling)
  company_key       text        NOT NULL,                    -- normalized company name (scope key)
  employer_user_id  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,  -- author, server-only
  body              text        NOT NULL,                    -- the employer's public response
  status            text        NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  reviewed_by       text,                                    -- admin username, on moderation
  reviewed_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT employer_report_replies_status_chk
    CHECK (status IN ('pending', 'approved', 'rejected'))
);

-- One reply per company per report — a re-submit (e.g. after a rejection) UPSERTs and re-enters
-- review, so an employer can't spam a report with many replies.
CREATE UNIQUE INDEX IF NOT EXISTS uq_employer_report_replies_company_report
  ON public.employer_report_replies (company_key, report_id);

-- Public render: approved replies for a set of report ids.
CREATE INDEX IF NOT EXISTS idx_employer_report_replies_approved
  ON public.employer_report_replies (report_id) WHERE status = 'approved';

-- Admin queue: pending first, newest within.
CREATE INDEX IF NOT EXISTS idx_employer_report_replies_status
  ON public.employer_report_replies (status, created_at DESC);

-- The employer's own list (hub status view), scoped by company.
CREATE INDEX IF NOT EXISTS idx_employer_report_replies_company
  ON public.employer_report_replies (company_key, created_at DESC);

ALTER TABLE public.employer_report_replies ENABLE ROW LEVEL SECURITY;
