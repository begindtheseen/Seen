-- Remove listings and companies rows named after job titles (owner request 2026-10-18).
-- Ingest now refuses them (lib/server/jobSources.js: isTitleLikeCompany in buildJob, the Adzuna
-- mapper and isValidCompanyName; isCompanyOnlyTitle for a title that is only the employer's name),
-- so this only clears what was stored before the guards. Data-only and idempotent; listings that a
-- seeker saved or applied to, and employer-posted listings, are never touched.

-- 1. Arbeitnow listings whose "company" is a job title (23 rows on 2026-10-18), and listings whose
--    title is only the company name (1 row: "WinCo Foods" at WinCo Foods).
DELETE FROM public.jobs j
WHERE (
        j.company IN (
          'Senior Software Engineer (Typescript / Backend) - AI/ML',
          'Signal Processing Engineer (RF Processing & Analytics)',
          'Junior Data Scientist - Downstream Demand Forecast - Value Chain ...'
        )
        OR (
          regexp_replace(lower(coalesce(j.title, '')), '[^a-z0-9]', '', 'g') <> ''
          AND regexp_replace(lower(coalesce(j.title, '')), '[^a-z0-9]', '', 'g')
            = regexp_replace(lower(coalesce(j.company, '')), '[^a-z0-9]', '', 'g')
        )
      )
  AND coalesce(j.is_employer_posted, false) = false
  AND NOT EXISTS (SELECT 1 FROM public.saved_jobs s WHERE s.job_id = j.id::text)
  AND NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.job_id = j.id::text);

-- 2. companies rows named after job titles (18 on 2026-10-18: the 3 above plus Greenhouse page
--    titles such as "Senior Manager, Internal Communications - Greenhouse"). Only rows no listing
--    still points at are removed.
DELETE FROM public.companies c
WHERE c.id IN (
        'c77bae7e-5689-456e-9de7-3b0063083fa1', '7f58e7cd-2609-4087-a5a2-468434305c5b',
        'a9fac8f3-ca36-412d-a2fc-bf1e8d6ddeb9', '309e2fa7-d733-40c7-b1c5-7a831d5872aa',
        'e54a8cd0-7d43-4287-9867-77d5c25e0315', '1446954e-1a25-41ea-bbed-42edac6252bb',
        'a0e99e51-3dac-4eb1-aac6-da48e1845002', '29af1a12-68e5-476d-85f3-65d04ed30a3b',
        '20d99ff7-5433-4a87-b8de-e9719fcf2aea', '8ffa6968-1cf8-4001-8eb6-a062e3db6eee',
        'e66a381e-b0f5-448a-9db6-e05e75af69c3', 'b85fcdb0-d69c-4c8e-9015-2fcaf34c5003',
        'be776358-9a84-4fe6-923a-85efb2cc17d3', 'e8f43b70-4f0d-40e1-bcb9-f626046a92ee',
        'ce9ca3b6-b157-45a1-adda-c78349097acd', '1b7868f7-504b-4fc2-a12b-6f5473542fb2',
        '4bdefe8f-6e4e-4ba0-a185-485cd25c299d', '24245c5d-8e62-46d7-8d28-509e09243f79'
      )
  AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.company_id = c.id);
