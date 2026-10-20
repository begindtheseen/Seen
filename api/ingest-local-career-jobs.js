// Jobs the owner's Chrome read from a company career site that refuses servers (Seen Command's
// career-site collector, scripts/collect-career-site.mjs). The browser sends the raw schema.org
// JobPosting objects it found; every one goes through the SAME checks as a server-read career site
// (lib/jobs/careerSite.js rowFromPosting): the posting's employer must be the company asked for, the
// job must be in the US or remote and not expired, and it must pass buildJob's quality gate.
//
// POST, Bearer LOCAL_INDEED_INGEST_SECRET:
//   { company, items: [{ page_url: "https://…", posting: <JobPosting> }] (1–100) }
// → { ok, received, saved, skipped: { reason: n } }

import { rowFromPosting } from '../lib/jobs/careerSite.js';
import { upsertJobs } from '../lib/server/jobSources.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const secret = process.env.LOCAL_INDEED_INGEST_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
  const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return res.status(503).json({ error: 'Job storage is unavailable.' });
  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return null; } })() : (req.body || {});
  const company = typeof body?.company === 'string' ? body.company.trim().slice(0, 120) : '';
  const items = Array.isArray(body?.items) ? body.items.slice(0, 100) : [];
  if (!company || !items.length) return res.status(400).json({ error: 'Provide a company and 1–100 items.' });

  const skipped = {}; const rows = [];
  for (const it of items) {
    let u = null; try { u = new URL(String(it?.page_url || '')); } catch { /* invalid */ }
    if (!u || u.protocol !== 'https:' || !it?.posting || typeof it.posting !== 'object') { skipped.invalid = (skipped.invalid || 0) + 1; continue; }
    const r = rowFromPosting(it.posting, { company, pageUrl: u.toString(), host: u.hostname });
    if (r.skip) { skipped[r.skip] = (skipped[r.skip] || 0) + 1; continue; }
    rows.push({ ...r.row, source: 'Company site (browser)' });
  }
  let saved = 0;
  for (let i = 0; i < rows.length; i += 100) saved += (await upsertJobs(rows.slice(i, i + 100), url, key).catch(() => ({ upserted: 0 }))).upserted || 0;
  return res.status(200).json({ ok: true, received: items.length, saved, skipped });
}
