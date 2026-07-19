// Employer notification feed — DERIVED, keyless, computed live on page load.
//
// WHAT "NOTIFY" HONESTLY MEANS HERE
// There is no employer login and no email/push delivery infrastructure in this codebase (the only
// mail path is api/apply.js's direct Resend call for candidate→employer application emails, and it
// has no employer addresses to send to). So "Employers receive timely notifications about updates
// to their job postings" is delivered the honest smallest way: compute what an employer needs to
// know from data that ALREADY exists and show it the moment they open /employers/notifications.
// "Timely" = derived on every load, not a stored/queued event. No new events table, no cron, no
// fabricated sender — email/push is a named follow-up (see the PR).
//
// EMPLOYER IDENTITY = COMPANY NAME. The portal creates no accounts (app/employers/page.tsx), so an
// employer is identified exactly the way the reputation tool identifies them — by looking up their
// company name (components/employer/EmployerReputation.tsx → /api/reports `company_score`). The
// page fetches this employer's rows by company name and hands them here.
//
// TWO REAL SOURCES, both already in the DB:
//   • jobs         — aggregated listings carrying `company`, `availability_status`, `last_seen_at`.
//                    Staleness is AGE-based and defined once in api/refresh-jobs.js › markStaleJobs:
//                    active→stale at 7d since last_seen_at, →expired at 14d. (staleRefresh.js then
//                    re-confirms liveness.) "Expiring postings" is that rule, surfaced to the owner.
//   • applications — candidate-side application reports carrying `company_name`, `role`, `city`,
//                    `status`, `created_at` (the seeker application tracker — the same corpus behind
//                    a company's ghost rate). "New applicants" = recent reports for this company,
//                    grouped by role. Only non-identifying fields are ever surfaced (role/city/when).
//
// This module is PURE (no IO): given jobs + applications + now, it returns the feed. That keeps the
// derivation unit-testable and lets the page (a server component) own the fetch.

// Thresholds MIRROR api/refresh-jobs.js › markStaleJobs EXACTLY — keep them in lockstep, do not drift.
export const STALE_AFTER_DAYS = 7; //  active → stale     once last_seen_at passes 7 days
export const EXPIRE_AFTER_DAYS = 14; // stale/active → expired once last_seen_at passes 14 days

// A posting within this many days of a threshold is surfaced as "about to cross it" so the owner has
// lead time to refresh a still-open role before it silently drops out of search results.
export const NEARING_WINDOW_DAYS = 2;

// How far back a candidate report still counts as a "new applicant". One stale cycle (7 days) keeps
// the feed to genuinely recent activity rather than replaying the company's whole application history.
export const APPLICANT_WINDOW_DAYS = 7;

const DAY_MS = 86400000;
const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 };

const toMs = (v) => {
  if (v == null) return NaN;
  if (typeof v === 'number') return v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? NaN : t;
};

function headlineForKind(kind, title) {
  switch (kind) {
    case 'posting_expired': return `Posting expired: ${title}`;
    case 'posting_stale': return `Posting going stale: ${title}`;
    case 'posting_nearing_stale': return `Posting needs a refresh: ${title}`;
    default: return title;
  }
}

