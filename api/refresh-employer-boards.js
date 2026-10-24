// Employer-board sync — Greenhouse / Lever / Ashby / Workable / Recruitee / SmartRecruiters boards
// registered in company_sources, pulled straight from each company's public job-board API.
//
// Why its own function (2026-10-20, prod): the registry held 4,002 active Greenhouse boards listing
// ~153,000 openings, yet only 41 boards had synced in two days and 3,867 Greenhouse listings were
// stored. The sync ran at the TAIL of api/refresh-jobs.js, after the Adzuna upserts had spent most of
// its 270 s budget, 24 boards at a time — one pass over the registry took about four weeks while a
// listing expires after 14 days. Here it has a whole invocation, every hour, sized so the full
// registry refreshes about once a day.
//
// Only listings in Seen's market are kept (lib/jobs/usLocation.js: US, remote, or no location —
// applied inside fetchSourceJobs, the one entry every board path uses, and again here). A board's
// sync health is judged on everything it returned, so a healthy board whose openings are all abroad
// is not mistaken for a dead one by the circuit breaker.
//
// Callers:
//   • Vercel cron (GET, Bearer CRON_SECRET) — the stalest boards, up to BOARDS_PER_RUN.
//   • Seen Command on the owner's Mac (POST, Bearer LOCAL_INDEED_INGEST_SECRET) —
//       { companies?: string[1..50] }  sync those companies' boards now, or
//       { limit?: 1..400 }             sync that many of the stalest boards now.
// Response: { ok, boards, synced, failed, fetched, kept, dropped_outside_market, upserted, by_provider,
//             not_found?, out_of_time } — every number is what actually happened, never an estimate.

import { fetchSourceJobs } from '../lib/jobs/atsProviders.js';
import { dueSources, recordSourceSync, seedSources } from '../lib/jobs/sourceRegistry.js';
import { SEED_SOURCES } from '../lib/jobs/seedSources.js';
import { upsertJobs, mapLimit, normalizeCompany } from '../lib/server/jobSources.js';
import { inUsMarket } from '../lib/jobs/usLocation.js';

// 4,100 active boards / 24 hourly runs ≈ 170; 200 leaves room for the registry to grow.
export const BOARDS_PER_RUN = Number(process.env.EMPLOYER_BOARDS_PER_RUN || 200);
const MAX_MANUAL_BOARDS = 400;
const MAX_COMPANIES = 50;
// maxDuration is 300 s (vercel.json); stop starting new work well before it.
const BUDGET_MS = Number(process.env.EMPLOYER_BOARDS_BUDGET_MS || 240_000);
const WAVE = 24;        // boards fetched before their rows are written
const CONCURRENCY = 8;  // simultaneous board fetches (public APIs, each ≤ 9 s)
const UPSERT_BATCH = 100;

const send = (res, code, body) => res.status(code).json(body);

/**
 * Sync the given company_sources rows. Injectable so tests drive it without the network.
 * Writes are sequential batches of 100 (the dedupe trigger deadlocks on concurrent overlapping
 * batches — see api/refresh-jobs.js).
 */
export async function syncBoards(sources, {
  supabaseUrl, serviceKey, deadline = Date.now() + BUDGET_MS,
  fetchJobs = fetchSourceJobs, upsert = upsertJobs, record = recordSourceSync,
} = {}) {
  const out = { boards: sources.length, synced: 0, failed: 0, fetched: 0, kept: 0, dropped_outside_market: 0, upserted: 0, by_provider: {}, out_of_time: false };
  for (let i = 0; i < sources.length; i += WAVE) {
    if (Date.now() >= deadline) { out.out_of_time = true; break; }
    const wave = sources.slice(i, i + WAVE);
    const results = await mapLimit(wave, CONCURRENCY, async (s) => {
      const r = await fetchJobs({ provider: s.provider, tenant: s.tenant, companyName: s.company_name });
      // fetchSourceJobs already drops rows outside the market and reports the board's full size;
      // an older fake / caller that returns unfiltered rows is filtered here as well.
      const rows = r.rows || [];
      const total = Number.isFinite(r.total) ? r.total : rows.length;
      const learned = r.companyName && r.companyName !== s.company_name ? r.companyName : null;
      return { s, ok: !!r.ok && total > 0, rows, total, dropped: Number.isFinite(r.droppedOutsideMarket) ? r.droppedOutsideMarket : 0, learned };
    });
    const keep = [];
    for (const { s, ok, rows, total, dropped } of results) {
      const p = (out.by_provider[s.provider] ||= { boards: 0, fetched: 0, kept: 0 });
      p.boards++;
      if (!ok) { out.failed++; continue; }
      out.synced++;
      out.fetched += total; p.fetched += total;
      out.dropped_outside_market += dropped;
      for (const row of rows) {
        if (inUsMarket(row.location)) { keep.push(row); p.kept++; } else out.dropped_outside_market++;
      }
    }
    out.kept += keep.length;
    for (let j = 0; j < keep.length; j += UPSERT_BATCH) {
      const u = await upsert(keep.slice(j, j + UPSERT_BATCH), supabaseUrl, serviceKey).catch(() => ({ upserted: 0 }));
      out.upserted += u.upserted || 0;
    }
    // ok:false and 200-but-empty both count toward the circuit breaker, as before. jobCount is the
    // board's full size, not the US share, so the registry shows what the board really holds. A
    // company name the board itself stated is written back (lib/jobs/companyName.js), so a
    // slug-named registry row learns its real name.
    await Promise.all(results.map(({ s, ok, total, learned }) =>
      record({ id: s.id, ok, jobCount: total, prevFailures: s.consecutive_failures || 0, companyName: learned }, supabaseUrl, serviceKey)));
  }
  return out;
}

