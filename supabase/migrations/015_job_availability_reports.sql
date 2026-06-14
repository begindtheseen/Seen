-- Job Availability Reports
-- Tracks user reports that a listing is no longer active.
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS job_availability_reports (
  id          bigserial   PRIMARY KEY,
  job_id      text        NOT NULL,
  user_id     uuid        NOT NULL,
  status      text        NOT NULL CHECK (status IN ('active', 'expired', 'unknown')),
  reported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_jar_job_id ON job_availability_reports(job_id);
CREATE INDEX IF NOT EXISTS idx_jar_status_reported ON job_availability_reports(status, reported_at DESC);

ALTER TABLE job_availability_reports ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='job_availability_reports' AND policyname='own_reports') THEN
    CREATE POLICY "own_reports" ON job_availability_reports
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
