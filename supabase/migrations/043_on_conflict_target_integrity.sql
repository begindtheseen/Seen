-- 043 — on_conflict target integrity: every PostgREST upsert target gets its unique index.
--
-- PostgREST `on_conflict=<cols>` upserts REQUIRE a matching unique index/constraint; without
-- one, Postgres rejects the statement outright and the write fails (usually swallowed by a
-- fire-and-forget .catch). A prod sweep (2026-07-03) of every `on_conflict=` in the codebase
-- found exactly ONE drifted target:
--
--   • company_aliases(alias) — used by the company-merge flow
--     (api/admin-stats.js `company_aliases?on_conflict=alias` + resolution=merge-duplicates).
--     No unique index existed on prod, so every merge's alias upsert silently 400'd and the
--     alias was never recorded (breaking future resolve-suggestions for the absorbed name).
--
-- All other targets verified present on prod: saved_jobs(user_id,job_id),
-- job_availability_reports(user_id,job_id) [job_avail_reports_user_job_idx — migration 015's
-- table-level UNIQUE never applied because CREATE TABLE IF NOT EXISTS no-oped, but the index
-- was added separately], profiles(id), ai_credits(user_id), demand_data(city,role_title),
-- company_scores(company_name), feature_flags(flag_name).
--
-- Idempotent AND name-agnostic: each block checks for a unique index on the COLUMN SET (not
-- an index name), dedupes first, and only then creates. Safe on fresh environments and on
-- prod alike; re-running is a no-op.

-- ── company_aliases(alias) ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    WHERE c.relname = 'company_aliases' AND i.indisunique
      AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
           FROM unnest(i.indkey) k JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k)
          = ARRAY['alias']
  ) THEN
    -- Collapse duplicate aliases, keeping the newest row (latest created_at, tie-break id).
    DELETE FROM company_aliases a
    USING company_aliases b
    WHERE a.alias = b.alias
      AND (a.created_at < b.created_at OR (a.created_at = b.created_at AND a.id < b.id));
    CREATE UNIQUE INDEX company_aliases_alias_uniq ON company_aliases (alias);
  END IF;
END $$;

-- ── job_availability_reports(user_id, job_id) ─────────────────────────────────────────
-- Present on prod already (job_avail_reports_user_job_idx); this block exists so a fresh /
-- restored environment converges without creating a redundant second index on prod.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    WHERE c.relname = 'job_availability_reports' AND i.indisunique
      AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
           FROM unnest(i.indkey) k JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k)
          = ARRAY['job_id','user_id']
  ) THEN
    DELETE FROM job_availability_reports a
    USING job_availability_reports b
    WHERE a.user_id = b.user_id
      AND a.job_id  = b.job_id
      AND (a.reported_at < b.reported_at OR (a.reported_at = b.reported_at AND a.id < b.id));
    CREATE UNIQUE INDEX job_avail_reports_user_job_idx ON job_availability_reports (user_id, job_id);
  END IF;
END $$;
