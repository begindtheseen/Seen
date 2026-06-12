-- User recent company views — server-side per-user, cross-device
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS user_recent_cos (
  user_id      uuid  NOT NULL,
  company_name text  NOT NULL,
  location     text  NOT NULL DEFAULT '',
  viewed_at    timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, company_name)
);
CREATE INDEX IF NOT EXISTS idx_user_recent_cos_viewed ON user_recent_cos(user_id, viewed_at DESC);
ALTER TABLE user_recent_cos ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_recent_cos' AND policyname='own_recent') THEN
    CREATE POLICY "own_recent" ON user_recent_cos USING (auth.uid() = user_id);
  END IF;
END $$;
