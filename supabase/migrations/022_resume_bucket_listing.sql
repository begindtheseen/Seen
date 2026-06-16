-- 022_resume_bucket_listing.sql
-- Resumes are PII. Two SELECT policies on storage.objects had a broad qual
-- (bucket_id = 'resumes' only), letting ANY role read/LIST every user's resume
-- (advisor 0025_public_bucket_allows_listing). Drop them; the correctly owner-scoped
-- "Users can read own resume" policy (bucket_id + auth.uid() = foldername[1]) remains,
-- and the server reads via the service key (which bypasses RLS). No app code uses the
-- storage client, so app behavior is unaffected. Idempotent.
DROP POLICY IF EXISTS "Service can read all resumes" ON storage.objects;
DROP POLICY IF EXISTS "Users read own resume" ON storage.objects;
