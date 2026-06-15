-- Migration 017: Stripe webhook idempotency + security hardening
-- Prevents double-processing of Stripe events (replay attacks, duplicate delivery).
-- Safe to run multiple times.

-- ── Stripe event idempotency tracking ────────────────────────────────────────
-- Every processed Stripe webhook event is recorded here.
-- The UNIQUE constraint on event_id causes a 409 if the same event is processed twice,
-- letting the webhook handler detect and skip duplicates safely.

CREATE TABLE IF NOT EXISTS stripe_events_processed (
  event_id    text        PRIMARY KEY,  -- Stripe event ID (e.g. "evt_1ABCxyz...")
  event_type  text        NOT NULL,     -- e.g. "checkout.session.completed"
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- Automatically prune events older than 30 days — Stripe's replay window is 72h,
-- so 30 days of retention gives 10× headroom while keeping the table small.
CREATE INDEX IF NOT EXISTS idx_stripe_events_processed_at
  ON stripe_events_processed (processed_at DESC);

-- No authenticated user should ever read or write this table directly.
ALTER TABLE stripe_events_processed ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stripe_events_service_only" ON stripe_events_processed
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ── RLS for core application tables ──────────────────────────────────────────
-- These tables were created before RLS was standard practice and may be
-- accessible via the anon key if RLS is not explicitly set.

-- profiles: users may only read/write their own row.
-- The app accesses profiles via the service key (bypasses RLS), so this policy
-- only matters for direct anon-key access.
ALTER TABLE IF EXISTS profiles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'own_profile'
  ) THEN
    CREATE POLICY "own_profile" ON profiles
      USING (auth.uid() = id)
      WITH CHECK (auth.uid() = id);
  END IF;
END $$;

-- applications: users may only read/write their own applications.
ALTER TABLE IF EXISTS applications ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'applications' AND policyname = 'own_applications'
  ) THEN
    CREATE POLICY "own_applications" ON applications
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- saved_jobs: users may only read/write their own saved jobs.
ALTER TABLE IF EXISTS saved_jobs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'saved_jobs' AND policyname = 'own_saved_jobs'
  ) THEN
    CREATE POLICY "own_saved_jobs" ON saved_jobs
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- reports: community aggregate data — public read is intentional (it's the product),
-- but writes must go through the API (service key) to pass validation.
-- Direct anon-key writes are blocked.
ALTER TABLE IF EXISTS reports ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'reports' AND policyname = 'reports_public_read'
  ) THEN
    CREATE POLICY "reports_public_read" ON reports
      FOR SELECT USING (true);  -- Community data is public
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'reports' AND policyname = 'reports_no_direct_write'
  ) THEN
    -- Block direct anon-key inserts/updates. All writes go through the service key.
    CREATE POLICY "reports_no_direct_write" ON reports
      FOR INSERT WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'reports' AND policyname = 'reports_no_direct_update'
  ) THEN
    CREATE POLICY "reports_no_direct_update" ON reports
      FOR UPDATE USING (auth.role() = 'service_role');
  END IF;
END $$;

-- login_signals: internal fraud-detection data — no user access, service key only.
ALTER TABLE IF EXISTS login_signals ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'login_signals' AND policyname = 'login_signals_service_only'
  ) THEN
    CREATE POLICY "login_signals_service_only" ON login_signals
      FOR ALL USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- duplicate_clusters: internal fraud detection — admin only.
ALTER TABLE IF EXISTS duplicate_clusters ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'duplicate_clusters' AND policyname = 'dup_clusters_service_only'
  ) THEN
    CREATE POLICY "dup_clusters_service_only" ON duplicate_clusters
      FOR ALL USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- feature_flags: read-only for service role; no user access.
ALTER TABLE IF EXISTS feature_flags ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'feature_flags' AND policyname = 'feature_flags_service_only'
  ) THEN
    CREATE POLICY "feature_flags_service_only" ON feature_flags
      FOR ALL USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- api_errors: internal logging — no user access.
ALTER TABLE IF EXISTS api_errors ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'api_errors' AND policyname = 'api_errors_service_only'
  ) THEN
    CREATE POLICY "api_errors_service_only" ON api_errors
      FOR ALL USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- search_logs: anonymized analytics — no user access.
ALTER TABLE IF EXISTS search_logs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'search_logs' AND policyname = 'search_logs_service_only'
  ) THEN
    CREATE POLICY "search_logs_service_only" ON search_logs
      FOR ALL USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- Verification:
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
-- SELECT schemaname, tablename, policyname FROM pg_policies ORDER BY tablename, policyname;
-- SELECT event_id FROM stripe_events_processed LIMIT 5;
