-- ── Live-pull cooldown ledger (scale guard for on-demand aggregation) ──────────────
-- The stored jobs corpus is intentionally small (14-day expiry) so on-demand Adzuna pulls
-- are the primary data-acquisition engine (api/jobs.js → aggregateForQuery). To keep a
-- flood of searches from hammering Adzuna / running up cost, we do NOT re-pull the SAME
-- (normalized query, location) within a cooldown window (see PULL_COOLDOWN_MS in
-- lib/server/jobSources.js — 3h). Inside the window the corpus already holds everything the
-- last pull found (still fresh for 14 days), so search serves cached DB rows and skips the
-- external call. One row per (query, location), upserted on every pull.
--
-- This table is server-only (service_role). The code that reads/writes it is FAIL-OPEN: if
-- this migration hasn't been applied yet, the cooldown check simply returns "not throttled"
-- and the global aggregation budget (rate_limits / agg-global) remains the always-on cap.

CREATE TABLE IF NOT EXISTS search_pull_log (
  query        TEXT NOT NULL,                 -- normalized (lowercased, ws-collapsed) canonical query
  location     TEXT NOT NULL DEFAULT '',      -- normalized location ('' = national, 'remote' = remote)
  pulled_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result_count INTEGER NOT NULL DEFAULT 0,    -- advisory: how many the last pull returned (for tuning)
  PRIMARY KEY (query, location)
);

-- Cooldown lookups filter on pulled_at; the recency index keeps them cheap.
CREATE INDEX IF NOT EXISTS idx_search_pull_log_pulled_at ON search_pull_log (pulled_at DESC);

-- Server-only: only service-role code touches this table. RLS ENABLED with NO policies
-- (default-deny for anon/authenticated; service_role bypasses RLS) — matches the codebase
-- convention (062/064) and stays clean of the rls_disabled_in_public security advisor.
ALTER TABLE search_pull_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE search_pull_log FROM anon, authenticated;
GRANT ALL ON TABLE search_pull_log TO service_role;
