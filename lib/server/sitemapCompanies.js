// The company pages the sitemap offers to search engines: every GRADED company, read page by page.
//
// Why paged: PostgREST caps any reply at 1,000 rows (max-rows), so a single `limit=10000` request
// silently returned the first 1,000 of 1,736 scored companies (2026-10-24).
//
// Why graded only (search plan 2026-10-24): a company page with no grade is served `noindex`
// (app/company/[slug]/layout.tsx), and a sitemap URL that answers noindex is a Search Console error.
// The rule is the page's own: the NEWEST company_scores row for the name (lib/growth.ts getScore reads
// `order=created_at.desc&limit=1`) must have an overall_score and pass isGradeable (lib/server/
// reportCounts.js: at least 1 real report and 5 pieces of evidence, a mention counting half).
// On 2026-10-24 that was 349 of 1,736 scored names.
import { isGradeable, firstPartyReportCount, scoreUpdatedAt } from './reportCounts.js';
import { hasMentionCount } from './scoreColumns.js';

export const SITEMAP_PAGE = 1000;
export const SITEMAP_MAX_URLS = 45000; // one sitemap file holds 50,000 URLs; leave room for the static routes

/**
 * @param {{ url?: string, key?: string, fetchImpl?: Function, pageSize?: number, max?: number, timeoutMs?: number }} [opts]
 * @returns {Promise<Array<{ name: string, lastModified: string|null }>>} most applicant reports first
 */
export async function fetchSitemapCompanies({ url, key, fetchImpl = fetch, pageSize = SITEMAP_PAGE, max = SITEMAP_MAX_URLS, timeoutMs = 8000 } = {}) {
  if (!url || !key) return [];
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const mention = (await hasMentionCount(url, headers, fetchImpl)) ? ',mention_count' : '';
  const select = `company_name,overall_score,first_party_report_count,report_count,data_source${mention},created_at,expires_at`;
  // Newest row per lowercased name — the row the page reads.
  const newest = new Map();
  for (let offset = 0; offset < SITEMAP_MAX_URLS * 2; offset += pageSize) {
    let rows;
    try {
      const r = await fetchImpl(
        `${url}/rest/v1/company_scores?select=${select}&order=company_name.asc,created_at.desc&limit=${pageSize}&offset=${offset}`,
        { headers, next: { revalidate: 3600 }, signal: AbortSignal.timeout(timeoutMs) },
      );
      if (!r.ok) break;
      rows = await r.json();
    } catch {
      break;
    }
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const row of rows) {
      const name = row && typeof row.company_name === 'string' ? row.company_name.trim() : '';
      if (!name) continue;
      const k = name.toLowerCase();
      const prev = newest.get(k);
      if (!prev || Date.parse(row.created_at || 0) > Date.parse(prev.created_at || 0)) newest.set(k, { ...row, company_name: name });
    }
    // A short page is the last page. The server may cap a page below pageSize, so also stop
    // only when fewer rows than the smaller of the two arrive.
    if (rows.length < Math.min(pageSize, SITEMAP_PAGE)) break;
  }
  return [...newest.values()]
    .filter((row) => row.overall_score != null && isGradeable(row))
    .sort((a, b) => firstPartyReportCount(b) - firstPartyReportCount(a) || a.company_name.localeCompare(b.company_name))
    .slice(0, max)
    .map((row) => ({ name: row.company_name, lastModified: scoreUpdatedAt(row) }));
}
