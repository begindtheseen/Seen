-- Rate limiting table for Seen API endpoints
-- Run this once in your Supabase SQL editor (Dashboard → SQL Editor → New query)

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,               -- "{ip}:{endpoint}:{window_hour}"
  count INTEGER NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '2 hours',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-clean expired rows daily (keeps table small)
CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits (expires_at);

-- Atomic increment function — prevents double-counting under concurrent requests
CREATE OR REPLACE FUNCTION increment_rate_limit(p_key TEXT, p_ttl_seconds INTEGER DEFAULT 3600)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO rate_limits (key, count, window_start, expires_at, updated_at)
  VALUES (p_key, 1, NOW(), NOW() + make_interval(secs => p_ttl_seconds + 60), NOW())
  ON CONFLICT (key) DO UPDATE SET
    count      = rate_limits.count + 1,
    updated_at = NOW()
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Clean up expired rows (call this from a scheduled job or manually)
CREATE OR REPLACE FUNCTION cleanup_rate_limits()
RETURNS INTEGER AS $$
DECLARE deleted INTEGER;
BEGIN
  DELETE FROM rate_limits WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Allow service role to call these functions
GRANT EXECUTE ON FUNCTION increment_rate_limit TO service_role;
GRANT EXECUTE ON FUNCTION cleanup_rate_limits  TO service_role;
GRANT ALL ON TABLE rate_limits TO service_role;

-- Disable public access — only server-side code touches this table
ALTER TABLE rate_limits DISABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE rate_limits FROM anon, authenticated;
