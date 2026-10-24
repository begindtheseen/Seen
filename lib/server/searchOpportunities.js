// The search opportunity engine (2026-10-24): real search data (public.search_daily, filled daily by
// api/cron-search-data.js from Google Search Console and Bing Webmaster Tools) turned into what Seen should
// work on next. Legitimately: every output points at making a REAL page answer a REAL question better, or at
// collecting real applicant reports for a company people search for. No keyword pages, no doorway pages, no
// stuffing (Google Search spam policies), and raw search strings never reach a public page: the only thing a
// public page receives is an intent label (topIntentsForCompany).
//
// Over the last 28 days of stored data (anchored on the newest stored day, since Search Console lags ~2 days):
//   strikingDistance — queries ranking at average position 8–20 with enough impressions: one push from page 1.
//   lowCtrPages      — page-one pages seen often whose CTR is well under the expected CTR for their position
//                      (title and description rewrite candidates).
//   intents          — every query classified (lib/server/searchIntents.js) and mapped to a company.
//   demandTargets    — companies people search for, by demand, with whether Seen can grade them yet; thin ones
//                      feed the report collectors (GET /api/local-company-intel-targets?order=search_demand).
//   digest           — the weekly view: top movers, new striking-distance queries, low-CTR pages, demand targets.
//
// The pure functions take rows ({ date, source, query, page, clicks, impressions, position }) and are tested on
// fixtures (searchOpportunities.test.mjs); the async loaders read Supabase with the service key and never throw.

import { classifyIntent, buildCompanyIndex, matchCompany, companyFromPageUrl, tokens, ANSWERABLE_INTENTS } from './searchIntents.js';
import { readSearchRows, searchFreshness } from './searchData.js';
import { firstPartyReportCount, mentionCount, isGradeable, reportsNeededForGrade } from './reportCounts.js';
import { hasMentionCount } from './scoreColumns.js';
import { companyPageUrl } from './indexNow.js';
import { pacificDate, pacificDayStart } from '../time/pacific.js';

export { classifyIntent, buildCompanyIndex, matchCompany, companyFromPageUrl, INTENTS, ANSWERABLE_INTENTS } from './searchIntents.js';

export const WINDOW_DAYS = 28;
export const STRIKING_MIN_POS = 8;
export const STRIKING_MAX_POS = 20;
export const STRIKING_MIN_IMPRESSIONS = 20;
export const LOW_CTR_MIN_IMPRESSIONS = 100;
export const LOW_CTR_RATIO = 0.5;         // CTR under half of the expected CTR for the position
export const LOW_CTR_MAX_POS = 10;
export const THIN_REPORTS = 10;           // the collectors' "fill every company to 10" bar
export const INTENT_MIN_IMPRESSIONS = 3;  // one person's search never changes a public page

// Expected organic CTR by average Google position. Source: Backlinko, "Google Organic CTR Stats" (study of
// ~4 million Google results: 12,166,560 queries over 1,312,881 pages; backlinko.com/google-ctr-stats, page last
// updated 2025-04-16, data from 2022). The text states #1 = 27.6%, the top three = 54.4% of clicks, #1 is
// ~10x as likely to be clicked as #10, and positions 8–10 are "virtually the same"; positions 2–10 are read
// from the study's chart (15.8, 11.0, 8.4, 6.3, 4.9, 3.9, 3.3, 2.7, 2.4), which match those statements.
// Past position 10 the study has no figure; page-two CTRs are taken as a flat ~1% falling to 0.5% by 20
// (an assumption — page-two CTR is small either way, and the low-CTR rule only fires at well under HALF of it).
export const CTR_CURVE = [0.276, 0.158, 0.110, 0.084, 0.063, 0.049, 0.039, 0.033, 0.027, 0.024];

/** Expected CTR at an average position (interpolated between whole positions). */
export function expectedCtr(position) {
  const p = Number(position);
  if (!Number.isFinite(p) || p <= 0) return null;
  if (p <= 1) return CTR_CURVE[0];
  if (p <= 10) {
    const lo = Math.floor(p), hi = Math.ceil(p), f = p - lo;
    return CTR_CURVE[lo - 1] + (CTR_CURVE[Math.min(hi, 10) - 1] - CTR_CURVE[lo - 1]) * f;
  }
  if (p <= 20) return 0.012 - (0.007 * (p - 10)) / 10;
  return 0.004;
}

