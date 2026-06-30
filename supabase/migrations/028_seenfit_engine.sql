-- Migration 028: SeenFit Engine — deterministic, keyless résumé/application optimizer.
--
-- The SeenFit Engine uses NO external AI APIs. It scores résumé↔job fit from a skill
-- taxonomy (skill_aliases / skill_relationships), deterministic fact extraction, and
-- the existing company_scores data. These tables persist extracted facts, the seeded
-- taxonomy, every scoring run (versioned via engine_version), and user feedback.
--
-- SECURITY: all six tables enable RLS with NO policies → deny-all to anon/authenticated.
-- The server (api/optimizer.js) reads/writes them with the SERVICE key (service_role
-- BYPASSES RLS), matching the pattern used by rate_limits (020) and the other
-- server-only tables. Idempotent — safe to run multiple times.

-- ── resume_facts ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.resume_facts (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid,
  source_resume_id uuid,
  fact_type        text,
  label            text,
  normalized_label text,
  evidence_text    text,
  confidence       numeric,
  created_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_resume_facts_user ON public.resume_facts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resume_facts_norm ON public.resume_facts (normalized_label);

-- ── job_facts (cached per job_id for fast repeat runs) ───────────────────────
CREATE TABLE IF NOT EXISTS public.job_facts (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           text,
  fact_type        text,
  label            text,
  normalized_label text,
  weight           numeric,
  confidence       numeric,
  importance       text,
  created_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_facts_job ON public.job_facts (job_id);

-- ── skill_aliases (taxonomy) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.skill_aliases (
  id         uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  skill      text,
  alias      text,
  source     text,
  confidence numeric
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_skill_aliases_alias ON public.skill_aliases (alias);

-- ── skill_relationships (taxonomy graph) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.skill_relationships (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  from_skill   text,
  to_skill     text,
  relationship text,
  weight       numeric,
  source       text
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_skill_rel ON public.skill_relationships (from_skill, to_skill, relationship);

-- ── optimizer_runs (versioned scoring runs) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.optimizer_runs (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid,
  job_id                text,
  fit_score             numeric,
  ats_score             numeric,
  evidence_score        numeric,
  company_process_score numeric,
  output                jsonb,
  engine_version        text,
  created_at            timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_optimizer_runs_user ON public.optimizer_runs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_optimizer_runs_job ON public.optimizer_runs (job_id);

-- ── optimizer_feedback ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.optimizer_feedback (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      uuid,
  user_id     uuid,
  rating      int,
  user_action text,
  outcome     text,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_optimizer_feedback_run ON public.optimizer_feedback (run_id);

-- ── RLS: deny-all to anon/authenticated; server uses the service key ─────────
ALTER TABLE public.resume_facts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_facts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skill_aliases       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skill_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.optimizer_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.optimizer_feedback  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.resume_facts        FROM anon, authenticated;
REVOKE ALL ON TABLE public.job_facts           FROM anon, authenticated;
REVOKE ALL ON TABLE public.skill_aliases       FROM anon, authenticated;
REVOKE ALL ON TABLE public.skill_relationships FROM anon, authenticated;
REVOKE ALL ON TABLE public.optimizer_runs      FROM anon, authenticated;
REVOKE ALL ON TABLE public.optimizer_feedback  FROM anon, authenticated;

-- ── Feature flags (rollout control without a deploy) ─────────────────────────
-- SEENFIT_ENGINE_ENABLED gates the endpoint + UI (default fully_on for launch).
-- LOCAL_MODEL_POLISH_ENABLED is a stub gate for future local-model polish (default off).
-- The endpoint also honors equivalent env vars (SEENFIT_ENGINE_ENABLED /
-- LOCAL_MODEL_POLISH_ENABLED) so it works even before the flags table is read.
INSERT INTO public.feature_flags (flag_name, status, description) VALUES
  ('seenfit_engine_enabled',       'fully_on', 'SeenFit deterministic résumé/application optimizer (endpoint + UI).'),
  ('local_model_polish_enabled',   'off',      'Stub gate for future local-model polish of SeenFit output. Keeps zero external AI.')
ON CONFLICT (flag_name) DO NOTHING;

-- ── Seed starter taxonomy ────────────────────────────────────────────────────
-- Keep in sync with lib/optimizer/normalizeSkills.ts (BUILTIN_TAXONOMY). The engine
-- ships with these baked in; the DB copy lets admins extend the taxonomy without a
-- code deploy. alias is lowercased canonical surface form → skill is the canonical.
INSERT INTO public.skill_aliases (skill, alias, source, confidence) VALUES
  -- customer service family
  ('customer service', 'customer support', 'seed', 0.95),
  ('customer service', 'guest service', 'seed', 0.9),
  ('customer service', 'guest services', 'seed', 0.9),
  ('customer service', 'client service', 'seed', 0.9),
  ('customer service', 'client services', 'seed', 0.9),
  ('customer service', 'customer care', 'seed', 0.9),
  ('customer service', 'customer success', 'seed', 0.85),
  ('customer service', 'help desk', 'seed', 0.8),
  ('customer service', 'service desk', 'seed', 0.8),
  -- intake family
  ('customer intake', 'intake', 'seed', 0.85),
  ('customer intake', 'applicant intake', 'seed', 0.9),
  ('customer intake', 'case intake', 'seed', 0.9),
  ('customer intake', 'patient intake', 'seed', 0.9),
  ('customer intake', 'client intake', 'seed', 0.9),
  -- logistics / routing
  ('route planning', 'delivery route', 'seed', 0.9),
  ('route planning', 'route completion', 'seed', 0.9),
  ('route planning', 'route optimization', 'seed', 0.9),
  ('route planning', 'dispatch', 'seed', 0.8),
  -- retail / POS
  ('point of sale', 'pos', 'seed', 0.95),
  ('point of sale', 'cash register', 'seed', 0.9),
  ('point of sale', 'register', 'seed', 0.8),
  ('point of sale', 'cashier', 'seed', 0.85),
  ('point of sale', 'cash handling', 'seed', 0.85),
  -- tech aliases
  ('javascript', 'js', 'seed', 0.95),
  ('node.js', 'node', 'seed', 0.95),
  ('node.js', 'nodejs', 'seed', 0.95),
  ('react', 'reactjs', 'seed', 0.95),
  ('react', 'react.js', 'seed', 0.95),
  ('postgresql', 'postgres', 'seed', 0.95),
  ('postgresql', 'pg', 'seed', 0.8),
  ('kubernetes', 'k8s', 'seed', 0.95),
  ('google cloud', 'gcp', 'seed', 0.95),
  ('aws', 'aws cloud', 'seed', 0.9),
  ('aws', 'amazon web services', 'seed', 0.95),
  ('typescript', 'ts', 'seed', 0.9),
  ('python', 'py', 'seed', 0.85),
  ('c#', 'c sharp', 'seed', 0.9),
  ('c#', 'csharp', 'seed', 0.9),
  ('go', 'golang', 'seed', 0.95),
  ('machine learning', 'ml', 'seed', 0.9),
  ('ci/cd', 'ci cd', 'seed', 0.9),
  ('ci/cd', 'cicd', 'seed', 0.9),
  ('rest', 'rest api', 'seed', 0.9),
  ('rest', 'restful', 'seed', 0.9),
  -- office / general
  ('excel', 'ms excel', 'seed', 0.95),
  ('excel', 'microsoft excel', 'seed', 0.95),
  ('excel', 'spreadsheets', 'seed', 0.8),
  ('microsoft word', 'ms word', 'seed', 0.95),
  ('microsoft powerpoint', 'powerpoint', 'seed', 0.95),
  ('google workspace', 'g suite', 'seed', 0.9),
  ('google workspace', 'gsuite', 'seed', 0.9),
  ('crm', 'crm software', 'seed', 0.9),
  ('salesforce', 'salesforce crm', 'seed', 0.95),
  -- soft skills / ops
  ('teamwork', 'team work', 'seed', 0.95),
  ('time management', 'time-management', 'seed', 0.95),
  ('problem solving', 'problem-solving', 'seed', 0.95),
  ('team management', 'people management', 'seed', 0.85),
  ('team management', 'staff management', 'seed', 0.85),
  ('inventory management', 'inventory control', 'seed', 0.9),
  ('inventory management', 'stock management', 'seed', 0.9),
  ('scheduling', 'scheduling shifts', 'seed', 0.9),
  ('scheduling', 'shift scheduling', 'seed', 0.9),
  ('data analytics', 'data analysis', 'seed', 0.9),
  ('accounting', 'bookkeeping', 'seed', 0.85)
ON CONFLICT (alias) DO NOTHING;

INSERT INTO public.skill_relationships (from_skill, to_skill, relationship, weight, source) VALUES
  ('customer service', 'customer intake', 'related', 0.6, 'seed'),
  ('customer service', 'point of sale', 'related', 0.4, 'seed'),
  ('customer service', 'conflict resolution', 'related', 0.5, 'seed'),
  ('customer service', 'communication', 'related', 0.5, 'seed'),
  ('point of sale', 'customer service', 'related', 0.4, 'seed'),
  ('point of sale', 'cash handling', 'related', 0.7, 'seed'),
  ('route planning', 'logistics', 'related', 0.7, 'seed'),
  ('route planning', 'time management', 'related', 0.5, 'seed'),
  ('inventory management', 'logistics', 'related', 0.6, 'seed'),
  ('inventory management', 'data analytics', 'related', 0.3, 'seed'),
  ('react', 'javascript', 'related', 0.8, 'seed'),
  ('react', 'typescript', 'related', 0.6, 'seed'),
  ('react', 'frontend', 'related', 0.7, 'seed'),
  ('node.js', 'javascript', 'related', 0.8, 'seed'),
  ('node.js', 'backend', 'related', 0.7, 'seed'),
  ('node.js', 'rest', 'related', 0.5, 'seed'),
  ('typescript', 'javascript', 'related', 0.9, 'seed'),
  ('kubernetes', 'docker', 'related', 0.7, 'seed'),
  ('kubernetes', 'devops', 'related', 0.7, 'seed'),
  ('docker', 'devops', 'related', 0.6, 'seed'),
  ('postgresql', 'sql', 'related', 0.9, 'seed'),
  ('aws', 'cloud', 'related', 0.8, 'seed'),
  ('aws', 'devops', 'related', 0.4, 'seed'),
  ('google cloud', 'cloud', 'related', 0.8, 'seed'),
  ('machine learning', 'python', 'related', 0.6, 'seed'),
  ('machine learning', 'data analytics', 'related', 0.6, 'seed'),
  ('data analytics', 'excel', 'related', 0.4, 'seed'),
  ('data analytics', 'sql', 'related', 0.5, 'seed'),
  ('team management', 'leadership', 'related', 0.7, 'seed'),
  ('team management', 'scheduling', 'related', 0.4, 'seed'),
  ('leadership', 'team management', 'related', 0.7, 'seed'),
  ('communication', 'customer service', 'related', 0.4, 'seed'),
  ('salesforce', 'crm', 'related', 0.9, 'seed')
ON CONFLICT (from_skill, to_skill, relationship) DO NOTHING;

-- Verification:
--   SELECT count(*) FROM skill_aliases;        -- 64
--   SELECT count(*) FROM skill_relationships;  -- 33
--   SELECT flag_name, status FROM feature_flags WHERE flag_name LIKE '%seenfit%' OR flag_name LIKE '%polish%';
