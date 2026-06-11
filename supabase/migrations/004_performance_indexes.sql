-- Performance indexes for 10k+ users
-- Run in Supabase SQL Editor

-- applications: all user queries filter by user_id
CREATE INDEX IF NOT EXISTS idx_applications_user_id
  ON applications(user_id);

-- applications: dashboard sorts by created_at desc
CREATE INDEX IF NOT EXISTS idx_applications_user_created
  ON applications(user_id, created_at DESC);

-- applications: status filters (active/ghosted/hired/rejected)
CREATE INDEX IF NOT EXISTS idx_applications_user_status
  ON applications(user_id, status);

-- saved_jobs: all user queries filter by user_id
CREATE INDEX IF NOT EXISTS idx_saved_jobs_user_id
  ON saved_jobs(user_id);

-- saved_jobs: dedup check on (user_id, job_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_jobs_user_job
  ON saved_jobs(user_id, job_id);

-- jobs cache: primary lookup pattern — search_query + expires_at
CREATE INDEX IF NOT EXISTS idx_jobs_search_query
  ON jobs(search_query);

CREATE INDEX IF NOT EXISTS idx_jobs_search_expires
  ON jobs(search_query, expires_at DESC);

-- jobs cache: keyword fallback filters on title and company
CREATE INDEX IF NOT EXISTS idx_jobs_title
  ON jobs USING gin(to_tsvector('english', title));

CREATE INDEX IF NOT EXISTS idx_jobs_company
  ON jobs(company);

-- jobs cache: expiry cleanup
CREATE INDEX IF NOT EXISTS idx_jobs_expires_at
  ON jobs(expires_at);

-- reports: primary company lookup (company_name column)
CREATE INDEX IF NOT EXISTS idx_reports_company_name
  ON reports(company_name);

-- reports: feed query (ordered by created_at desc)
CREATE INDEX IF NOT EXISTS idx_reports_created_at
  ON reports(created_at DESC);

-- reports: outcome filter + created_at for feed
CREATE INDEX IF NOT EXISTS idx_reports_outcome_created
  ON reports(outcome, created_at DESC);

-- reports: company_id FK lookups (fallback path)
CREATE INDEX IF NOT EXISTS idx_reports_company_id
  ON reports(company_id);

-- companies: name search (ilike queries)
CREATE INDEX IF NOT EXISTS idx_companies_name
  ON companies(name);

-- company_locations: FK from reports
CREATE INDEX IF NOT EXISTS idx_company_locations_company_id
  ON company_locations(company_id);

-- profiles: PK is id (already indexed), but ensure resume queries are fast
-- profiles.id is the PK so no additional index needed

-- query_expansions: canonical lookup
CREATE INDEX IF NOT EXISTS idx_query_expansions_raw
  ON query_expansions(raw_query);

-- search_logs: analytics queries by created_at
CREATE INDEX IF NOT EXISTS idx_search_logs_created_at
  ON search_logs(created_at DESC);

-- rate_limits: already has primary key on key column
-- expires_at index already in 001_rate_limits.sql
