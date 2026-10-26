// Sources Seen never takes applicant reports from — owner decisions, enforced in one place:
//   • the Google collector never opens them (lib/reports/webHarvest.js SKIP_HOSTS),
//   • Seen's import refuses them (api/ingest-local-company-intel.js),
//   • the paid web-search backfill blocks them (scripts/credit/web-reports.mjs blocked_domains: HACKER_NEWS_DOMAINS).
//
// 2026-10-20  Glassdoor, Indeed, LinkedIn, Facebook, Instagram, X/Twitter, TikTok, Threads — their posts
//             belong to their users under those sites' terms (anti-scraping, litigation and account-ban risk).
// 2026-10-20  Hacker News — "filled with vibecoders trying to sneak fake reviews that are self advertisements".
// Tests: lib/reports/excludedSources.test.mjs.

export const HACKER_NEWS_DOMAINS = ['news.ycombinator.com', 'ycombinator.com', 'hn.algolia.com'];
// A name ending in "." matches that brand under any country domain (glassdoor.co.uk, ca.indeed.com…).
export const EXCLUDED_SOURCES = [
  ...HACKER_NEWS_DOMAINS,
  'glassdoor.', 'indeed.', 'linkedin.com', 'facebook.com', 'instagram.com', 'x.com', 'twitter.com', 'tiktok.com', 'threads.net',
];

export function hostMatches(host, entry) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  if (!h) return false;
  return entry.endsWith('.') ? (h.startsWith(entry) || h.includes(`.${entry}`)) : (h === entry || h.endsWith(`.${entry}`));
}

/** The excluded entry an https URL belongs to, or null. A URL that cannot be parsed is not judged here. */
export function excludedSource(url) {
  let host; try { host = new URL(String(url)).hostname; } catch { return null; }
  return EXCLUDED_SOURCES.find((e) => hostMatches(host, e)) || null;
}
