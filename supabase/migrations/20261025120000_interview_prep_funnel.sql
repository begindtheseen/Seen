-- Interview Prep + funnel counters (owner decision 2026-10-25: Interview Prep, $9.99 per interview, replaces the
-- Interview Sprint; the funnel must be measurable step by step).
--
--   interview_preps — one cached prep pack per (user, company + role). Written by api/interview-prep.js with the
--     service key. The pack is what Seen generated for that person: questions, answers built from their résumé,
--     emails, and the company's interview record at the time. Deleted with the account (api/user-sync.js).
--   funnel_events — one row per funnel step that is not already recorded elsewhere: prep_offer_shown,
--     prep_offer_clicked, prep_built, guest_email_shown, guest_email_given. Purchases are counted from
--     credit_transactions (reason purchase_interview), sign-ups from auth.users, tracked applications from
--     applications. Admin → Revenue funnel reads all of them.
--
-- Additive only. Both tables are server-only: RLS on, no policies, grants revoked. The code that writes them
-- treats a missing table as "not set up yet", so deploying the code before this migration is safe.

CREATE TABLE IF NOT EXISTS public.interview_preps (
  id             bigserial   PRIMARY KEY,
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prep_key       text        NOT NULL,
  company        text        NOT NULL,
  role           text,
  application_id text,
  pack           jsonb       NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, prep_key)
);

CREATE TABLE IF NOT EXISTS public.funnel_events (
  id         bigserial   PRIMARY KEY,
  user_id    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  event      text        NOT NULL CHECK (event IN ('prep_offer_shown', 'prep_offer_clicked', 'prep_built', 'guest_email_shown', 'guest_email_given')),
  company    text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_funnel_events_event_time ON public.funnel_events (event, created_at DESC);

ALTER TABLE public.interview_preps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funnel_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.interview_preps FROM anon, authenticated;
REVOKE ALL ON public.funnel_events FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