// Derive one posting's notification (or null when it's healthy / not reasoned-about).
function derivePostingItem(job, nowMs) {
  const status = String(job.availability_status || '').toLowerCase();
  // A blocked/ambiguous liveness verdict ('unknown') carries no signal — never guess (staleRefresh.js).
  if (status === 'unknown') return null;

  const anchorRaw = job.last_seen_at || job.created_at || null;
  const anchorMs = toMs(anchorRaw);
  const ageDays = Number.isNaN(anchorMs) ? null : (nowMs - anchorMs) / DAY_MS;
  const title = job.title || 'Untitled posting';

  const isExpired = status === 'expired' || (ageDays != null && ageDays >= EXPIRE_AFTER_DAYS);
  const isStale = status === 'stale' || (ageDays != null && ageDays >= STALE_AFTER_DAYS);
  const isNearingStale = ageDays != null && ageDays >= STALE_AFTER_DAYS - NEARING_WINDOW_DAYS;

  let kind, severity, detail;
  let daysUntilExpiry;

  if (isExpired) {
    kind = 'posting_expired';
    severity = 'critical';
    detail = `“${title}” has expired on Seen and is dropping out of search results. Refresh or re-post the listing to keep receiving applicants.`;
  } else if (isStale) {
    kind = 'posting_stale';
    severity = 'warning';
    daysUntilExpiry = ageDays != null ? Math.max(0, Math.ceil(EXPIRE_AFTER_DAYS - ageDays)) : null;
    detail = daysUntilExpiry != null
      ? `“${title}” is marked stale and will expire in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'} unless it's seen again on its source. Refresh it to stay visible.`
      : `“${title}” is marked stale. Refresh it to stay visible.`;
  } else if (isNearingStale) {
    kind = 'posting_nearing_stale';
    severity = 'warning';
    const daysUntilStale = Math.max(0, Math.ceil(STALE_AFTER_DAYS - ageDays));
    detail = `“${title}” will be marked stale in ${daysUntilStale} day${daysUntilStale === 1 ? '' : 's'} if it isn't seen again — after that it has ${NEARING_WINDOW_DAYS === 0 ? '' : `${EXPIRE_AFTER_DAYS - STALE_AFTER_DAYS} more days `}before it expires.`;
  } else {
    return null; // healthy / recently-seen posting — nothing to notify
  }

  const jid = job.id ?? `${job.company || ''}|${title}`;
  return {
    id: `job:${jid}:${kind}`,
    kind,
    severity,
    title: headlineForKind(kind, title),
    detail,
    at: Number.isNaN(anchorMs) ? null : new Date(anchorMs).toISOString(),
    jobId: job.id ?? null,
    role: job.title || null,
    city: job.city || job.location || null,
    ageDays: ageDays == null ? null : Math.floor(ageDays),
    ...(daysUntilExpiry != null ? { daysUntilExpiry } : {}),
  };
}

// Group recent application reports by role into "N new applicants" items.
function deriveApplicantItems(applications, nowMs) {
  const windowMs = APPLICANT_WINDOW_DAYS * DAY_MS;
  const groups = new Map();

  for (const app of applications) {
    if (!app || !app.created_at) continue;
    const t = toMs(app.created_at);
    // recent AND not in the future (guards clock skew / bad rows) — precision-first.
    if (Number.isNaN(t) || t > nowMs || nowMs - t > windowMs) continue;
    const roleRaw = String(app.role || '').trim();
    const key = roleRaw.toLowerCase() || '__norole__';
    let g = groups.get(key);
    if (!g) { g = { role: roleRaw, count: 0, latest: t, cities: new Set() }; groups.set(key, g); }
    g.count += 1;
    if (t > g.latest) g.latest = t;
    if (app.city) g.cities.add(String(app.city).trim());
  }

  const items = [];
  for (const g of groups.values()) {
    const cities = [...g.cities].filter(Boolean);
    items.push({
      id: `apps:${g.role.toLowerCase() || '__norole__'}`,
      kind: 'new_applicants',
      severity: 'info',
      title: `${g.count} new applicant${g.count === 1 ? '' : 's'}${g.role ? ` — ${g.role}` : ''}`,
      detail: g.role
        ? `${g.count} candidate${g.count === 1 ? '' : 's'} reported applying to “${g.role}” in the last ${APPLICANT_WINDOW_DAYS} days${cities.length ? ` (${cities.slice(0, 3).join(', ')}${cities.length > 3 ? '…' : ''})` : ''}.`
        : `${g.count} candidate${g.count === 1 ? '' : 's'} reported applying to you in the last ${APPLICANT_WINDOW_DAYS} days.`,
      at: new Date(g.latest).toISOString(),
      role: g.role || null,
      count: g.count,
      cities,
    });
  }
  return items;
}

