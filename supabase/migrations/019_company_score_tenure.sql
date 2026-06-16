-- Résumé-derived employee tenure as a company-score signal.
--
-- The Opportunity Engine + résumé parsing give us employment history
-- (company, start_date, end_date) per user in resume_employment. The
-- `update_tenure` job (api/reports.js) averages tenure per company and writes
-- it here; the scoring engine (api/_utils/companyScore.js) folds it into the
-- overall score as a bounded, sample-gated adjustment.
--
-- Additive + idempotent. Existing scores are unaffected until tenure is populated.

ALTER TABLE company_scores ADD COLUMN IF NOT EXISTS avg_tenure_months   numeric(6,1);
ALTER TABLE company_scores ADD COLUMN IF NOT EXISTS tenure_sample_count integer DEFAULT 0;
