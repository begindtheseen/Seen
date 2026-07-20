// Pure helpers for LOGIN-SCOPED employer listing management (api/employer-listings.js).
//
// Distinct from lib/server/employerListings.js (the account-free "close my listing" flow behind
// api/reports.js): this module powers the CLAIM-scoped dashboard where an approved employer posts
// their own listings, sees every listing on their company, and disputes the rest. No I/O — validate
// a new employer-posted listing, build its jobs-table row (migration 055 ownership columns), dedupe
// the two apply signals (apply_events clicks + self-reported applications) into per-listing/per-role
// counts, and annotate a company's jobs rows for the table. Only non-identifying fields ever leave
// here — applicant identity is never surfaced to an employer.

import { classifyListingOrigin, isHttpUrl } from './listingDisputes.js';

/**
 * Validate an employer's new-listing form. apply_url (the click-through redirect target) is required
 * and must be a real http(s) URL. Returns { ok:true, listing } or { ok:false, error }.
 */
export function validateNewListing(input = {}) {
  const title = String(input.title == null ? '' : input.title).trim();
  const apply_url = String(input.apply_url == null ? '' : input.apply_url).trim();
  if (title.length < 3) return { ok: false, error: 'A job title is required' };
  if (title.length > 200) return { ok: false, error: 'That job title is too long' };
  if (!isHttpUrl(apply_url)) return { ok: false, error: 'A valid apply link (http/https) is required' };
  return {
    ok: true,
    listing: {
      title: title.slice(0, 200),
      location: String(input.location == null ? '' : input.location).trim().slice(0, 200) || 'Remote',
      salary: input.salary ? String(input.salary).trim().slice(0, 120) : null,
      description: input.description ? String(input.description).trim().slice(0, 8000) : null,
      apply_url: apply_url.slice(0, 2000),
      type: normalizeType(input.type),
    },
  };
}

function normalizeType(t) {
  return String(t == null ? '' : t).trim().toLowerCase().includes('part') ? 'Part-time' : 'Full-time';
}

/**
 * Build the jobs-table row for an employer-posted listing. `company` is the employer's approved-claim
 * display name; `companyKey` its normalized key; `uid` the verified employer. Timestamps are passed
 * in (pure — no Date.now here) so this stays deterministic/testable.
 */
export function buildEmployerListingRow(listing, { uid, company, companyKey, nowISO, expiresISO } = {}) {
  return {
    title: listing.title,
    company,
    location: listing.location,
    salary: listing.salary,
    description: listing.description,
    apply_url: listing.apply_url,
    source: 'Employer',
    type: listing.type,
    availability_status: 'active',
    is_employer_posted: true,
    employer_user_id: uid,
    last_seen_at: nowISO,
    last_checked_at: nowISO,
    created_at: nowISO,
    expires_at: expiresISO,
    search_query: companyKey,
  };
}

/**
 * Dedupe the two apply signals into counts. An apply_event (observed click) and a self-reported
 * application from the SAME user for the SAME job are the same application — counted once. Rows
 * without a user_id+job_id pair can't be deduped, so they each count (precision-first: we never
 * silently drop a real signal, we only collapse a provable duplicate).
 * Returns { total, perJob: {job_id:n}, perRole: {role:n} }.
 */
export function applyCounts({ applyEvents = [], applications = [] } = {}) {
  const perJob = {};
  const perRole = {};
  const seen = new Set();
  const bump = (jobId, role) => {
    if (jobId != null && jobId !== '') perJob[jobId] = (perJob[jobId] || 0) + 1;
    const r = String(role == null ? '' : role).trim().toLowerCase() || '__norole__';
    perRole[r] = (perRole[r] || 0) + 1;
  };
  for (const e of (Array.isArray(applyEvents) ? applyEvents : [])) {
    if (!e) continue;
    const key = e.user_id && e.job_id ? `u:${e.user_id}|j:${e.job_id}` : null;
    if (key) seen.add(key);
    bump(e.job_id, e.role);
  }
  for (const a of (Array.isArray(applications) ? applications : [])) {
    if (!a) continue;
    const key = a.user_id && a.job_id ? `u:${a.user_id}|j:${a.job_id}` : null;
    if (key && seen.has(key)) continue; // already counted from an apply_event
    bump(a.job_id, a.role);
  }
  const total = Object.values(perRole).reduce((n, v) => n + v, 0);
  return { total, perJob, perRole };
}

/**
 * Annotate a company's jobs rows for the employer listing table: origin badge, availability, an open
 * dispute (if any), and the deduped apply count. Non-identifying fields only.
 * @param {Array} jobs
 * @param {Object} opts
 * @param {Object} [opts.openDisputesByJob]  - { [job_id]: dispute } for this employer's OPEN disputes
 * @param {Object} [opts.applyCountsByJob]    - { [job_id]: n } from applyCounts().perJob
 */
export function annotateListings(jobs, { openDisputesByJob = {}, applyCountsByJob = {} } = {}) {
  return (Array.isArray(jobs) ? jobs : []).filter(Boolean).map((j) => ({
    id: j.id ?? null,
    title: j.title || 'Untitled posting',
    company: j.company || null,
    location: j.location || j.city || null,
    apply_url: j.apply_url || j.url || null,
    source: j.source || null,
    origin: classifyListingOrigin(j),
    availability_status: j.availability_status || null,
    expires_at: j.expires_at || null,
    created_at: j.created_at || null,
    is_employer_posted: !!(j.is_employer_posted || j.employer_user_id),
    applications: applyCountsByJob[j.id] || 0,
    openDispute: openDisputesByJob[String(j.id)] || null,
  }));
}
