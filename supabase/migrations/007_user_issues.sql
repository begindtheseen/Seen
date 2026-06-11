-- User-reported issues queue. Anyone can submit; only service key can read/update.
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS user_issues (
  id            bigserial    PRIMARY KEY,
  type          text         NOT NULL,
  target_type   text         DEFAULT 'company',
  target_name   text,
  notes         text,
  status        text         DEFAULT 'open',
  created_at    timestamptz  DEFAULT now(),
  resolved_at   timestamptz,
  resolver_note text
);

CREATE INDEX IF NOT EXISTS idx_user_issues_status  ON user_issues(status);
CREATE INDEX IF NOT EXISTS idx_user_issues_created ON user_issues(created_at DESC);

ALTER TABLE user_issues ENABLE ROW LEVEL SECURITY;

-- Anonymous users can submit issues
CREATE POLICY IF NOT EXISTS "anon_insert" ON user_issues
  FOR INSERT WITH CHECK (true);

-- Reads/updates only via service key (bypasses RLS automatically)
