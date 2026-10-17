-- Migration 20261017120100: company_summaries — one plain-language, data-grounded summary per company.
--
-- WHY (GEO "real-data-first for AI citations"): a company page should lead with a short, quotable
-- paragraph that search engines and AI answer engines can cite. These rows are produced OFFLINE by
-- scripts/credit/company-summaries.mjs (one-time Message Batches run) from ONLY Seen's own data —
-- company_scores stats, report outcome counts by source, and a sample of report_text — and every
-- number in a summary is post-validated against those stats before it is written (rows that fail
-- the numeric-grounding check are rejected, never stored).
--
-- KEY: company_name uses the SAME canonical form company_scores.company_name does — lower(trim(...))
-- (migration 023, enforced by company_scores_company_name_key) — so the page reads the summary with
-- the stored score name it already holds. Not a hard FK: company_scores rows are deleted by merges
-- (api/admin-stats.js mergeCompanyPair) and a dangling summary must not block that delete; the
-- reader only renders a summary when status = 'ok', and the generator re-checks report_count.
--
-- ANTI-GAMING: a summary is a description of self-reported / community CLAIMS, never a score input.
-- Nothing reads this table to compute a grade, and money never changes it.
--
-- READ PATH: the company page is SSR (app/company/[slug]/layout.tsx → lib/companySummary.ts) and
-- reads with the SERVICE key, exactly like company_scores via lib/growth.ts. So this table is
-- server-only: RLS ON with NO policies and anon/authenticated revoked — the same pattern as
-- company_reddit_cache (054) and company_merges (040). service_role bypasses RLS.
--
-- DEPLOY ORDER (CLAUDE.md "deploy code before schema"): the page code tolerates this table being
-- absent (a failed read renders nothing), so it is safe to deploy the code first. Additive and
-- idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS public.company_summaries (
  company_name               text        PRIMARY KEY,              -- = company_scores.company_name (lower(trim))
  summary                    text        NULL,                     -- 2–4 sentences; NULL when insufficient_data
  highlights                 jsonb       NOT NULL DEFAULT '[]'::jsonb, -- [{ label, value, basis }]
  report_count_at_generation integer     NOT NULL DEFAULT 0,       -- first-party report rows the summary was built from
  data_basis                 text        NULL,                     -- human-readable sample basis, e.g. "42 applicant reports (12 from public Reddit discussion)"
  model                      text        NULL,                     -- generating model id
  generated_at               timestamptz NOT NULL DEFAULT now(),
  status                     text        NOT NULL DEFAULT 'ok'
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_summaries_status_check') THEN
    ALTER TABLE public.company_summaries
      ADD CONSTRAINT company_summaries_status_check CHECK (status IN ('ok', 'insufficient_data'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_summaries_highlights_array') THEN
    ALTER TABLE public.company_summaries
      ADD CONSTRAINT company_summaries_highlights_array CHECK (jsonb_typeof(highlights) = 'array');
  END IF;
  -- An 'ok' row must carry text; the page renders summary only for status = 'ok'.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_summaries_ok_has_summary') THEN
    ALTER TABLE public.company_summaries
      ADD CONSTRAINT company_summaries_ok_has_summary CHECK (status <> 'ok' OR (summary IS NOT NULL AND length(summary) > 0));
  END IF;
END $$;

-- Refresh planning: find the stalest summaries first on a re-run.
CREATE INDEX IF NOT EXISTS idx_company_summaries_generated ON public.company_summaries (generated_at);

ALTER TABLE public.company_summaries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.company_summaries FROM anon, authenticated;

COMMENT ON TABLE public.company_summaries IS
  'Offline, numerically-grounded plain-language company summaries (scripts/credit/company-summaries.mjs). Display-only, never a score input. Service-key only (deny-all RLS).';
