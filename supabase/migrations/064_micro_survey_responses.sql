-- 064_micro_survey_responses.sql
-- Low-friction, NO-incentive micro-survey responses (see components/MicroSurveyModal.tsx +
-- components/MicroSurveyHost.tsx + api/micro-survey.js). ONE multiple-choice question, one tap,
-- dismissible, no reward. Because nothing is rewarded there is nothing to farm, so the raw signal
-- is cleaner than the incented SurveyModal — but every row is still a CLAIM, not a fact.
--
-- TRUST TIER: this is our LOWEST-trust first-party signal. It lives on its own here and is
-- DELIBERATELY NOT joined into company scoring yet. Wiring these claims into a company score is a
-- separate, explicit follow-up (kept out of this migration on purpose) so the scoring path is
-- never half-wired. When that day comes, weight it BELOW the direct / survey / ingest tiers.
--
-- Service-key only (RLS on, no policies) — same posture as our other server-only ingest tables
-- (see 062_company_signals.sql). The write goes through api/micro-survey.js with the service key.

create table if not exists public.micro_survey_responses (
  id           uuid primary key default gen_random_uuid(),
  -- Optional: the signed-in user when a Supabase Bearer token was presented, else NULL (anonymous).
  user_id      uuid,
  -- Which fixed-pool question was answered. Validated server-side against lib/server/microSurvey.js
  -- (unknown keys are rejected before insert), so this is effectively an enum of known keys.
  question_key text not null,
  -- Only set for the CONTEXTUAL question ("Did {company} get back to you?"); NULL for general ones.
  company      text,
  -- The chosen option — always one of the question's fixed choices (enum validated in the API).
  choice       text not null,
  created_at   timestamptz not null default now()
);

-- Breadth reporting is by question, and by company for the contextual question, newest first.
create index if not exists idx_micro_survey_question
  on public.micro_survey_responses (question_key, created_at desc);
create index if not exists idx_micro_survey_company
  on public.micro_survey_responses (lower(company), created_at desc)
  where company is not null;

alter table public.micro_survey_responses enable row level security;
-- No policies: service-key (server) access only, like our other ingest tables.

comment on table public.micro_survey_responses is
  'Low-trust, no-incentive single-question micro-survey CLAIMS (one tap, dismissible). Own trust tier; NOT wired into company scoring yet (deliberate follow-up). Service-key only (RLS on, no policies).';
