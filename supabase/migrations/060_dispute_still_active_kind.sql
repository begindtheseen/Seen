-- Migration 060: 'still_active' listing-dispute kind — the employer's answer to a seeker report.
--
-- WHY: a seeker reports a listing inactive (job_availability_reports) and the employer is
-- notified — but the dispute kinds (migration 056) only let an employer say a listing IS
-- inactive/needs edits/isn't theirs. There was no kind meaning "this report is WRONG — the
-- listing is still active." That's the other half of the correction loop: the seeker's report
-- and the employer's rebuttal meet in ONE admin dispute (referenced by its dispute number,
-- listing_disputes.id) where the admin rules with both sides in view.
--
-- Effect on approval (api/admin-stats.js resolve_listing_dispute): the seeker reports for the
-- listing are cleared and the listing is re-marked active. On denial the reports stand.
-- Idempotent (drop + re-add the CHECK).

ALTER TABLE public.listing_disputes DROP CONSTRAINT IF EXISTS listing_disputes_kind_chk;
ALTER TABLE public.listing_disputes ADD CONSTRAINT listing_disputes_kind_chk
  CHECK (kind IN ('inactive','delete','edit','not_ours','other','still_active'));
