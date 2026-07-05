-- Migration 048: employer purchases — Operation 50%, Engine E4 (employer-side revenue).
--
-- Employers buy one-time, no-login products via Stripe Checkout (email-based): a Featured Listing
-- boost and a Transparency Verified enrollment. Each paid checkout is captured here so the owner
-- can fulfill it (feature the listing / grant the verified enrollment) from admin. Keyed by the
-- Stripe checkout session id (UNIQUE) so webhook + return-page confirm are idempotent — whichever
-- lands first inserts, the other no-ops.
--
-- IMPORTANT (integrity): a purchase NEVER changes a company's transparency score, and the
-- Transparency Verified badge is an enrollment/commitment marker the owner grants after review —
-- money buys reach and the right to commit, never a better score. Server-only (RLS on, no policy).

CREATE TABLE IF NOT EXISTS employer_purchases (
  id                 bigserial   PRIMARY KEY,
  stripe_session_id  text        UNIQUE NOT NULL,
  employer_sku       text        NOT NULL,
  company            text,
  email              text,
  target_url         text,
  amount_cents       integer,
  status             text        NOT NULL DEFAULT 'paid',   -- paid | fulfilled | refunded
  created_at         timestamptz NOT NULL DEFAULT now(),
  fulfilled_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_employer_purchases_status ON employer_purchases (status, created_at DESC);

ALTER TABLE employer_purchases ENABLE ROW LEVEL SECURITY;
