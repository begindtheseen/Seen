// Pure helpers for LISTING DISPUTES (migration 056) — the employer→admin correction loop.
//
// No I/O, no node builtins — safe to import from the employer endpoint (api/employer-listings.js),
// the admin endpoint (api/admin-stats.js), and tests. These functions validate an employer's
// dispute submission, decide what an APPROVED dispute does to the listing, and order/count the
// admin queue. The endpoints do the DB work + auth; the DB (RLS + CHECK constraints, migration 056)
// is the backstop.
//
// PRODUCT RULE: employers never directly edit/delete an existing listing. Every change/removal is a
// dispute an admin approves or denies. On approval the admin applies the effect resolveDisputeEffect
// returns — a takedown reuses the exact delete_listing machinery (expire + suppress), an edit
// applies the sanitized proposed_changes. This keeps the neutral-aggregator posture intact.

import { normalizeClaimCompany } from './employerClaims.js';

export const DISPUTE_KINDS = ['inactive', 'delete', 'edit', 'not_ours', 'other'];
export const DISPUTE_STATUSES = ['open', 'approved', 'denied'];
export const DISPUTE_DECISIONS = ['approved', 'denied']; // admin verdicts
// Fields an 'edit' dispute may propose to change on the jobs row.
export const EDITABLE_FIELDS = ['title', 'description', 'location', 'salary', 'apply_url'];

export function isDisputeKind(k) { return DISPUTE_KINDS.includes(String(k == null ? '' : k)); }
export function isDisputeStatus(s) { return DISPUTE_STATUSES.includes(String(s == null ? '' : s)); }
export function isDisputeDecision(d) { return DISPUTE_DECISIONS.includes(String(d == null ? '' : d)); }

// The scope/group key = the SAME canonical company key the claims table + surfaces use
// (lower/trim/collapse-ws), so a dispute's company_key collides with employer_company_claims.company_name.
export function disputeCompanyKey(name) { return normalizeClaimCompany(name); }

/**
 * An http(s) URL, and only that. Used for the apply/redirect target — never accept a non-URL there.
 */
export function isHttpUrl(v) {
  const s = String(v == null ? '' : v).trim();
  if (!/^https?:\/\//i.test(s)) return false;
  try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}

/**
 * Classify a jobs row's origin for the employer listing table + badge:
 *   'employer'   — the employer posted it themselves (migration 055).
 *   'imported'   — a paste-a-link import (source 'Imported').
 *   'aggregated' — everything else (Adzuna/Remotive/… — third-party aggregated data).
 */
export function classifyListingOrigin(job) {
  if (!job || typeof job !== 'object') return 'aggregated';
  if (job.is_employer_posted || job.employer_user_id) return 'employer';
  if (String(job.source || '').trim().toLowerCase() === 'imported') return 'imported';
  return 'aggregated';
}

/**
 * Whitelist + cap + type-check an 'edit' dispute's proposed changes. Only EDITABLE_FIELDS survive;
 * apply_url must be a real http(s) URL or it's dropped; empties are dropped. Returns a plain object
 * safe to store as proposed_changes and later apply as a jobs PATCH.
 */
export function sanitizeProposedChanges(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  const caps = { title: 200, description: 8000, location: 200, salary: 120, apply_url: 2000 };
  for (const f of EDITABLE_FIELDS) {
    if (input[f] == null) continue;
    const v = String(input[f]).trim();
    if (!v) continue;
    if (f === 'apply_url' && !isHttpUrl(v)) continue;
    out[f] = v.slice(0, caps[f]);
  }
  return out;
}

/**
 * Validate + normalize an employer's dispute submission.
 * Returns { ok:true, dispute:{ job_id, kind, reason, detail, proposed_changes } } or { ok:false, error }.
 */
export function validateDisputeInput({ job_id, kind, detail, reason, proposed_changes } = {}) {
  const jid = String(job_id == null ? '' : job_id).trim();
  if (!jid) return { ok: false, error: 'A listing is required' };
  if (!isDisputeKind(kind)) return { ok: false, error: 'Invalid dispute type' };
  const det = String(detail == null ? '' : detail).trim();
  if (det.length < 4) return { ok: false, error: 'Please describe the problem in a few words' };
  const changes = kind === 'edit' ? sanitizeProposedChanges(proposed_changes) : {};
  if (kind === 'edit' && Object.keys(changes).length === 0) {
    return { ok: false, error: 'An edit request needs at least one proposed change' };
  }
  return {
    ok: true,
    dispute: {
      job_id: jid,
      kind,
      reason: reason ? String(reason).slice(0, 120) : null,
      detail: det.slice(0, 2000),
      proposed_changes: changes,
    },
  };
}

/**
 * What applying an APPROVED dispute does to the listing (the endpoint executes it):
 *   inactive | delete | not_ours → { takedown:true }  (expire + suppress, like delete_listing)
 *   edit                         → { edit:true, patch } when there's a non-empty sanitized patch
 *   other                        → no automatic mutation (admin note only)
 */
export function resolveDisputeEffect(dispute) {
  const kind = dispute && dispute.kind;
  if (kind === 'inactive' || kind === 'delete' || kind === 'not_ours') {
    return { takedown: true, edit: false, patch: null };
  }
  if (kind === 'edit') {
    const patch = sanitizeProposedChanges(dispute && dispute.proposed_changes);
    return { takedown: false, edit: Object.keys(patch).length > 0, patch };
  }
  return { takedown: false, edit: false, patch: null };
}

// Admin queue helpers (mirror api/_utils/companyReddit.js).
export function disputeStatusCounts(rows) {
  const out = { open: 0, approved: 0, denied: 0 };
  for (const r of (Array.isArray(rows) ? rows : [])) if (out[r && r.status] != null) out[r.status]++;
  return out;
}
export function orderDisputesOpenFirst(rows) {
  const rank = { open: 0, approved: 1, denied: 2 };
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) =>
    ((rank[a && a.status] ?? 9) - (rank[b && b.status] ?? 9)) ||
    ((Date.parse(b && b.created_at) || 0) - (Date.parse(a && a.created_at) || 0)));
}
