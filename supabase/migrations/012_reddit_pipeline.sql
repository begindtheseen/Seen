-- Reddit pipeline support: outcome_weight, trust_reason, dedup tracking.
-- Safe to run multiple times.

-- Add outcome weight to reports (1.0 = direct user submission, 0.1–0.7 = community signal)
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS outcome_weight numeric(4,3) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS trust_reason   text;

-- Index for weighted aggregate queries
CREATE INDEX IF NOT EXISTS idx_reports_outcome_weight ON reports(outcome_weight);

-- Deduplication table: tracks which Reddit posts have been imported.
-- reddit_post_id is the Reddit fullname (e.g. "t3_abc123").
CREATE TABLE IF NOT EXISTS reddit_imports (
  id             bigserial   PRIMARY KEY,
  reddit_post_id text        NOT NULL UNIQUE,
  company_name   text        NOT NULL,
  subreddit      text        NOT NULL,
  report_id      uuid        REFERENCES reports(id) ON DELETE SET NULL,
  skipped        boolean     NOT NULL DEFAULT false,
  skip_reason    text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reddit_imports_company   ON reddit_imports(company_name);
CREATE INDEX IF NOT EXISTS idx_reddit_imports_created   ON reddit_imports(created_at DESC);

-- Service-role only — no user reads or writes
ALTER TABLE reddit_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reddit_imports_service_only" ON reddit_imports
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Verification:
-- SELECT COUNT(*) FROM reddit_imports;
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'reports' AND column_name IN ('outcome_weight','trust_reason');
