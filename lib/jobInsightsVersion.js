// The job-insights generation version, shared by the server cache key (api/job-insights.js) and
// the device cache (app/jobs/[id]/page.tsx, components/jobs/JobDetailDrawer.tsx). Bump it whenever
// lib/server/jobInsights.js changes what it would say about a posting: every cached answer written
// under an older version — the shared 7-day `job_insights` rows and each device's `ji_` entry — is
// then ignored and regenerated on the next view, with no SQL purge.
//
// v3 (2026-10-25): requirements are verified against the posting (no "Machine Learning" or "12+
// years" from a "2–12+ years · Go, Java, C/C++ etc." posting), alternatives stay alternatives, and
// shift/schedule claims need the posting to mention a shift or schedule.
export const JOB_INSIGHTS_VERSION = 'v3';
