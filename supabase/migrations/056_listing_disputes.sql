-- Migration 056: listing disputes — the employer→admin correction loop for job listings.
--
-- WHY: an employer with an APPROVED company claim (migration 053) must be able to contest ANY
-- listing attached to their company — whether it was aggregated (Adzuna/…), paste-a-link imported,
-- or one they posted themselves. Per the product decision, employers do NOT directly edit or delete
-- existing listings (that would let a company quietly rewrite/erase third-party listing data and
-- erode the neutral-aggregator posture). Instead every change/removal is filed here as a DISPUTE
-- that ONLY an admin approves or denies. On approval the admin side (api/admin-stats.js
-- resolve_listing_dispute) applies the effect using the exact same soft-delete+suppress machinery
-- as delete_listing (expire the row + suppress the apply_url) or applies the proposed edit.
--
-- This mirrors company_reddit_disputes (migration 054): server-only table, RLS ON with NO policy,
-- reached only through the service key. The difference is authorship — a listing dispute is tied to
-- a verified employer (employer_user_id, from the JWT) and a specific listing (job_id), and its
-- terminal states are approved | denied (an admin verdict), not the reddit reviewed/actioned set.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.listing_disputes (
  id                bigserial   PRIMARY KEY,
  job_id            text        NOT NULL,                       -- the disputed listing (jobs.id as text; ephemeral ids allowed)
  company_name      text        NOT NULL,                       -- display name as the employer sees it
  company_key       text        NOT NULL,                       -- normalized (lower/trim/space-collapsed) — scope + grouping key
  employer_user_id  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,  -- who filed it (verified JWT)
  kind              text        NOT NULL,                       -- inactive | delete | edit | not_ours | other
  reason            text,                                       -- short machine reason (optional)
  detail            text        NOT NULL,                       -- the employer's explanation (required, capped by the endpoint)
  proposed_changes  jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- edit disputes: {title?,description?,location?,salary?,apply_url?}
  status            text        NOT NULL DEFAULT 'open',        -- open | approved | denied
  created_at        timestamptz NOT NULL DEFAULT now(),
  reviewed_at       timestamptz,
  reviewed_by       text,                                       -- admin username (audit)
  admin_note        text,                                       -- admin's approve/deny note

  CONSTRAINT listing_disputes_kind_chk   CHECK (kind   IN ('inactive','delete','edit','not_ours','other')),
  CONSTRAINT listing_disputes_status_chk CHECK (status IN ('open','approved','denied'))
);

-- Review queue: open disputes newest-first, plus per-company lookups (employer's own list, admin
-- god-view), plus the employer's-own-disputes read.
CREATE INDEX IF NOT EXISTS idx_listing_disputes_status   ON public.listing_disputes (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listing_disputes_company  ON public.listing_disputes (company_key);
CREATE INDEX IF NOT EXISTS idx_listing_disputes_employer ON public.listing_disputes (employer_user_id);
CREATE INDEX IF NOT EXISTS idx_listing_disputes_job      ON public.listing_disputes (job_id);

-- One OPEN dispute per (employer, listing, kind) so a double-submit can't flood the queue. Partial
-- unique index — approved/denied history is preserved and re-filing after a verdict is allowed.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_listing_dispute_open
  ON public.listing_disputes (employer_user_id, job_id, kind) WHERE status = 'open';

ALTER TABLE public.listing_disputes ENABLE ROW LEVEL SECURITY;
