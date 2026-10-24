// What the public feed and the homepage ticker may show (audit 2026-10-23: /feed carried a Twilio
// CUSTOMER's "support ghosted me", an Albertsons employee's "she hired me and now is trying to get rid
// of me", and the ticker read "albertsons got an offer" seven times in a row).
//
// Rule: a first-party Seen report (or a review-site import) is shown as stored; a row compiled from
// public discussion (Reddit / "Public review · <host>") is shown ONLY when its stored text still
// passes the strict first-hand applicant rules (lib/reports/applicantRules.js) for its own company —
// the same check the ingest runs, re-run here because older imports (reddit_community_report,
// web_search_public_review, early reddit_rule_match) were accepted by looser rules. Pure, no I/O.

import { classifyApplicantAccount, isCompanySubreddit } from './applicantRules.js';
import { classifyPlatform } from '../../api/_utils/companyIntel.js';

import { stripAttribution } from './excerptText.js';
import { redditSubredditOf } from './platformLabel.js';

/** "Reddit r/Albertsons" (or the old doubled "Reddit r/r/Albertsons") → "Albertsons"; null for any other platform. */
export { redditSubredditOf };

/** A row compiled from public discussion (counted at 0.3 trust) rather than submitted to Seen. */
export function isPublicDiscussionRow(row) {
  const t = classifyPlatform(row?.platform);
  return t === 'reddit' || t === 'public_web';
}

// Rows the strict rules already accepted at ingest WITH their thread context (title names the company,
// opening post, company subreddit) — api/ingest-local-company-intel.js writes them with this reason.
// The stored excerpt alone often no longer names the company ("They rejected me… recruiter said the
// hiring manager really liked you", filed under Wells Fargo from a thread titled after it), so the
// feed re-check treats the company as established and judges the rest: customer story, employee
// story, advice, hearsay, negation, another employer named. Older reasons (LLM-era imports) get the
// full check, company naming included.
export const CONTEXT_VERIFIED_TRUST_REASONS = new Set(['reddit_rule_match']);

/** The classification the feed judges a public-discussion row by (null for first-party rows). */
export function feedRowVerdict(row) {
  if (!row || !row.company_name) return null;
  if (!isPublicDiscussionRow(row)) return null;
  const text = stripAttribution(row.report_text);
  const sub = redditSubredditOf(row.platform);
  const companySub = !!sub && isCompanySubreddit(sub, [row.company_name]);
  return classifyApplicantAccount(text, {
    names: [row.company_name],
    inCompanySub: companySub,
    contextVerified: CONTEXT_VERIFIED_TRUST_REASONS.has(String(row.trust_reason || '')),
  });
}

/** True when the feed / ticker may show this row. */
export function feedRowPasses(row) {
  if (!row || !row.company_name) return false;
  if (!isPublicDiscussionRow(row)) return true;
  const v = feedRowVerdict(row);
  return !!v && v.kind === 'applicant_outcome';
}

/**
 * One card per company per screen: the first (newest) row of each company is kept and carries
 * `more_from_company` = how many later rows of the same company were folded into it.
 */
export function collapseByCompany(rows) {
  const out = [];
  const idx = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const key = String(r?.company_name || '').toLowerCase().trim();
    if (!key) continue;
    if (idx.has(key)) { out[idx.get(key)].more_from_company += 1; continue; }
    idx.set(key, out.length);
    out.push({ ...r, more_from_company: 0 });
  }
  return out;
}
