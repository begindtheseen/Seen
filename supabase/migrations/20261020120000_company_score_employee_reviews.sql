-- How many employee reviews a stored company score was built with (lib/server/employeeReviews.js).
-- Employee reviews move the grade by their letter grades (api/_utils/companyScore.js
-- employeeReviewAdjustment, bounded ±5) and are shown next to the applicant-report count. Nullable and
-- additive: code probes for the column (lib/server/scoreColumns.js hasEmployeeReviewCount) and works
-- before and after it exists. A NULL on an existing row is repaired on the next view (the score cache
-- staleness check compares it with the live count and recomputes).
alter table public.company_scores add column if not exists employee_review_count integer;
