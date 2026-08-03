// Pure helpers for employer replies to outcome reports (Wave 2). No I/O, no node builtins — shared
// by api/employer-replies.js, api/admin-stats.js, and tests. The endpoint + DB (RLS, unique index,
// status CHECK — migration 060) enforce; these shape/validate.
//
// INTEGRITY: nothing here touches scoring. A reply is display-only employer voice.

import { normalizeClaimCompany } from './employerClaims.js';

export const REPLY_MAX = 1200;
export const REPLY_MIN = 2;

/**
 * Clean + bound an employer reply body. Collapses runs of blank lines, trims, caps length.
 * Returns the cleaned string, or null when it isn't a usable reply (empty / too short).
 */
export function normalizeReplyBody(body) {
  const raw = String(body == null ? '' : body).replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (raw.length < REPLY_MIN) return null;
  return raw.slice(0, REPLY_MAX);
}

/** A report_id is usable if it's a non-empty, reasonably-bounded token (uuid or numeric-as-text). */
export function isValidReportId(id) {
  const s = String(id == null ? '' : id).trim();
  return s.length > 0 && s.length <= 64 && /^[\w-]+$/.test(s);
}

/**
 * Whether an employer scoped to `companyKey` may reply to a report whose company_name is
 * `reportCompanyName` — i.e. the report is about THEIR company. Lenient contains-match on the
 * normalized names (handles "Acme" vs "Acme Inc" the way the dashboard lookup does), because the
 * gate only decides "is this your company's report", and an admin still reviews before anything
 * goes public. Empty/again-null inputs are never a match.
 */
export function reportBelongsToCompany(companyKey, reportCompanyName) {
  const key = normalizeClaimCompany(companyKey);
  const rep = normalizeClaimCompany(reportCompanyName);
  if (!key || !rep) return false;
  return key === rep || key.includes(rep) || rep.includes(key);
}
