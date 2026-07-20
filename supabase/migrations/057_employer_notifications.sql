-- Migration 057: persisted employer notifications (real events, read/unread).
--
-- WHY: the employer notifications feed used to be DERIVED live from jobs+applications
-- (lib/server/employerNotifications.js) — great for "your postings are going stale", but it can't
-- represent point-in-time EVENTS an employer must not miss: someone applied, one of your listings
-- was reported inactive, or an admin ruled on your dispute. Those are persisted here with a
-- read/unread marker so the feed has real state. The derived staleness items are still merged in at
-- read time (api/employer-notifications.js) — this table does not replace that, it adds the events.
--
-- SCOPING = company_key (the normalized company name, the same key employer_company_claims and the
-- surfaces use). One approved claim owns a company (migration 053's unique index), so company_key
-- scoping IS employer scoping; keying by company_key also lets an event be recorded before/without a
-- claim and still surface to whoever later holds the approved claim. employer_user_id is stamped
-- when known (e.g. a dispute verdict for a specific filer) but is not required.
--
-- Server-only: RLS ON with NO policy, reached only via the service key (like company_reddit_disputes
-- 054 and suppressed_listings 047). The read endpoint verifies the employer's JWT + approved claim
-- and returns only their own company_key's rows — no anon/authenticated direct access. Idempotent.

CREATE TABLE IF NOT EXISTS public.employer_notifications (
  id                bigserial   PRIMARY KEY,
  company_key       text        NOT NULL,                     -- normalized company name (scope key)
  company_name      text,                                     -- display name at creation time
  employer_user_id  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,  -- target employer, when known
  kind              text        NOT NULL,                     -- apply_activity | listing_reported | dispute_approved | dispute_denied
  severity          text        NOT NULL DEFAULT 'info',      -- info | warning | critical
  title             text        NOT NULL,
  body              text,
  job_id            text,                                     -- related listing, when applicable
  meta              jsonb       NOT NULL DEFAULT '{}'::jsonb, -- non-identifying extras (role, city, apply_url, dispute_id…)
  read_at           timestamptz,                              -- NULL = unread
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT employer_notifications_kind_chk
    CHECK (kind IN ('apply_activity','listing_reported','dispute_approved','dispute_denied')),
  CONSTRAINT employer_notifications_severity_chk
    CHECK (severity IN ('info','warning','critical'))
);

-- The feed read: this company's rows, newest-first; unread-count is a filter on the same index.
CREATE INDEX IF NOT EXISTS idx_employer_notifications_company
  ON public.employer_notifications (company_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employer_notifications_unread
  ON public.employer_notifications (company_key) WHERE read_at IS NULL;

ALTER TABLE public.employer_notifications ENABLE ROW LEVEL SECURITY;
