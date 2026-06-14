-- Prevent duplicate job listings by apply_url.
-- Run AFTER using the admin dedup panel to remove existing duplicates,
-- otherwise this index creation will fail on the current dupes.
--
-- What this does:
--   Exact same apply_url = same job posting. Block re-insertion at DB level.
--   The refresh-jobs upsert uses "resolution=merge-duplicates" which will
--   now correctly update existing rows instead of inserting duplicates.

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_apply_url_dedup
  ON jobs(apply_url)
  WHERE apply_url IS NOT NULL
    AND availability_status NOT IN ('removed', 'expired');
