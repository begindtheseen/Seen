-- Apply on Seen (owner request 2026-10-17): listings employers post on Seen can take applications
-- on Seen itself, on the employer's own site, or both — the employer chooses per listing.
--
--   jobs.apply_mode      'external' (default — every existing and aggregated row: apply on the
--                        employer's site, today's behaviour) | 'seen' (apply on Seen only — for
--                        employers with no way to receive résumés) | 'both'.
--   seen_applications    one row per (listing, applicant): who applied, the résumé they chose to
--                        share, their note, and the employer's status for it.
--   storage bucket       application-resumes — PRIVATE. Files are only ever read through short-lived
--                        signed URLs minted by api/employer-listings.js for the owning employer.
--
-- Server-only: seen_applications has RLS ON with NO policy (reached only with the service key, like
-- employer_notifications 057). The code ships BEFORE this migration and treats a missing column/table
-- as "not available yet" (lib/server/seenApply.js isNotMigrated) — external apply only, no Seen-apply
-- UI — so applying this is what switches the feature on. Idempotent.

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS apply_mode text NOT NULL DEFAULT 'external';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_apply_mode_check') THEN
    ALTER TABLE public.jobs ADD CONSTRAINT jobs_apply_mode_check
      CHECK (apply_mode IN ('external', 'seen', 'both'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.seen_applications (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id             uuid        NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  company_key        text        NOT NULL,              -- normalized company name (employer scope key)
  company_name       text,                              -- display name at apply time
  job_title          text,                              -- snapshot: the inbox still reads after edits
  employer_user_id   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  applicant_user_id  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  applicant_name     text        NOT NULL,
  applicant_email    text        NOT NULL,
  applicant_phone    text,
  resume_text        text,                              -- extracted / saved résumé text (always kept)
  resume_path        text,                              -- object path in the application-resumes bucket
  resume_file_name   text,
  resume_mime        text,
  note               text,
  status             text        NOT NULL DEFAULT 'new',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT seen_applications_status_check
    CHECK (status IN ('new', 'reviewed', 'interviewing', 'rejected', 'hired')),
  CONSTRAINT seen_applications_one_per_applicant UNIQUE (job_id, applicant_user_id)
);

-- The employer inbox read: this company's applications, newest first (optionally one listing).
CREATE INDEX IF NOT EXISTS idx_seen_applications_company
  ON public.seen_applications (company_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_seen_applications_job
  ON public.seen_applications (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_seen_applications_applicant
  ON public.seen_applications (applicant_user_id);

ALTER TABLE public.seen_applications ENABLE ROW LEVEL SECURITY;

-- Private résumé bucket (the older `resumes` bucket is public — applicant files must never be).
-- 3 MB: Vercel caps a function request body at 4.5 MB and the file arrives base64-encoded.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'application-resumes', 'application-resumes', false, 3145728,
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
)
ON CONFLICT (id) DO NOTHING;
