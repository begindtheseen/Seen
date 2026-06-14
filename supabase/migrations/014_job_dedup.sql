-- Prevent duplicate job listings.
-- Run AFTER using the admin dedup panel to clean existing duplicates,
-- otherwise the index creation will fail on current dupes.
--
-- Root cause: Adzuna returns different redirect_url tracking params per search,
-- so the same job matched by multiple queries has different apply_url values.
-- The true duplicate key is (title, company, city) case-insensitive.

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_title_company_city_dedup
  ON jobs(lower(title), lower(company), lower(city));
