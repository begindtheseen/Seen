// Search priority for listings employers post on Seen (owner decision 2026-10-17).
//
// A job posted (or imported) directly on Seen by its employer is shown ahead of aggregated
// listings in every search it is relevant to — the advertised benefit of posting on Seen.
// Paid Featured placement (employer_perks.featured_until) ranks above that. Priority only
// changes ORDER, never a score, and never pulls in a listing that doesn't match the search.
//
// Pure (no I/O) so the server (api/jobs.js) and the jobs page's client-side sort share one
// definition — the client re-sorts results, which would otherwise undo the server's order.

/** Lowercase, letters and digits only: "Seen Jobs" / "SeenJobs" / "seen-jobs" → "seenjobs". */
export function normCompany(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * 0 = normal · 1 = posted on Seen by the employer · 2 = Featured · 3 = Featured AND posted on Seen.
 * Paid Featured outranks a free direct post; a direct post outranks every aggregated listing.
 */
export function priorityTier(job) {
  if (!job) return 0;
  return (job.featured ? 2 : 0) + (job.employer_posted ? 1 : 0);
}

/** Stable sort: higher tier first, original order kept within a tier. Never mutates the input. */
export function sortByPriority(list) {
  return (Array.isArray(list) ? list : [])
    .map((j, i) => [j, i])
    .sort((a, b) => (priorityTier(b[0]) - priorityTier(a[0])) || (a[1] - b[1]))
    .map(([j]) => j);
}

/**
 * True when the search names this listing's company — so "seen jobs", "seenjobs" and
 * "Seen Jobs software engineer" all find Seen Jobs. Short names (< 4 chars after normalizing)
 * need an exact match so a 2-letter company can't match half of all queries.
 */
export function companyMatchesQuery(company, query) {
  const c = normCompany(company);
  const q = normCompany(query);
  if (!c || !q) return false;
  if (c === q) return true;
  if (c.length < 4) return false;
  return q.includes(c) || (q.length >= 4 && c.includes(q));
}

/** True for listings a remote worker can take from anywhere. */
export function isRemoteListing(job) {
  return /\bremote\b|\bwork from home\b|\banywhere\b/i.test(String(job?.location || ''));
}
