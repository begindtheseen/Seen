// The searches people actually ran, for the scheduled refresh to keep alive.
//
// Audit 2026-10-27: the refresh cron (api/refresh-jobs.js) cycles a fixed catalog of 260 (role, city) pairs, almost all
// in Los Angeles, New York and Chicago. A search a person ran — "cashier · Phoenix", "valet · Anaheim" — was pulled once,
// live, and never again; its listings expired, and the next person in that city found 2 cashier listings. Each run now
// spends a few of its Adzuna calls on the most-searched pairs of the last two weeks (search_pull_log), normalised — the
// typed place resolved ("anahiem ca" → Anaheim, CA), the role read ("part time cashir" → cashier) — and skips any pair a
// person's own search already refreshed in the last 20 hours.
import { resolveLocation } from '../geo/resolveLocation.js';
import { parseSearchQuery, wordCount } from '../jobs/searchQuery.js';

/**
 * @param {Array<{ query: string, location: string, pulled_at: string, result_count?: number }>} rows search_pull_log rows
 * @param {{ now?: number, limit?: number, freshHours?: number, exclude?: Array<{what: string, where: string}> }} [opts]
 * @returns {Array<{ what: string, where: string, searches: number }>} most-searched first
 */
export function pickDemandSearches(rows, { now = Date.now(), limit = 8, freshHours = 20, exclude = [] } = {}) {
  const groups = new Map();
  const skip = new Set(exclude.map((e) => `${String(e.what).toLowerCase()}|${String(e.where).toLowerCase()}`));
  for (const r of Array.isArray(rows) ? rows : []) {
    const parsed = parseSearchQuery(String(r.query || ''), { hasLocation: !!r.location });
    const what = parsed.role.replace(/[^a-z0-9+#&' -]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!what || what.length < 3 || what.length > 60) continue;
    // a real search names a job or an employer Seen's listings use ("see", "subscribers ." are not searches)
    if (!what.split(' ').some((w) => w.length >= 4 && wordCount(w) >= 10)) continue;
    let where = '';
    const rawLoc = String(r.location || parsed.location || '').trim();
    if (rawLoc && rawLoc.toLowerCase() !== 'remote') {
      const loc = resolveLocation(rawLoc);
      if (!loc || (loc.kind !== 'city' && loc.kind !== 'state')) continue; // an unreadable place is not worth a call
      where = loc.label;
    } else if (rawLoc.toLowerCase() === 'remote' || parsed.remote) {
      where = 'Remote';
    } else {
      continue; // a nationwide search: the catalog's remote and national pulls cover it
    }
    const key = `${what}|${where.toLowerCase()}`;
    if (skip.has(key)) continue;
    const at = Date.parse(r.pulled_at) || 0;
    const g = groups.get(key) || { what, where, searches: 0, last: 0 };
    g.searches++;
    g.last = Math.max(g.last, at);
    groups.set(key, g);
  }
  const freshMs = freshHours * 3600_000;
  return [...groups.values()]
    .filter((g) => now - g.last >= freshMs)
    .sort((a, b) => (b.searches - a.searches) || (b.last - a.last))
    .slice(0, limit)
    .map(({ what, where, searches }) => ({ what, where, searches }));
}

/** Read the last 14 days of search_pull_log and pick the pairs to refresh. Never throws — [] on failure. */
export async function loadDemandSearches({ supabaseUrl, serviceKey, limit = 8, exclude = [], now = Date.now() }) {
  if (!supabaseUrl || !serviceKey || limit <= 0) return [];
  try {
    const since = new Date(now - 14 * 86400_000).toISOString();
    const r = await fetch(`${supabaseUrl}/rest/v1/search_pull_log?pulled_at=gt.${encodeURIComponent(since)}&select=query,location,pulled_at&order=pulled_at.desc&limit=1000`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    const rows = r.ok ? await r.json() : [];
    return pickDemandSearches(rows, { now, limit, exclude });
  } catch (_e) {
    return [];
  }
}
