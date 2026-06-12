-- Feature flags — controls rollout of new features without deploys.
-- Each flag can be: off | admin_only | beta_users | percentage_rollout | fully_on
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS feature_flags (
  flag_name     text PRIMARY KEY,
  status        text NOT NULL DEFAULT 'off'
                  CHECK (status IN ('off','admin_only','beta_users','percentage_rollout','fully_on')),
  percentage    integer DEFAULT 0 CHECK (percentage BETWEEN 0 AND 100),
  description   text,
  updated_by    text,
  updated_at    timestamptz DEFAULT now()
);

-- Seed defaults — never overwrite existing values
INSERT INTO feature_flags (flag_name, status, description) VALUES
  ('outcome_cards_v2_enabled',            'off',        'Outcome card v2 generation and sharing'),
  ('ai_credit_system_enabled',            'admin_only', 'AI credit earning/spending system'),
  ('resume_question_engine_enabled',      'admin_only', 'Resume-based credit-earning questions'),
  ('admin_panel_enabled',                 'admin_only', 'Admin panel visibility and access'),
  ('duplicate_detection_enabled',         'admin_only', 'Duplicate account detection and clustering'),
  ('company_confidence_matching_enabled', 'fully_on',   'Company match confidence display'),
  ('hiring_forecast_enabled',             'off',        'Hiring forecast and demand predictions')
ON CONFLICT (flag_name) DO NOTHING;

-- Verification: SELECT flag_name, status FROM feature_flags ORDER BY flag_name;
