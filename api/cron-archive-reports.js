// Always-on applicant reports (2026-10-21). The Reddit-archive collector needs no browser and no model, so it
// runs here every hour on Vercel instead of only when the owner's Mac is awake ("my biggest obstacle is the
// computer not being running all the time"). Each run fills the thinnest companies — open listings, fewer
// than 10 applicant reports, most listings first — through the SAME code the Mac collector uses
// (lib/reports/archiveSource.js + lib/reports/collectorRun.js) and the SAME ingest handler, so every account
// passes the strict first-hand rules twice and is published at the Reddit tier (weight 0.3,
// trust_reason reddit_rule_match). Nothing is invented: a company with no first-hand accounts gets none.
//
// Rotation: every run is logged in public.collector_runs (migration 20261021150000); a company tried in the
// last 7 days is skipped, so the queue walks forward instead of retrying the same dry companies hourly.
// Without the table the run still works (no rotation, no log).
//
// GET  (Vercel cron, `Authorization: Bearer $CRON_SECRET` or x-vercel-cron) → one run, ≤ ~4 minutes.
// GET  ?runs=1 with `Authorization: Bearer $LOCAL_COMPANY_INTEL_INGEST_SECRET` → the last 50 cloud runs
//      (Seen Command reads this for its Notifications and Home tabs).
// POST ?secret=$CRON_SECRET → a manual run.
import targetsHandler from './local-company-intel-targets.js';
import ingestHandler from './ingest-local-company-intel.js';
import { runCollection } from '../lib/reports/collectorRun.js';
import { redditArchiveSource } from '../lib/reports/archiveSource.js';

export const PIPELINE = 'applicant_reports_cloud';
const RUN_MS = 230_000;          // the function may run 300 s; leave room to write the log
// Measured live 2026-10-21: the archive answers ~1 search per 9 s when busy (6 of 17 timed out), so a
// 230 s run covers two companies properly rather than six badly.
const PER_COMPANY_MIN = 1.9;
const COMPANIES_PER_RUN = 2;
const BELOW = 10;
const ROTATE_DAYS = 7;

const sb = (path, init = {}) => fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, { ...init,
  headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });

// Call another API handler in-process (no HTTP round trip, no second function invocation).
export function callHandler(handler, { method = 'GET', query = {}, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, setHeader() { return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); return this; }, end() { resolve({ status: this.statusCode, body: null }); return this; } };
    Promise.resolve(handler({ method, query, body, headers }, res)).catch(reject);
  });
}

// A board slug that was only capitalized ("Andurilindustries", "Ivcevidensia") matches no one's post, and a
// search for it burns the run's minutes (seen live 2026-10-21: 2 companies, 0 accounts, all 230 s). Real
// names have a space, a Seen grade row, or are a normal-length single word ("Walmart", "Salesforce").
export const searchableName = (c) => /\s/.test(c.company) || c.has_score || String(c.company).length < 12;

async function recentlyTried() {
  const since = new Date(Date.now() - ROTATE_DAYS * 86400000).toISOString();
  const r = await sb(`collector_runs?pipeline=eq.${PIPELINE}&started_at=gte.${since}&select=companies&limit=1000`).catch(() => null);
  if (!r || !r.ok) return { ok: false, names: new Set() };
  const rows = await r.json();
  return { ok: true, names: new Set(rows.flatMap((x) => x.companies || []).map((n) => String(n).toLowerCase())) };
}

export async function runCloudCollection({ now = Date.now, sources, targetsCall = callHandler, ingestCall = callHandler } = {}) {
  const secret = process.env.LOCAL_COMPANY_INTEL_INGEST_SECRET;
  if (!secret) return { ok: false, status: 'failed', error: 'LOCAL_COMPANY_INTEL_INGEST_SECRET is not set' };
  const auth = { authorization: `Bearer ${secret}` };
  const started = now();
  const t = await targetsCall(targetsHandler, { query: { below: String(BELOW), limit: '100' }, headers: auth });
  if (t.status !== 200) return { ok: false, status: 'failed', error: `targets: ${t.body?.error || t.status}` };
  const tried = await recentlyTried();
  const queue = (t.body.companies || []).filter((c) => c.company && !c.slug_like && searchableName(c)).map((c) => c.company);
  let targets = queue.filter((c) => !tried.names.has(c.toLowerCase())).slice(0, COMPANIES_PER_RUN);
  if (!targets.length) targets = queue.slice(0, COMPANIES_PER_RUN); // a full lap: start over
  let logId = null;
  if (tried.ok) {
    const r = await sb('collector_runs', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ pipeline: PIPELINE, companies: targets, status: 'running' }) }).catch(() => null);
    if (r?.ok) logId = (await r.json())[0]?.id ?? null;
  }
  const postItems = async (items) => {
    const r = await ingestCall(ingestHandler, { method: 'POST', body: { items, require_existing: true }, headers: auth });
    if (r.status !== 200) throw new Error(`Seen ingest failed (${r.status}): ${r.body?.error || 'unknown error'}`);
    return r.body;
  };
  let summary, error = null;
  try {
    summary = await runCollection({ targets, goal: BELOW, minutes: PER_COMPANY_MIN, runDeadline: started + RUN_MS, postItems,
      sources: sources || [redditArchiveSource({ years: 5 })], log: () => {}, warn: () => {}, now, meta: { below: BELOW, queue: t.body.below_count ?? queue.length } });
  } catch (e) { error = String(e?.message || e).slice(0, 300); }
  const status = error || (summary && !summary.ok) ? 'failed' : summary.stopped_early ? 'partial' : 'complete';
  const compact = summary && { ...summary, companies: summary.companies.map(({ company, found, new_reports, duplicates, downgraded, stopped_by, error: e }) => ({ company, found, new_reports, duplicates, downgraded, stopped_by, ...(e ? { error: e } : {}) })) };
  if (logId != null) {
    await sb(`collector_runs?id=eq.${logId}`, { method: 'PATCH', body: JSON.stringify({ status, finished_at: new Date(now()).toISOString(),
      new_reports: summary?.imported_reports || 0, summary: compact,
      // Only companies actually searched count as tried — one the clock never reached stays in the queue.
      ...(summary ? { companies: summary.companies.map((c) => c.company) } : {}), error: error || summary?.ingest_error || null }) }).catch(() => {});
  }
  return { ok: status !== 'failed', status, id: logId, error: error || summary?.ingest_error || null, summary: compact };
}

export default async function handler(req, res) {
  const q = req.query || {};
  if (req.method === 'GET' && String(q.runs) === '1') {
    const secret = process.env.LOCAL_COMPANY_INTEL_INGEST_SECRET;
    if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
    const r = await sb('collector_runs?select=id,pipeline,started_at,finished_at,status,companies,new_reports,error,summary&order=started_at.desc&limit=50').catch(() => null);
    if (!r || !r.ok) return res.status(200).json({ ok: true, ready: false, runs: [] });
    return res.status(200).json({ ok: true, ready: true, runs: await r.json() });
  }
  const cron = process.env.CRON_SECRET;
  // Same rule as the other Seen crons: Vercel's header, or the CRON_SECRET bearer Vercel adds when it is set.
  const isCron = req.headers['x-vercel-cron'] === '1' || (cron && req.headers.authorization === `Bearer ${cron}`);
  const manual = req.method === 'POST' && cron && q.secret === cron;
  if (!((req.method === 'GET' && isCron) || manual)) return res.status(401).json({ error: 'Unauthorized' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return res.status(503).json({ error: 'Storage is unavailable.' });
  const out = await runCloudCollection();
  return res.status(out.ok ? 200 : 500).json(out);
}