// Calendar arithmetic on a stored 'YYYY-MM-DD' LABEL (already a Pacific day), not on an instant.
export function addDays(day, n) {
  const [y, m, d] = String(day).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

const latestDate = (rows) => rows.reduce((m, r) => (r.date > m ? r.date : m), '');

/** The window [from, to] (inclusive) ending at the newest stored day. */
export function windowOf(rows, days = WINDOW_DAYS) {
  const to = latestDate(rows);
  return to ? { from: addDays(to, -(days - 1)), to } : null;
}

const inRange = (r, w) => w && r.date >= w.from && r.date <= w.to;
const norm = (q) => String(q ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Sum rows per (source, query, page) inside a window; position is impression-weighted.
 * @returns {Array<{ source: string, query: string, page: string, clicks: number, impressions: number, position: number|null, ctr: number }>}
 */
export function aggregate(rows, w) {
  const m = new Map();
  for (const r of rows) {
    if (w && !inRange(r, w)) continue;
    const imp = Number(r.impressions) || 0;
    if (!imp) continue;
    const query = norm(r.query), page = String(r.page ?? '');
    const k = `${r.source}\u0000${query}\u0000${page}`;
    const a = m.get(k) || { source: r.source, query, page, clicks: 0, impressions: 0, posW: 0, posImp: 0 };
    a.clicks += Number(r.clicks) || 0;
    a.impressions += imp;
    const pos = Number(r.position);
    if (Number.isFinite(pos) && pos > 0) { a.posW += pos * imp; a.posImp += imp; }
    m.set(k, a);
  }
  return [...m.values()].map(({ posW, posImp, ...a }) => ({ ...a, position: posImp ? Math.round((posW / posImp) * 10) / 10 : null, ctr: a.impressions ? a.clicks / a.impressions : 0 }));
}

/**
 * Per-query totals across engines. Bing reports a query twice (site-wide and per page); when a source has a
 * site-level row (page '') for a query, that row is its total, so the page rows are never added on top.
 */
export function queryTotals(agg) {
  const siteLevel = new Set(agg.filter((a) => a.page === '').map((a) => `${a.source}\u0000${a.query}`));
  const m = new Map();
  for (const a of agg) {
    if (a.page !== '' && siteLevel.has(`${a.source}\u0000${a.query}`)) continue;
    const t = m.get(a.query) || { query: a.query, clicks: 0, impressions: 0, pages: new Set() };
    t.clicks += a.clicks;
    t.impressions += a.impressions;
    if (a.page) t.pages.add(a.page);
    m.set(a.query, t);
  }
  return [...m.values()].map((t) => ({ ...t, pages: [...t.pages] }));
}

/** The company a (query, page) row is about: the query's own company first, else the company page it landed on. */
export function companyFor(query, page, index) {
  const hit = matchCompany(query, index);
  if (hit) return { name: String(hit.company_name ?? hit.company), known: true, entry: hit };
  const fromPage = page ? companyFromPageUrl(page) : null;
  if (!fromPage) return null;
  const entry = index?.byKey?.get(tokens(fromPage).join(' ')) || null;
  return { name: entry ? String(entry.company_name ?? entry.company) : fromPage, known: !!entry, entry };
}

const companyStatus = (entry) => {
  if (!entry) return { graded: false, applicant_reports: 0, reports_needed: 5 };
  return { graded: isGradeable(entry), applicant_reports: firstPartyReportCount(entry), reports_needed: reportsNeededForGrade(entry) };
};

// What a page needs to win the query, by intent. Every hint is about real content, never about keywords.
const STRENGTHEN = {
  application_status: 'Answer "how long until they respond" near the top with the response rate and the average wait.',
  how_long_to_hear_back: 'Lead the FAQ with the average wait to hear back, stated from the reports.',
  does_ghost: 'Lead with the ghost rate and how many applicant reports it stands on.',
  interview_process: 'Show interview rounds and how many reports reached an interview.',
  hiring_process: 'Summarise the process from reports: response rate, wait, rounds, in that order.',
  is_legit: 'Make the evidence basis (reports, sources, last updated) the first thing on the page.',
  jobs_at: 'Link the open listings and the listing signals from the company page.',
  other: 'Check the query matches what the page covers; improve the page only where it does.',
};

/** Queries one push from page one. */
export function strikingDistance(agg, index, { minImpressions = STRIKING_MIN_IMPRESSIONS, minPos = STRIKING_MIN_POS, maxPos = STRIKING_MAX_POS, limit = 50 } = {}) {
  const best = new Map(); // source+query → the page with most impressions
  for (const a of agg) {
    if (!a.page || a.position == null || a.position < minPos || a.position > maxPos || a.impressions < minImpressions) continue;
    const k = `${a.source}\u0000${a.query}`;
    if (!best.has(k) || best.get(k).impressions < a.impressions) best.set(k, a);
  }
  return [...best.values()].sort((x, y) => y.impressions - x.impressions).slice(0, limit).map((a) => {
    const intent = classifyIntent(a.query);
    const co = companyFor(a.query, a.page, index);
    const st = companyStatus(co?.entry);
    const needsData = co && !st.graded;
    return { source: a.source, query: a.query, page: a.page, impressions: a.impressions, clicks: a.clicks, position: a.position, intent,
      company: co?.name ?? null, graded: co ? st.graded : null,
      advice: needsData ? `The page cannot answer it yet: ${co.name} needs ${st.reports_needed} more report${st.reports_needed === 1 ? '' : 's'} for a grade. Collect reports first.` : STRENGTHEN[intent] };
  });
}

/** Pages seen often with a CTR well under what their position should earn. */
export function lowCtrPages(agg, { minImpressions = LOW_CTR_MIN_IMPRESSIONS, ratio = LOW_CTR_RATIO, limit = 30 } = {}) {
  const m = new Map();
  for (const a of agg) {
    if (!a.page) continue;
    const k = `${a.source}\u0000${a.page}`;
    const p = m.get(k) || { source: a.source, page: a.page, clicks: 0, impressions: 0, posW: 0, posImp: 0, intents: new Map() };
    p.clicks += a.clicks;
    p.impressions += a.impressions;
    if (a.position != null) { p.posW += a.position * a.impressions; p.posImp += a.impressions; }
    const intent = classifyIntent(a.query);
    p.intents.set(intent, (p.intents.get(intent) || 0) + a.impressions);
    m.set(k, p);
  }
  const out = [];
  for (const p of m.values()) {
    if (p.impressions < minImpressions || !p.posImp) continue;
    const position = Math.round((p.posW / p.posImp) * 10) / 10;
    const expected = expectedCtr(position);
    const ctr = p.clicks / p.impressions;
    // Page one only: past position 10 almost nobody sees the snippet, so the fix is ranking (striking distance), not copy.
    if (expected == null || position > LOW_CTR_MAX_POS || ctr >= expected * ratio) continue;
    out.push({ source: p.source, page: p.page, impressions: p.impressions, clicks: p.clicks, ctr: Math.round(ctr * 10000) / 10000, position,
      expected_ctr: Math.round(expected * 10000) / 10000, lost_clicks: Math.round(p.impressions * (expected - ctr)),
      top_intents: [...p.intents].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([intent]) => intent) });
  }
  return out.sort((x, y) => y.lost_clicks - x.lost_clicks).slice(0, limit);
}

/** Impressions / clicks / distinct queries per intent. */
export function intentSummary(agg) {
  const out = Object.fromEntries(['application_status', 'hiring_process', 'interview_process', 'how_long_to_hear_back', 'is_legit', 'does_ghost', 'jobs_at', 'other']
    .map((i) => [i, { queries: 0, impressions: 0, clicks: 0 }]));
  for (const t of queryTotals(agg)) {
    const s = out[classifyIntent(t.query)];
    s.queries++; s.impressions += t.impressions; s.clicks += t.clicks;
  }
  return out;
}

/**
 * Companies by search demand, each with whether Seen can grade it. `thin` = not graded or under THIN_REPORTS
 * applicant reports: what the report collectors should work on.
 */
export function demandTargetsFrom(agg, index, { limit = 200 } = {}) {
  const m = new Map();
  // Totals per query (no Bing double count), attributed once, to the query's company or its landing page's.
  const pageOf = new Map();
  for (const a of agg) if (a.page && (!pageOf.has(a.query) || pageOf.get(a.query).impressions < a.impressions)) pageOf.set(a.query, a);
  for (const t of queryTotals(agg)) {
    const co = companyFor(t.query, pageOf.get(t.query)?.page || '', index);
    if (!co) continue;
    const k = tokens(co.name).join(' ');
    const e = m.get(k) || { company: co.name, known: co.known, entry: co.entry, impressions: 0, clicks: 0, queries: 0, intents: new Map() };
    e.impressions += t.impressions; e.clicks += t.clicks; e.queries++;
    const intent = classifyIntent(t.query);
    e.intents.set(intent, (e.intents.get(intent) || 0) + t.impressions);
    m.set(k, e);
  }
  return [...m.values()].map((e) => {
    const st = companyStatus(e.entry);
    return { company: e.company, known: e.known, impressions: e.impressions, clicks: e.clicks, queries: e.queries,
      intents: [...e.intents].sort((x, y) => y[1] - x[1]).map(([intent]) => intent),
      graded: st.graded, applicant_reports: st.applicant_reports, reports_needed: st.reports_needed,
      thin: !st.graded || st.applicant_reports < THIN_REPORTS, page: companyPageUrl(e.company) };
  }).sort((x, y) => y.impressions - x.impressions || y.clicks - x.clicks || x.company.localeCompare(y.company)).slice(0, limit);
}

/**
 * The intents real searchers used for one company (by impressions), never the queries themselves. Intents
 * below `minImpressions` are dropped, so no single search shapes a public page.
 */
export function intentsForCompanyFrom(rows, companyName, index, { minImpressions = INTENT_MIN_IMPRESSIONS, w } = {}) {
  const key = tokens(companyName).join(' ');
  const page = companyPageUrl(companyName);
  const by = new Map();
  for (const t of queryTotals(aggregate(rows, w ?? windowOf(rows)))) {
    const hit = matchCompany(t.query, index);
    const about = hit ? tokens(hit.company_name ?? hit.company).join(' ') === key : t.pages.includes(page);
    if (!about) continue;
    const intent = classifyIntent(t.query);
    if (intent === 'other') continue;
    const e = by.get(intent) || { intent, impressions: 0, clicks: 0 };
    e.impressions += t.impressions; e.clicks += t.clicks;
    by.set(intent, e);
  }
  return [...by.values()].filter((e) => e.impressions >= minImpressions).sort((a, b) => b.impressions - a.impressions || a.intent.localeCompare(b.intent));
}

/** The weekly digest: last 7 stored days against the 7 before. */
export function buildDigest(rows, index, { limit = 10 } = {}) {
  const to = latestDate(rows);
  if (!to) return null;
  const thisWeek = { from: addDays(to, -6), to }, lastWeek = { from: addDays(to, -13), to: addDays(to, -7) }, before = { from: addDays(to, -27), to: addDays(to, -7) };
  const cur = new Map(queryTotals(aggregate(rows, thisWeek)).map((t) => [t.query, t]));
  const prev = new Map(queryTotals(aggregate(rows, lastWeek)).map((t) => [t.query, t]));
  const movers = [...new Set([...cur.keys(), ...prev.keys()])].map((q) => {
    const c = cur.get(q), p = prev.get(q);
    return { query: q, intent: classifyIntent(q), clicks: c?.clicks || 0, clicks_change: (c?.clicks || 0) - (p?.clicks || 0),
      impressions: c?.impressions || 0, impressions_change: (c?.impressions || 0) - (p?.impressions || 0) };
  }).filter((x) => x.clicks_change || x.impressions_change)
    .sort((a, b) => Math.abs(b.clicks_change) - Math.abs(a.clicks_change) || Math.abs(b.impressions_change) - Math.abs(a.impressions_change)).slice(0, limit);
  const recentStriking = strikingDistance(aggregate(rows, thisWeek), index, { minImpressions: Math.ceil(STRIKING_MIN_IMPRESSIONS / 4) });
  const earlier = new Set(strikingDistance(aggregate(rows, before), index, { minImpressions: 1, limit: 100_000 }).map((s) => `${s.source}\u0000${s.query}`));
  const monthAgg = aggregate(rows, windowOf(rows));
  return { week: thisWeek, compared_to: lastWeek, top_movers: movers,
    new_striking_distance: recentStriking.filter((s) => !earlier.has(`${s.source}\u0000${s.query}`)).slice(0, limit),
    low_ctr_pages: lowCtrPages(monthAgg, { limit }),
    demand_targets: demandTargetsFrom(monthAgg, index).filter((d) => d.thin).slice(0, limit) };
}

/** Everything the admin endpoint returns, from rows + the known companies. */
export function computeOpportunities(rows, companies, { days = WINDOW_DAYS } = {}) {
  const index = buildCompanyIndex(companies);
  const w = windowOf(rows, days);
  if (!w) return { window: null, totals: { clicks: 0, impressions: 0, queries: 0, pages: 0 }, striking_distance: [], low_ctr_pages: [], intents: intentSummary([]), demand_targets: [], missing_pages: [], digest: null };
  const agg = aggregate(rows, w);
  const qt = queryTotals(agg);
  const demand = demandTargetsFrom(agg, index);
  return {
    window: w,
    totals: { clicks: qt.reduce((n, t) => n + t.clicks, 0), impressions: qt.reduce((n, t) => n + t.impressions, 0), queries: qt.length, pages: new Set(agg.filter((a) => a.page).map((a) => a.page)).size },
    striking_distance: strikingDistance(agg, index),
    low_ctr_pages: lowCtrPages(agg),
    intents: intentSummary(agg),
    demand_targets: demand,
    // Companies people search for that Seen has no score row for at all (only reachable through a company page URL).
    missing_pages: demand.filter((d) => !d.known).slice(0, 50),
    digest: buildDigest(rows, index),
  };
}

// ── Loaders (service key; never throw) ────────────────────────────────────────────────────────────

const env = () => ({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY });
const sinceFor = (now, days) => pacificDate(pacificDayStart(now, -(days + 7))); // + Search Console's lag, with room

/** Every company_scores name with the counts the grade gate needs. null on a failed read. */
export async function loadKnownCompanies({ url = env().url, key = env().key, fetchImpl = fetch, maxRows = 60_000 } = {}) {
  if (!url || !key) return null;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  try {
    const sel = `company_name,report_count,first_party_report_count,data_source${(await hasMentionCount(url, headers, fetchImpl)) ? ',mention_count' : ''}`;
    const out = [];
    for (let offset = 0; offset < maxRows; offset += 1000) {
      const r = await fetchImpl(`${url}/rest/v1/company_scores?select=${sel}&order=company_name.asc&limit=1000&offset=${offset}`, { headers, signal: AbortSignal.timeout(10_000) });
      if (!r.ok) return null;
      const rows = await r.json();
      out.push(...rows);
      if (rows.length < 1000) break;
    }
    return out;
  } catch { return null; }
}

/** The admin view: the engine over the stored window + freshness. */
export async function loadSearchOpportunities({ url = env().url, key = env().key, fetchImpl = fetch, now = new Date(), days = WINDOW_DAYS } = {}) {
  const [data, companies, freshness] = await Promise.all([
    readSearchRows({ url, key, since: sinceFor(now, days), fetchImpl }),
    loadKnownCompanies({ url, key, fetchImpl }),
    searchFreshness({ url, key, fetchImpl }),
  ]);
  if (data.missingTable || freshness.missingTable) return { ok: true, ready: false, reason: 'search_daily is not migrated yet (20261024170000_search_data)', freshness: { google: null, bing: null } };
  if (!data.ok) return { ok: false, error: 'could not read search data' };
  const out = computeOpportunities(data.rows, companies || [], { days });
  const today = pacificDate(now);
  const ageDays = (d) => (d ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000) : null);
  return { ok: true, ready: true, generated_at: now.toISOString(), rows: data.rows.length, ...(data.capped ? { capped: true } : {}), companies_known: companies ? companies.length : null,
    freshness: { google: freshness.google, bing: freshness.bing, google_age_days: ageDays(freshness.google), bing_age_days: ageDays(freshness.bing),
      // Search Console lags ~2 days and Bing updates weekly; past these the daily pull has stopped.
      stale: (freshness.google != null && ageDays(freshness.google) > 5) || (freshness.bing != null && ageDays(freshness.bing) > 14) },
    ...out };
}

