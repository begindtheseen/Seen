// Pure data-shaping for the employer dashboard (app/employers/dashboard/page.tsx).
//
// The schema reality this encodes (verified in code, not assumed):
//   • Job postings are NOT employer-owned rows. Seen indexes listings by company name and
//     serves a company's live (non-expired) listings from api/jobs.js `company_jobs`.
//     Migration 050 is explicit: "the employer portal creates NO accounts at all."
//   • "Applicant interactions" are community outcome reports (the `reports` table, public
//     read — migration 017 `reports_public_read USING (true)`), keyed by company_name +
//     role + outcome. There is NO private per-applicant record an employer could see
//     (applications are seeker-private under RLS `auth.uid() = user_id`, migration 016),
//     so a per-posting "applicant count" is DERIVED by matching a report's `role` to a
//     posting's `title`. That's an honest approximation, and the UI labels it as reported
//     candidate outcomes — never as a private ATS feed.
//
// These functions are pure (no I/O) so the page is a thin fetch-and-render shell and the
// shaping logic below is unit-tested (employerDashboard.test.mjs).

// Raw report outcomes (the submit vocabulary in api/reports.js) → display buckets.
const OUTCOME_BUCKETS = {
  ghosted: 'ghosted',
  rejected: 'rejected',
  autoreject: 'rejected',
  interview: 'interviewing',
  human: 'interviewing',
  offer: 'hired',
  hired: 'hired',
  waiting: 'waiting',
};

// Display metadata per bucket. `tone` is a semantic hint the page maps to a color token.
export const BUCKET_META = {
  ghosted: { label: 'Ghosted', tone: 'bad' },
  rejected: { label: 'Rejected', tone: 'warn' },
  interviewing: { label: 'Interviewing', tone: 'good' },
  hired: { label: 'Hired / Offer', tone: 'good' },
  waiting: { label: 'Awaiting reply', tone: 'neutral' },
};

// Map any raw outcome to a display bucket. Unknown / missing → 'waiting' (never throws).
export function bucketOutcome(outcome) {
  if (!outcome) return 'waiting';
  return OUTCOME_BUCKETS[String(outcome).toLowerCase().trim()] || 'waiting';
}

// Loose normalizer for company/role/title comparison.
function norm(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Does a report's `role` plausibly belong to a posting's `title`? Loose on purpose:
// exact-normalized equality, or either string containing the other, so "Senior Software
// Engineer" still associates with a "Software Engineer" listing. An empty role is
// company-wide (not tied to a specific posting) and never matches.
export function roleMatchesTitle(role, title) {
  const r = norm(role);
  const t = norm(title);
  if (!r || !t) return false;
  if (r === t) return true;
  return r.includes(t) || t.includes(r);
}

// Count reports into display buckets and derive the two headline rates the rest of the
// product speaks in: ghost rate = ghosted / total; response rate = the share where the
// company actually responded (rejected + interviewing + hired) / total.
export function summarizeInteractions(reports) {
  const list = Array.isArray(reports) ? reports : [];
  const counts = { ghosted: 0, rejected: 0, interviewing: 0, hired: 0, waiting: 0 };
  for (const rep of list) counts[bucketOutcome(rep && rep.outcome)]++;
  const total = list.length;
  const responded = counts.rejected + counts.interviewing + counts.hired;
  return {
    total,
    counts,
    ghostRate: total ? Math.round((counts.ghosted / total) * 100) : null,
    responseRate: total ? Math.round((responded / total) * 100) : null,
  };
}

// One normalized, display-ready interaction row.
export function normalizeInteraction(rep) {
  const bucket = bucketOutcome(rep && rep.outcome);
  return {
    role: rep && rep.role ? String(rep.role) : 'Role not specified',
    rawOutcome: rep && rep.outcome ? String(rep.outcome) : 'waiting',
    bucket,
    label: BUCKET_META[bucket].label,
    tone: BUCKET_META[bucket].tone,
    experienceLevel: rep && rep.experience_level ? String(rep.experience_level) : '',
    createdAt: rep && rep.created_at ? String(rep.created_at) : null,
  };
}

// Most-recent-first, capped, normalized. Rows without a parseable date sort last.
export function recentInteractions(reports, limit = 8) {
  const list = Array.isArray(reports) ? reports.slice() : [];
  list.sort((a, b) => {
    const da = a && a.created_at ? Date.parse(a.created_at) || 0 : 0;
    const db = b && b.created_at ? Date.parse(b.created_at) || 0 : 0;
    return db - da;
  });
  const n = Math.max(0, limit | 0);
  return list.slice(0, n).map(normalizeInteraction);
}

// Attach a reported-interaction summary to each posting by matching report.role → posting.title.
// Reports whose role matches no posting (or is blank) are company-wide: they still count in the
// overall summary / recent feed, but never get invented into a per-posting number here.
export function postingsWithInteractions(postings, reports) {
  const posts = Array.isArray(postings) ? postings : [];
  const reps = Array.isArray(reports) ? reports : [];
  return posts.map((p) => {
    const matched = reps.filter((r) => roleMatchesTitle(r && r.role, p && p.title));
    const summary = summarizeInteractions(matched);
    return {
      title: p && p.title ? String(p.title) : 'Untitled listing',
      location: p && p.location ? String(p.location) : '',
      type: p && p.type ? String(p.type) : '',
      level: p && p.level ? String(p.level) : '',
      salary: p && p.salary ? String(p.salary) : '',
      source: p && p.source ? String(p.source) : 'Seen',
      score: p && typeof p.score === 'number' ? p.score : null,
      url: (p && (p.url || p.apply_url)) || null,
      postedAt: (p && p.posted_at) || null,
      applicantCount: summary.total,
      counts: summary.counts,
    };
  });
}