const SOURCE_SELECT = 'select=id,company_name,provider,tenant,consecutive_failures';
const inValue = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** The ingestable, not-disabled boards registered for these company names. */
export async function sourcesForCompanies(names, supabaseUrl, serviceKey, fetchImpl = fetch) {
  const canon = [...new Set(names.map((n) => normalizeCompany(n)).filter(Boolean))];
  if (!canon.length) return { sources: [], notFound: names };
  const list = encodeURIComponent(`(${canon.map(inValue).join(',')})`);
  const r = await fetchImpl(`${supabaseUrl}/rest/v1/company_sources?company_name=in.${list}&ingestable=eq.true&status=neq.disabled&${SOURCE_SELECT}&limit=500`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!r.ok) throw new Error(`company_sources read failed (${r.status})`);
  const sources = await r.json();
  const have = new Set(sources.map((s) => s.company_name));
  return { sources, notFound: canon.filter((c) => !have.has(c)) };
}

function authorize(req) {
  const auth = req.headers.authorization || '';
  const cron = process.env.CRON_SECRET;
  const local = process.env.LOCAL_INDEED_INGEST_SECRET;
  if (cron && auth === `Bearer ${cron}`) return 'cron';
  if (local && auth === `Bearer ${local}`) return 'local';
  return null;
}

function parseBody(req) {
  if (req.method !== 'POST') return {};
  const b = req.body;
  if (typeof b === 'string') { try { return JSON.parse(b || '{}'); } catch { return null; } }
  return b && typeof b === 'object' ? b : {};
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  const caller = authorize(req);
  if (!caller) return send(res, 401, { error: 'Unauthorized' });
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return send(res, 503, { error: 'Job storage is unavailable.' });

  const body = parseBody(req);
  if (body === null) return send(res, 400, { error: 'Body must be JSON.' });
  const deadline = Date.now() + BUDGET_MS;

  try {
    let sources; let notFound;
    if (body.companies !== undefined) {
      const names = Array.isArray(body.companies) ? body.companies.filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim().slice(0, 120)) : [];
      if (!names.length || names.length > MAX_COMPANIES) return send(res, 400, { error: `companies must list 1–${MAX_COMPANIES} names.` });
      ({ sources, notFound } = await sourcesForCompanies(names, url, key));
    } else {
      const limit = body.limit === undefined ? BOARDS_PER_RUN : Number(body.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_MANUAL_BOARDS) return send(res, 400, { error: `limit must be 1–${MAX_MANUAL_BOARDS}.` });
      // Seed the curated starter boards (idempotent merge; a cheap no-op once they exist).
      await seedSources(SEED_SOURCES, url, key).catch(() => 0);
      sources = await dueSources(url, key, limit);
    }
    const summary = await syncBoards(sources, { supabaseUrl: url, serviceKey: key, deadline });
    return send(res, 200, { ok: true, caller, ...summary, ...(notFound ? { not_found: notFound } : {}) });
  } catch (e) {
    console.error('refresh-employer-boards failed:', e.message);
    return send(res, 502, { ok: false, error: String(e.message || e).slice(0, 200) });
  }
}
