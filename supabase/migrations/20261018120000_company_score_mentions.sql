-- "What people are saying" counts toward company scores (owner request 2026-10-18).
-- mention_count = how many quoted online accounts (company_scores.web_reviews) state a hiring outcome
-- (ghosted / heard back). They feed the rates at low trust (companyIntel SOURCE_TRUST.mentions) and
-- count toward the 5-item grade bar, but they are NOT report rows, so first_party_report_count is
-- unchanged. Additive with a default: the code detects the column and works with or without it.
ALTER TABLE public.company_scores ADD COLUMN IF NOT EXISTS mention_count integer NOT NULL DEFAULT 0;
