-- Migration 047: suppressed listings — a real "delete" for live/ephemeral search results.
--
-- Live search results are pulled from external sources on the fly and carry client-generated
-- ephemeral ids (j_<hash>); they are never rows in the jobs table, so the admin's soft-delete
-- (which expires a jobs row) has nothing to act on. When an admin reviews a reported ephemeral
-- listing and confirms it's dead, we record its apply_url here; the job-search read path filters
-- these out so a re-search can't resurface the same dead posting. Keyed by apply_url because that
-- is the one stable identifier a live listing carries across searches. Server-only (RLS on, no
-- policy) — written by the admin endpoint via the service key.

CREATE TABLE IF NOT EXISTS suppressed_listings (
  apply_url     text        PRIMARY KEY,
  stable_job_id text,
  title         text,
  company       text,
  reason        text        NOT NULL DEFAULT 'admin_removed',
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE suppressed_listings ENABLE ROW LEVEL SECURITY;
