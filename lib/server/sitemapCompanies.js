// Every scored company name for the sitemap, read page by page.
//
// Why: PostgREST caps any reply at 1,000 rows (max-rows), so the old single request with
// `limit=10000` silently returned the first 1,000 of 1,736 scored companies (2026-10-24) and the
// rest were never offered to search engines. Pages are ordered by report_count then name so the
// offsets are stable while rows are added.
export const SITEMAP_PAGE = 1000;
export const SITEMAP_MAX_URLS = 45000; // one sitemap file holds 50,000 URLs; leave room for the static routes

/**
 * @param {{ url?: string, key?: string, fetchImpl?: Function, pageSize?: number, max?: number, timeoutMs?: number }} [opts]
 * @returns {Promise<string[]>}
 */
export async function fetchAllCompanyNames({ url, key, fetchImpl = fetch, pageSize = SITEMAP_PAGE, max = SITEMAP_MAX_URLS, timeoutMs = 8000 } = {}) {
  if (!url || !key) return [];
  const names = [];
  const seen = new Set();
  for (let offset = 0; offset < max; offset += pageSize) {
    let rows;
    try {
      const r = await fetchImpl(
        `${url}/rest/v1/company_scores?select=company_name&order=report_count.desc.nullslast,company_name.asc&limit=${pageSize}&offset=${offset}`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` }, next: { revalidate: 3600 }, signal: AbortSignal.timeout(timeoutMs) },
      );
      if (!r.ok) break;
      rows = await r.json();
    } catch {
      break;
    }
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const row of rows) {
      const name = row && typeof row.company_name === 'string' ? row.company_name.trim() : '';
      const k = name.toLowerCase();
      if (name && !seen.has(k)) { seen.add(k); names.push(name); }
    }
    // A short page is the last page. The server may cap a page below pageSize, so also stop
    // only when fewer rows than the smaller of the two arrive.
    if (rows.length < Math.min(pageSize, SITEMAP_PAGE)) break;
  }
  return names.slice(0, max);
}