/**
 * Companies ordered by search demand (last 28 days), for the report collectors. `companies` (optional) are the
 * caller's already-loaded company_scores rows. Never throws; { ready:false } before the migration or with no data.
 * @returns {Promise<{ ready: boolean, companies: Array<{ company: string, known: boolean, impressions: number, clicks: number, queries: number, intents: string[], graded: boolean, applicant_reports: number, reports_needed: number, thin: boolean, page: string }> }>}
 */
export async function searchDemandTargets({ url = env().url, key = env().key, fetchImpl = fetch, now = new Date(), days = WINDOW_DAYS, companies, limit = 500 } = {}) {
  const [data, known] = await Promise.all([
    readSearchRows({ url, key, since: sinceFor(now, days), fetchImpl }),
    companies ? Promise.resolve(companies) : loadKnownCompanies({ url, key, fetchImpl }),
  ]);
  if (!data.ok || !data.rows.length) return { ready: false, companies: [] };
  const index = buildCompanyIndex(known || []);
  return { ready: true, companies: demandTargetsFrom(aggregate(data.rows, windowOf(data.rows, days)), index, { limit }) };
}

/**
 * Which intents real searchers used for this company in the last 28 days, strongest first — intent labels
 * only, never the queries. For the company page FAQ: lead with exactly the questions people searched.
 * [] on any failure, before the migration, or with no qualifying searches. Server-only (service key).
 * @param {string} companyName
 * @returns {Promise<Array<{ intent: string, impressions: number, clicks: number }>>}
 */
