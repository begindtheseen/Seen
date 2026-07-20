// Pure helpers for PERSISTED employer notifications (migration 057) — real point-in-time events.
//
// No I/O. Build a row for insertion, normalize a stored row into the feed-item shape the client
// renders, and merge persisted events with the live-DERIVED staleness/applicant items
// (lib/server/employerNotifications.js) into one feed. Persisted items keep their read/unread state;
// derived items are transient. Endpoints (api/employer-notifications.js, api/apply.js,
// api/user-sync.js, api/admin-stats.js) do the DB insert/read + auth.

import { normalizeClaimCompany } from './employerClaims.js';

export const STORED_NOTIFICATION_KINDS = ['apply_activity', 'listing_reported', 'dispute_approved', 'dispute_denied'];

const SEVERITY_BY_KIND = {
  apply_activity: 'info',
  listing_reported: 'warning',
  dispute_approved: 'info',
  dispute_denied: 'info',
};

function defaultTitle(kind) {
  switch (kind) {
    case 'apply_activity': return 'New applicant activity';
    case 'listing_reported': return 'A listing was reported';
    case 'dispute_approved': return 'Your dispute was approved';
    case 'dispute_denied': return 'Your dispute was reviewed';
    default: return 'Update';
  }
}

/**
 * Build an employer_notifications row (migration 057). Pure — the caller inserts it with the service
 * key. Returns null for an unknown kind or when no company key can be resolved (never store an
 * unscoped notification — that would be a bleed vector).
 */
export function buildNotificationRow(kind, {
  companyName, companyKey, employerUserId = null, title, body = null, jobId = null, severity = null, meta = {},
} = {}) {
  if (!STORED_NOTIFICATION_KINDS.includes(kind)) return null;
  const key = (companyKey && String(companyKey).trim()) || normalizeClaimCompany(companyName);
  if (!key) return null;
  return {
    company_key: key,
    company_name: companyName || null,
    employer_user_id: employerUserId,
    kind,
    severity: severity || SEVERITY_BY_KIND[kind] || 'info',
    title: (title && String(title).slice(0, 300)) || defaultTitle(kind),
    body: body != null ? String(body).slice(0, 1000) : null,
    job_id: jobId != null ? String(jobId) : null,
    meta: meta && typeof meta === 'object' ? meta : {},
  };
}

/**
 * Normalize a stored employer_notifications row into the feed-item shape the client renders (aligned
 * with the derived feed's item shape so one component paints both).
 */
export function persistedToFeedItem(row) {
  return {
    id: `evt:${row.id}`,
    kind: row.kind,
    severity: row.severity || 'info',
    title: row.title,
    detail: row.body || '',
    at: row.created_at || null,
    jobId: row.job_id || null,
    read: !!row.read_at,
    meta: row.meta || {},
    stored: true,
  };
}

const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 };

/**
 * Merge persisted event rows with live-derived items into one feed, most-urgent-then-newest.
 * Persisted items carry real read state; derived items are always treated as read (transient).
 * Returns { items, unread, storedCount }.
 */
export function mergeFeed(persistedRows = [], derivedItems = []) {
  const persisted = (Array.isArray(persistedRows) ? persistedRows : []).map(persistedToFeedItem);
  const derived = (Array.isArray(derivedItems) ? derivedItems : []).map((d) => ({ ...d, stored: false, read: true }));
  const items = [...persisted, ...derived].sort((a, b) => {
    const r = (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3);
    if (r !== 0) return r;
    return (b.at ? Date.parse(b.at) : 0) - (a.at ? Date.parse(a.at) : 0);
  });
  return { items, unread: persisted.filter((i) => !i.read).length, storedCount: persisted.length };
}
