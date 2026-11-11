-- Job keys: each person's matching profile for "Matched to your résumé" (the /jobs rail) and the
-- matched-jobs emails (owner request 2026-11-10). lib/server/jobKeys.js builds a small versioned object
-- from the résumé on file (its roles, the years in each field, level, licences, degree) and the jobs the
-- person applied to in the last 60 days; lib/server/resumeMatches.js matches listings against it.
--
-- Written only by the server with the service key (api/user-sync.js save_resume / clear_resume /
-- add_application / remove_application, lib/server/resumes.js writeMirror, and the readers' self-heal).
-- Nothing reads it with a user token. Who may write profiles is decided by migration
-- 20261101130000_profiles_server_write_only.sql; this adds columns only and changes no access.
--
-- Additive and idempotent: safe to apply before or after the code. Until it is applied the code derives
-- the keys in memory on every read (it probes for the column once per instance).
alter table public.profiles add column if not exists job_keys jsonb;
alter table public.profiles add column if not exists job_keys_updated_at timestamptz;
comment on column public.profiles.job_keys is 'Matching profile built from the résumé + recent applications (lib/server/jobKeys.js). Server-written.';
