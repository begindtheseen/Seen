// Admin-only ingress for the Mac-based OpenCLI importer. This endpoint NEVER
// contacts Indeed; it only validates listings already read by the local browser
// worker, then sends them through Seen's normal quality, scoring, and DB path.

import { buildJob, upsertJobs } from '../lib/server/jobSources.js';

const text = (value, max = 12000) => String(value || '').replace(/\0/g, '').trim().slice(0, max);

function indeedUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return /^https:$/.test(url.protocol) && /(^|\.)indeed\.com$/i.test(url.hostname) ? url.toString() : '';
  } catch { return ''; }
}

export function normalizeLocalIndeedJob(raw) {
  const url = indeedUrl(raw?.url || raw?.job_url || raw?.jobUrl);
  if (!url) return null;
  return buildJob({
    title: text(raw?.title || raw?.position, 200),
    company: text(raw?.company || raw?.company_name || raw?.companyName, 120),
    location: text(raw?.location, 120) || 'Remote',
    salary: text(raw?.salary, 120) || null,
    description: text(raw?.description, 12000),
    apply_url: url,
    source: 'Indeed (local OpenCLI)',
    type: /part[ -]?time/i.test(text(raw?.job_type || raw?.jobType || raw?.type, 80)) ? 'Part-time' : 'Full-time',
    searchQuery: text(raw?.search_query || raw?.searchQuery || raw?.title, 160),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const secret = process.env.LOCAL_INDEED_INGEST_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });

  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const input = Array.isArray(body.jobs) ? body.jobs.slice(0, 100) : [];
  if (!input.length) return res.status(400).json({ error: 'Provide 1–100 Indeed jobs.' });

  const rows = input.map(normalizeLocalIndeedJob).filter(Boolean);
  if (!rows.length) return res.status(422).json({ error: 'No valid Indeed job rows were supplied.' });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return res.status(503).json({ error: 'Job storage is unavailable.' });

  try {
    const result = await upsertJobs(rows, url, key);
    return res.status(200).json({ ok: true, received: input.length, accepted: rows.length, upserted: result.upserted || 0, dropped: result.dropped || 0 });
  } catch (error) {
    console.error('local Indeed ingestion failed:', error.message);
    return res.status(500).json({ error: 'Could not store Indeed listings.' });
  }
}
