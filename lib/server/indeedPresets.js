// Preset searches for the Mac-local Indeed collector (Seen Command → Aggregation → Indeed Jobs).
// Pure: the endpoint (api/local-indeed-presets.js) passes in the search-log rows and the date.
// Tests: lib/server/indeedPresets.test.mjs.
//
//   • niches       — Seen's own niche list (lib/server/jobSearchCatalog.js), the same searches the
//                    job-refresh cron keeps fresh through Adzuna.
//   • maintenance  — "keep the listings in the loop": PER_NICHE searches from EVERY niche, rotating by
//                    ISO week, so ~10 weekly runs cover every niche search once and no niche goes stale.
//   • demand       — what people actually searched on Seen in the last DEMAND_DAYS days (2+ searches).
//   • thin         — of those, the ones that returned few results: demand Seen covers badly.

import { JOB_SEARCH_GROUPS } from './jobSearchCatalog.js';
import { pacificParts } from '../time/pacific.js';

export const PER_NICHE = 2;
export const DEMAND_DAYS = 90;
export const MIN_DEMAND_SEARCHES = 2;
export const THIN_RESULTS = 10;

const toSearch = (s) => ({ query: s.what, location: s.where });

/** ISO-8601 week number (1–53) of a date. */
export function isoWeek(date = new Date()) {
  const p = pacificParts(date); // the California calendar day
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

/** This week's maintenance set: PER_NICHE searches from every niche, a different slice each week. */
export function maintenanceSearches(date = new Date(), perNiche = PER_NICHE) {
  const week = isoWeek(date);
  const out = [];
  for (const g of JOB_SEARCH_GROUPS) {
    const n = g.searches.length;
    for (let k = 0; k < Math.min(perNiche, n); k++) out.push({ ...toSearch(g.searches[(week * perNiche + k) % n]), niche: g.label });
  }
  return { week, searches: out };
}

const clean = (q) => String(q || '').toLowerCase().replace(/\s+/g, ' ').trim();
// "austin, tx" → "Austin, TX": words capitalized, a trailing two-letter state code upper-cased.
const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/(,\s*)([a-z]{2})$/i, (m, sep, st) => sep + st.toUpperCase());

/**
 * search_logs rows ({ query, location, result_count }) → demand searches: queries searched at least
 * MIN_DEMAND_SEARCHES times, most searched first, each at its most-searched location (Remote if none).
 * Searches for Seen itself ("seen jobs") are not job demand and are dropped.
 */
export function demandSearches(rows, { limit = 30 } = {}) {
  const by = new Map();
  for (const r of rows || []) {
    const q = clean(r?.query);
    if (q.length < 3 || /\bseen/.test(q)) continue;
    const e = by.get(q) || { query: q, searches: 0, results: 0, locations: new Map() };
    e.searches += 1;
    e.results += Math.max(0, Number(r.result_count) || 0);
    const loc = clean(r.location);
    if (loc) e.locations.set(loc, (e.locations.get(loc) || 0) + 1);
    by.set(q, e);
  }
  return [...by.values()]
    .filter((e) => e.searches >= MIN_DEMAND_SEARCHES)
    .sort((a, b) => b.searches - a.searches || a.query.localeCompare(b.query))
    .slice(0, limit)
    .map((e) => {
      const loc = [...e.locations.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      return { query: titleCase(e.query), location: loc ? titleCase(loc) : 'Remote', searches: e.searches, avg_results: Math.round(e.results / e.searches) };
    });
}

export function buildPresets(rows, date = new Date()) {
  const demand = demandSearches(rows);
  return {
    generated_at: date.toISOString(),
    maintenance: { ...maintenanceSearches(date), per_niche: PER_NICHE, niches: JOB_SEARCH_GROUPS.length },
    niches: JOB_SEARCH_GROUPS.map((g) => ({ id: g.id, label: g.label, searches: g.searches.map(toSearch) })),
    demand: { days: DEMAND_DAYS, min_searches: MIN_DEMAND_SEARCHES, searches: demand },
    thin: { below_results: THIN_RESULTS, searches: demand.filter((d) => d.avg_results < THIN_RESULTS) },
  };
}
