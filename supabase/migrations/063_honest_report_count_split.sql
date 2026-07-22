-- 063_honest_report_count_split.sql  (applied to prod 2026-07-22 via MCP)
--
-- company_scores.report_count conflated two different things under one number:
-- real applicant-report rows AND the LLM web-research pipeline's *claimed* mention count
-- (unbounded, floored ≥1 — observed 12,775 for one company while the entire reports table
-- held 147 rows). Split it so every surface can label honestly:
--   first_party_report_count — count of real resolved report rows behind the score
--   web_report_count         — the clamped web-research claim (NEVER applicant reports)
-- report_count remains the fused total for scoring math / back-compat.

alter table public.company_scores add column if not exists first_party_report_count integer;
alter table public.company_scores add column if not exists web_report_count integer;

-- Backfill legacy rows from data_source: only 'reports'-derived scores were computed from real
-- rows; everything else ('web_search'/null) is a web claim. (Mixed fused rows self-correct on
-- their next recompute — this backfill deliberately errs toward NOT claiming first-party.)
update public.company_scores set
  first_party_report_count = case when data_source = 'reports' then coalesce(report_count, 0) else 0 end,
  web_report_count         = case when data_source = 'reports' then 0 else coalesce(report_count, 0) end
where first_party_report_count is null;
