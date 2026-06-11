-- Login signal collection for duplicate account detection.
-- Stores one row per session load: IP + user_agent.
-- No RLS — service key only. Users cannot query their own signals.
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS login_signals (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL,
  ip_address  text,
  user_agent  text,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_signals_user    ON login_signals(user_id);
CREATE INDEX IF NOT EXISTS idx_login_signals_ip      ON login_signals(ip_address);
CREATE INDEX IF NOT EXISTS idx_login_signals_created ON login_signals(created_at DESC);

-- Suspected duplicate account clusters identified by admin or auto-detection.
CREATE TABLE IF NOT EXISTS duplicate_clusters (
  id          bigserial PRIMARY KEY,
  user_ids    uuid[]  NOT NULL,
  signals     text[], -- shared signals: 'ip:1.2.3.4', 'ua_hash:abc', 'resume_hash:xyz'
  risk_score  integer DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
  status      text DEFAULT 'suspected'
                CHECK (status IN ('suspected','safe','watching','limited','frozen','suspended')),
  admin_note  text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dup_clusters_status ON duplicate_clusters(status);
CREATE INDEX IF NOT EXISTS idx_dup_clusters_risk   ON duplicate_clusters(risk_score DESC);
CREATE INDEX IF NOT EXISTS idx_dup_clusters_created ON duplicate_clusters(created_at DESC);

-- Purge signals older than 90 days (run via cron or manually)
-- SELECT purge_old_signals();
CREATE OR REPLACE FUNCTION purge_old_signals() RETURNS void
  LANGUAGE SQL AS $$ DELETE FROM login_signals WHERE created_at < NOW() - INTERVAL '90 days'; $$;

-- Verification:
-- SELECT COUNT(*) FROM login_signals;
-- SELECT COUNT(*) FROM duplicate_clusters;
