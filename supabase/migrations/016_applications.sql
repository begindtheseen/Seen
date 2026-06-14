-- Application tracking tables for SeenJobs behavioral flywheel. Safe to run multiple times.

-- ── applications ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS applications (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES auth.users,
  company           text        NOT NULL,
  role              text        NOT NULL,
  job_id            text,
  applied_at        timestamptz,
  source            text        DEFAULT 'seen',
  resume_optimized  boolean     DEFAULT false,
  stage             text        DEFAULT 'considering',
  status            text        DEFAULT 'active',
  next_check_due_at timestamptz,
  closed_at         timestamptz,
  final_outcome     text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'applications'
      AND indexname  = 'idx_applications_user_id'
  ) THEN
    CREATE INDEX idx_applications_user_id ON applications (user_id, created_at DESC);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'applications'
      AND indexname  = 'idx_applications_stage'
  ) THEN
    CREATE INDEX idx_applications_stage ON applications (stage, status);
  END IF;
END $$;

ALTER TABLE applications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'applications'
      AND policyname = 'own_applications'
  ) THEN
    CREATE POLICY own_applications ON applications
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- ── application_events ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS application_events (
  id              bigserial   PRIMARY KEY,
  application_id  uuid        NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL,
  event_type      text        NOT NULL,
  event_date      timestamptz NOT NULL DEFAULT now(),
  stage_before    text,
  stage_after     text,
  confidence      text        DEFAULT 'low',
  source          text        DEFAULT 'user_reported',
  trust_weight    float       DEFAULT 0.3,
  metadata        jsonb       DEFAULT '{}',
  anomaly_flags   text[]      DEFAULT '{}',
  created_at      timestamptz DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'application_events'
      AND indexname  = 'idx_app_events_app_id'
  ) THEN
    CREATE INDEX idx_app_events_app_id ON application_events (application_id, event_date DESC);
  END IF;
END $$;

ALTER TABLE application_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'application_events'
      AND policyname = 'own_app_events'
  ) THEN
    CREATE POLICY own_app_events ON application_events
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