/**
 * @typedef {Object} EmployerFeedThresholds
 * @property {number} STALE_AFTER_DAYS
 * @property {number} EXPIRE_AFTER_DAYS
 * @property {number} NEARING_WINDOW_DAYS
 * @property {number} APPLICANT_WINDOW_DAYS
 */

/**
 * @typedef {Object} EmployerFeedSummary
 * @property {number} total
 * @property {number} newApplicants
 * @property {number} postingsExpired
 * @property {number} postingsStale
 * @property {number} postingsNearingStale
 * @property {number|null} newSinceVisit
 */

/**
 * @typedef {Object} EmployerNotificationItem
 * @property {string} id
 * @property {'new_applicants'|'posting_expired'|'posting_stale'|'posting_nearing_stale'} kind
 * @property {'critical'|'warning'|'info'} severity
 * @property {string} title
 * @property {string} detail
 * @property {string|null} at
 * @property {string|null} [role]
 * @property {string|null} [city]
 * @property {number} [count]
 * @property {number} [daysUntilExpiry]
 * @property {number|null} [ageDays]
 * @property {boolean} [isNew]
 * @property {string[]} [cities]
 */

/**
 * Derive an employer's live notification feed from real rows.
 *
 * @param {Object}   input
 * @param {Array}    input.jobs         - this company's `jobs` rows (id,title,company,city,availability_status,last_seen_at,created_at)
 * @param {Array}    input.applications - this company's `applications` rows (role,city,status,created_at) — non-identifying fields only
 * @param {number|string} [input.now]   - reference "now" (ms or ISO); defaults to Date.now()
 * @param {number|string|null} [input.lastVisit] - the employer's last visit (ms/ISO) to flag items as new; optional
 * @returns {{ items: EmployerNotificationItem[], summary: EmployerFeedSummary, thresholds: EmployerFeedThresholds }}
 */
export function deriveEmployerNotifications({ jobs = [], applications = [], now = Date.now(), lastVisit = null } = {}) {
  const nowMs = toMs(now);
  const nowResolved = Number.isNaN(nowMs) ? Date.now() : nowMs;

  const items = [];

  // ── Postings: stale / expiring, from the age-based rule ──────────────────────
  const seen = new Set();
  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (!job) continue;
    const dedupeKey = job.id ?? `${job.company || ''}|${job.title || ''}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const item = derivePostingItem(job, nowResolved);
    if (item) items.push(item);
  }

  // ── New applicants: recent reports grouped by role ───────────────────────────
  items.push(...deriveApplicantItems(Array.isArray(applications) ? applications : [], nowResolved));

  // ── Sort: most urgent first (critical → warning → info), then most recent ────
  items.sort((a, b) => {
    const r = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (r !== 0) return r;
    return (b.at ? Date.parse(b.at) : 0) - (a.at ? Date.parse(a.at) : 0);
  });

  // ── since-last-visit flag (client passes its stored last-visit; server state not required) ──
  const lastVisitMs = lastVisit == null ? null : toMs(lastVisit);
  if (lastVisitMs != null && !Number.isNaN(lastVisitMs)) {
    for (const it of items) it.isNew = it.at ? Date.parse(it.at) > lastVisitMs : false;
  }

  const summary = {
    total: items.length,
    newApplicants: items.filter((i) => i.kind === 'new_applicants').reduce((n, i) => n + (i.count || 0), 0),
    postingsExpired: items.filter((i) => i.kind === 'posting_expired').length,
    postingsStale: items.filter((i) => i.kind === 'posting_stale').length,
    postingsNearingStale: items.filter((i) => i.kind === 'posting_nearing_stale').length,
    newSinceVisit: lastVisitMs != null && !Number.isNaN(lastVisitMs) ? items.filter((i) => i.isNew).length : null,
  };

  return {
    items,
    summary,
    thresholds: { STALE_AFTER_DAYS, EXPIRE_AFTER_DAYS, NEARING_WINDOW_DAYS, APPLICANT_WINDOW_DAYS },
  };
}
