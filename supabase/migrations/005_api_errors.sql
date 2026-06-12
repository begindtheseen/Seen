-- API error log — written fire-and-forget from serverless functions
-- Allows admin visibility into failures without digging through Vercel logs

CREATE TABLE IF NOT EXISTS api_errors (
  id          bigserial PRIMARY KEY,
  endpoint    text NOT NULL,
  error_msg   text,
  context     jsonb,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_errors_endpoint ON api_errors(endpoint);
CREATE INDEX IF NOT EXISTS idx_api_errors_created  ON api_errors(created_at DESC);

-- Auto-delete errors older than 30 days to avoid unbounded growth
-- (Run as a Supabase scheduled function or pg_cron if available)
-- DELETE FROM api_errors WHERE created_at < now() - interval '30 days';
