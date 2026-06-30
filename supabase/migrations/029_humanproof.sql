-- Migration 029: HumanProof — deterministic, keyless résumé/application humanizer.
--
-- HumanProof runs AFTER the SeenFit optimizer (migration 028). It removes generic
-- AI-style résumé writing and replaces it with truthful, specific, human work context
-- drawn ONLY from the user's real facts (résumé facts, job facts, SeenFit optimizer
-- output, SeenJobs company/outcome data). It uses NO external AI APIs — everything is
-- local dictionaries (phrase_risk_rules), deterministic scoring, and templates.
--
-- FRAMING: HumanProof never claims to bypass/beat/trick detectors, ATS, or employers.
--
-- SECURITY: all four new tables enable RLS with NO policies → deny-all to
-- anon/authenticated. The server (api/optimizer.js) reads/writes them with the SERVICE
-- key (service_role BYPASSES RLS), matching the SeenFit tables (028) and rate_limits
-- (020). Idempotent — safe to run multiple times.

-- ── humanizer_runs (versioned humanization runs) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.humanizer_runs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL,
  job_id            text        NULL,
  optimizer_run_id  uuid        NULL,
  original_text     text        NOT NULL,
  humanized_text    text        NULL,
  humanproof_score  numeric,
  ai_slop_risk      text,
  output            jsonb,
  engine_version    text        DEFAULT 'humanproof_v1',
  created_at        timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_humanizer_runs_user ON public.humanizer_runs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_humanizer_runs_job  ON public.humanizer_runs (job_id);

-- ── humanizer_flags (one row per detected generic/AI-style issue) ────────────
CREATE TABLE IF NOT EXISTS public.humanizer_flags (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid        REFERENCES public.humanizer_runs(id) ON DELETE CASCADE,
  flag_type       text        NOT NULL,
  severity        text        NOT NULL,
  original_phrase text        NULL,
  explanation     text,
  suggested_fix   text        NULL,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_humanizer_flags_run ON public.humanizer_flags (run_id);

-- ── phrase_risk_rules (local dictionary; admins extend without a deploy) ──────
CREATE TABLE IF NOT EXISTS public.phrase_risk_rules (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  phrase           text        NOT NULL,
  category         text        NOT NULL,
  severity         text        NOT NULL,
  replacement_hint text        NULL,
  active           boolean     DEFAULT true,
  created_at       timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_phrase_risk_rules_phrase ON public.phrase_risk_rules (phrase);

-- ── humanizer_feedback (rate this pass / saved / copied) ─────────────────────
CREATE TABLE IF NOT EXISTS public.humanizer_feedback (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id     uuid        REFERENCES public.humanizer_runs(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL,
  action     text        NULL,
  rating     int         NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_humanizer_feedback_run ON public.humanizer_feedback (run_id);

-- ── RLS: deny-all to anon/authenticated; server uses the service key ─────────
ALTER TABLE public.humanizer_runs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.humanizer_flags    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phrase_risk_rules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.humanizer_feedback ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.humanizer_runs     FROM anon, authenticated;
REVOKE ALL ON TABLE public.humanizer_flags    FROM anon, authenticated;
REVOKE ALL ON TABLE public.phrase_risk_rules  FROM anon, authenticated;
REVOKE ALL ON TABLE public.humanizer_feedback FROM anon, authenticated;

-- ── Feature flags (rollout control without a deploy) ─────────────────────────
-- HUMANPROOF_ENABLED gates the endpoint + UI (default fully_on for launch).
-- HUMANPROOF_PAID_ONLY gates the full feature behind Pro (default off → on at launch
--   of the paid tier; the endpoint resolves Pro via gateAI(proOnly) when on).
-- LOCAL_HUMANIZER_MODEL_ENABLED is a stub gate for FUTURE LOCAL polish (default off);
--   it NEVER enables any external model. The endpoint also honors equivalent env vars.
INSERT INTO public.feature_flags (flag_name, status, description) VALUES
  ('humanproof_enabled',             'fully_on', 'HumanProof deterministic résumé/application humanizer (endpoint + UI).'),
  ('humanproof_paid_only',           'off',      'Gate the full HumanProof feature behind Seen Pro (ai_credits.pro = true).'),
  ('local_humanizer_model_enabled',  'off',      'Stub gate for FUTURE LOCAL polish of HumanProof output. Keeps zero external AI.')
ON CONFLICT (flag_name) DO NOTHING;

-- ── Seed phrase_risk_rules ────────────────────────────────────────────────────
-- Keep in sync with lib/humanizer/phraseRisk.ts (BUILTIN_PHRASE_RULES). The engine
-- ships with these baked in; this DB copy lets admins extend/disable rules without a
-- code deploy. phrase is the lowercased surface form; category/severity/replacement_hint
-- mirror the dictionary. Context-dependent hints (e.g. fast-paced environment) are
-- resolved against role/résumé facts at runtime in lib/humanizer/roleDetails.ts.
INSERT INTO public.phrase_risk_rules (phrase, category, severity, replacement_hint) VALUES
  -- generic AI/résumé-generator verbs & filler (ai_slop)
  ('leveraged',                       'ai_slop',   'medium', 'used'),
  ('utilized',                        'ai_slop',   'medium', 'used'),
  ('spearheaded',                     'ai_slop',   'medium', 'led'),
  ('optimized',                       'ai_slop',   'medium', 'improved'),
  ('streamlined',                     'ai_slop',   'medium', 'simplified'),
  ('demonstrated excellence',         'ai_slop',   'high',   'showed'),
  ('responsible for ensuring',        'ai_slop',   'medium', 'helped make sure'),
  ('successfully managed various tasks', 'vague_claim', 'high', 'handled specific tasks'),
  ('played a key role',               'vague_claim', 'high', 'helped with'),
  ('assisted with various duties',    'vague_claim', 'high', 'helped with specific duties'),
  ('worked effectively',              'vague_claim', 'medium', 'worked on'),
  ('contributed to success',          'vague_claim', 'high', 'helped with'),
  ('ensured customer satisfaction',   'vague_claim', 'medium', 'helped customers'),
  -- corporate buzzwords (buzzword)
  ('proven track record',             'buzzword',  'high',   'experience with'),
  ('results-driven',                  'buzzword',  'high',   NULL),
  ('dynamic professional',            'buzzword',  'high',   NULL),
  ('fast-paced environment',          'buzzword',  'medium', 'busy shift'),
  ('cross-functional collaboration',  'buzzword',  'medium', 'working with other teams'),
  ('detail-oriented professional',    'buzzword',  'high',   'careful with details'),
  ('highly motivated individual',     'buzzword',  'high',   NULL),
  ('passionate about delivering results', 'buzzword', 'high', NULL),
  ('strong communication skills',     'buzzword',  'medium', 'clear updates')
ON CONFLICT (phrase) DO NOTHING;

-- Verification:
--   SELECT count(*) FROM phrase_risk_rules;  -- 22
--   SELECT flag_name, status FROM feature_flags WHERE flag_name LIKE '%humanproof%' OR flag_name LIKE '%local_humanizer%';
