-- Migration 041: range CHECK constraints on company_scores.
--
-- Rates are stored as fractions in [0,1] and scores as [0,100]. A hand-math merge writer
-- (removed in the merge-integrity work) had been blending already-fractional rates with a
-- 0-100 default, producing out-of-range values that rendered as "3400% ghost rate" on the
-- company page. These constraints make that class of bug impossible to persist.
--
-- APPLY ONLY AFTER repairing rows violating the ranges — the reviewer handles prod repair
-- (clamp existing out-of-range rows) + application. Idempotent: each block adds its
-- constraint only if it does not already exist, so re-running is safe.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_scores_ghost_rate_range') THEN
    ALTER TABLE public.company_scores
      ADD CONSTRAINT company_scores_ghost_rate_range
      CHECK (ghost_rate IS NULL OR (ghost_rate >= 0 AND ghost_rate <= 1));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_scores_response_rate_range') THEN
    ALTER TABLE public.company_scores
      ADD CONSTRAINT company_scores_response_rate_range
      CHECK (response_rate IS NULL OR (response_rate >= 0 AND response_rate <= 1));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_scores_unpaid_rate_range') THEN
    ALTER TABLE public.company_scores
      ADD CONSTRAINT company_scores_unpaid_rate_range
      CHECK (unpaid_rate IS NULL OR (unpaid_rate >= 0 AND unpaid_rate <= 1));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_scores_overall_score_range') THEN
    ALTER TABLE public.company_scores
      ADD CONSTRAINT company_scores_overall_score_range
      CHECK (overall_score IS NULL OR (overall_score >= 0 AND overall_score <= 100));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_scores_waste_score_range') THEN
    ALTER TABLE public.company_scores
      ADD CONSTRAINT company_scores_waste_score_range
      CHECK (waste_score IS NULL OR (waste_score >= 0 AND waste_score <= 100));
  END IF;
END $$;
