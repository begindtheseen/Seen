// Company-first job pull for Seen Command (owner's Mac → Seen). For each company: its job boards
// (found and registered when Seen has none), its own career site, and Adzuna filtered to that
// employer — see lib/jobs/companyJobs.js. Indeed runs on the Mac alongside; a career site that
// refuses servers comes back in needs_browser for the Mac's Chrome collector.
//
// POST, Bearer LOCAL_INDEED_INGEST_SECRET:
//   { companies: string[1..10], site_limit?: 1..150 (job pages read per career site, default 40),
//     websites?: { [company]: "homedepot.com" } }
// → { ok, results: [per-company report], saved, needs_browser: [{ company, url, host, reason }] }

import { pullCompanyJobs } from '../lib/jobs/companyJobs.js';

const MAX_COMPANIES = 10;
const BUDGET_MS = 270_000; // maxDuration 300 (vercel.json)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const secret = process.env.LOCAL_INDEED_INGEST_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
  const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return res.status(503).json({ error: 'Job storage is unavailable.' });
  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return null; } })() : (req.body || {});
  if (!body) return res.status(400).json({ error: 'Body must be JSON.' });
  const names = Array.isArray(body.companies)
    ? [...new Map(body.companies.filter((n) => typeof n === 'string').map((n) => n.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120)).filter(Boolean).map((n) => [n.toLowerCase(), n])).values()]
    : [];
  if (!names.length || names.length > MAX_COMPANIES) return res.status(400).json({ error: `companies must list 1–${MAX_COMPANIES} names.` });
  const siteLimit = body.site_limit === undefined ? 40 : Number(body.site_limit);
  if (!Number.isInteger(siteLimit) || siteLimit < 1 || siteLimit > 150) return res.status(400).json({ error: 'site_limit must be 1–150.' });
  const websites = body.websites && typeof body.websites === 'object' ? body.websites : {};

  const deadline = Date.now() + BUDGET_MS;
  const results = [];
  for (const company of names) {
    if (Date.now() >= deadline) { results.push({ company, skipped: 'out of time — run it again' }); continue; }
    const site = typeof websites[company] === 'string' ? websites[company].slice(0, 200) : null;
    results.push(await pullCompanyJobs(company, { supabaseUrl: url, serviceKey: key, siteLimit, website: site, deadline }));
  }
  return res.status(200).json({
    ok: true, results,
    saved: results.reduce((a, r) => a + (r.saved || 0), 0),
    needs_browser: results.filter((r) => r.needs_browser).map((r) => ({ company: r.company, ...r.needs_browser })),
  });
}
