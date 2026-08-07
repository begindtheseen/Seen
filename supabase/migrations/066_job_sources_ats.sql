-- 066 — Multi-source job ingestion: employer-direct ATS provenance + a self-growing source registry.
--
-- Two additive, zero-risk changes (new nullable columns + one new table — no existing query
-- references them, so nothing can break):
--   1. jobs gains provenance columns so a listing records WHICH ATS/provider supplied it and its
--      requisition id — this is how employer-direct listings are distinguished from aggregator
--      (Adzuna) ones in ranking + admin diagnostics, and how the same requisition dedups.
--   2. company_sources — the registry that makes Seen self-growing. Every time a search reveals an
--      employer's ATS tenant (a Greenhouse board, a Lever account, …), it's recorded here so the
--      scheduled refresh can ingest that employer DIRECTLY forever, without a human adding it.

-- ── jobs provenance (all nullable → safe on existing rows) ──────────────────────────────────
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source_type text;      -- EMPLOYER_DIRECT | ATS_DIRECT | JOB_BOARD | AGGREGATOR | DISCOVERY_SOURCE | UNKNOWN
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ats_provider text;     -- greenhouse | lever | ashby | ...
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ats_tenant text;       -- the employer's tenant id on that ATS
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS external_id text;      -- the provider's requisition / posting id
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS canonical_url text;    -- employer-direct apply URL when known (preferred over an aggregator redirect)

-- ── company_sources — the employer/ATS source registry ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_sources (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid REFERENCES companies(id) ON DELETE SET NULL,
  company_name          text NOT NULL,
  provider              text NOT NULL,                 -- greenhouse | lever | ashby | smartrecruiters | workable | recruitee | workday | ...
  tenant                text NOT NULL,                 -- the employer's identifier on that provider
  careers_url           text,
  source_type           text NOT NULL DEFAULT 'ATS_DIRECT',
  ingestable            boolean NOT NULL DEFAULT true,  -- does Seen have a safe public-JSON provider for it?
  status                text NOT NULL DEFAULT 'active', -- active | degraded | disabled | dead
  confidence            real NOT NULL DEFAULT 0.7,
  job_count             integer NOT NULL DEFAULT 0,
  consecutive_failures  integer NOT NULL DEFAULT 0,
  first_discovered_at   timestamptz NOT NULL DEFAULT now(),
  last_verified_at      timestamptz,
  last_successful_sync  timestamptz,
  discovered_via        text,                          -- 'search' | 'seed' | 'crawl' | 'manual'
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- One registry row per (provider, tenant) — the idempotent upsert target for snowball discovery.
CREATE UNIQUE INDEX IF NOT EXISTS company_sources_provider_tenant_uniq ON company_sources (provider, tenant);
-- Scheduled ingestion picks the freshest ingestable active sources first.
CREATE INDEX IF NOT EXISTS company_sources_sync_idx ON company_sources (ingestable, status, last_successful_sync);
CREATE INDEX IF NOT EXISTS company_sources_company_idx ON company_sources (lower(company_name));

-- Server-only table (service key). RLS on with no policy = deny all anon/auth access (intentional,
-- matches Seen's other server-only tables); the service role bypasses RLS.
ALTER TABLE company_sources ENABLE ROW LEVEL SECURITY;

-- Diagnostics helper index: employer-direct vs aggregator distribution over active jobs.
CREATE INDEX IF NOT EXISTS jobs_source_type_idx ON jobs (source_type) WHERE source_type IS NOT NULL;
