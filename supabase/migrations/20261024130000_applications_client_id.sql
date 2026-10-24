-- Idempotent add_application (audit 3, H4: one client request produced two applications rows
-- 700 ms apart during the 2026-10-24 production stall).
--
-- The tracker already sends its own id for every new application ("app_<ms>"). It is stored here
-- and made unique per user, so a retried or replayed add_application finds the row it already
-- created instead of inserting a second one (api/user-sync.js add_application).
--
-- Additive and backward-compatible: api/user-sync.js works before AND after this is applied (it
-- probes for the column and falls back to a natural-key check — same user, company, role and
-- applied_at within 15 minutes — until the column exists). Deploy the code first, then apply this.

ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS client_id text;

-- Partial: rows written before this migration (and server-created rows with no client id) stay NULL.
CREATE UNIQUE INDEX IF NOT EXISTS applications_user_client_id_key
  ON public.applications (user_id, client_id)
  WHERE client_id IS NOT NULL;
