// Duplicate report copies — the same account stored twice. Tests: lib/server/reportDupes.test.mjs.
//
// Prod 2026-10-20: the Oct 18 SpaceX / Tesla import ran twice. Every imported row exists exactly twice
// (same company, outcome, platform, role and text; invented timestamps up to a year apart): 150 extra
// copies — 13 hiring accounts (SpaceX's "16 applicant reports" were 11 accounts, 5 counted twice in the
// response / ghost math) and 137 employee reviews. Each account must count once.
//
// A copy is never deleted. It is marked { needs_review: true, trust_reason: 'duplicate_import' }:
// hidden from every public list, never scored (reportCounts.js NEVER_SCORED_TRUST_REASONS), out of the
// admin review queue, and reversible — the prior values and the kept original's id go to
// admin_audit_log. needs_review:true keeps a marked copy out of the score under the OLD filter as well,
// so the order of deploy and data change does not matter.
//
// Only substantive text is compared (≥ 40 characters): two Seen users who each submit "Ghosted" with
// no text are two reports, not one.

import { DUPLICATE_TRUST_REASON, REJECTED_TRUST_REASON } from './reportCounts.js';

export { DUPLICATE_TRUST_REASON };
export const MIN_DUP_TEXT = 40;

const norm = (v) => String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Identity of one account, or null when the text is too short to call two rows the same account. */
export function reportDupKey(r) {
  const text = norm(r?.report_text);
  if (text.length < MIN_DUP_TEXT) return null;
  return [norm(r.company_name), norm(r.outcome), norm(r.platform), norm(r.role), text].join('\n');
}

const ts = (r) => { const t = Date.parse(r?.created_at || ''); return Number.isFinite(t) ? t : 0; };

/**
 * rows → copies to mark: every row after the first of its key. The original kept is the oldest copy an
 * admin has NOT rejected (then lowest id), so a re-run picks the same one and an approved copy is never
 * dropped in favour of a rejected one. Already-marked rows are ignored; already-rejected copies are
 * left as they are (they count for nothing either way).
 * @returns {{ dupes: {id:string, keep:string, company:string}[], groups: number }}
 */
export function findDuplicateReports(rows) {
  const byKey = new Map();
  for (const r of rows || []) {
    if (!r || r.trust_reason === DUPLICATE_TRUST_REASON) continue;
    const k = reportDupKey(r);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
  const dupes = [];
  let groups = 0;
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    groups++;
    const rejected = (r) => r.trust_reason === REJECTED_TRUST_REASON;
    const [keep, ...rest] = [...list].sort((a, b) => (rejected(a) - rejected(b)) || ts(a) - ts(b) || String(a.id).localeCompare(String(b.id)));
    for (const r of rest) if (!rejected(r)) dupes.push({ id: String(r.id), keep: String(keep.id), company: String(r.company_name || '') });
  }
  return { dupes, groups };
}

export const DUPLICATE_PATCH = Object.freeze({ needs_review: true, trust_reason: DUPLICATE_TRUST_REASON });
