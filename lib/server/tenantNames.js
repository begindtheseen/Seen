// A stored board slug → the employer's registered name, at serve time.
//
// 62,219 of 81,918 active job rows (2026-10-24) carry an ATS tenant slug as `company` ("plscareers",
// "spacexglobal", "lucidmotors"), and the dedupe trigger never rewrites `company` on a re-seen row,
// so a stored slug outlives any ingest fix until the owner approves a backfill. The registry row
// the board was discovered under (company_sources.tenant → company_name) is the name a person or
// the board's own feed gave it — the hourly sync writes learned names there (lib/jobs/sourceRegistry.js
// recordSourceSync). This reads that map once per instance (10 min), paged under PostgREST's
// 1,000-row cap, and renames a row whose `company` is still the slug. Fail-safe: any error yields
// the last good map (or an empty one) and the row keeps its stored name.

const TTL_MS = 10 * 60_000;
const PAGE = 1000;
const MAX_PAGES = 12;
let cache = { at: 0, map: new Map() };

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
// A company value that is just a slug: lowercase letters/digits, no spaces.
const slugLike = (s) => /^[a-z0-9]+$/.test(String(s ?? '').trim()) && /[a-z]/.test(String(s ?? ''));

/** @returns {Promise<Map<string, string>>} tenant → registered company name (only where they differ) */
export async function loadTenantNames(supabaseUrl, headers, { fetchImpl = fetch, now = Date.now() } = {}) {
  if (!supabaseUrl) return cache.map;
  if (cache.at > 0 && now - cache.at < TTL_MS) return cache.map; // at 0 = never loaded
  const map = new Map();
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const r = await fetchImpl(`${supabaseUrl}/rest/v1/company_sources?select=tenant,company_name&order=tenant.asc&limit=${PAGE}&offset=${page * PAGE}`, { headers });
      if (!r.ok) throw new Error(`company_sources ${r.status}`);
      const rows = await r.json();
      if (!Array.isArray(rows)) break;
      for (const row of rows) {
        const tenant = String(row?.tenant || '').toLowerCase().trim();
        const name = String(row?.company_name || '').replace(/\s+/g, ' ').trim();
        if (!tenant || !name) continue;
        // The registered name is a name only when it is more than the slug (case alone does not count:
        // a seed "Stripe" for `stripe` is a name, a lowercase "plscareers" for `plscareers` is not).
        if (name === name.toLowerCase() && norm(name) === tenant) continue;
        if (!map.has(tenant)) map.set(tenant, name);
      }
      if (rows.length < PAGE) break;
    }
    cache = { at: now, map };
  } catch {
    cache = { at: now, map: cache.map };
  }
  return cache.map;
}

/** For tests: forget the cached map. */
export function resetTenantNamesCache() { cache = { at: 0, map: new Map() }; }

/**
 * The row with its company renamed when `company` is still the board slug and the registry names
 * that tenant. Rows with a real name, or no mapping, are returned as they are.
 * @template T extends { company?: string|null, ats_tenant?: string|null }
 * @param {T} row
 * @param {Map<string, string>} map
 * @returns {T}
 */
export function withTenantName(row, map) {
  if (!row || !map || !map.size) return row;
  const company = String(row.company ?? '').trim();
  if (!slugLike(company)) return row;
  const tenant = String(row.ats_tenant || '').toLowerCase().trim();
  const name = (tenant && norm(company) === tenant ? map.get(tenant) : null) || map.get(company.toLowerCase());
  if (!name || name === company) return row;
  return { ...row, company: name, company_slug: company };
}

/** `withTenantName` over a list. */
export function applyTenantNames(rows, map) {
  if (!Array.isArray(rows) || !map || !map.size) return Array.isArray(rows) ? rows : [];
  return rows.map((r) => withTenantName(r, map));
}
