-- job_enrichment: allow day / week / month pay periods.
--
-- The 200-job pilot (2026-10-17) showed weekly pay is common in the corpus (travel nursing, truck
-- driving: "$2,764 per week") and had nowhere to go but 'unknown'. Widen the CHECK so the stated
-- unit is kept as-is (the tagger never converts between units). Only touches the table added by
-- 20261017120000_job_enrichment.sql; existing values all remain valid. Idempotent.

alter table public.job_enrichment drop constraint if exists job_enrichment_salary_period_chk;
alter table public.job_enrichment add constraint job_enrichment_salary_period_chk
  check (salary_period in ('hour', 'day', 'week', 'month', 'year', 'unknown'));
