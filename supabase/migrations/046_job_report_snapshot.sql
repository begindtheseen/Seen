-- Migration 046: capture a snapshot of WHAT was reported on a job-availability report.
--
-- Live/aggregated search results carry client-generated ephemeral ids ("j_<hash>", lib/jobId.ts)
-- and are never persisted to the jobs table. When a user reports one as inactive, the report row
-- is saved but the admin panel has no jobs-table row to join to — so it could only show the opaque
-- id and "not in the job board". These nullable columns store a lightweight snapshot of the
-- listing at report time (sent by the client, which is viewing it), so the admin can see exactly
-- what was flagged even for a listing that was never stored. Additive + nullable — safe on reruns,
-- no backfill needed (older reports simply have null snapshot fields).

ALTER TABLE job_availability_reports ADD COLUMN IF NOT EXISTS company   text;
ALTER TABLE job_availability_reports ADD COLUMN IF NOT EXISTS title     text;
ALTER TABLE job_availability_reports ADD COLUMN IF NOT EXISTS city      text;
ALTER TABLE job_availability_reports ADD COLUMN IF NOT EXISTS apply_url text;
