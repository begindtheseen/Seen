-- Migration 040: company_merges — an append-only audit log of every company merge,
-- written BEFORE any mutation so a merge is always reversible.
--
-- The merge routine (api/admin-stats.js action `merge` / `auto_merge`) snapshots both
-- the secondary company_scores row (deleted by the merge) and the primary row's
-- pre-merge web-context fields, records which report ids were remapped and which
-- companies-table ids the secondary resolved to, and stores the alias it added. The
-- `undo_merge` action replays those facts in reverse: re-insert the secondary score,
-- re-point the moved reports, drop the alias, restore the primary's web context, then
-- recompute BOTH companies' scores from the (restored) report corpus.
--
-- SECURITY: RLS enabled with NO policies → deny-all to anon/authenticated, matching the
-- pattern in migrations 020/028/030/032. The server (api/admin-stats.js) reads/writes
-- this table with the SERVICE key (service_role BYPASSES RLS). Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS public.company_merges (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz DEFAULT now(),
  admin_id            uuid        NULL,   -- admin_accounts.id that performed the merge
  primary_score_id    uuid        NULL,   -- surviving company_scores.id
  primary_name        text        NULL,   -- surviving display name
  secondary_score_id  uuid        NULL,   -- absorbed (deleted) company_scores.id
  secondary_name      text        NULL,   -- absorbed display name
  secondary_row       jsonb       NULL,   -- full snapshot of the deleted secondary row
  primary_row_before  jsonb       NULL,   -- full snapshot of the primary row pre-merge
  moved_report_ids    uuid[]      NULL,   -- reports remapped secondary → primary
  secondary_company_ids uuid[]    NULL,   -- companies-table ids the secondary resolved to
  aliases_added       text[]      NULL,   -- company_aliases.alias values inserted by the merge
  undone_at           timestamptz NULL,   -- set when the merge is reversed
  undone_by           uuid        NULL    -- admin_accounts.id that reversed it
);

CREATE INDEX IF NOT EXISTS idx_company_merges_created
  ON public.company_merges (created_at DESC);

ALTER TABLE public.company_merges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.company_merges FROM anon, authenticated;

COMMENT ON TABLE public.company_merges IS
  'Append-only merge audit log — snapshots enable undo_merge. Service-key only (deny-all RLS).';
