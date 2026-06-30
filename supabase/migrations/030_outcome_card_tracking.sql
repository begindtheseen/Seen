-- Migration 030: outcome_card_shares — light share/download tracking for the
-- "One-Click Outcome Card from the tracker" virality loop.
--
-- When a signed-in user generates a shareable outcome card from a TERMINAL tracked
-- application (hired / ghosted / rejected) and downloads or shares it to a social
-- destination, the report page records ONE row here so we can measure which outcomes
-- and channels actually drive shares (the data-acquisition + virality engine per
-- SEEN_STRATEGY/CLAUDE.md). This table is purely analytics — it does NOT feed
-- company_scores (the report itself, via api/reports.js create_from_tracker, does).
--
-- SECURITY: RLS enabled with NO policies → deny-all to anon/authenticated, matching
-- humanproof (029), seenfit (028) and rate_limits (020). Only the server, using the
-- SERVICE key (service_role BYPASSES RLS), inserts rows. Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS public.outcome_card_shares (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NULL,
  company_name  text        NOT NULL,
  outcome       text        NOT NULL,
  shared_via    text        NOT NULL,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outcome_card_shares_user    ON public.outcome_card_shares (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outcome_card_shares_created ON public.outcome_card_shares (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outcome_card_shares_via     ON public.outcome_card_shares (shared_via);

-- ── RLS: deny-all to anon/authenticated; server uses the service key ─────────
ALTER TABLE public.outcome_card_shares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.outcome_card_shares FROM anon, authenticated;

-- Verification:
--   SELECT shared_via, count(*) FROM outcome_card_shares GROUP BY 1 ORDER BY 2 DESC;
