// Preset searches for the Mac-local Indeed collector (Seen Command → Aggregation → Indeed Jobs).
// Same Bearer secret as /api/ingest-local-indeed. Read-only. Rules: lib/server/indeedPresets.js.
import { buildPresets, DEMAND_DAYS } from '../lib/server/indeedPresets.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const secret = process.env.LOCAL_INDEED_INGEST_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  let rows = [];
  let demandError = null;
  if (url && key) {
    const since = new Date(Date.now() - DEMAND_DAYS * 86400000).toISOString();
    try {
      const r = await fetch(`${url}/rest/v1/search_logs?select=query,location,result_count&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=5000`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
      if (r.ok) rows = await r.json(); else demandError = `search log read failed (${r.status})`;
    } catch { demandError = 'search log read failed'; }
  } else demandError = 'search log storage is unavailable';
  // The niche list and the maintenance rotation never depend on the log; demand is reported as
  // unavailable (never as "nobody searched") when the log could not be read.
  const out = buildPresets(Array.isArray(rows) ? rows : []);
  if (demandError) { out.demand = { ...out.demand, searches: [], error: demandError }; out.thin = { ...out.thin, searches: [], error: demandError }; }
  return res.status(200).json({ ok: true, ...out });
}
