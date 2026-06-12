-- AI Credit System + Resume Intelligence + Internal Admin
-- Safe to run multiple times.

-- ── AI Credits ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_credits (
  user_id     uuid    PRIMARY KEY,
  balance     integer NOT NULL DEFAULT 3,
  daily_earned integer NOT NULL DEFAULT 0,
  last_reset  date    NOT NULL DEFAULT CURRENT_DATE,
  pro         boolean NOT NULL DEFAULT false,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE ai_credits ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ai_credits' AND policyname='own_credits') THEN
    CREATE POLICY "own_credits" ON ai_credits USING (auth.uid() = user_id);
  END IF;
END $$;

-- ── Credit Transactions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_transactions (
  id         bigserial   PRIMARY KEY,
  user_id    uuid        NOT NULL,
  delta      integer     NOT NULL,
  reason     text        NOT NULL,
  metadata   jsonb       DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_credit_tx_user ON credit_transactions(user_id, created_at DESC);
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='credit_transactions' AND policyname='own_tx') THEN
    CREATE POLICY "own_tx" ON credit_transactions USING (auth.uid() = user_id);
  END IF;
END $$;

-- ── Resume Employment History ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resume_employment (
  id         bigserial   PRIMARY KEY,
  user_id    uuid        NOT NULL,
  company    text        NOT NULL,
  title      text,
  start_date text,
  end_date   text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_resume_emp_user ON resume_employment(user_id);
ALTER TABLE resume_employment ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='resume_employment' AND policyname='own_employment') THEN
    CREATE POLICY "own_employment" ON resume_employment USING (auth.uid() = user_id);
  END IF;
END $$;

-- ── Answered Questions (credit-earning dedup) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS answered_questions (
  user_id      uuid  NOT NULL,
  question_key text  NOT NULL,
  answer       text  NOT NULL,
  created_at   timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, question_key)
);
ALTER TABLE answered_questions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='answered_questions' AND policyname='own_answers') THEN
    CREATE POLICY "own_answers" ON answered_questions USING (auth.uid() = user_id);
  END IF;
END $$;

-- ── Admin Accounts (separate from Supabase auth) ──────────────────────────────
CREATE TABLE IF NOT EXISTS admin_accounts (
  id             bigserial PRIMARY KEY,
  username       text      UNIQUE NOT NULL,
  password_hash  text      NOT NULL,
  salt           text      NOT NULL,
  role           text      NOT NULL DEFAULT 'admin' CHECK (role IN ('super_admin','admin','moderator')),
  is_active      boolean   NOT NULL DEFAULT true,
  created_at     timestamptz DEFAULT now(),
  last_login     timestamptz,
  login_attempts integer   NOT NULL DEFAULT 0,
  locked_until   timestamptz
);
-- No public access — service key only
ALTER TABLE admin_accounts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='admin_accounts' AND policyname='no_public') THEN
    CREATE POLICY "no_public" ON admin_accounts USING (false);
  END IF;
END $$;

-- ── Admin Sessions ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_sessions (
  token      text      PRIMARY KEY,
  admin_id   bigint    NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
  role       text      NOT NULL,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '8 hours'),
  ip_address text
);
CREATE INDEX IF NOT EXISTS idx_admin_sess_exp ON admin_sessions(expires_at);
ALTER TABLE admin_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='admin_sessions' AND policyname='no_public') THEN
    CREATE POLICY "no_public" ON admin_sessions USING (false);
  END IF;
END $$;

-- ── Admin Audit Log ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          bigserial PRIMARY KEY,
  admin_id    bigint    REFERENCES admin_accounts(id),
  username    text      NOT NULL,
  action      text      NOT NULL,
  target_type text,
  target_id   text,
  metadata    jsonb     DEFAULT '{}',
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_time ON admin_audit_log(created_at DESC);
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='admin_audit_log' AND policyname='no_public') THEN
    CREATE POLICY "no_public" ON admin_audit_log USING (false);
  END IF;
END $$;
