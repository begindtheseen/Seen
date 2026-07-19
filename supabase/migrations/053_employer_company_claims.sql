-- Migration 053: employer → company claims (ADMIN-APPROVED CLAIMS model).
--
-- THE MODEL (the assumed decision — owner can redirect; see the PR):
--   An employer account (profiles.account_type = 'employer', migration 050) does NOT
--   automatically get access to a company just because their name or email looks like a match —
--   that would leak a competitor's data (anyone signing up as "Amazon" would see Amazon's view).
--   Instead an employer REQUESTS to claim a company, and an ADMIN approves it. Only an APPROVED
--   claim grants that employer login-scoped access to THAT company's employer surfaces.
--
--   This same table delivers the owner's ADMIN GOD-VIEW: admins approve/reject claims here, and
--   (in the app) can open any company's employer view without being that company — the claim is
--   the identity link; the admin is the trust authority.
--
-- WHAT A "COMPANY" IS in this codebase: there is no companies table with a stable UUID — a company
--   is identified by its NAME. company_scores has a UNIQUE constraint on company_name in canonical
--   form (lower(trim(...)), migration 023) and every employer surface (reputation, dashboard,
--   analytics, notifications) scopes by ?company=<name>. So a claim references a company by its
--   canonical name (`company_name`) — the same durable key company_scores uses — and keeps the
--   employer's typed spelling (`company_display_name`) for display + as the value fed to the
--   surfaces' ?company= param. A claim does NOT require a company_scores row to exist yet (a company
--   with no reports is still claimable) — company_scores.company_name is the shared canonical key,
--   not a hard foreign key, exactly as the surfaces already treat it.
--
-- APPROVALS ARE ADMIN-ONLY: the app's admins authenticate with a separate X-Admin-Token session
--   (api/admin-stats.js → admin_sessions), NOT a Supabase auth user, and operate through the
--   service key (RLS bypassed). So status changes are made by the service-key admin endpoint
--   (api/employer-claims.js). RLS below gives NO update/delete path to anon/authenticated, so a
--   logged-in employer can never approve their own claim — only read/create their own.
--
-- Idempotent: safe to re-run. NOTE (owner applies this migration — the agent never does).

CREATE TABLE IF NOT EXISTS employer_company_claims (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The employer (auth.users.id === profiles.id). Defaults to the caller so a direct anon-key
  -- insert can't spoof another user (the RLS WITH CHECK also pins it to auth.uid()).
  user_id               uuid        NOT NULL DEFAULT auth.uid(),
  -- Canonical company key: lower(trim(...)) with internal whitespace collapsed. Matches how
  -- company_scores stores company_name (migration 023) and is what uniqueness is enforced on.
  company_name          text        NOT NULL,
  -- The name as the employer typed it — for admin readability + the ?company= value the surfaces
  -- consume (their lookups are case-insensitive ilike / normalize internally).
  company_display_name  text,
  status                text        NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  reviewed_at           timestamptz,
  reviewed_by           text,        -- admin username that approved/rejected (audit trail)
  note                  text         -- optional admin note / rejection reason
);

-- One employer has at most ONE approved company (the login-scoping target is unambiguous).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_claim_one_approved_per_user
  ON employer_company_claims (user_id)
  WHERE status = 'approved';

-- At most one employer approved per company (two employers can't both own "Amazon").
CREATE UNIQUE INDEX IF NOT EXISTS uniq_claim_one_approved_per_company
  ON employer_company_claims (company_name)
  WHERE status = 'approved';

-- No duplicate ACTIVE (pending or approved) claim for the same user+company — re-requesting a
-- company you already have pending/approved is a no-op the DB refuses.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_claim_active_user_company
  ON employer_company_claims (user_id, company_name)
  WHERE status IN ('pending', 'approved');

-- Admin queue: pending first, newest first.
CREATE INDEX IF NOT EXISTS idx_claims_status_created
  ON employer_company_claims (status, created_at DESC);

-- The employer's own lookup (auth.tsx resolves their approved company on login).
CREATE INDEX IF NOT EXISTS idx_claims_user
  ON employer_company_claims (user_id, created_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- The app reads/writes claims via the service key (bypasses RLS); these policies are the
-- defense-in-depth boundary for any direct anon-key access:
--   • an employer SELECTs only their own claims,
--   • an employer INSERTs only their own claim, only in 'pending' state,
--   • there is NO authenticated UPDATE/DELETE policy → approvals/rejections are admin-only.
ALTER TABLE employer_company_claims ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'employer_company_claims' AND policyname = 'claims_select_own'
  ) THEN
    CREATE POLICY claims_select_own ON employer_company_claims
      FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'employer_company_claims' AND policyname = 'claims_insert_own_pending'
  ) THEN
    -- Ownership + pending-only are pinned here; the "must be an employer account" rule is
    -- enforced by the server endpoint (which reads profiles.account_type with the service key),
    -- avoiding a cross-table RLS subquery dependency on the profiles policy.
    CREATE POLICY claims_insert_own_pending ON employer_company_claims
      FOR INSERT
      WITH CHECK (auth.uid() = user_id AND status = 'pending');
  END IF;
END $$;
