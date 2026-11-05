-- Saved résumés (owner request 2026-11-01): an account keeps up to MAX_RESUMES_FREE (1) résumé, or
-- MAX_RESUMES_PRO (5) with Pro (lib/server/creditRules.js), and picks which one to apply with.
--
-- The DEFAULT résumé is mirrored into profiles.resume_text / resume_file_name / resume_word_count /
-- resume_updated_at by api/user-sync.js on every change, so every existing reader (job rail, interview
-- prep, Studio, job-match emails, Apply on Seen) keeps working unchanged.
--
-- Server-only, like profiles since 20261101130000: every read and write goes through api/user-sync.js
-- with the service key (which bypasses RLS and these grants). RLS on with NO policies.
--
-- Additive and idempotent. The code works before this is applied (it detects the missing table and
-- keeps the single profiles.resume_text résumé, with the multi-résumé UI hidden).

-- The profiles résumé columns exist in prod but were hand-applied (no migration). Codified here so a
-- fresh or restored database has them; IF NOT EXISTS makes this a no-op in prod.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS resume_text text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS resume_file_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS resume_word_count integer;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS resume_updated_at timestamptz;

CREATE TABLE IF NOT EXISTS public.resumes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  resume_text text NOT NULL,
  file_name   text,
  word_count  integer,
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One default per account.
CREATE UNIQUE INDEX IF NOT EXISTS resumes_one_default_per_user ON public.resumes (user_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS resumes_user_id_idx ON public.resumes (user_id);

ALTER TABLE public.resumes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.resumes FROM anon, authenticated;

-- Backfill: the résumé every account already has becomes its default 'My résumé'. Skips accounts that
-- already have a row, so running this twice adds nothing.
INSERT INTO public.resumes (user_id, name, resume_text, file_name, word_count, is_default, created_at, updated_at)
SELECT p.id, 'My résumé', p.resume_text::text, p.resume_file_name::text, p.resume_word_count::integer, true,
       COALESCE(p.resume_updated_at::timestamptz, now()), COALESCE(p.resume_updated_at::timestamptz, now())
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
WHERE p.resume_text IS NOT NULL
  AND btrim(p.resume_text) <> ''
  AND NOT EXISTS (SELECT 1 FROM public.resumes r WHERE r.user_id = p.id);
