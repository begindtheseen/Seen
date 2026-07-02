-- Migration 039: reports.user_id — the column every first-party write path sends but prod
-- never had. Its absence made PostgREST reject ENTIRE inserts from submit / quick_submit /
-- create_from_tracker / survey writeReport (errors swallowed) — first-party reports never
-- persisted. Nullable + ON DELETE SET NULL so contributed intel is auto-anonymized (never
-- destroyed) when an account is deleted, enforcing the preservation policy at the DB level.
-- Hand-applied to prod 2026-07-02 (verified: column exists, FK ON DELETE SET NULL); this
-- file codifies it idempotently.
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_reports_user_id ON public.reports(user_id) WHERE user_id IS NOT NULL;
