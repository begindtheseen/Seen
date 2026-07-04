// Display-honesty helper: reports imported from the Reddit pipeline are stored with
// platform "Reddit r/<subreddit>" (api/reports.js), and the scoring fusion classifies
// reddit sources by /reddit/ on the platform string (api/_utils/companyIntel.js).
// This mirrors that same test so every surface that renders individual reports can label
// imported ones "Sourced from public discussion" — distinct from first-hand reports.
// Display only: scoring weights already down-weight reddit (SOURCE_TRUST) and are untouched.
export const isRedditSourced = (platform?: string | null): boolean =>
  /reddit/i.test(String(platform ?? ''))

export const PUBLIC_DISCUSSION_LABEL = 'Sourced from public discussion'
