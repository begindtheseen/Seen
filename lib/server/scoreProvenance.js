// Which cached company scores are honest enough to show a user, and what to call them.
//
// A company score is a public statement about a named employer — "this company ghosts 61% of
// applicants" is an accusation, and the whole legal posture of this product rests on it being an
// attributed aggregation of real evidence rather than our own verdict.
//
// The cache holds 552 rows written by a since-deleted bulk path with `data_source: 'ai_estimate'`,
// all generated on one day, all carrying a numeric ghost_rate, and none backed by a single report
// (report_count = 0 on every one). Their mean overall_score is 54 against 71 for web-researched rows
// and 85 for report-derived ones, so the invented figures skew hardest toward accusing companies.
// They are still live — nothing expired them.
//
// Two rules follow, and both are about provenance rather than score value:
//   1. A score with no evidence behind it is not served. It is treated as a cache MISS so the caller
//      falls through to real aggregation, and failing that to the honest "no data yet" state.
//   2. Provenance is never renamed. The serving layer used to collapse every non-'reports' row to
//      'web_research', which relabeled an AI guess as research. Unrecognized provenance now stays
//      unrecognized.

// Provenance values written by code paths that consult real evidence.
const EVIDENCED_SOURCES = new Set(['reports', 'web_search', 'web_research', 'fused']);

// Provenance values known to be model output with no underlying evidence. Kept explicit — an
// unrecognized value is handled by the evidence check below, not by guessing it is safe.
const UNEVIDENCED_SOURCES = new Set(['ai_estimate', 'ai_generated', 'estimate', 'llm']);

export { EVIDENCED_SOURCES, UNEVIDENCED_SOURCES };

/**
 * Is this stored score row backed by anything we can point at?
 *
 * A row qualifies when its provenance is a known evidence-consulting path AND it actually carries
 * evidence — a report of some kind, or a web-review corpus. Rows whose provenance we do not
 * recognize are refused rather than assumed good: the failure mode of showing a fabricated
 * accusation is far worse than the failure mode of showing "no data yet".
 */
export function isEvidencedScore(row) {
  if (!row || typeof row !== 'object') return false;
  const source = typeof row.data_source === 'string' ? row.data_source.trim().toLowerCase() : '';
  if (UNEVIDENCED_SOURCES.has(source)) return false;
  if (!EVIDENCED_SOURCES.has(source)) return false;

  const firstParty = Number(row.first_party_report_count) || 0;
  const web = Number(row.web_report_count) || 0;
  const total = Number(row.report_count) || 0;
  const reviews = Array.isArray(row.web_reviews) ? row.web_reviews.length : 0;
  return firstParty > 0 || web > 0 || total > 0 || reviews > 0;
}

/** Why a row was refused — for logging and admin surfaces, never shown to a job seeker. */
export function suppressionReason(row) {
  if (!row || typeof row !== 'object') return 'no-row';
  const source = typeof row.data_source === 'string' ? row.data_source.trim().toLowerCase() : '';
  if (UNEVIDENCED_SOURCES.has(source)) return `unevidenced-source:${source || 'unknown'}`;
  if (!EVIDENCED_SOURCES.has(source)) return `unrecognized-source:${source || 'null'}`;
  if (!isEvidencedScore(row)) return 'no-evidence-behind-score';
  return null;
}

/**
 * The provenance label to serve for a row. Only reports-derived scores may claim 'reports'; every
 * other evidenced row is web research. Nothing else is renamed into a category it did not come from.
 */
export function servedDataSource(row) {
  const source = typeof row?.data_source === 'string' ? row.data_source.trim().toLowerCase() : '';
  if (source === 'reports') return 'reports';
  if (source === 'fused') return 'fused';
  if (source === 'web_search' || source === 'web_research') return 'web_research';
  return source || 'unknown';
}
