// Living search data, daily (2026-10-24). Pulls what people searched before they saw a seenjobs.io page — Google
// Search Console (Search Analytics: query + page + date, the last 3 finished days, re-pulled so late data
// settles) and Bing Webmaster Tools (top queries site-wide and for the most-seen pages) — and upserts it into
// public.search_daily, idempotently. lib/server/searchOpportunities.js reads it for the admin opportunities,
// the report collectors' order=search_demand queue, and the intents each company page answers first.
//
// Then IndexNow (lib/server/indexNow.js, production only): company pages whose grade was rewritten in the last
// day and are gradeable, the list hubs on days grades changed, and any static page never submitted before.
//
// Credentials (all optional; each source is skipped without its own):
//   GSC_SERVICE_ACCOUNT_JSON + GSC_SITE_URL   Google (service-account key JSON; 'sc-domain:seenjobs.io')
//   BING_WEBMASTER_API_KEY (+ BING_SITE_URL)  Bing (default site 'https://seenjobs.io/')
// With neither, the search pull answers { ok:true, skipped:'no_credentials' } and makes no request. Before
// migration 20261024170000_search_data is applied, the writes no-op and say so (deploy code before schema).
//
// GET  (Vercel cron, x-vercel-cron or `Authorization: Bearer $CRON_SECRET`) → one run.
// POST ?secret=$CRON_SECRET[&days=N][&static=1] → a manual run; days (≤ 480) backfills Search Console history,
//      static=1 re-submits every static page to IndexNow.
import { pullSearchConsole } from '../lib/server/searchConsole.js';
import { pullBing } from '../lib/server/bingWebmaster.js';
import { storeSearchRecords, pruneSearchRows } from '../lib/server/searchData.js';
import { submitUrls, indexableCompanyUrls, recentlySubmitted, everSubmitted, indexNowEnabled, STATIC_PATHS, HUB_PATHS, SITE } from '../lib/server/indexNow.js';
import { hasMentionCount } from '../lib/server/scoreColumns.js';
import { SCORE_TTL_MS } from '../lib/server/reportCounts.js';

const RUN_MS = 100_000; // vercel.json maxDuration 120 s

const sbHeaders = (key) => ({ apikey: key, Authorization: `Bearer ${key}` });

/** Score rows written in the last `hours` (expires_at = write time + SCORE_TTL_MS; company_scores has no updated_at). */
export async function recentlyRescored({ url, key, nowMs = Date.now(), hours = 24, fetchImpl = fetch }) {
  const since = new Date(nowMs - hours * 3600_000 + SCORE_TTL_MS).toISOString();
  const sel = `company_name,report_count,first_party_report_count,data_source${(await hasMentionCount(url, sbHeaders(key), fetchImpl)) ? ',mention_count' : ''}`;
  const out = [];
  try {
    for (let offset = 0; offset < 20_000; offset += 1000) {
      const r = await fetchImpl(`${url}/rest/v1/company_scores?select=${sel}&expires_at=gte.${encodeURIComponent(since)}&order=company_name.asc&limit=1000&offset=${offset}`, { headers: sbHeaders(key) });
      if (!r.ok) return { ok: false, rows: out };
      const rows = await r.json();
      out.push(...rows);
      if (rows.length < 1000) break;
    }
  } catch { return { ok: false, rows: out }; }
  return { ok: true, rows: out };
}

/** The IndexNow part of a run. */
export async function runIndexNow({ env = process.env, fetchImpl = fetch, nowMs = Date.now(), allStatic = false } = {}) {
  if (!indexNowEnabled(env)) return { skipped: 'not_production' };
  const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_KEY;
  const changed = await recentlyRescored({ url, key, nowMs, fetchImpl });
  const companyUrls = indexableCompanyUrls(changed.rows);
  const staticUrls = STATIC_PATHS.map((p) => `${SITE}${p}`);
  const ever = allStatic ? new Set() : await everSubmitted({ url, key, urls: staticUrls, fetchImpl });
  // A static page is submitted once when new (never in the log); the hubs again on days grades changed. Without
  // the log (before the migration) no static page is sent: it cannot tell new from old.
  const freshStatic = ever ? staticUrls.filter((u) => !ever.has(u)) : [];
  const hubs = companyUrls.length ? HUB_PATHS.map((p) => `${SITE}${p}`) : [];
  const wanted = [...new Set([...companyUrls, ...hubs, ...freshStatic])];
  const done = await recentlySubmitted({ url, key, urls: wanted, nowMs, fetchImpl });
  const send = wanted.filter((u) => !done.has(u));
  // A new static path must really exist before it is announced.
  const live = [];
  for (const u of send) {
    if (!freshStatic.includes(u)) { live.push(u); continue; }
    try { const r = await fetchImpl(u, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(8000) }); if (r.status === 200) live.push(u); } catch { /* skip */ }
  }
  const sent = await submitUrls(live, { env, fetchImpl });
  return { companies_changed: changed.rows.length, company_urls: companyUrls.length, static_new: freshStatic.length, skipped_recent: done.size, ...sent };
}

export async function runSearchData({ env = process.env, fetchImpl = fetch, now = new Date(), days, allStatic = false } = {}) {
  const deadlineAt = Date.now() + RUN_MS;
  const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_KEY;
  const [google, bing] = await Promise.all([
    pullSearchConsole({ env, now, fetchImpl, deadlineAt, ...(days ? { days } : {}) }),
    pullBing({ env, now, fetchImpl, deadlineAt }),
  ]);
  const out = { ok: true };
  const sources = { google, bing };
  if (google.skipped && bing.skipped) out.skipped = 'no_credentials';
  for (const [name, r] of Object.entries(sources)) {
    const { records, ...rest } = r;
    out[name] = rest;
    if (r.skipped || !records?.length) continue;
    const st = await storeSearchRecords({ url, key, records, fetchImpl });
    out[name] = { ...rest, rows: records.length, written: st.written, ...(st.missingTable ? { missing_table: true } : {}), ...(st.error ? { store_error: st.error } : {}) };
    if (!st.ok) out.ok = false;
  }
  if (!google.ok || !bing.ok) out.ok = false;
  if (!out.skipped) {
    const p = await pruneSearchRows({ url, key, now, fetchImpl });
    if (p.missingTable) out.missing_table = true;
  }
  out.indexnow = await runIndexNow({ env, fetchImpl, nowMs: now.getTime(), allStatic });
  return out;
}

export default async function handler(req, res) {
  const q = req.query || {};
  const cron = process.env.CRON_SECRET;
  // Same rule as the other Seen crons: Vercel's header, or the CRON_SECRET bearer Vercel adds when it is set.
  const isCron = req.headers?.['x-vercel-cron'] === '1' || (cron && req.headers?.authorization === `Bearer ${cron}`);
  const manual = req.method === 'POST' && cron && q.secret === cron;
  if (!((req.method === 'GET' && isCron) || manual)) return res.status(401).json({ error: 'Unauthorized' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return res.status(503).json({ error: 'Storage is unavailable.' });
  const daysRaw = Number(q.days);
  const days = manual && Number.isInteger(daysRaw) && daysRaw >= 1 && daysRaw <= 480 ? daysRaw : undefined;
  try {
    const out = await runSearchData({ days, allStatic: manual && String(q.static) === '1' });
    return res.status(out.ok ? 200 : 500).json(out);
  } catch (e) {
    console.error('[cron-search-data]', String(e?.message || e).slice(0, 200));
    return res.status(500).json({ ok: false, error: 'search data run failed' });
  }
}
