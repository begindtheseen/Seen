// Bing Webmaster Tools → Seen (2026-10-24). ChatGPT search and Copilot draw heavily on Bing's index, so what
// people search on Bing is the closest free signal of what AI answers are asked about Seen's pages.
//
// Auth: an API key (env BING_WEBMASTER_API_KEY, Bing Webmaster Tools → Settings → API access), sent as the
// `apikey` query parameter. Site: env BING_SITE_URL, default 'https://seenjobs.io/' (the site as verified in Bing).
//
// Verified against Microsoft's reference on 2026-10-24 (learn.microsoft.com, Microsoft.Bing.Webmaster.Api
// IWebmasterApi): JSON endpoints at https://ssl.bing.com/webmaster/api.svc/json/<Method>?siteUrl=…&apikey=…
//   GetQueryStats(siteUrl)              → { d: [QueryStats] }, top queries for the whole site
//   GetPageStats(siteUrl)               → { d: [QueryStats] }, top pages (the page URL is in `Query`)
//   GetPageQueryStats(siteUrl, page)    → { d: [QueryStats] }, top queries for one page; the reference's JSON
//                                         sample passes `page` as a JSON string literal ("\"http:\/\/…\"").
//   QueryStats = { AvgClickPosition, AvgImpressionPosition, Clicks, Date: "/Date(1316156400000-0700)/",
//                  Impressions, Query }. Remarks: "The data will be updated every week" (rows are weekly buckets).
// NOT verified live (no key in this environment): whether GetPageQueryStats also accepts a plain page URL.

import { pacificDate } from '../time/pacific.js';

export const BING_API = 'https://ssl.bing.com/webmaster/api.svc/json';
export const BING_PAGES_PER_RUN = 25;     // per-page query stats for the most-seen pages
export const BING_KEEP_DAYS = 90;         // Bing returns months of weekly buckets; keep the recent ones

/** "/Date(1316156400000-0700)/" → Date, or null. */
export function parseBingDate(v) {
  const m = /\/Date\((-?\d+)([+-]\d{4})?\)\//.exec(String(v ?? ''));
  if (m) return new Date(Number(m[1]));
  const t = Date.parse(String(v ?? ''));
  return Number.isFinite(t) ? new Date(t) : null;
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };

/**
 * QueryStats rows → search_daily records. `page` = '' for site-level rows (GetQueryStats).
 * @param {Array<object>} rows
 * @param {{ page?: string, sinceMs?: number }} [opts]
 */
export function bingRowsToRecords(rows, { page = '', sinceMs = 0 } = {}) {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const query = String(row?.Query ?? '').trim();
    const d = parseBingDate(row?.Date);
    if (!query || !d || d.getTime() < sinceMs) continue;
    const impressions = Math.round(num(row.Impressions)), clicks = Math.min(Math.round(num(row.Clicks)), impressions);
    if (!impressions) continue;
    const pos = Number(row.AvgImpressionPosition);
    out.push({ date: pacificDate(d), source: 'bing', query: query.slice(0, 500), page: String(page).slice(0, 1000), clicks, impressions,
      ctr: Math.min(1, clicks / impressions), position: Number.isFinite(pos) && pos > 0 ? Math.round(pos * 100) / 100 : null });
  }
  return out;
}

export const bingUrl = (method, params) => `${BING_API}/${method}?${new URLSearchParams(params).toString()}`;

async function call(method, params, { fetchImpl, timeoutMs = 20_000 }) {
  try {
    const r = await fetchImpl(bingUrl(method, params), { headers: { 'Content-Type': 'application/json; charset=utf-8' }, signal: AbortSignal.timeout(timeoutMs) });
    const j = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, error: `${method}: HTTP ${r.status}${j?.Message ? ` ${String(j.Message).slice(0, 100)}` : ''}` };
    return { ok: true, rows: Array.isArray(j?.d) ? j.d : [] };
  } catch (e) {
    return { ok: false, error: `${method}: ${String(e?.message || e).slice(0, 120)}` };
  }
}

/**
 * One full pull: site-level query stats, then query stats for the top pages. Without a key:
 * { skipped: 'no_credentials' } and no request.
 */
export async function pullBing({ env = process.env, now = new Date(), fetchImpl = fetch, pages = BING_PAGES_PER_RUN, deadlineAt = Infinity } = {}) {
  const apikey = String(env.BING_WEBMASTER_API_KEY || '').trim();
  if (!apikey) return { ok: true, skipped: 'no_credentials' };
  const siteUrl = String(env.BING_SITE_URL || 'https://seenjobs.io/').trim();
  const sinceMs = now.getTime() - BING_KEEP_DAYS * 86_400_000;
  const opts = { fetchImpl };
  const errors = [];
  let requests = 0;
  const q = await call('GetQueryStats', { siteUrl, apikey }, opts); requests++;
  if (!q.ok) return { ok: false, error: q.error, requests };
  const records = bingRowsToRecords(q.rows, { sinceMs });
  const p = await call('GetPageStats', { siteUrl, apikey }, opts); requests++;
  if (!p.ok) errors.push(p.error);
  // The pages people saw most, over the kept window.
  const byPage = new Map();
  for (const row of p.ok ? p.rows : []) {
    const d = parseBingDate(row?.Date);
    const url = String(row?.Query || '').trim();
    if (!url || (d && d.getTime() < sinceMs)) continue;
    byPage.set(url, (byPage.get(url) || 0) + num(row.Impressions));
  }
  const top = [...byPage].sort((a, b) => b[1] - a[1]).slice(0, pages).map(([u]) => u);
  for (const page of top) {
    if (Date.now() > deadlineAt) { errors.push('out of time'); break; }
    const r = await call('GetPageQueryStats', { siteUrl, page: JSON.stringify(page), apikey }, opts); requests++;
    if (!r.ok) { errors.push(r.error); continue; }
    records.push(...bingRowsToRecords(r.rows, { page, sinceMs }));
  }
  return { ok: true, records, requests, pages: top.length, ...(errors.length ? { errors: errors.slice(0, 5) } : {}) };
}
