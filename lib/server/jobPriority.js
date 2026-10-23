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
 * +4 when the search names this listing's company (`company_match`, set by api/jobs.js): someone who
 * typed "Topgolf" wants Topgolf's jobs first, ahead of any paid placement for another company.
 */
export function priorityTier(job) {
  if (!job) return 0;
  return (job.company_match ? 4 : 0) + (job.featured ? 2 : 0) + (job.employer_posted ? 1 : 0);
}

/**
 * A listing inside the searched radius (or one the search did not scope by place). The server
 * stamps `in_radius:false` on the rows it added from further away or remote to fill a thin page;
 * a row without the flag (a résumé match, an older cache entry) counts as in the searched area.
 */
export function inSearchedArea(job) {
  return !job || job.in_radius !== false;
}

/**
 * Stable sort: listings in the searched area first, then higher tier first, original order kept
 * within a group. Never mutates the input. The area partition comes before the paid Featured tier
 * on purpose: a search for "cashier near Phoenix" never shows a Featured Austin cashier above a
 * Phoenix one — the live audit (2026-10-23) found in-radius rows scrambled below far-away ones.
 */
export function sortByPriority(list) {
  return (Array.isArray(list) ? list : [])
    .map((j, i) => [j, i])
    .sort((a, b) => ((inSearchedArea(b[0]) ? 1 : 0) - (inSearchedArea(a[0]) ? 1 : 0)) || (priorityTier(b[0]) - priorityTier(a[0])) || (a[1] - b[1]))
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

const COMPANY_SUFFIXES = new Set(['inc', 'incorporated', 'llc', 'llp', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company', 'companies', 'plc', 'group', 'holdings', 'the']);

/**
 * Stricter than companyMatchesQuery — used to rank ANY listing first: true only when the search
 * contains the company's whole name (legal suffixes ignored). "target" → Target Corporation, and
 * "topgolf dallas" → Topgolf, but a role search like "nurse" never pulls "Nurse Staffing LLC" up.
 */
export function queryNamesCompany(company, query) {
  const words = String(company || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const core = words.filter((w) => !COMPANY_SUFFIXES.has(w)).join('');
  const q = normCompany(query);
  if (core.length < 3 || !q) return false;
  return q === core || (core.length >= 4 && q.includes(core));
}

/** True for listings a remote worker can take from anywhere. */
export function isRemoteListing(job) {
  return /\bremote\b|\bwork from home\b|\banywhere\b/i.test(String(job?.location || ''));
}
