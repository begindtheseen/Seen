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

// A location string that means "remote" (matches the seeker search's own remote test in api/jobs.js).
export const REMOTE_RE = /\bremote\b|\bwork from home\b|\bwfh\b|\banywhere\b/i;
export function isRemoteLocation(loc) { return REMOTE_RE.test(String(loc == null ? '' : loc)); }

/**
 * Build the jobs-table row for an employer-posted listing. `company` is the employer's approved-claim
 * display name; `companyKey` its normalized key; `uid` the verified employer. Timestamps are passed
 * in (pure — no Date.now here) so this stays deterministic/testable.
 *
 * Location fields make the listing show under the seeker's LOCATION filters: `remote` true when the
 * location reads remote (the search keeps remote listings on a "Remote" search), and `city` set for a
 * real place (so `city`/`location` ilike filters match). lat/lng are geocoded by the endpoint (I/O).
 */
export function buildEmployerListingRow(listing, { uid, company, companyKey, nowISO, expiresISO } = {}) {
  const remote = isRemoteLocation(listing.location);
  return {
    title: listing.title,
    company,
    location: listing.location,
    city: remote ? null : listing.location,
    remote,
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

// ── Import from a link (api/employer-listings.js action 'import_preview') ─────
// Legal-form words dropped before comparing a parsed company with the employer's claim, so
// "Acme" matches "Acme, Inc." / "ACME Corp". Kept short and unambiguous on purpose.
const LEGAL_SUFFIX_RE = /\b(incorporated|inc|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|plc|gmbh|lp|llp)\b\.?/g;
export function companyMatchKey(name) {
  return String(name == null ? '' : name).toLowerCase()
    // Careers-page titles name the company as "Careers at Airbnb" / "Jobs @ Acme" (seen live).
    .replace(/^\s*(careers|jobs|work|working)\s+(at|@|with)\s+/, '')
    .replace(/\s+careers\s*$/, '') // NOT a trailing "jobs": "Seen Jobs" is a real company name
    .replace(LEGAL_SUFFIX_RE, ' ').replace(/[^a-z0-9]/g, '');
}

/**
 * True / false when the parsed company can be compared with the employer's approved company,
 * null when the listing named no company (we can't tell — the UI says so instead of guessing).
 * Letters and digits only, legal suffixes ignored: "Seen Jobs" = "SeenJobs" = "Seen Jobs, Inc.".
 */
export function importCompanyMatches(parsedCompany, claimCompanyName) {
  const a = companyMatchKey(parsedCompany);
  const b = companyMatchKey(claimCompanyName);
  if (!a || !b) return null;
  return a === b;
}

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', bull: '•' };
const decodeEntities = (t) => t.replace(/&(#x?[0-9a-f]+|[a-z]+\d*);/gi, (m, e) => {
  const k = e.toLowerCase();
  if (k[0] === '#') {
    const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' ';
  }
  return ENTITIES[k] ?? m;
});

/**
 * A listing's HTML description → editable plain text that keeps paragraphs and bullets (the
 * seeker-side cleanDescription flattens to one line, which is fine for search but not for a form
 * the employer edits). Also handles entity-escaped HTML ("&lt;p&gt;…") some ATS APIs return.
 */
export function htmlToFormText(raw) {
  let t = String(raw == null ? '' : raw);
  if (!/<[a-z!/]/i.test(t) && /&lt;[a-z/]/i.test(t)) t = decodeEntities(t);
  t = t
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|ul|ol|h[1-6]|section|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ');
  t = decodeEntities(t)
    .split('\n').map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return t.slice(0, 8000);
}

/**
 * Shape a resolved listing (lib/server/listingResolve.js `fields`) into the employer create form's
 * fields. Pure — writes nothing. apply_url is the original listing link so applicants land in the
 * employer's own ATS. `missing` lists what the employer still has to fill in before posting; the
 * create action's validateNewListing stays the authoritative check.
 */
export function buildImportPreview(fields = {}, { url, claimCompanyName } = {}) {
  const f = fields || {};
  const listing = {
    title: String(f.title || '').trim().slice(0, 200),
    company: String(f.company || '').trim().slice(0, 120),
    location: String(f.location || '').trim().slice(0, 200),
    salary: f.salary ? String(f.salary).trim().slice(0, 120) : '',
    type: normalizeType(f.type),
    description: htmlToFormText(f.description),
    apply_url: isHttpUrl(url) ? String(url).trim().slice(0, 2000) : '',
  };
  const missing = [];
  if (listing.title.length < 3) missing.push('title');
  if (listing.description.length < 80) missing.push('description');
  if (!listing.apply_url) missing.push('apply_url');
  return {
    listing,
    company_matches: importCompanyMatches(listing.company, claimCompanyName),
    via: f.via || 'none',
    missing,
    needs_details: missing.length > 0,
  };
}
