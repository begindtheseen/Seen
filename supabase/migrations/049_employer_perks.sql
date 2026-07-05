-- Migration 049: employer perks — the fulfillment side of Engine E4.
--
-- When an admin fulfills an employer purchase (after review), the perk lands here, keyed by the
-- lowercased company name. Two time-boxed perks:
--   featured_until — the company's listings get a "Featured" badge + placement boost in search.
--   verified_until — the company shows a "Transparency Verified" badge on its company page.
--
-- INTEGRITY: neither perk touches a transparency score. Featured is paid PLACEMENT. Verified is a
-- displayed COMMITMENT (the employer pledges to respond) that the admin grants after review and
-- that real outcome data continues to validate — money never buys a score, only the badge/reach.
-- Server-only (RLS on, no policy); read via the service key on the company page + search paths.

CREATE TABLE IF NOT EXISTS employer_perks (
  company        text        PRIMARY KEY,   -- lowercased company name
  featured_until timestamptz,
  verified_until timestamptz,
  purchase_id    bigint,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE employer_perks ENABLE ROW LEVEL SECURITY;
