-- Employer listing edits, "hired → close the listing", and retention of declined applications
-- (owner request 2026-10-18).
--
--   jobs.edited_at                  last time the employer edited the listing (NULL = never). Shown as
--                                   "Edited <date>" on the listing, and on any application sent before it.
--   seen_applications.decided_at    when the application got a final status (hired / rejected / withdrawn).
--                                   The retention clock starts here.
--   seen_applications.purged_at     set when the employer's copy of a declined or withdrawn application
--                                   is cleared 30 days after the decision (lib/server/applicationRetention.js):
--                                   résumé file + text, contact details and note are removed; the status
--                                   and dates stay for response-time stats, and the conversation stays
--                                   because it is the applicant's record too (their tracker reads it).
--
-- Additive and backward-compatible: the running code checks for these columns
-- (lib/server/seenApplyStore.js lifecycleAvailable) and offers none of the new actions until they
-- exist. Idempotent.

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE public.seen_applications ADD COLUMN IF NOT EXISTS decided_at timestamptz;
ALTER TABLE public.seen_applications ADD COLUMN IF NOT EXISTS purged_at timestamptz;

-- Applications already decided before this migration start their clock at their last update.
UPDATE public.seen_applications
   SET decided_at = updated_at
 WHERE decided_at IS NULL AND status IN ('hired', 'rejected', 'withdrawn');

-- The retention sweep's scan: declined/withdrawn rows not yet cleared, oldest decision first.
CREATE INDEX IF NOT EXISTS idx_seen_applications_retention
  ON public.seen_applications (decided_at)
  WHERE purged_at IS NULL AND status IN ('rejected', 'withdrawn');