export async function topIntentsForCompany(companyName, { url = env().url, key = env().key, fetchImpl = fetch, now = new Date(), days = WINDOW_DAYS, timeoutMs = 2500, minImpressions = INTENT_MIN_IMPRESSIONS, companies } = {}) {
  const name = String(companyName ?? '').trim();
  const words = tokens(name);
  if (!url || !key || !words.length) return [];
  try {
    const since = sinceFor(now, days);
    const pattern = encodeURIComponent(`*${words.join('*')}*`);
    // The page's own searches, and searches naming the company that landed anywhere on the site.
    const [byPage, byQuery] = await Promise.all([
      readSearchRows({ url, key, since, filter: `page=eq.${encodeURIComponent(companyPageUrl(name))}`, fetchImpl, timeoutMs, maxRows: 20_000 }),
      readSearchRows({ url, key, since, filter: `query=ilike.${pattern}`, fetchImpl, timeoutMs, maxRows: 20_000 }),
    ]);
    if (!byPage.ok && !byQuery.ok) return [];
    const rows = [...new Map([...byPage.rows, ...byQuery.rows].map((r) => [r.id, r])).values()];
    if (!rows.length) return [];
    // Whole-word match on the company's name. With only this name known, "target optical status" would count
    // for Target; pass `companies` (every known name) and the longest known name wins instead.
    const index = buildCompanyIndex([...(Array.isArray(companies) ? companies : []), { company_name: name }]);
    const w = { from: addDays(latestDate(rows), -(days - 1)), to: latestDate(rows) };
    return intentsForCompanyFrom(rows, name, index, { minImpressions, w }).filter((e) => ANSWERABLE_INTENTS.includes(e.intent));
  } catch { return []; }
}
